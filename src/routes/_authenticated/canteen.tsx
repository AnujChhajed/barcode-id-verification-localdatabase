import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, canteenApi, type CanteenVerification } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CheckCircle2, Clock, ScanLine, ShieldAlert, UtensilsCrossed, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/canteen")({
  component: CanteenPage,
});

function formatTime(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleTimeString();
}

type VerdictTone = "approved" | "rejected" | "unable";

function toneFor(result: CanteenVerification["result"]): VerdictTone {
  if (result === "approved") return "approved";
  if (result === "unable_to_verify") return "unable";
  return "rejected";
}

const TONE_CLASS: Record<VerdictTone, string> = {
  approved: "border-success/40 bg-success/10 text-success",
  rejected: "border-destructive/40 bg-destructive/10 text-destructive",
  unable: "border-warning/40 bg-warning/10 text-warning",
};

function CanteenPage() {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const [code, setCode] = useState("");
  const [answer, setAnswer] = useState<CanteenVerification | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["canteen", "today"],
    queryFn: () => canteenApi.events({ limit: 50 }),
    refetchInterval: 30_000,
  });

  const verify = useMutation({
    mutationFn: (scanned: string) => canteenApi.verify(scanned),
    onSuccess: (result) => {
      setAnswer(result);
      setCode("");
      void refetch();
      if (result.result === "approved") {
        toast.success(t("ctn.approved_toast", { name: result.person?.fullName ?? "" }));
      } else if (result.alreadyEntered) {
        toast.warning(result.reasonText);
      } else {
        toast.error(result.reasonText);
      }
      setTimeout(() => inputRef.current?.focus(), 0);
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : t("common.error"));
    },
  });

  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const scanned = code.trim();
      if (!scanned || inFlight.current) return;
      inFlight.current = true;
      verify.mutate(scanned, { onSettled: () => (inFlight.current = false) });
    },
    [code, verify],
  );

  const entries = data?.events ?? [];
  const tone = answer ? toneFor(answer.result) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("ctn.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("ctn.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 shadow-sm">
          <UtensilsCrossed className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">
            {t("ctn.served_today", { count: data?.servedToday ?? 0 })}
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t("ctn.scan_placeholder")}
              className="pl-9 text-base"
              autoComplete="off"
            />
          </div>
          <Button type="submit" disabled={verify.isPending || !code.trim()}>
            {verify.isPending ? t("ctn.checking") : t("ctn.check_btn")}
          </Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">{t("ctn.scan_hint")}</p>

        {answer && tone && (
          <div
            className={cn("mt-4 flex items-start gap-3 rounded-xl border p-4", TONE_CLASS[tone])}
          >
            {tone === "approved" ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            ) : tone === "rejected" ? (
              <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
            ) : (
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-bold uppercase tracking-wide">{t(`ctn.result_${tone}`)}</p>
              <p className="text-sm">{answer.reasonText}</p>
              {answer.person && (
                <p className="mt-1 text-sm font-medium">
                  {answer.person.fullName}
                  <span className="ml-2 text-xs font-normal opacity-80">
                    {t(`verify.category_${answer.person.category}`)}
                  </span>
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{t("ctn.today_log")}</h2>
          <span className="text-xs text-muted-foreground">
            {t("common2.records", { count: data?.total ?? 0 })}
          </span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">{t("ctn.col_time")}</th>
              <th className="px-4 py-3 text-left">{t("common2.name")}</th>
              <th className="px-4 py-3 text-left">{t("logs.col_result")}</th>
              <th className="px-4 py-3 text-left">{t("common2.reason_col")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {entries.map((event) => (
              <tr key={event.id}>
                <td className="px-4 py-3 text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    {formatTime(event.occurredAt)}
                  </span>
                </td>
                <td className="px-4 py-3 font-medium">
                  {event.personName ?? t("logs.unknown_code")}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={event.result === "approved" ? "secondary" : "destructive"}>
                    {t(
                      `logs.result_${event.result === "unable_to_verify" ? "unable" : event.result}`,
                    )}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{event.reasonText ?? "—"}</td>
              </tr>
            ))}
            {!isLoading && entries.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  {t("ctn.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
