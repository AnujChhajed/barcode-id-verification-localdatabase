import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { gateApi, type GateEventView, type GateResult, type GateDirection } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Search,
  Download,
  Activity,
  TrendingDown,
} from "lucide-react";
import { downloadCSV } from "@/lib/csv";
import jsPDF from "jspdf";
import { ReportsView } from "./reports";

export const Route = createFileRoute("/_authenticated/logs")({
  component: LogsPage,
});

/** The most rows the API will return in one page (`listGateEventsQuerySchema`). */
const PAGE_LIMIT = 200;

// ── Helpers ───────────────────────────────────────────────────────────────

/** Returns "YYYY-MM-DD" in the browser's LOCAL timezone, n days from today. */
function dayOffset(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Start of a local calendar day → ISO instant for the inclusive `from` filter. */
function localDayStart(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

/** End of a local calendar day → ISO instant for the inclusive `to` filter. */
function localDayEnd(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

/** The date key ("YYYY-MM-DD") of an instant, in the browser's local timezone. */
function localDateKey(iso: string) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function LogsPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<"all" | GateResult>("all");
  const [direction, setDirection] = useState<"all" | GateDirection>("all");
  const [live, setLive] = useState(false);
  const [fromDate, setFromDate] = useState(dayOffset(-30));
  const [toDate, setToDate] = useState(dayOffset(0));

  const [activeTab, setActiveTab] = useState(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "reports"
      ? "reports"
      : "logs",
  );

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["gate-events", result, direction, fromDate, toDate],
    refetchInterval: live ? 15_000 : false,
    queryFn: () =>
      gateApi.events({
        result: result === "all" ? undefined : result,
        direction: direction === "all" ? undefined : direction,
        from: localDayStart(fromDate),
        to: localDayEnd(toDate),
        limit: PAGE_LIMIT,
      }),
  });

  const today = dayOffset(0);

  const { data: todayApproved } = useQuery({
    queryKey: ["gate-events-today", today],
    queryFn: () =>
      gateApi.events({
        result: "approved",
        from: localDayStart(today),
        to: localDayEnd(today),
        limit: PAGE_LIMIT,
      }),
  });

  // The API does not expose the raw scanned code, so the search box matches the
  // holder's name on the page that was loaded.
  const events = useMemo(() => {
    const rows = data?.events ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((e) => (e.personName ?? "").toLowerCase().includes(q));
  }, [data, search]);

  const truncated = (data?.total ?? 0) > (data?.events.length ?? 0);

  // ── Today attendance ──────────────────────────────────────────────────
  const attendance = useMemo(() => {
    const rows = todayApproved?.events ?? [];
    const map = new Map<
      string,
      {
        name: string;
        category: string;
        firstIn: string | null;
        lastOut: string | null;
      }
    >();
    for (const e of [...rows].reverse()) {
      const key = e.personId ?? e.personName ?? "unknown";
      const cur = map.get(key) ?? {
        name: e.personName ?? t("logs.unknown_code"),
        category: e.personCategory ?? "—",
        firstIn: null,
        lastOut: null,
      };
      if (e.direction === "entry" && !cur.firstIn) cur.firstIn = e.occurredAt;
      if (e.direction === "exit") cur.lastOut = e.occurredAt;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [todayApproved, t]);

  // ── Denied frequency ──────────────────────────────────────────────────
  const deniedFreq = useMemo(() => {
    const map = new Map<string, { label: string; count: number; lastSeen: string }>();
    for (const e of data?.events ?? []) {
      if (e.result !== "rejected") continue;
      const key = e.personId ?? e.reasonCode ?? "unregistered";
      const cur = map.get(key) ?? {
        label: e.personName ?? t("logs.unknown_code"),
        count: 0,
        lastSeen: e.occurredAt,
      };
      cur.count++;
      if (e.occurredAt > cur.lastSeen) cur.lastSeen = e.occurredAt;
      map.set(key, cur);
    }
    return Array.from(map.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);
  }, [data, t]);

  // ── Exports ───────────────────────────────────────────────────────────
  const exportLogsCSV = () => {
    if (!events.length) return;
    downloadCSV(
      `gate-events-${fromDate}-to-${toDate}.csv`,
      events.map((e) => ({
        when: e.occurredAt,
        result: e.result,
        direction: e.direction,
        person: e.personName ?? "",
        category: e.personCategory ?? "",
        reason_code: e.reasonCode ?? "",
        reason: e.reasonText ?? "",
      })),
    );
  };

  const exportLogsPDF = () => {
    if (!events.length) return;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("Gate Events", 40, 40);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`${fromDate} → ${toDate}  ·  ${events.length} records`, 40, 56);
    doc.setFontSize(8);
    let y = 80;
    const cols = ["When", "Result", "Dir", "Person", "Category", "Reason"];
    const xs = [40, 155, 230, 265, 400, 480];
    doc.setFont("helvetica", "bold");
    cols.forEach((c, i) => doc.text(c, xs[i], y));
    y += 8;
    doc.line(40, y, 555, y);
    y += 12;
    doc.setFont("helvetica", "normal");
    for (const e of events) {
      if (y > 800) {
        doc.addPage();
        y = 40;
      }
      doc.text(new Date(e.occurredAt).toLocaleString().slice(0, 18), xs[0], y);
      doc.text(e.result, xs[1], y);
      doc.text(e.direction === "entry" ? "IN" : "OUT", xs[2], y);
      doc.text((e.personName ?? "—").slice(0, 22), xs[3], y);
      doc.text((e.personCategory ?? "—").slice(0, 12), xs[4], y);
      doc.text((e.reasonText ?? "").slice(0, 18), xs[5], y);
      y += 14;
    }
    doc.save(`gate-events-${fromDate}-to-${toDate}.pdf`);
  };

  const exportAttendanceCSV = () => {
    downloadCSV(
      `attendance-${today}.csv`,
      attendance.map((a) => ({
        person: a.name,
        category: a.category,
        first_entry: a.firstIn ?? "",
        last_exit: a.lastOut ?? "",
      })),
    );
  };

  const exportDeniedCSV = () => {
    if (!deniedFreq.length) return;
    downloadCSV(
      `denied-frequency-${fromDate}-to-${toDate}.csv`,
      deniedFreq.map((d) => ({
        person: d.label,
        denials: d.count,
        last_seen: d.lastSeen,
      })),
    );
  };

  const exportDeniedPDF = () => {
    if (!deniedFreq.length) return;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("Rejected Access — Frequency Report", 40, 40);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`${fromDate} → ${toDate}  ·  Top ${deniedFreq.length} entries`, 40, 56);
    let y = 80;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("#", 40, y);
    doc.text("Person", 65, y);
    doc.text("Rejections", 340, y);
    doc.text("Last seen", 420, y);
    y += 8;
    doc.line(40, y, 555, y);
    y += 12;
    doc.setFont("helvetica", "normal");
    deniedFreq.forEach((d, i) => {
      if (y > 800) {
        doc.addPage();
        y = 40;
      }
      doc.text(String(i + 1), 40, y);
      doc.text(String(d.label).slice(0, 40), 65, y);
      doc.text(String(d.count), 340, y);
      doc.text(new Date(d.lastSeen).toLocaleString().slice(0, 18), 420, y);
      y += 14;
    });
    doc.save(`rejected-frequency-${fromDate}-to-${toDate}.pdf`);
  };

  // ── UI ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("logs.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("logs.subtitle")}</p>
        </div>
        <Button size="sm" variant={live ? "default" : "outline"} onClick={() => setLive((l) => !l)}>
          <Activity className="mr-2 h-4 w-4" /> {live ? t("logs.live_on") : t("common2.live_badge")}
        </Button>
      </div>

      {/* Date range filter */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-1 flex-wrap gap-3">
          <div className="space-y-1 min-w-[140px]">
            <Label className="text-xs">{t("logs.from")}</Label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1 min-w-[140px]">
            <Label className="text-xs">{t("logs.to")}</Label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="flex items-end gap-1.5 flex-wrap">
            {[
              { label: t("logs.preset_today"), from: dayOffset(0), to: dayOffset(0) },
              { label: t("logs.preset_7d"), from: dayOffset(-7), to: dayOffset(0) },
              { label: t("logs.preset_30d"), from: dayOffset(-30), to: dayOffset(0) },
            ].map((p) => (
              <Button
                key={p.label}
                size="sm"
                variant="outline"
                className="h-9"
                onClick={() => {
                  setFromDate(p.from);
                  setToDate(p.to);
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={exportLogsCSV}>
            <Download className="mr-2 h-4 w-4" /> CSV
          </Button>
          <Button size="sm" variant="outline" onClick={exportLogsPDF}>
            <Download className="mr-2 h-4 w-4" /> PDF
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="logs">{t("logs.tab_logs")}</TabsTrigger>
          <TabsTrigger value="reports">Reports & Analytics</TabsTrigger>
          <TabsTrigger value="attendance">{t("logs.tab_attend")}</TabsTrigger>
          <TabsTrigger value="denied">
            <TrendingDown className="mr-1.5 h-3.5 w-3.5" />
            {t("logs.tab_denied")}
            {deniedFreq.length > 0 && (
              <span className="ml-1.5 rounded-full bg-destructive/15 px-1.5 text-[10px] font-bold text-destructive">
                {deniedFreq.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── All events tab ── */}
        <TabsContent value="logs" className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("logs.search_ph")}
                className="pl-9"
              />
            </div>
            <Select value={result} onValueChange={(v) => setResult(v as "all" | GateResult)}>
              <SelectTrigger className="w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("logs.result_all")}</SelectItem>
                <SelectItem value="approved">{t("logs.result_approved")}</SelectItem>
                <SelectItem value="rejected">{t("logs.result_rejected")}</SelectItem>
                <SelectItem value="unable_to_verify">{t("logs.result_unable")}</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={direction}
              onValueChange={(v) => setDirection(v as "all" | GateDirection)}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("logs.dir_all")}</SelectItem>
                <SelectItem value="entry">{t("common2.entry")}</SelectItem>
                <SelectItem value="exit">{t("common2.exit")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {isLoading ? (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                {t("common.loading")}
              </div>
            ) : events.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                {t("logs.no_match")}
              </div>
            ) : (
              <>
                <div className="border-b border-border px-5 py-2 text-xs text-muted-foreground">
                  {truncated
                    ? t("logs.records_of_total", {
                        count: events.length,
                        total: data?.total ?? 0,
                      })
                    : t("common2.records", { count: events.length })}
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left">{t("logs.col_when")}</th>
                      <th className="px-4 py-3 text-left">{t("logs.col_result")}</th>
                      <th className="px-4 py-3 text-left">{t("logs.col_dir")}</th>
                      <th className="px-4 py-3 text-left">{t("logs.col_person")}</th>
                      <th className="px-4 py-3 text-left">{t("logs.col_category")}</th>
                      <th className="px-4 py-3 text-left">{t("logs.col_reason")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {events.map((e) => (
                      <tr key={e.id} className="hover:bg-secondary/30">
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {new Date(e.occurredAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <ResultBadge r={e.result} />
                        </td>
                        <td className="px-4 py-3 text-xs uppercase text-muted-foreground">
                          {e.direction === "entry" ? t("common2.entry") : t("common2.exit")}
                        </td>
                        <td className="px-4 py-3">
                          {e.personName ? (
                            <span className="font-medium">{e.personName}</span>
                          ) : (
                            <span className="text-muted-foreground italic">
                              {t("logs.unknown_code")}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {e.personCategory ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {e.reasonText ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </TabsContent>

        {/* ── Today attendance tab ── */}
        <TabsContent value="attendance" className="space-y-4">
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={exportAttendanceCSV}>
              <Download className="mr-2 h-4 w-4" /> {t("logs.export_csv")}
            </Button>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {attendance.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                {t("logs.no_entries_today")}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">{t("logs.col_person")}</th>
                    <th className="px-4 py-3 text-left">{t("logs.col_category")}</th>
                    <th className="px-4 py-3 text-left">{t("logs.col_first_entry")}</th>
                    <th className="px-4 py-3 text-left">{t("logs.col_last_exit")}</th>
                    <th className="px-4 py-3 text-left">{t("logs.col_status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {attendance.map((a) => (
                    <tr key={a.name}>
                      <td className="px-4 py-3 font-medium">{a.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{a.category}</td>
                      <td className="px-4 py-3 text-xs">
                        {a.firstIn ? new Date(a.firstIn).toLocaleTimeString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {a.lastOut ? new Date(a.lastOut).toLocaleTimeString() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {a.firstIn && !a.lastOut ? (
                          <Badge className="bg-success text-success-foreground">
                            {t("logs.attend_campus")}
                          </Badge>
                        ) : a.lastOut ? (
                          <Badge variant="secondary">{t("logs.attend_left")}</Badge>
                        ) : (
                          <Badge variant="outline">—</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>

        {/* ── Rejected frequency tab ── */}
        <TabsContent value="denied" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{t("logs.denied_desc")}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={exportDeniedCSV}>
                <Download className="mr-2 h-4 w-4" /> CSV
              </Button>
              <Button size="sm" variant="outline" onClick={exportDeniedPDF}>
                <Download className="mr-2 h-4 w-4" /> PDF
              </Button>
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {isLoading ? (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                {t("common.loading")}
              </div>
            ) : deniedFreq.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                {t("logs.no_denied")}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">#</th>
                    <th className="px-4 py-3 text-left">{t("logs.col_person")}</th>
                    <th className="px-4 py-3 text-left">{t("logs.col_denials")}</th>
                    <th className="px-4 py-3 text-left">{t("logs.col_last_seen")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {deniedFreq.map((d, i) => (
                    <tr key={d.label} className="hover:bg-secondary/30">
                      <td className="px-4 py-3 text-muted-foreground">{i + 1}</td>
                      <td className="px-4 py-3 font-medium">{d.label}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`font-bold tabular-nums ${d.count >= 10 ? "text-destructive" : d.count >= 5 ? "text-warning" : ""}`}
                        >
                          {d.count}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {new Date(d.lastSeen).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>

        {/* ── Reports & Analytics tab ── */}
        <TabsContent value="reports" className="space-y-4 pt-2">
          <ReportsView />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ResultBadge({ r }: { r: GateResult }) {
  const { t } = useTranslation();
  if (r === "approved")
    return (
      <Badge className="gap-1 bg-success text-success-foreground">
        <CheckCircle2 className="h-3 w-3" /> {t("logs.result_approved")}
      </Badge>
    );
  if (r === "rejected")
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" /> {t("logs.result_rejected")}
      </Badge>
    );
  return (
    <Badge variant="secondary" className="gap-1">
      <AlertTriangle className="h-3 w-3" /> {t("logs.result_unable")}
    </Badge>
  );
}
