import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import jsPDF from "jspdf";
import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { reportsApi, type ScanReport } from "@/lib/api";
import { downloadCSV } from "@/lib/csv";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Download,
  FileText,
  ScanLine,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Users,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsView,
});

// Hardcoded hex values — CSS custom properties don't resolve inside SVG fill attributes.
const C = { approved: "#16A34A", rejected: "#DC2626", unable: "#F59E0B" };

// ── Date helpers (all in the operator's local calendar) ──────────────────────

/** "YYYY-MM-DD" for today, in the browser's local timezone. */
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** Shift a date key by whole days without ever rounding through UTC. */
function addDays(dateKey: string, n: number) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const shifted = new Date(y, m - 1, d + n);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}-${String(
    shifted.getDate(),
  ).padStart(2, "0")}`;
}

/** "2026-10-17" → "17 Oct". Built from the parts so it never shifts a day. */
function dayLabel(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

// ── Screen ───────────────────────────────────────────────────────────────────

export function ReportsView() {
  const { t } = useTranslation();
  const [from, setFrom] = useState(() => addDays(todayKey(), -29));
  const [to, setTo] = useState(todayKey);

  const rangeValid = Boolean(from) && Boolean(to) && from <= to;

  const {
    data: report,
    isFetching,
    error,
  } = useQuery({
    queryKey: ["scan-report", from, to],
    queryFn: () => reportsApi.scans(from, to),
    enabled: rangeValid,
  });

  const presets = useMemo(() => {
    const today = todayKey();
    const [y, m] = today.split("-").map(Number);
    return [
      { key: "today", labelKey: "rep.preset_today", from: today, to: today },
      { key: "7", labelKey: "rep.preset_7", from: addDays(today, -6), to: today },
      { key: "30", labelKey: "rep.preset_30", from: addDays(today, -29), to: today },
      {
        key: "month",
        labelKey: "rep.preset_month",
        from: `${y}-${String(m).padStart(2, "0")}-01`,
        to: today,
      },
    ];
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{t("rep.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("rep.subtitle")}</p>
      </div>

      {/* ── The window ── */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="rep-from">{t("rep.from")}</Label>
            <Input
              id="rep-from"
              type="date"
              value={from}
              max={to}
              onChange={(event) => setFrom(event.target.value)}
              className="w-[170px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rep-to">{t("rep.to")}</Label>
            <Input
              id="rep-to"
              type="date"
              value={to}
              min={from}
              onChange={(event) => setTo(event.target.value)}
              className="w-[170px]"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <Button
                key={preset.key}
                type="button"
                size="sm"
                variant={preset.from === from && preset.to === to ? "default" : "outline"}
                onClick={() => {
                  setFrom(preset.from);
                  setTo(preset.to);
                }}
              >
                {t(preset.labelKey)}
              </Button>
            ))}
          </div>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!report}
              onClick={() => report && exportCsv(report, t)}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {t("rep.export_csv")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!report}
              onClick={() => report && exportPdf(report, t)}
            >
              <FileText className="mr-1.5 h-3.5 w-3.5" />
              {t("rep.export_pdf")}
            </Button>
          </div>
        </div>

        {!rangeValid && <p className="mt-3 text-sm text-destructive">{t("rep.range_invalid")}</p>}
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {t("rep.load_failed")}
        </div>
      )}

      {rangeValid && !report && !error && (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      )}

      {report && (
        <div className={cn("space-y-5", isFetching && "opacity-60 transition-opacity")}>
          <p className="text-xs text-muted-foreground">
            {t("rep.window", { from: report.from, to: report.to, days: report.days })} ·{" "}
            {t("rep.generated", { when: new Date(report.generatedAt).toLocaleTimeString() })}
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label={t("rep.card_scans")} value={report.counts.scans} icon={ScanLine} />
            <Stat
              label={t("rep.card_approved")}
              value={report.counts.approved}
              icon={CheckCircle2}
              color="text-success"
            />
            <Stat
              label={t("rep.card_rejected")}
              value={report.counts.rejected}
              icon={XCircle}
              color="text-destructive"
            />
            <Stat
              label={t("rep.card_unable")}
              value={report.counts.unable}
              icon={AlertTriangle}
              color="text-warning"
            />
            <Stat
              label={t("rep.card_people")}
              value={report.uniquePeople}
              icon={Users}
              color="text-primary"
            />
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">{t("rep.chart_daily")}</h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={report.daily.map((row) => ({ ...row, label: dayLabel(row.date) }))}>
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar
                  dataKey="approved"
                  name={t("logs.result_approved")}
                  stackId="a"
                  fill={C.approved}
                />
                <Bar
                  dataKey="rejected"
                  name={t("logs.result_rejected")}
                  stackId="a"
                  fill={C.rejected}
                />
                <Bar dataKey="unable" name={t("logs.result_unable")} stackId="a" fill={C.unable} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {report.counts.scans === 0 ? (
            <p className="rounded-xl border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground shadow-sm">
              {t("rep.empty")}
            </p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <Breakdown
                title={t("rep.tbl_gate")}
                head={t("rep.col_gate")}
                rows={report.byGate.map((row) => ({ key: row.gateId, label: row.gateName, row }))}
                t={t}
              />
              <Breakdown
                title={t("rep.tbl_category")}
                head={t("rep.col_category")}
                rows={report.byCategory
                  .filter((row) => row.scans > 0)
                  .map((row) => ({
                    key: row.category,
                    label: t(`dash.cat_${row.category}`),
                    row,
                  }))}
                t={t}
              />
              <Breakdown
                title={t("rep.tbl_direction")}
                head={t("rep.col_direction")}
                rows={report.byDirection.map((row) => ({
                  key: row.direction,
                  label: row.direction === "entry" ? t("rep.dir_entry") : t("rep.dir_exit"),
                  row,
                }))}
                t={t}
              />

              <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                <div className="border-b border-border px-5 py-3">
                  <h2 className="text-sm font-semibold">{t("rep.tbl_reasons")}</h2>
                </div>
                {report.topReasons.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                    {t("rep.no_reasons")}
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-secondary/50 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-5 py-2 text-left font-medium">{t("rep.col_reason")}</th>
                        <th className="px-5 py-2 text-right font-medium">{t("rep.col_count")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {report.topReasons.map((row) => (
                        <tr key={row.reasonCode}>
                          <td className="px-5 py-2">
                            <span className="font-medium">{row.reasonText ?? row.reasonCode}</span>
                            <span className="ml-2 font-mono text-xs text-muted-foreground">
                              {row.reasonCode}
                            </span>
                          </td>
                          <td className="px-5 py-2 text-right font-semibold">{row.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  icon: Icon,
  color = "text-foreground",
}: {
  label: string;
  value: number;
  icon: typeof ScanLine;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <Icon className={cn("h-4 w-4", color)} />
      </div>
      <p className={cn("mt-2 text-3xl font-bold", color)}>{value}</p>
    </div>
  );
}

/** A small scan-count table — one row per gate / category / direction. */
function Breakdown({
  title,
  head,
  rows,
  t,
}: {
  title: string;
  head: string;
  rows: Array<{
    key: string;
    label: string;
    row: { scans: number; approved: number; rejected: number; unable: number };
  }>;
  t: (key: string) => string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">{t("rep.empty")}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-5 py-2 text-left font-medium">{head}</th>
              <th className="px-3 py-2 text-right font-medium">{t("rep.col_scans")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("rep.col_approved")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("rep.col_rejected")}</th>
              <th className="px-5 py-2 text-right font-medium">{t("rep.col_unable")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(({ key, label, row }) => (
              <tr key={key}>
                <td className="px-5 py-2 font-medium">{label}</td>
                <td className="px-3 py-2 text-right font-semibold">{row.scans}</td>
                <td className="px-3 py-2 text-right text-success">{row.approved}</td>
                <td className="px-3 py-2 text-right text-destructive">{row.rejected}</td>
                <td className="px-5 py-2 text-right text-warning">{row.unable}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Exports ──────────────────────────────────────────────────────────────────

type T = (key: string, params?: Record<string, unknown>) => string;

/**
 * The CSV is a flat "long" table — one section per breakdown — so it opens in
 * any spreadsheet and each row still carries the section it came from.
 */
function exportCsv(report: ScanReport, t: T) {
  const rows: Record<string, unknown>[] = [];

  rows.push({ section: "summary", group: t("rep.card_scans"), value: report.counts.scans });
  rows.push({ section: "summary", group: t("rep.card_approved"), value: report.counts.approved });
  rows.push({ section: "summary", group: t("rep.card_rejected"), value: report.counts.rejected });
  rows.push({ section: "summary", group: t("rep.card_unable"), value: report.counts.unable });
  rows.push({ section: "summary", group: t("rep.card_people"), value: report.uniquePeople });

  for (const day of report.daily) {
    rows.push({
      section: "daily",
      group: day.date,
      scans: day.scans,
      approved: day.approved,
      rejected: day.rejected,
      unable: day.unable,
    });
  }
  for (const gate of report.byGate) {
    rows.push({
      section: "gate",
      group: gate.gateName,
      scans: gate.scans,
      approved: gate.approved,
      rejected: gate.rejected,
      unable: gate.unable,
    });
  }
  for (const category of report.byCategory) {
    rows.push({
      section: "category",
      group: category.category,
      scans: category.scans,
      approved: category.approved,
      rejected: category.rejected,
      unable: category.unable,
    });
  }
  for (const direction of report.byDirection) {
    rows.push({
      section: "direction",
      group: direction.direction,
      scans: direction.scans,
      approved: direction.approved,
      rejected: direction.rejected,
      unable: direction.unable,
    });
  }
  for (const reason of report.topReasons) {
    rows.push({
      section: "reason",
      group: reason.reasonCode,
      reason: reason.reasonText ?? "",
      count: reason.count,
    });
  }

  downloadCSV(`ABB-Plant3-report-${report.from}-to-${report.to}.csv`, rows);
}

function exportPdf(report: ScanReport, t: T) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const left = 40;
  let y = 46;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("ABB Plant 3 — Access Report", left, y);
  y += 18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`${report.from}  →  ${report.to}   (${report.days} days)`, left, y);
  y += 14;
  doc.setFontSize(8);
  doc.text(
    `${t("rep.generated", { when: new Date(report.generatedAt).toLocaleString() })}`,
    left,
    y,
  );
  y += 22;

  // Summary
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Summary", left, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  const summary: Array<[string, number]> = [
    [t("rep.card_scans"), report.counts.scans],
    [t("rep.card_approved"), report.counts.approved],
    [t("rep.card_rejected"), report.counts.rejected],
    [t("rep.card_unable"), report.counts.unable],
    [t("rep.card_people"), report.uniquePeople],
  ];
  for (const [label, value] of summary) {
    doc.text(`${label}`, left + 6, y);
    doc.text(`${value}`, left + 220, y, { align: "right" });
    y += 13;
  }
  y += 12;

  const table = (
    title: string,
    head: string,
    rows: Array<[string, number, number, number, number]>,
  ) => {
    if (rows.length === 0) return;
    if (y > 730) {
      doc.addPage();
      y = 46;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(title, left, y);
    y += 14;
    doc.setFontSize(8.5);
    const cols = [left + 6, left + 260, left + 340, left + 420, left + 500];
    doc.text(head, cols[0], y);
    doc.text(t("rep.col_scans"), cols[1], y, { align: "right" });
    doc.text(t("rep.col_approved"), cols[2], y, { align: "right" });
    doc.text(t("rep.col_rejected"), cols[3], y, { align: "right" });
    doc.text(t("rep.col_unable"), cols[4], y, { align: "right" });
    y += 6;
    doc.setDrawColor(200);
    doc.line(left, y, 555, y);
    y += 12;
    doc.setFont("helvetica", "normal");
    for (const [label, scans, approved, rejected, unable] of rows) {
      if (y > 780) {
        doc.addPage();
        y = 46;
      }
      doc.text(label.slice(0, 44), cols[0], y);
      doc.text(String(scans), cols[1], y, { align: "right" });
      doc.text(String(approved), cols[2], y, { align: "right" });
      doc.text(String(rejected), cols[3], y, { align: "right" });
      doc.text(String(unable), cols[4], y, { align: "right" });
      y += 13;
    }
    y += 16;
  };

  table(
    "Daily activity",
    t("rep.col_date"),
    report.daily.map((d) => [d.date, d.scans, d.approved, d.rejected, d.unable]),
  );
  table(
    t("rep.tbl_gate"),
    t("rep.col_gate"),
    report.byGate.map((g) => [g.gateName, g.scans, g.approved, g.rejected, g.unable]),
  );
  table(
    t("rep.tbl_category"),
    t("rep.col_category"),
    report.byCategory.map((c) => [c.category, c.scans, c.approved, c.rejected, c.unable]),
  );
  table(
    t("rep.tbl_direction"),
    t("rep.col_direction"),
    report.byDirection.map((d) => [d.direction, d.scans, d.approved, d.rejected, d.unable]),
  );

  // Refusal reasons — a two-column table, so it needs its own pass.
  if (report.topReasons.length > 0) {
    if (y > 700) {
      doc.addPage();
      y = 46;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(t("rep.tbl_reasons"), left, y);
    y += 14;
    doc.setFontSize(8.5);
    doc.text(t("rep.col_reason"), left + 6, y);
    doc.text(t("rep.col_count"), left + 500, y, { align: "right" });
    y += 6;
    doc.setDrawColor(200);
    doc.line(left, y, 555, y);
    y += 12;
    doc.setFont("helvetica", "normal");
    for (const reason of report.topReasons) {
      if (y > 780) {
        doc.addPage();
        y = 46;
      }
      doc.text(`${reason.reasonCode} — ${reason.reasonText ?? ""}`.slice(0, 90), left + 6, y);
      doc.text(String(reason.count), left + 500, y, { align: "right" });
      y += 13;
    }
  }

  doc.save(`ABB-Plant3-report-${report.from}-to-${report.to}.pdf`);
}
