import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, watchlistApi, type WatchlistEntryView, type WatchlistLevel } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Eye, EyeOff, Plus, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/watchlist")({
  component: WatchlistPage,
});

const LEVELS: WatchlistLevel[] = ["info", "warn", "deny", "detain"];

const LEVEL_TONE: Record<WatchlistLevel, string> = {
  info: "border-border bg-secondary text-muted-foreground",
  warn: "border-warning/40 bg-warning/10 text-warning",
  deny: "border-destructive/40 bg-destructive/10 text-destructive",
  detain: "border-destructive bg-destructive text-destructive-foreground",
};

function formatDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

function WatchlistPage() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["watchlist", showInactive],
    queryFn: () => watchlistApi.list({ includeInactive: showInactive, limit: 200 }),
    refetchInterval: 60_000,
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => watchlistApi.deactivate(id),
    onSuccess: () => {
      toast.success(t("wl.toast_removed"));
      void queryClient.invalidateQueries({ queryKey: ["watchlist"] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t("common.error")),
  });

  const entries = data?.entries ?? [];
  const detainCount = entries.filter((e) => e.isActive && e.level === "detain").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("wl.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("wl.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowInactive((v) => !v)}>
            {showInactive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {showInactive ? t("wl.hide_inactive") : t("wl.show_inactive")}
          </Button>
          {isAdmin && <NewEntryDialog />}
        </div>
      </div>

      {detainCount > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive bg-destructive/10 p-4 text-destructive">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm font-semibold">{t("wl.detain_banner", { count: detainCount })}</p>
        </div>
      )}

      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          {t("common.loading")}
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">{t("wl.empty_all")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              canDeactivate={isAdmin}
              pending={deactivate.isPending}
              onDeactivate={() => deactivate.mutate(entry.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EntryCard({
  entry,
  canDeactivate,
  pending,
  onDeactivate,
}: {
  entry: WatchlistEntryView;
  canDeactivate: boolean;
  pending: boolean;
  onDeactivate: () => void;
}) {
  const { t } = useTranslation();
  const expired = entry.expiresAt ? new Date(entry.expiresAt).getTime() < Date.now() : false;

  return (
    <div className={cn("rounded-xl border bg-card p-4 shadow-sm", !entry.isActive && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
            LEVEL_TONE[entry.level],
          )}
        >
          {t(`wl.level_${entry.level}`)}
        </span>
        <h3 className="flex-1 text-sm font-semibold">{entry.fullName}</h3>
        {!entry.isActive && <Badge variant="outline">{t("wl.inactive_badge")}</Badge>}
        {expired && <Badge variant="secondary">{t("wl.expired_badge")}</Badge>}
        {canDeactivate && entry.isActive && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={pending}
            onClick={onDeactivate}
          >
            {t("wl.deactivate")}
          </Button>
        )}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{entry.reason}</p>
      {entry.notes && <p className="mt-1 text-sm text-muted-foreground">{entry.notes}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
        {entry.barcode && <span className="font-mono">{entry.barcode}</span>}
        {entry.createdByName && (
          <span>
            {t("wl.added_by")} {entry.createdByName}
          </span>
        )}
        {entry.expiresAt && (
          <span>{t("wl.expires_on", { date: formatDate(entry.expiresAt) })}</span>
        )}
      </div>
    </div>
  );
}

function NewEntryDialog() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [level, setLevel] = useState<WatchlistLevel>("warn");
  const [barcode, setBarcode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const create = useMutation({
    mutationFn: () =>
      watchlistApi.create({
        fullName: fullName.trim(),
        reason: reason.trim(),
        level,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(barcode.trim() ? { barcode: barcode.trim() } : {}),
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      }),
    onSuccess: () => {
      toast.success(t("wl.toast_added"));
      void queryClient.invalidateQueries({ queryKey: ["watchlist"] });
      setOpen(false);
      setFullName("");
      setReason("");
      setNotes("");
      setLevel("warn");
      setBarcode("");
      setExpiresAt("");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t("common.error")),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!fullName.trim() || !reason.trim()) {
      toast.error(t("inc.required_fields"));
      return;
    }
    create.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          {t("wl.add_btn")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("wl.form_title")}</DialogTitle>
            <DialogDescription>{t("wl.gate_notice_sub")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="wl-name">{t("wl.label_name")}</Label>
              <Input
                id="wl-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={t("wl.ph_name")}
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("wl.label_level")}</Label>
              <Select value={level} onValueChange={(v) => setLevel(v as WatchlistLevel)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEVELS.map((l) => (
                    <SelectItem key={l} value={l}>
                      {t(`wl.level_${l}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wl-reason">{t("wl.label_reason")}</Label>
            <Input
              id="wl-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("wl.ph_reason")}
              maxLength={300}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wl-notes">{t("wl.label_desc")}</Label>
            <Textarea
              id="wl-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("wl.ph_desc")}
              rows={3}
              maxLength={1000}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="wl-barcode">{t("wl.label_barcode")}</Label>
              <Input
                id="wl-barcode"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder={t("wl.ph_barcode")}
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wl-expires">{t("wl.label_expires")}</Label>
              <Input
                id="wl-expires"
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? t("wl.adding") : t("wl.add_submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
