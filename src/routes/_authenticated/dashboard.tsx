import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { announcementsApi, dashboardApi, gateApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import {
  ScanLine,
  CheckCircle2,
  XCircle,
  Clock,
  UserCheck,
  UserPlus,
  ShieldAlert,
  Megaphone,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

/** How many plant days the trend covers. */
const TREND_DAYS = 7;

// Hardcoded hex values — CSS custom properties don't resolve inside SVG fill attributes.
const C = { approved: "#16A34A", rejected: "#DC2626", unable: "#F59E0B" };

/** "2026-10-17" → "Fri". Built from the parts so it never shifts by a day. */
function weekdayLabel(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short" });
}

function Dashboard() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();

  // ── Every figure, in ONE request. The server owns "today" (plant clock) ──
  const { data: summary } = useQuery({
    queryKey: ["dashboard-summary", TREND_DAYS],
    queryFn: () => dashboardApi.summary(TREND_DAYS),
    refetchInterval: 30_000,
  });

  // ── Live feed (polling: the backend has no websocket transport) ─────────
  const { data: feed } = useQuery({
    queryKey: ["dashboard-feed"],
    refetchInterval: 15_000,
    queryFn: () => gateApi.events({ limit: 10 }),
  });

  // ── Active announcements (readable by every gate role) ─────────────────
  const { data: announcementData } = useQuery({
    queryKey: ["dashboard-announcements"],
    refetchInterval: 120_000,
    queryFn: () => announcementsApi.list(),
  });

  const banners = (announcementData?.announcements ?? []).slice(0, 2);
  const recent = feed?.events ?? [];

  if (!summary) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("dash.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }

  const { counts, inside, watchlist } = summary;

  const cards = [
    {
      key: "scans",
      label: t("common.scans_today"),
      value: counts.scans,
      icon: ScanLine,
      color: "text-foreground",
    },
    {
      key: "approved",
      label: t("common.allowed_today"),
      value: counts.approved,
      icon: CheckCircle2,
      color: "text-success",
    },
    {
      key: "rejected",
      label: t("common.denied_today"),
      value: counts.rejected,
      icon: XCircle,
      color: "text-destructive",
    },
    {
      key: "inside",
      label: t("common.currently_inside"),
      value: inside.total,
      icon: UserCheck,
      color: "text-primary",
    },
    {
      key: "visitors",
      label: t("common.active_visitors"),
      value: inside.byCategory.visitor,
      icon: UserPlus,
      color: "text-warning",
    },
    {
      key: "watchlist",
      label: t("dash.card_watchlist"),
      value: watchlist.active,
      icon: ShieldAlert,
      color: "text-destructive",
    },
  ];

  const pieData = [
    { name: t("logs.result_approved"), value: counts.approved, color: C.approved },
    { name: t("logs.result_rejected"), value: counts.rejected, color: C.rejected },
    { name: t("logs.result_unable"), value: counts.unable, color: C.unable },
  ];

  // Only categories that actually saw a scan today: an all-zero bar with a
  // legend entry nobody can explain is worse than an absent one.
  const categoryData = summary.categorySplit
    .filter((row) => row.scans > 0)
    .map((row) => ({ ...row, label: t(`dash.cat_${row.category}`) }));

  const trendData = summary.daily.map((row) => ({ ...row, label: weekdayLabel(row.date) }));

  return (
    <div className="space-y-6">
      {banners.length > 0 && (
        <div className="space-y-2">
          {banners.map((a) => (
            <div
              key={a.id}
              className={cn(
                "flex items-start gap-3 rounded-xl border p-4 shadow-sm",
                a.severity === "critical"
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : a.severity === "warning"
                    ? "border-warning/40 bg-warning/10 text-warning"
                    : "border-primary/30 bg-primary/5 text-foreground",
              )}
            >
              <Megaphone className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">{a.title}</p>
                <p className="text-sm opacity-90">{a.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("dash.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {isAdmin ? t("dash.subtitle_admin") : t("dash.subtitle_op")}
          </p>
        </div>
        <Link
          to="/verify"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          {t("dash.open_scanner")}
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ key, label, value, icon: Icon, color }) => (
          <div key={key} className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {label}
              </p>
              <Icon className={`h-4 w-4 ${color}`} />
            </div>
            <p className={`mt-2 text-3xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {watchlist.active > 0 && (
        <Link
          to="/watchlist"
          className="flex items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive shadow-sm hover:opacity-90"
        >
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span className="font-medium">
            {t("dash.watchlist_alert", { count: watchlist.active })}
          </span>
          <span className="ml-auto text-xs underline">{t("dash.view_watchlist")}</span>
        </Link>
      )}

      {inside.missingExit > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning shadow-sm">
          <Clock className="h-4 w-4 shrink-0" />
          <span>{t("dash.missing_exit", { count: inside.missingExit })}</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">{t("dash.chart_hourly")}</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={summary.hourly.map((b) => ({ ...b, label: `${b.hour}:00` }))}>
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={2} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
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
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">{t("dash.chart_split")}</h2>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75}>
                {pieData.map((d, i) => (
                  <Cell key={i} fill={d.color} />
                ))}
              </Pie>
              <Legend />
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">{t("dash.chart_category")}</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={categoryData}>
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
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
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">{t("dash.chart_weekly")}</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={trendData}>
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
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
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-semibold">{t("dash.live_title")}</h2>
          <Link to="/logs" className="text-xs text-primary hover:underline">
            {t("dash.view_all")}
          </Link>
        </div>
        <div className="divide-y divide-border">
          {recent.length === 0 && (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              {t("dash.no_scans")}
            </div>
          )}
          {recent.map((log) => (
            <div key={log.id} className="flex items-center gap-3 px-5 py-3 text-sm">
              {log.result === "approved" ? (
                <CheckCircle2 className="h-4 w-4 text-success" />
              ) : log.result === "rejected" ? (
                <XCircle className="h-4 w-4 text-destructive" />
              ) : (
                <Clock className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="rounded bg-secondary px-1.5 text-[10px] uppercase text-muted-foreground">
                {log.direction === "entry" ? t("dash.dir_entry") : t("dash.dir_exit")}
              </span>
              <div className="flex-1 truncate">
                <span className="font-medium">
                  {log.personName ?? (
                    <span className="italic text-muted-foreground">{t("logs.unknown_code")}</span>
                  )}
                </span>
                {log.personCategory && (
                  <span className="ml-2 text-xs text-muted-foreground">{log.personCategory}</span>
                )}
                {log.reasonText && (
                  <span className="ml-2 text-xs text-muted-foreground">· {log.reasonText}</span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {new Date(log.occurredAt).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
