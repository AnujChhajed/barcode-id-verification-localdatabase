import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { gateApi, type PersonCategory } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  RefreshCw,
  ArrowDownToLine,
  ArrowUpFromLine,
  User as UserIcon,
  Clock,
  ScanLine,
  ArrowLeft,
  Search,
  ArrowUpDown,
  AlertTriangle,
  X,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/inside")({
  component: InsidePage,
});

type SortKey = "since_new" | "since_old" | "name_asc" | "name_desc" | "duration";
type TypeFilter = "all" | PersonCategory;

/**
 * Local midnight for the plant's calendar day, as an ISO instant for the
 * `/api/gate/events` inclusive `from` bound. The backend reports the plant's
 * own date key, so the browser never has to guess the site time zone.
 */
function startOfDayIso(dateKey?: string) {
  if (dateKey && /^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    const [y, m, d] = dateKey.split("-").map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

function InsidePage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("since_new");

  // ── Who is currently on site (authoritative — derived on the server) ──
  const { data, isLoading, isFetching, dataUpdatedAt, refetch } = useQuery({
    queryKey: ["inside"],
    queryFn: () => gateApi.inside(),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const rows = useMemo(() => data?.inside ?? [], [data]);
  const todayKey = data?.today;

  // ── Today's throughput, counted by the server (not the browser) ──
  const { data: throughput } = useQuery({
    queryKey: ["inside-throughput", todayKey],
    enabled: Boolean(todayKey),
    refetchInterval: 30_000,
    queryFn: async () => {
      const from = startOfDayIso(todayKey);
      const [entries, exits] = await Promise.all([
        gateApi.events({ from, direction: "entry", result: "approved", limit: 1 }),
        gateApi.events({ from, direction: "exit", result: "approved", limit: 1 }),
      ]);
      return { entries: entries.total, exits: exits.total };
    },
  });

  const workers = rows.filter((r) => r.person.category === "worker").length;
  const interns = rows.filter((r) => r.person.category === "intern").length;
  const visitors = rows.filter((r) => r.person.category === "visitor").length;

  // ── Filters + sort ─────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = rows;
    if (typeFilter !== "all") list = list.filter((r) => r.person.category === typeFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => {
        const p = r.person;
        return (
          p.fullName.toLowerCase().includes(q) ||
          (p.workerRef ?? "").toLowerCase().includes(q) ||
          (p.contractorCompany ?? "").toLowerCase().includes(q) ||
          (p.institutionName ?? "").toLowerCase().includes(q)
        );
      });
    }
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case "since_new":
          return new Date(b.since).getTime() - new Date(a.since).getTime();
        case "since_old":
        case "duration":
          return new Date(a.since).getTime() - new Date(b.since).getTime();
        case "name_asc":
          return a.person.fullName.localeCompare(b.person.fullName);
        case "name_desc":
          return b.person.fullName.localeCompare(a.person.fullName);
        default:
          return 0;
      }
    });
  }, [rows, typeFilter, search, sortKey]);

  const hasActiveFilter = search !== "" || typeFilter !== "all";
  const clearFilters = () => {
    setSearch("");
    setTypeFilter("all");
  };

  const degradedCount = rows.filter((r) => r.missingExit).length;

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/verify">
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
              <ArrowLeft className="h-4 w-4" /> {t("nav.gate_scan")}
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">{t("inside.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("inside.subtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {dataUpdatedAt > 0 && (
            <span className="text-xs text-muted-foreground">
              {t("inside.updated_at", {
                time: new Date(dataUpdatedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                }),
              })}
            </span>
          )}
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            {t("common2.refresh")}
          </Button>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          value={rows.length}
          label={t("inside.stat_inside")}
          color="text-success"
          bg="bg-success/10"
          live
        />
        <StatCard
          value={workers}
          label={t("inside.stat_workers")}
          color="text-primary"
          bg="bg-primary/10"
        />
        <StatCard
          value={interns}
          label={t("inside.stat_interns")}
          color="text-foreground"
          bg="bg-secondary"
        />
        <StatCard
          value={visitors}
          label={t("inside.stat_visitors")}
          color="text-warning"
          bg="bg-warning/10"
        />
      </div>

      {/* ── Today's throughput ── */}
      <div className="flex flex-wrap gap-4 rounded-xl border border-border bg-card px-5 py-3 text-sm text-muted-foreground shadow-sm">
        <span className="flex items-center gap-1.5">
          <ArrowDownToLine className="h-4 w-4 text-success" />
          <strong className="text-foreground">{throughput?.entries ?? "—"}</strong>{" "}
          {t("common2.entry")}
        </span>
        <span className="flex items-center gap-1.5">
          <ArrowUpFromLine className="h-4 w-4 text-primary" />
          <strong className="text-foreground">{throughput?.exits ?? "—"}</strong>{" "}
          {t("common2.exit")}
        </span>
        {degradedCount > 0 && (
          <span className="flex items-center gap-1.5 text-warning">
            <AlertTriangle className="h-4 w-4" />
            {t("inside.missing_exit_count", { count: degradedCount })}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <ScanLine className="h-4 w-4" />
          {t("inside.total_scans_today", {
            count: (throughput?.entries ?? 0) + (throughput?.exits ?? 0),
          })}
        </span>
      </div>

      {/* ── Filter / sort toolbar ── */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("inside.search_ph")}
            className="pl-9 h-9"
          />
        </div>

        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
          <SelectTrigger className="w-[150px] h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("inside.type_all")}</SelectItem>
            <SelectItem value="worker">{t("inside.type_worker")}</SelectItem>
            <SelectItem value="intern">{t("inside.type_intern")}</SelectItem>
            <SelectItem value="visitor">{t("inside.type_visitor")}</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <ArrowUpDown className="h-4 w-4 text-muted-foreground shrink-0" />
          <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
            <SelectTrigger className="w-[190px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="since_new">{t("inside.sort_since_new")}</SelectItem>
              <SelectItem value="since_old">{t("inside.sort_since_old")}</SelectItem>
              <SelectItem value="duration">{t("inside.sort_duration")}</SelectItem>
              <SelectItem value="name_asc">{t("inside.sort_name_asc")}</SelectItem>
              <SelectItem value="name_desc">{t("inside.sort_name_desc")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {hasActiveFilter && (
          <Button
            size="sm"
            variant="ghost"
            onClick={clearFilters}
            className="h-9 gap-1.5 text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" /> {t("common2.clear_filters")}
          </Button>
        )}
      </div>

      {/* ── Occupancy list ── */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card py-20">
          <Users className="h-14 w-14 text-muted-foreground/20" />
          <p className="font-semibold text-muted-foreground">{t("inside.empty")}</p>
          <p className="text-sm text-muted-foreground">{t("inside.empty_hint")}</p>
          <Link to="/verify" className="mt-2">
            <Button size="sm" variant="outline">
              <ScanLine className="mr-1.5 h-4 w-4" /> {t("inside.go_to_gate")}
            </Button>
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border bg-secondary/30 px-5 py-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">
                {hasActiveFilter
                  ? t("inside.filtered_count", { shown: filtered.length, total: rows.length })
                  : t("inside.total_count", { count: rows.length })}
              </span>
            </div>
            <div className="flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-3 py-1">
              <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
              <span className="text-xs font-semibold text-success">{t("common2.live_badge")}</span>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-muted-foreground">
              {t("inside.no_match")}{" "}
              <button
                onClick={clearFilters}
                className="text-primary underline-offset-2 hover:underline"
              >
                {t("common2.clear_filters")}
              </button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((entry) => {
                const p = entry.person;
                const ago = relativeTime(entry.since, t);
                const duration = elapsed(entry.since);
                return (
                  <div
                    key={entry.credentialId}
                    className="flex items-center gap-4 px-5 py-3.5 hover:bg-secondary/20 transition-colors"
                  >
                    <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary ring-2 ring-border">
                      <UserIcon className="h-5 w-5 text-muted-foreground" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm">{p.fullName}</p>
                        <CategoryBadge category={p.category} />
                        {entry.missingExit && (
                          <Badge
                            variant="outline"
                            className="gap-1 border-warning/40 text-[10px] font-bold uppercase text-warning"
                            title={t("inside.missing_exit_hint")}
                          >
                            <AlertTriangle className="h-3 w-3" /> {t("inside.missing_exit")}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {[p.workerRef, p.contractorCompany, p.institutionName]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </p>
                    </div>

                    <div className="hidden sm:flex items-center gap-1 rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {duration}
                    </div>

                    <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground">
                      <span title={new Date(entry.since).toLocaleString()}>{ago}</span>
                      <span className="hidden sm:inline">
                        {t("inside.since_at", {
                          time: new Date(entry.since).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          }),
                        })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="border-t border-border bg-secondary/10 px-5 py-2.5 text-xs text-muted-foreground">
            {t("inside.footer")}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function CategoryBadge({ category }: { category: PersonCategory }) {
  const { t } = useTranslation();
  const styles: Record<PersonCategory, string> = {
    worker: "bg-primary/15 text-primary",
    intern: "bg-secondary text-muted-foreground",
    visitor: "bg-warning/15 text-warning",
  };
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase ${styles[category]}`}
    >
      {t(`inside.cat_${category}`)}
    </span>
  );
}

function elapsed(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function relativeTime(iso: string, t: (k: string, o?: Record<string, unknown>) => string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return t("inside.just_now");
  if (mins < 60) return t("inside.minutes_ago", { count: mins });
  const h = Math.floor(mins / 60);
  return t("inside.hours_ago", { count: h });
}

function StatCard({
  value,
  label,
  color,
  bg,
  live = false,
}: {
  value: number;
  label: string;
  color: string;
  bg: string;
  live?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`flex flex-col items-start gap-1 rounded-xl border border-border p-5 shadow-sm ${bg}`}
    >
      <div className="flex w-full items-center justify-between">
        <span className={`text-3xl font-bold ${color}`}>{value}</span>
        {live && (
          <span className="flex items-center gap-1 rounded-full border border-success/25 bg-success/15 px-2 py-0.5 text-[10px] font-bold text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />{" "}
            {t("common2.live_badge")}
          </span>
        )}
      </div>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
    </div>
  );
}
