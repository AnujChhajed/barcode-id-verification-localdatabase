import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { auditApi, type AuditEntryView } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { RefreshCw, ScrollText } from "lucide-react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/audit")({
  component: AuditPage,
});

const PAGE_SIZE = 50;

function formatWhen(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function snapshot(value: Record<string, unknown> | null) {
  if (!value) return "—";
  try {
    return JSON.stringify(value);
  } catch {
    return "—";
  }
}

function AuditPage() {
  const { t } = useTranslation();
  const { isAdmin, loading } = useAuth();
  const [action, setAction] = useState("");
  const [entityId, setEntityId] = useState("");
  const [offset, setOffset] = useState(0);

  const filters = {
    ...(action ? { action } : {}),
    ...(entityId.trim() ? { entityId: entityId.trim() } : {}),
    limit: PAGE_SIZE,
    offset,
  };

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["audit", action, entityId, offset],
    enabled: isAdmin,
    queryFn: () => auditApi.list(filters),
  });

  if (loading) return null;
  if (!isAdmin) return <Navigate to="/verify" />;

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const actions = data?.actions ?? [];
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("aud.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("aud.subtitle")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          {t("common2.refresh")}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => {
              setAction("");
              setOffset(0);
            }}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-medium transition-colors",
              !action
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary",
            )}
          >
            {t("common2.all")}
          </button>
          {actions.slice(0, 12).map((a) => (
            <button
              key={a}
              onClick={() => {
                setAction(a);
                setOffset(0);
              }}
              className={cn(
                "rounded-md px-2 py-1 font-mono text-xs transition-colors",
                action === a
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary",
              )}
            >
              {a}
            </button>
          ))}
        </div>
        <Input
          value={entityId}
          onChange={(e) => {
            setEntityId(e.target.value);
            setOffset(0);
          }}
          placeholder={t("aud.entity_placeholder")}
          className="h-8 w-56"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">{t("aud.col_when")}</th>
              <th className="px-4 py-3 text-left">{t("aud.col_actor")}</th>
              <th className="px-4 py-3 text-left">{t("aud.col_action")}</th>
              <th className="px-4 py-3 text-left">{t("aud.col_entity")}</th>
              <th className="px-4 py-3 text-left">{t("aud.col_reason")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {entries.map((entry) => (
              <AuditRow key={entry.id} entry={entry} />
            ))}
            {!isLoading && entries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center">
                  <ScrollText className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
                  <span className="text-sm text-muted-foreground">{t("aud.empty")}</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{t("aud.total", { total })}</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            {t("reg.prev")}
          </Button>
          <span>{t("aud.page_of", { page, pages })}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            {t("reg.next")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AuditRow({ entry }: { entry: AuditEntryView }) {
  const [open, setOpen] = useState(false);
  const hasSnapshot = Boolean(entry.oldValue || entry.newValue);

  return (
    <>
      <tr className="align-top">
        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
          {formatWhen(entry.occurredAt)}
        </td>
        <td className="px-4 py-3">{entry.actorName ?? "—"}</td>
        <td className="px-4 py-3">
          <Badge variant="secondary" className="font-mono text-[10px]">
            {entry.action}
          </Badge>
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground">
          {entry.entityType}
          {entry.entityId && <span className="block font-mono">{entry.entityId.slice(0, 8)}…</span>}
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground">
          {entry.reason ?? "—"}
          {hasSnapshot && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="ml-2 text-primary hover:underline"
            >
              {open ? "▲" : "▼"}
            </button>
          )}
        </td>
      </tr>
      {open && hasSnapshot && (
        <tr className="bg-secondary/40">
          <td colSpan={5} className="px-4 py-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
                  Before
                </p>
                <pre className="overflow-x-auto rounded bg-card p-2 font-mono text-[11px]">
                  {snapshot(entry.oldValue)}
                </pre>
              </div>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
                  After
                </p>
                <pre className="overflow-x-auto rounded bg-card p-2 font-mono text-[11px]">
                  {snapshot(entry.newValue)}
                </pre>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
