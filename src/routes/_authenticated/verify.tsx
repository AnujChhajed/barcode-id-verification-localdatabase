import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Quagga from "@ericblade/quagga2";
import { toast } from "sonner";
import {
  ApiError,
  credentialsApi,
  gateApi,
  incidentsApi,
  peopleApi,
  type CredentialView,
  type GateDirection,
  type GateResult,
  type IncidentSeverity,
  type PersonCategory,
  type PersonStatus,
  type VerificationView,
  type WatchlistEntryView,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ScannerStatus from "@/components/ScannerStatus";
import { cn } from "@/lib/utils";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  Clock,
  Eye,
  Keyboard,
  Maximize2,
  Minimize2,
  QrCode,
  RefreshCw,
  ScanLine,
  Search,
  ShieldCheck,
  User as UserIcon,
  UserPlus,
  Wifi,
  WifiOff,
  X,
  XCircle,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/verify")({
  component: VerifyPage,
});

// ── Vocabulary ─────────────────────────────────────────────────────────────
//
// The gate is the one screen a guard uses all shift, so the wording here is
// deliberate:
//   - APPROVED / REJECTED / UNABLE TO VERIFY are the server's three outcomes,
//     and they are never blurred into "allowed" and "denied".
//   - The server decides every scan. Nothing on this page computes a verdict,
//     and a scan that could not be checked is shown as a refusal — never as a
//     pass.

type ScanMode = "scanner" | "camera" | "lookup";

/**
 * One scan, as the gate saw it. `result` is the server's answer; everything
 * else here is either the answer's justification or the identification the
 * guard reads off the screen.
 */
interface Outcome {
  result: GateResult;
  reasonCode: string;
  reasonText: string;
  direction: GateDirection;
  at: Date;
  /** The scan matched one already recorded moments ago. Shown, never hidden. */
  duplicate: boolean;
  /** False when the scan could not be written down. */
  recorded: boolean;
  person: VerificationView | null;
  credential: CredentialView | null;
  /** What the guard scanned or typed. */
  scannedCode: string;
  /** True when no verdict was obtained because the API did not answer. */
  unreachable: boolean;
  /** Advisory watchlist match. Never changes the verdict above. */
  watchlist: WatchlistEntryView | null;
}

interface SessionStats {
  approved: number;
  rejected: number;
  unable: number;
}

const CATEGORY_LABEL: Record<PersonCategory, string> = {
  worker: "verify.category_worker",
  intern: "verify.category_intern",
  visitor: "verify.category_visitor",
};

const STATUS_LABEL: Record<PersonStatus, string> = {
  active: "verify.status_active",
  suspended: "verify.status_suspended",
  terminated: "verify.status_terminated",
};

function statusTone(status: PersonStatus) {
  if (status === "active") return "bg-success/15 text-success";
  if (status === "suspended") return "bg-destructive/15 text-destructive";
  return "bg-secondary text-muted-foreground";
}

function initialsOf(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function timeLabel(at: Date) {
  return at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ── The page ───────────────────────────────────────────────────────────────

function VerifyPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoDirection, setAutoDirection] = useState(true);
  const [manualDirection, setManualDirection] = useState<GateDirection>("entry");
  const [manualOverrideOpen, setManualOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [scanMode, setScanMode] = useState<ScanMode>("scanner");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [recent, setRecent] = useState<Outcome[]>([]);
  const [stats, setStats] = useState<SessionStats>({ approved: 0, rejected: 0, unable: 0 });
  const [showSummary, setShowSummary] = useState(false);
  const [kiosk, setKiosk] = useState(false);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [incidentOpen, setIncidentOpen] = useState(false);

  // Manual lookup — the fallback when a card cannot be read at all.
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupResults, setLookupResults] = useState<VerificationView[]>([]);
  const [lookupBusy, setLookupBusy] = useState(false);

  const [cameraFlash, setCameraFlash] = useState(false);

  const sessionStart = useRef(new Date());
  const inputRef = useRef<HTMLInputElement>(null);
  const lookupInputRef = useRef<HTMLInputElement>(null);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cameraBoxRef = useRef<HTMLDivElement>(null);
  const cameraBusy = useRef(false);
  const quaggaStarted = useRef(false);
  const inFlight = useRef(false);
  const audioCtx = useRef<AudioContext | null>(null);
  const lastScanRef = useRef<{ code: string; time: number } | null>(null);

  const cameraAvailable =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    (typeof window !== "undefined"
      ? window.isSecureContext ||
        location.hostname === "localhost" ||
        location.hostname === "127.0.0.1"
      : false);

  // ── Live signals from the server ─────────────────────────────────────────
  // The "inside now" count doubles as a health probe: if this query fails, the
  // API is not answering and the header says so.
  const insideQuery = useQuery({
    queryKey: ["inside-now"],
    queryFn: gateApi.inside,
    refetchInterval: 30_000,
  });

  const serverDown = insideQuery.isError;
  const insideCount = insideQuery.data?.inside.length ?? 0;

  // ── Audio feedback ───────────────────────────────────────────────────────
  // A guard does not always look at the monitor. Two clearly different tones
  // make the verdict audible from a few metres away.
  const beep = useCallback((ok: boolean) => {
    try {
      const Ctor =
        window.AudioContext ??
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      audioCtx.current ||= new Ctor();
      const ctx = audioCtx.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = ok ? 880 : 220;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (ok ? 0.18 : 0.4));
      osc.start();
      osc.stop(ctx.currentTime + (ok ? 0.2 : 0.45));
    } catch {
      /* audio is a convenience, never a requirement */
    }
  }, []);

  const recordOutcome = useCallback(
    (next: Outcome) => {
      setOutcome(next);
      setRecent((previous) => [next, ...previous].slice(0, 10));
      setStats((previous) => {
        if (next.result === "approved") return { ...previous, approved: previous.approved + 1 };
        if (next.result === "rejected") return { ...previous, rejected: previous.rejected + 1 };
        return { ...previous, unable: previous.unable + 1 };
      });
      beep(next.result === "approved");
    },
    [beep],
  );

  // ── The scan ─────────────────────────────────────────────────────────────
  const verify = useCallback(
    async (
      raw: string,
      overrideOpts?: { direction?: GateDirection; overrideReason?: string },
    ) => {
      const scanned = raw.trim();
      if (!scanned || inFlight.current) return;

      // 1.2s cooldown debounce on identical scan to prevent multiple enter/frames
      const now = Date.now();
      if (
        lastScanRef.current &&
        lastScanRef.current.code === scanned &&
        now - lastScanRef.current.time < 1200
      ) {
        return;
      }
      lastScanRef.current = { code: scanned, time: now };

      const chosenDirection =
        overrideOpts?.direction ?? (autoDirection ? "auto" : manualDirection);
      const chosenReason = overrideOpts?.overrideReason ?? (autoDirection ? undefined : overrideReason);

      inFlight.current = true;
      setBusy(true);
      try {
        const answer = await gateApi.verify(scanned, chosenDirection, chosenReason);
        recordOutcome({
          result: answer.result,
          reasonCode: answer.reasonCode,
          reasonText: answer.reasonText,
          direction: answer.direction,
          at: new Date(answer.occurredAt),
          duplicate: answer.duplicate,
          recorded: answer.recorded,
          person: answer.person,
          credential: answer.credential,
          scannedCode: scanned,
          unreachable: false,
          watchlist: answer.watchlist ?? null,
        });

        const displayId =
          answer.person?.shortId ||
          answer.person?.workerRef ||
          answer.credential?.id ||
          scanned;

        if (answer.result === "approved") {
          void queryClient.invalidateQueries({ queryKey: ["inside-now"] });
          if (answer.direction === "entry") {
            toast.success(`ENTRY RECORDED — ${displayId}`);
          } else {
            toast.success(`EXIT RECORDED — ${displayId}`);
          }
        } else if (answer.result === "rejected") {
          const reason = (answer.reasonText || answer.reasonCode || "").toUpperCase();
          toast.error(`ACCESS DENIED — ${reason}`);
        } else {
          toast.error("UNABLE TO VERIFY — TRY AGAIN");
        }
      } catch (error) {
        // Fail closed. A verdict we did not obtain is a refusal, and saying so
        // is the only safe thing to put in front of a guard.
        const unreachable =
          error instanceof ApiError && (error.code === "NETWORK" || error.status === 0);
        recordOutcome({
          result: "unable_to_verify",
          reasonCode: unreachable ? "server_unreachable" : "request_failed",
          reasonText: unreachable
            ? t("verify.server_unreachable")
            : error instanceof ApiError
              ? error.message
              : t("common.error"),
          direction: chosenDirection === "auto" ? "entry" : chosenDirection,
          at: new Date(),
          duplicate: false,
          recorded: false,
          person: null,
          credential: null,
          scannedCode: scanned,
          unreachable,
          watchlist: null,
        });
        toast.error("UNABLE TO VERIFY — TRY AGAIN");
      } finally {
        inFlight.current = false;
        setBusy(false);
        setCode("");
        if (scanMode === "scanner") setTimeout(() => inputRef.current?.focus(), 0);
      }
    },
    [autoDirection, manualDirection, overrideReason, recordOutcome, scanMode, queryClient, t],
  );

  const verifyRef = useRef(verify);
  useEffect(() => {
    verifyRef.current = verify;
  }, [verify]);

  // ── Focus handling ───────────────────────────────────────────────────────
  useEffect(() => {
    if (outcome) return;
    if (scanMode === "scanner") inputRef.current?.focus();
    if (scanMode === "lookup") lookupInputRef.current?.focus();
  }, [scanMode, outcome]);

  // ── Kiosk mode ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (kiosk) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
  }, [kiosk]);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setKiosk(false);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // ── Camera scanning (Quagga2, 1D formats) ───────────────────────────────
  useEffect(() => {
    if (scanMode !== "camera") {
      if (quaggaStarted.current) {
        try {
          Quagga.stop();
        } catch {
          /* already stopped */
        }
        quaggaStarted.current = false;
      }
      return;
    }

    if (!cameraAvailable) {
      toast.error(t("verify.camera_denied"), { duration: 6000 });
      setScanMode("scanner");
      return;
    }
    if (!cameraBoxRef.current) return;

    let stopped = false;

    const onDetected = (detection: unknown) => {
      if (stopped || cameraBusy.current) return;
      if (!detection || typeof detection !== "object" || !("codeResult" in detection)) return;
      const codeResult = (detection as { codeResult?: { code?: unknown } }).codeResult;
      const value = codeResult?.code;
      if (typeof value !== "string" || !value) return;

      // Suppress the same barcode being reported many times per second.
      cameraBusy.current = true;
      setTimeout(() => {
        cameraBusy.current = false;
      }, 1500);

      setCameraFlash(true);
      setTimeout(() => setCameraFlash(false), 600);
      void verifyRef.current(value);
    };

    Quagga.init(
      {
        inputStream: {
          type: "LiveStream",
          target: cameraBoxRef.current,
          constraints: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: "environment",
          },
        },
        locate: true,
        numOfWorkers:
          typeof navigator !== "undefined" ? Math.min(navigator.hardwareConcurrency ?? 2, 4) : 2,
        decoder: {
          // QR first: every card and pass now carries the credential id as a QR
          // code. The linear readers stay so an older printed card still scans.
          // `qr_reader` is written in the object form because this build's type
          // union for the string form predates the library's QR support.
          readers: [
            { format: "qr_reader", config: { supplements: [] } },
            "code_128_reader",
            "code_39_reader",
            "code_93_reader",
            "ean_reader",
            "ean_8_reader",
            "i2of5_reader",
            "codabar_reader",
          ],
          debug: {
            drawBoundingBox: false,
            showFrequency: false,
            drawScanline: false,
            showPattern: false,
          },
        },
      },
      (error: unknown) => {
        if (error) {
          toast.error(t("verify.camera_denied"), { duration: 6000 });
          setScanMode("scanner");
          return;
        }
        if (!stopped) {
          Quagga.onDetected(onDetected);
          Quagga.start();
          quaggaStarted.current = true;
        }
      },
    );

    return () => {
      stopped = true;
      Quagga.offDetected(onDetected);
      if (quaggaStarted.current) {
        try {
          Quagga.stop();
        } catch {
          /* already stopped */
        }
        quaggaStarted.current = false;
      }
    };
  }, [scanMode, cameraAvailable, t]);

  // ── Manual lookup ────────────────────────────────────────────────────────
  const runLookup = useCallback(async (term: string) => {
    const query = term.trim();
    if (!query) {
      setLookupResults([]);
      return;
    }
    setLookupBusy(true);
    try {
      setLookupResults(await peopleApi.search(query, 10));
    } catch {
      setLookupResults([]);
    } finally {
      setLookupBusy(false);
    }
  }, []);

  const onLookupChange = (value: string) => {
    setLookupQuery(value);
    clearTimeout(lookupTimer.current);
    lookupTimer.current = setTimeout(() => void runLookup(value), 400);
  };

  // Manual lookup never relies on the Entry/Exit toggle: the guard states the
  // direction for the person in front of them.
  const verifyFromLookup = (person: VerificationView, lookupDirection: GateDirection) => {
    if (!person.activeCredentialId && !person.shortId) {
      toast.error(t("verify.lookup_no_credential", { name: person.fullName }));
      return;
    }
    setLookupQuery("");
    setLookupResults([]);
    const targetCode = person.activeCredentialId || person.shortId || person.id;
    void verify(targetCode, { direction: lookupDirection });
  };

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void verify(code);
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className={cn(kiosk && "fixed inset-0 z-50 overflow-auto bg-background p-4")}>
      <div
        className={cn(
          !kiosk && "grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start",
        )}
      >
        {/* ── Left column — the scan itself ── */}
        <div className="space-y-4">
          {/* ── Header ── */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">{t("verify.page_title")}</h1>
              <p className="text-sm text-muted-foreground">{t("verify.page_subtitle")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
                  serverDown ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success",
                )}
              >
                {serverDown ? <WifiOff className="h-3 w-3" /> : <Wifi className="h-3 w-3" />}
                {serverDown ? t("verify.server_down") : t("verify.server_ok")}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-muted-foreground">
                <Eye className="h-3 w-3" />
                {t("verify.inside_now", { count: insideCount })}
              </span>
              {!kiosk && (
                <Link to="/logs">
                  <Button size="sm" variant="outline">
                    <Clock className="mr-1.5 h-3.5 w-3.5" />
                    {t("verify.view_logs")}
                  </Button>
                </Link>
              )}
              {!kiosk && (
                <Button size="sm" variant="outline" onClick={() => setIncidentOpen(true)}>
                  <AlertOctagon className="mr-1.5 h-3.5 w-3.5" />
                  {t("verify.report_incident")}
                </Button>
              )}
              {!kiosk && isAdmin && (
                <Button size="sm" variant="outline" onClick={() => setWalkInOpen(true)}>
                  <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                  {t("verify.walk_in")}
                </Button>
              )}
              <Button
                size="sm"
                variant={kiosk ? "default" : "outline"}
                onClick={() => setKiosk((value) => !value)}
                title={kiosk ? t("verify.kiosk_off") : t("verify.kiosk_on")}
              >
                {kiosk ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </div>

          {/* ── Gate controls ── */}
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                Gate Direction Mode
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAutoDirection(true);
                    setOverrideReason("");
                  }}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-all",
                    autoDirection
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-secondary text-muted-foreground hover:text-foreground",
                  )}
                >
                  <RefreshCw className="h-4 w-4" />
                  Auto IN / OUT
                </button>

                <Button
                  type="button"
                  variant={!autoDirection ? "destructive" : "outline"}
                  size="sm"
                  onClick={() => setManualOverrideOpen(true)}
                  className="h-[38px] font-medium"
                >
                  <AlertTriangle className="mr-1.5 h-4 w-4" />
                  {!autoDirection ? `Override: ${manualDirection.toUpperCase()}` : "Manual Override"}
                </Button>
              </div>
            </div>

            {!autoDirection && (
              <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
                <span className="font-semibold text-warning">
                  FORCING {manualDirection.toUpperCase()}:
                </span>
                <span className="max-w-[200px] truncate text-muted-foreground" title={overrideReason}>
                  {overrideReason || "Reason required"}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAutoDirection(true);
                    setOverrideReason("");
                  }}
                  className="ml-2 font-bold text-primary underline"
                >
                  Reset to Auto
                </button>
              </div>
            )}

            {/* Plant 3 has exactly one gate, so it is stated rather than chosen. */}
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("verify.gate")}</p>
              <div className="flex h-[38px] items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 text-sm font-medium">
                <ShieldCheck className="h-4 w-4 text-primary" />
                {t("verify.gate_fixed")}
              </div>
            </div>

            <button
              onClick={() => setShowSummary((value) => !value)}
              className="ml-auto flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary"
            >
              <RefreshCw className="h-4 w-4" />
              {t("verify.summary")}
              <span className="rounded-full bg-primary/15 px-1.5 text-xs text-primary">
                {stats.approved + stats.rejected + stats.unable}
              </span>
            </button>
          </div>

          {/* ── Session summary ── */}
          {showSummary && (
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="mb-4 flex items-center justify-between">
                <span className="font-semibold">{t("verify.shift_summary")}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {t("verify.shift_since", {
                      time: sessionStart.current.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      }),
                    })}
                  </span>
                  <button
                    onClick={() => setShowSummary(false)}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  {
                    label: t("verify.shift_approved"),
                    value: stats.approved,
                    tone: "text-success",
                    bg: "bg-success/10",
                  },
                  {
                    label: t("verify.shift_rejected"),
                    value: stats.rejected,
                    tone: "text-destructive",
                    bg: "bg-destructive/10",
                  },
                  {
                    label: t("verify.shift_unable"),
                    value: stats.unable,
                    tone: "text-warning",
                    bg: "bg-warning/10",
                  },
                  {
                    label: t("verify.shift_total"),
                    value: stats.approved + stats.rejected + stats.unable,
                    tone: "text-primary",
                    bg: "bg-primary/10",
                  },
                ].map(({ label, value, tone, bg }) => (
                  <div key={label} className={cn("flex flex-col items-center rounded-xl py-4", bg)}>
                    <span className={cn("text-3xl font-bold", tone)}>{value}</span>
                    <span className="mt-1 text-xs font-medium text-muted-foreground">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Mode switcher ── */}
          {!kiosk && (
            <div className="grid grid-cols-3 gap-3">
              <ModeCard
                active={scanMode === "scanner"}
                icon={<Keyboard className="h-5 w-5" />}
                title={t("verify.mode_scanner")}
                subtitle={t("verify.mode_scanner_sub")}
                onClick={() => setScanMode("scanner")}
              />
              <ModeCard
                active={scanMode === "camera"}
                disabled={!cameraAvailable}
                icon={<QrCode className="h-5 w-5" />}
                title={t("verify.mode_camera")}
                subtitle={
                  cameraAvailable ? t("verify.mode_camera_sub") : t("verify.mode_camera_https")
                }
                onClick={() => {
                  if (!cameraAvailable) {
                    toast.error(t("verify.camera_denied"), { duration: 6000 });
                    return;
                  }
                  setScanMode("camera");
                }}
              />
              <ModeCard
                active={scanMode === "lookup"}
                icon={<Search className="h-5 w-5" />}
                title={t("verify.mode_lookup")}
                subtitle={t("verify.mode_lookup_sub")}
                onClick={() => setScanMode("lookup")}
              />
            </div>
          )}

          {scanMode === "scanner" && !kiosk && <ScannerStatus />}

          {/* ── Mode 1 — hardware scanner ── */}
          {scanMode === "scanner" && (
            <div className="overflow-hidden rounded-xl border-2 border-primary/20 bg-card shadow-sm">
              <div className="flex items-center gap-4 border-b border-border bg-primary/[0.03] px-5 py-4">
                <div className="relative shrink-0">
                  <span className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
                  <div className="relative grid h-12 w-12 place-items-center rounded-full bg-primary/10 ring-1 ring-primary/25">
                    <ScanLine className="h-6 w-6 text-primary" />
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-foreground">{t("verify.ready_title")}</p>
                  <p className="text-xs text-muted-foreground">{t("verify.ready_sub")}</p>
                </div>
                {busy && (
                  <span className="shrink-0 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-semibold text-warning">
                    {t("verify.verifying")}
                  </span>
                )}
              </div>
              <form onSubmit={onSubmit} className="p-4">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <ScanLine className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      ref={inputRef}
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder={t("verify.scan_placeholder")}
                      autoFocus
                      autoComplete="off"
                      spellCheck={false}
                      disabled={busy}
                      className="h-16 pl-12 font-mono text-xl tracking-wide"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={busy || !code.trim()}
                    className="h-16 px-6 text-base"
                  >
                    {t("verify.verify_btn")}
                  </Button>
                </div>
                <p className="mt-2.5 text-center text-xs text-muted-foreground">
                  {t("verify.enter_hint")}{" "}
                  <kbd className="rounded border border-border bg-secondary px-1 py-0.5 font-mono text-[10px]">
                    Enter
                  </kbd>
                </p>
              </form>
            </div>
          )}

          {/* ── Mode 2 — camera ── */}
          {scanMode === "camera" && (
            <div className="overflow-hidden rounded-xl border-2 border-primary/20 bg-black shadow-sm">
              <div className="relative">
                <div
                  ref={cameraBoxRef}
                  className="block aspect-video w-full overflow-hidden bg-black [&_canvas]:hidden [&_video]:h-full [&_video]:w-full [&_video]:object-cover"
                />
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <div
                    className="absolute inset-0"
                    style={{ boxShadow: "inset 0 0 80px 30px rgba(0,0,0,0.65)" }}
                  />
                  <div className="relative z-10 h-20 w-72 sm:h-24 sm:w-96">
                    <span className="absolute left-0 top-0 h-6 w-8 rounded-tl-sm border-l-[3px] border-t-[3px] border-white" />
                    <span className="absolute right-0 top-0 h-6 w-8 rounded-tr-sm border-r-[3px] border-t-[3px] border-white" />
                    <span className="absolute bottom-0 left-0 h-6 w-8 rounded-bl-sm border-b-[3px] border-l-[3px] border-white" />
                    <span className="absolute bottom-0 right-0 h-6 w-8 rounded-br-sm border-b-[3px] border-r-[3px] border-white" />
                    <div
                      className="absolute inset-x-0 h-0.5 rounded-full animate-scan-line"
                      style={{
                        background:
                          "linear-gradient(to right, transparent, oklch(0.68 0.14 155), transparent)",
                        boxShadow: "0 0 8px 2px oklch(0.68 0.14 155 / 0.6)",
                      }}
                    />
                    {cameraFlash && (
                      <div className="absolute inset-0 rounded-sm bg-success/40 animate-in fade-in zoom-in-95 duration-150" />
                    )}
                  </div>
                  <div className="relative z-10 mt-5 flex items-center gap-2 rounded-full bg-black/60 px-4 py-1.5 backdrop-blur-sm">
                    <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                    <span className="text-xs font-semibold tracking-wide text-white/90">
                      {t("verify.camera_scanning")}
                    </span>
                  </div>
                </div>
                {busy && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60">
                    <div className="flex flex-col items-center gap-3">
                      <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                      <p className="text-sm font-semibold text-white">{t("verify.verifying")}</p>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between gap-3 bg-card px-5 py-3">
                <div className="flex items-center gap-2.5">
                  <QrCode className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="text-xs leading-tight text-muted-foreground">
                    {t("verify.camera_hint")}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setScanMode("scanner")}
                  className="shrink-0 text-xs"
                >
                  <Keyboard className="mr-1.5 h-3.5 w-3.5" />
                  {t("verify.use_scanner")}
                </Button>
              </div>
            </div>
          )}

          {/* ── Mode 3 — manual lookup ── */}
          {scanMode === "lookup" && (
            <div className="overflow-hidden rounded-xl border-2 border-primary/20 bg-card shadow-sm">
              <div className="border-b border-border bg-primary/[0.03] px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/10">
                    <Search className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-bold">{t("verify.lookup_title")}</p>
                    <p className="text-xs text-muted-foreground">{t("verify.lookup_sub")}</p>
                  </div>
                </div>
              </div>
              <div className="space-y-3 p-4">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={lookupInputRef}
                    value={lookupQuery}
                    onChange={(event) => onLookupChange(event.target.value)}
                    placeholder={t("verify.lookup_placeholder")}
                    autoFocus
                    autoComplete="off"
                    className="h-12 pl-11"
                  />
                  {lookupBusy && (
                    <div className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  )}
                </div>

                {lookupResults.length > 0 && (
                  <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                    {lookupResults.map((person) => (
                      <div key={person.id} className="flex items-center gap-3 px-4 py-3">
                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary text-xs font-bold text-muted-foreground">
                          {initialsOf(person.fullName)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{person.fullName}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {t(CATEGORY_LABEL[person.category])}
                            {person.workerRef ? ` · ${person.workerRef}` : ""}
                            {person.contractorCompany ? ` · ${person.contractorCompany}` : ""}
                            {person.institutionName ? ` · ${person.institutionName}` : ""}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                            statusTone(person.status),
                          )}
                        >
                          {t(STATUS_LABEL[person.status])}
                        </span>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy || !person.activeCredentialId}
                            title={
                              person.activeCredentialId
                                ? undefined
                                : t("verify.lookup_no_credential", { name: person.fullName })
                            }
                            onClick={() => verifyFromLookup(person, "entry")}
                          >
                            <ArrowDownToLine className="mr-1 h-3.5 w-3.5" />
                            {t("verify.mark_in")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy || !person.activeCredentialId}
                            title={
                              person.activeCredentialId
                                ? undefined
                                : t("verify.lookup_no_credential", { name: person.fullName })
                            }
                            onClick={() => verifyFromLookup(person, "exit")}
                          >
                            <ArrowUpFromLine className="mr-1 h-3.5 w-3.5" />
                            {t("verify.mark_out")}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {lookupQuery.trim().length > 2 && lookupResults.length === 0 && !lookupBusy && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {t("verify.lookup_no_results", { query: lookupQuery })}
                  </p>
                )}

                {lookupQuery.trim().length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {t("verify.lookup_none")}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Right column — the session, kept in view beside the scan ── */}
        {!kiosk && (
          <aside className="space-y-3 lg:sticky lg:top-4">
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <div className="grid grid-cols-3 gap-2 p-3">
                {[
                  {
                    label: t("verify.shift_approved"),
                    value: stats.approved,
                    tone: "text-success",
                    bg: "bg-success/10",
                  },
                  {
                    label: t("verify.shift_rejected"),
                    value: stats.rejected,
                    tone: "text-destructive",
                    bg: "bg-destructive/10",
                  },
                  {
                    label: t("verify.shift_unable"),
                    value: stats.unable,
                    tone: "text-warning",
                    bg: "bg-warning/10",
                  },
                ].map(({ label, value, tone, bg }) => (
                  <div key={label} className={cn("flex flex-col items-center rounded-lg py-3", bg)}>
                    <span className={cn("text-2xl font-bold", tone)}>{value}</span>
                    <span className="mt-1 text-center text-[11px] font-medium leading-tight text-muted-foreground">
                      {label}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-center gap-1.5 border-t border-border px-3 py-2 text-xs font-medium text-muted-foreground">
                <Eye className="h-3.5 w-3.5" />
                {t("verify.inside_now", { count: insideCount })}
              </div>
            </div>

            {/* Recent scans (this session) */}
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <div className="flex items-center justify-between border-b border-border px-5 py-3">
                <span className="text-sm font-semibold">{t("verify.recent_title")}</span>
                <span className="text-xs text-muted-foreground">
                  {t("verify.recent_count", { count: recent.length })}
                </span>
              </div>
              {recent.length === 0 ? (
                <p className="px-5 py-6 text-center text-sm text-muted-foreground">
                  {t("verify.recent_empty")}
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {recent.map((scan, index) => (
                    <div
                      key={`${scan.scannedCode}-${index}`}
                      className="flex items-center gap-3 px-5 py-2.5 text-sm"
                    >
                      {scan.result === "approved" ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                      ) : scan.result === "rejected" ? (
                        <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                      )}
                      <span className="rounded bg-secondary px-1.5 text-[10px] uppercase text-muted-foreground">
                        {scan.direction === "entry" ? t("verify.dir_entry") : t("verify.dir_exit")}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {scan.person?.fullName ?? t("verify.no_holder")}
                        {scan.reasonText && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            · {scan.reasonText}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {timeLabel(scan.at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* ── Result overlay ── */}
      {outcome && (
        <ResultOverlay
          outcome={outcome}
          onClose={() => {
            setOutcome(null);
            if (scanMode === "scanner") setTimeout(() => inputRef.current?.focus(), 50);
          }}
        />
      )}

      {/* ── Visitor walk-in (C7): register → short gate pass → entry ── */}
      {walkInOpen && isAdmin && (
        <WalkInDialog
          onIssued={(credentialId) => void verify(credentialId, { direction: "entry" })}
          onClose={() => setWalkInOpen(false)}
        />
      )}

      {/* ── Manual Gate Direction Override ── */}
      {manualOverrideOpen && (
        <ManualOverrideDialog
          initialDirection={manualDirection}
          initialReason={overrideReason}
          onApply={(dir, reason) => {
            setManualDirection(dir);
            setOverrideReason(reason);
            setAutoDirection(false);
            toast.info(`Manual override set: Forcing ${dir.toUpperCase()}`);
          }}
          onClose={() => setManualOverrideOpen(false)}
        />
      )}

      {/* ── Report an incident (C8) ── */}
      {incidentOpen && (
        <IncidentDialog person={outcome?.person ?? null} onClose={() => setIncidentOpen(false)} />
      )}
    </div>
  );
}

// ── Mode card ──────────────────────────────────────────────────────────────

function ModeCard({
  active,
  disabled,
  icon,
  title,
  subtitle,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-2.5 rounded-xl border-2 px-3 py-5 text-center transition-all duration-200",
        disabled
          ? "cursor-not-allowed border-border bg-card/50 opacity-50"
          : active
            ? "border-primary bg-primary/5 shadow-sm"
            : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-primary/[0.03]",
      )}
    >
      <div
        className={cn(
          "grid h-11 w-11 place-items-center rounded-xl",
          !disabled && active ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground",
        )}
      >
        {icon}
      </div>
      <div>
        <p
          className={cn(
            "text-sm font-semibold leading-tight",
            !disabled && active && "text-primary",
          )}
        >
          {title}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>
      </div>
    </button>
  );
}

// ── Result overlay ─────────────────────────────────────────────────────────
//
// The verdict is deliberately full-screen and colour-coded: green for approved,
// red for rejected, amber for unable to verify. Amber is never green.

function ResultOverlay({ outcome, onClose }: { outcome: Outcome; onClose: () => void }) {
  const { t } = useTranslation();
  const seconds = outcome.result === "approved" ? 5 : 12;
  const [remaining, setRemaining] = useState(seconds);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    setRemaining(seconds);
    const timer = setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          clearInterval(timer);
          closeRef.current();
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [outcome, seconds]);

  const tone =
    outcome.result === "approved"
      ? {
          icon: CheckCircle2,
          label: t("verify.result_approved"),
          header: "bg-success",
          fg: "text-success-foreground",
          ring: "ring-success/40",
          bar: "bg-success",
        }
      : outcome.result === "rejected"
        ? {
            icon: XCircle,
            label: t("verify.result_rejected"),
            header: "bg-destructive",
            fg: "text-destructive-foreground",
            ring: "ring-destructive/40",
            bar: "bg-destructive",
          }
        : {
            icon: AlertTriangle,
            label: t("verify.result_unable"),
            header: "bg-warning",
            fg: "text-warning-foreground",
            ring: "ring-warning/40",
            bar: "bg-warning",
          };

  const Icon = tone.icon;
  const person = outcome.person;
  const progress = (remaining / seconds) * 100;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-3 animate-in fade-in duration-150 sm:p-6">
      <div
        className={cn(
          "w-full max-w-lg overflow-hidden rounded-2xl shadow-2xl ring-2 animate-in zoom-in-95 duration-200",
          tone.ring,
        )}
      >
        {/* Verdict */}
        <div
          className={cn("flex items-center justify-between gap-3 px-5 py-4", tone.header, tone.fg)}
        >
          <div className="flex items-center gap-3">
            <Icon className="h-7 w-7 shrink-0" />
            <div>
              <p className="text-xl font-extrabold leading-tight tracking-tight">{tone.label}</p>
              <p className="text-sm opacity-80">
                {outcome.direction === "entry" ? t("verify.result_entry") : t("verify.result_exit")}{" "}
                · {timeLabel(outcome.at)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full p-2 transition-colors hover:bg-white/20"
            title={t("verify.result_close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Holder */}
        <div className="flex gap-4 bg-card p-5">
          <div className="grid h-28 w-28 shrink-0 place-items-center rounded-xl bg-secondary text-2xl font-bold text-muted-foreground ring-1 ring-border sm:h-32 sm:w-32">
            {person ? (
              initialsOf(person.fullName)
            ) : (
              <UserIcon className="h-12 w-12 text-muted-foreground/40" />
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            {person ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xl font-bold leading-tight">{person.fullName}</p>
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">
                    {t(CATEGORY_LABEL[person.category])}
                  </span>
                </div>
                {/* Short ID badge */}
                <div className="inline-flex items-center gap-2 rounded-md bg-secondary px-2.5 py-1 text-sm font-bold tracking-wide text-foreground">
                  <span>ID NO. {person.shortId || person.workerRef || person.id.slice(0, 8).toUpperCase()}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                      statusTone(person.status),
                    )}
                  >
                    {t(STATUS_LABEL[person.status])}
                  </span>
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">
                    {outcome.direction === "entry" ? "GATE IN" : "GATE OUT"}
                  </span>
                  {outcome.credential && (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                      {outcome.credential.kind === "id_card"
                        ? t("verify.kind_id_card")
                        : t("verify.kind_gate_pass")}
                    </span>
                  )}
                </div>
                <div className="space-y-0.5 pt-1 text-xs text-muted-foreground">
                  {person.workerRef && person.workerRef !== person.shortId && (
                    <p>
                      {t("verify.worker_ref")}:{" "}
                      <span className="font-medium text-foreground">{person.workerRef}</span>
                    </p>
                  )}
                  {person.contractorCompany && (
                    <p>
                      {t("verify.contractor")}:{" "}
                      <span className="font-medium text-foreground">
                        {person.contractorCompany}
                      </span>
                    </p>
                  )}
                  {person.institutionName && (
                    <p>
                      {t("verify.institution")}:{" "}
                      <span className="font-medium text-foreground">{person.institutionName}</span>
                    </p>
                  )}
                  {outcome.credential && (
                    <p>
                      {t("verify.valid_until")}:{" "}
                      <span className="font-medium text-foreground">
                        {outcome.credential.validTo}
                      </span>
                    </p>
                  )}
                </div>
                <div className="pt-1.5">
                  <Link
                    to="/register"
                    className="text-xs font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
                  >
                    View Record & ID Card →
                  </Link>
                </div>
              </>
            ) : (
              <div className="space-y-1">
                <p className="text-base font-semibold text-muted-foreground">
                  {t("verify.no_holder")}
                </p>
                <p className="font-mono text-xs text-muted-foreground">{outcome.scannedCode}</p>
              </div>
            )}

            {/* Why — the server's own words, never a client-side guess. */}
            <div
              className={cn(
                "mt-2 rounded-lg px-3 py-2 text-sm font-medium",
                outcome.result === "approved"
                  ? "bg-success/10 text-success"
                  : outcome.result === "rejected"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-warning/10 text-warning",
              )}
            >
              {outcome.reasonText}
            </div>
          </div>
        </div>

        {/* Watchlist alert — advisory. It is shown alongside the verdict and
            never changes it: the server owns the decision. */}
        {outcome.watchlist && (
          <div
            className={cn(
              "flex items-start gap-3 border-t-2 px-5 py-3",
              outcome.watchlist.level === "detain"
                ? "border-destructive bg-destructive text-destructive-foreground"
                : outcome.watchlist.level === "deny"
                  ? "border-destructive bg-destructive/10 text-destructive"
                  : outcome.watchlist.level === "warn"
                    ? "border-warning bg-warning/10 text-warning"
                    : "border-border bg-secondary/40 text-muted-foreground",
            )}
          >
            <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-extrabold uppercase tracking-wide">
                {t("verify.watchlist_alert")} ·{" "}
                {t(`verify.watchlist_level_${outcome.watchlist.level}`)}
              </p>
              <p className="text-sm font-medium">{outcome.watchlist.fullName}</p>
              <p className="text-xs opacity-90">
                {t("verify.watchlist_reason")}: {outcome.watchlist.reason}
              </p>
              <p className="mt-1 text-[11px] opacity-75">{t("verify.watchlist_advisory")}</p>
            </div>
          </div>
        )}

        {/* Cautions */}
        {(outcome.duplicate || !outcome.recorded || outcome.unreachable) && (
          <div className="space-y-1.5 border-t border-border bg-secondary/30 px-5 py-3 text-xs">
            {outcome.duplicate && (
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="h-3.5 w-3.5 shrink-0" />
                {t("verify.duplicate_note")}
              </p>
            )}
            {!outcome.recorded && (
              <p className="flex items-center gap-1.5 text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {t("verify.not_recorded")}
              </p>
            )}
            {outcome.unreachable && (
              <p className="flex items-center gap-1.5 text-destructive">
                <WifiOff className="h-3.5 w-3.5 shrink-0" />
                {t("verify.server_unreachable")}
              </p>
            )}
          </div>
        )}

        {/* Countdown */}
        <div className="space-y-3 border-t border-border bg-secondary/30 px-5 py-4">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-1000 ease-linear",
                tone.bar,
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {t("verify.result_auto_close", { secs: remaining })}
            </span>
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <X className="h-3.5 w-3.5" />
              {t("verify.result_close")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Visitor walk-in (C7) ───────────────────────────────────────────────────
//
// One flow for someone who arrives without a card: the visitor is registered,
// a gate pass valid for today is issued, and the entry is recorded — all
// server-side, so the pass the guard just created is the pass the server
// checks. Registration is personal data, so the action is administrator-only.

/** Today's calendar date in the browser zone, `YYYY-MM-DD`. */
function localDateKey() {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function WalkInDialog({
  onIssued,
  onClose,
}: {
  onIssued: (credentialId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [purpose, setPurpose] = useState("");
  const [host, setHost] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const create = useMutation({
    mutationFn: async () => {
      const person = await peopleApi.create({
        category: "visitor",
        fullName: fullName.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        purposeOfVisit: purpose.trim(),
        personToMeet: host.trim(),
      });
      const today = localDateKey();
      const credential = await credentialsApi.issue({
        personId: person.id,
        kind: "gate_pass",
        validFrom: today,
        validTo: today,
      });
      return { person, credential };
    },
    onSuccess: ({ person, credential }) => {
      void queryClient.invalidateQueries({ queryKey: ["people"] });
      toast.success(t("verify.walkin_done", { name: person.fullName }));
      onIssued(credential.id);
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.details?.length) {
        setFieldErrors(Object.fromEntries(error.details.map((d) => [d.path, d.message])));
      } else {
        setFieldErrors({});
      }
      toast.error(error instanceof ApiError ? error.message : t("common.error"));
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFieldErrors({});
    if (!fullName.trim() || !purpose.trim() || !host.trim()) {
      toast.error(t("verify.walkin_required"));
      return;
    }
    create.mutate();
  };

  const fieldError = (name: string) =>
    fieldErrors[name] ? <p className="text-xs text-destructive">{fieldErrors[name]}</p> : null;

  return (
    <Dialog open onOpenChange={(open) => !open && !create.isPending && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            {t("verify.walkin_title")}
          </DialogTitle>
          <DialogDescription>{t("verify.walkin_desc")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="walkin-name">{t("verify.walkin_name")}</Label>
            <Input
              id="walkin-name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder={t("verify.walkin_name_ph")}
              autoComplete="off"
              autoFocus
              disabled={create.isPending}
            />
            {fieldError("fullName")}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="walkin-phone">{t("verify.walkin_phone")}</Label>
            <Input
              id="walkin-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder={t("verify.walkin_phone_ph")}
              autoComplete="off"
              disabled={create.isPending}
            />
            {fieldError("phone")}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="walkin-purpose">{t("verify.walkin_purpose")}</Label>
            <Input
              id="walkin-purpose"
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
              placeholder={t("verify.walkin_purpose_ph")}
              autoComplete="off"
              disabled={create.isPending}
            />
            {fieldError("purposeOfVisit")}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="walkin-host">{t("verify.walkin_host")}</Label>
            <Input
              id="walkin-host"
              value={host}
              onChange={(event) => setHost(event.target.value)}
              placeholder={t("verify.walkin_host_ph")}
              autoComplete="off"
              disabled={create.isPending}
            />
            {fieldError("personToMeet")}
          </div>

          <p className="rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
            {t("verify.walkin_note")}
          </p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? t("verify.walkin_working") : t("verify.walkin_submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Report an incident (C8) ────────────────────────────────────────────────
//
// A guard must be able to record what just happened without leaving the gate.
// The report is dated by the server and attributed to this gate; the person is
// linked only when the gate actually knows who was involved.

const INCIDENT_SEVERITIES: IncidentSeverity[] = ["low", "medium", "high", "critical"];

const SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  low: "verify.sev_low",
  medium: "verify.sev_medium",
  high: "verify.sev_high",
  critical: "verify.sev_critical",
};

const SEVERITY_TONE: Record<IncidentSeverity, string> = {
  low: "bg-secondary text-muted-foreground",
  medium: "bg-warning/20 text-warning",
  high: "bg-destructive/15 text-destructive",
  critical: "bg-destructive text-destructive-foreground",
};

function IncidentDialog({
  person,
  onClose,
}: {
  person: VerificationView | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<IncidentSeverity>("medium");
  const [description, setDescription] = useState("");
  const [linkPerson, setLinkPerson] = useState(Boolean(person));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const create = useMutation({
    mutationFn: () =>
      incidentsApi.create({
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        severity,
        ...(linkPerson && person ? { personId: person.id } : {}),
      }),
    onSuccess: (incident) => {
      toast.success(t("verify.incident_done", { title: incident.title }));
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.details?.length) {
        setFieldErrors(Object.fromEntries(error.details.map((d) => [d.path, d.message])));
      } else {
        setFieldErrors({});
      }
      toast.error(error instanceof ApiError ? error.message : t("common.error"));
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFieldErrors({});
    if (title.trim().length < 3) {
      toast.error(t("verify.incident_title_required"));
      return;
    }
    create.mutate();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !create.isPending && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertOctagon className="h-5 w-5 text-primary" />
            {t("verify.incident_title")}
          </DialogTitle>
          <DialogDescription>{t("verify.incident_desc")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("verify.incident_severity")}</Label>
            <div className="flex flex-wrap gap-1.5">
              {INCIDENT_SEVERITIES.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSeverity(value)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-all",
                    severity === value
                      ? SEVERITY_TONE[value]
                      : "bg-secondary text-muted-foreground hover:bg-secondary/70",
                  )}
                >
                  {t(SEVERITY_LABEL[value])}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="incident-title">{t("verify.incident_what")}</Label>
            <Input
              id="incident-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("verify.incident_what_ph")}
              autoComplete="off"
              autoFocus
              disabled={create.isPending}
            />
            {fieldErrors.title && <p className="text-xs text-destructive">{fieldErrors.title}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="incident-details">{t("verify.incident_details")}</Label>
            <Textarea
              id="incident-details"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("verify.incident_details_ph")}
              rows={4}
              disabled={create.isPending}
            />
          </div>

          {person && (
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm">
              <Checkbox
                checked={linkPerson}
                onCheckedChange={(value) => setLinkPerson(value === true)}
                disabled={create.isPending}
              />
              <span className="text-muted-foreground">
                {t("verify.incident_link", { name: person.fullName })}
              </span>
            </label>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? t("verify.incident_filing") : t("verify.incident_submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ManualOverrideDialog({
  initialDirection,
  initialReason,
  onApply,
  onClose,
}: {
  initialDirection: GateDirection;
  initialReason: string;
  onApply: (direction: GateDirection, reason: string) => void;
  onClose: () => void;
}) {
  const [direction, setDirection] = useState<GateDirection>(initialDirection);
  const [reason, setReason] = useState(initialReason);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      toast.error("Please enter a mandatory override reason.");
      return;
    }
    onApply(direction, reason.trim());
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
            Authorized Manual Gate Override
          </DialogTitle>
          <DialogDescription>
            Force a specific IN or OUT gate direction. Every manual override requires an audited reason and is recorded in the security audit trail.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Forced Direction</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={direction === "entry" ? "default" : "outline"}
                className={cn(direction === "entry" && "bg-success hover:bg-success/90 text-success-foreground")}
                onClick={() => setDirection("entry")}
              >
                <ArrowDownToLine className="mr-1.5 h-4 w-4" />
                Force ENTRY (IN)
              </Button>
              <Button
                type="button"
                variant={direction === "exit" ? "default" : "outline"}
                className={cn(direction === "exit" && "bg-primary hover:bg-primary/90 text-primary-foreground")}
                onClick={() => setDirection("exit")}
              >
                <ArrowUpFromLine className="mr-1.5 h-4 w-4" />
                Force EXIT (OUT)
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="override-reason" className="text-sm font-semibold">
              Mandatory Audit Reason *
            </Label>
            <Textarea
              id="override-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Card unreadable at unmonitored gate, security escort, holder state sync..."
              rows={3}
              required
              autoFocus
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!reason.trim()}>
              Apply Manual Override
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
