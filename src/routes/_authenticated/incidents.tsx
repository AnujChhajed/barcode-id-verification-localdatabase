import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  incidentsApi,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentView,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertTriangle, Dot, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/incidents")({
  component: IncidentsPage,
});

const SEVERITY_ORDER: IncidentSeverity[] = ["critical", "high", "medium", "low"];
const STATUS_ORDER: IncidentStatus[] = ["open", "investigating", "closed"];

const SEVERITY_TONE: Record<IncidentSeverity, string> = {
  critical: "border-destructive/40 bg-destructive/10 text-destructive",
  high: "border-warning/40 bg-warning/10 text-warning",
  medium: "border-primary/30 bg-primary/10 text-primary",
  low: "border-border bg-secondary text-muted-foreground",
};

const STATUS_LABEL: Record<IncidentStatus, string> = {
  open: "inc.status_open",
  investigating: "inc.status_review",
  closed: "inc.status_closed",
};

function formatWhen(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function IncidentsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<IncidentStatus | "all">("all");
  const [severity, setSeverity] = useState<IncidentSeverity | "all">("all");

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["incidents", status, severity],
    queryFn: () =>
      incidentsApi.list({
        ...(status === "all" ? {} : { status }),
        ...(severity === "all" ? {} : { severity }),
        limit: 100,
      }),
    refetchInterval: 30_000,
  });

  const setStatusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: IncidentStatus }) =>
      incidentsApi.setStatus(id, next),
    onSuccess: () => {
      toast.success(t("inc.toast_updated"));
      void queryClient.invalidateQueries({ queryKey: ["incidents"] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t("common.error")),
  });

  const incidents = useMemo(() => data?.incidents ?? [], [data]);
  const openCount = useMemo(
    () => incidents.filter((i) => i.status !== "closed").length,
    [incidents],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("inc.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {openCount > 0 ? t("inc.sub_open", { count: openCount }) : t("inc.sub_clear")}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          {t("common2.refresh")}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <FilterRow
          label={t("common2.status")}
          value={status}
          options={[
            { value: "all", label: t("inc.filter_all") },
            ...STATUS_ORDER.map((s) => ({ value: s, label: t(STATUS_LABEL[s]) })),
          ]}
          onChange={(v) => setStatus(v as IncidentStatus | "all")}
        />
        <FilterRow
          label={t("inc.label_severity")}
          value={severity}
          options={[
            { value: "all", label: t("inc.filter_all") },
            ...SEVERITY_ORDER.map((s) => ({ value: s, label: t(`inc.sev_${s}`) })),
          ]}
          onChange={(v) => setSeverity(v as IncidentSeverity | "all")}
        />
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          {t("common.loading")}
        </div>
      ) : incidents.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">{t("inc.empty_all")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("inc.all_clear")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {incidents.map((incident) => (
            <IncidentCard
              key={incident.id}
              incident={incident}
              pending={setStatusMutation.isPending}
              onSetStatus={(next) => setStatusMutation.mutate({ id: incident.id, next })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-medium transition-colors",
              value === option.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function IncidentCard({
  incident,
  pending,
  onSetStatus,
}: {
  incident: IncidentView;
  pending: boolean;
  onSetStatus: (next: IncidentStatus) => void;
}) {
  const { t } = useTranslation();
  const tone = SEVERITY_TONE[incident.severity];

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
            tone,
          )}
        >
          {t(`inc.sev_${incident.severity}`)}
        </span>
        <h3 className="flex-1 text-sm font-semibold">{incident.title}</h3>
        <Badge variant={incident.status === "closed" ? "secondary" : "default"}>
          {t(STATUS_LABEL[incident.status])}
        </Badge>
      </div>

      <div className="space-y-2 px-4 py-3">
        {incident.description && (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {incident.description}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{formatWhen(incident.occurredAt)}</span>
          {incident.personName && (
            <>
              <Dot className="h-3 w-3" />
              <span>{incident.personName}</span>
            </>
          )}
          {incident.reportedByName && (
            <>
              <Dot className="h-3 w-3" />
              <span>
                {t("inc.reported_by")} {incident.reportedByName}
              </span>
            </>
          )}
        </div>
      </div>

      {incident.status !== "closed" && (
        <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
          {incident.status === "open" && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => onSetStatus("investigating")}
            >
              {t("inc.mark_review")}
            </Button>
          )}
          <Button size="sm" disabled={pending} onClick={() => onSetStatus("closed")}>
            {t("inc.close_btn")}
          </Button>
        </div>
      )}
    </div>
  );
}
