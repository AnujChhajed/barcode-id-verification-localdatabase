import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  announcementsApi,
  ApiError,
  type AnnouncementSeverity,
  type AnnouncementView,
} from "@/lib/api";
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
import { Megaphone, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/announcements")({
  component: AnnouncementsPage,
});

const SEVERITIES: AnnouncementSeverity[] = ["info", "warning", "critical"];

const SEVERITY_TONE: Record<AnnouncementSeverity, string> = {
  info: "border-primary/30 bg-primary/5",
  warning: "border-warning/40 bg-warning/5",
  critical: "border-destructive/40 bg-destructive/5",
};

function formatWhen(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function AnnouncementsPage() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["announcements", isAdmin],
    queryFn: () => announcementsApi.list(isAdmin),
    refetchInterval: 60_000,
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => announcementsApi.deactivate(id),
    onSuccess: () => {
      toast.success(t("ann.toast_deactivated"));
      void queryClient.invalidateQueries({ queryKey: ["announcements"] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t("common.error")),
  });

  const announcements = data?.announcements ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("ann.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("ann.empty_sub")}</p>
        </div>
        {isAdmin && <NewAnnouncementDialog />}
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          {t("common.loading")}
        </div>
      ) : announcements.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <Megaphone className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">{t("ann.empty")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {announcements.map((item) => (
            <AnnouncementCard
              key={item.id}
              item={item}
              canDeactivate={isAdmin}
              pending={deactivate.isPending}
              onDeactivate={() => deactivate.mutate(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AnnouncementCard({
  item,
  canDeactivate,
  pending,
  onDeactivate,
}: {
  item: AnnouncementView;
  canDeactivate: boolean;
  pending: boolean;
  onDeactivate: () => void;
}) {
  const { t } = useTranslation();
  const expired = item.expiresAt ? new Date(item.expiresAt).getTime() < Date.now() : false;
  const inactive = !item.isActive || expired;

  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4 shadow-sm",
        inactive ? "border-border opacity-60" : SEVERITY_TONE[item.severity],
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={item.severity === "critical" ? "destructive" : "secondary"}>
          {t(`ann.sev_${item.severity}`)}
        </Badge>
        <h3 className="flex-1 text-sm font-semibold">{item.title}</h3>
        {inactive && <Badge variant="outline">{t("ann.inactive_badge")}</Badge>}
        {canDeactivate && item.isActive && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={pending}
            onClick={onDeactivate}
          >
            <Trash2 className="h-4 w-4" />
            {t("ann.deactivate")}
          </Button>
        )}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.body}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
        <span>{formatWhen(item.createdAt)}</span>
        {item.createdByName && (
          <span>
            {t("ann.posted_by")} {item.createdByName}
          </span>
        )}
        {item.expiresAt && <span>{t("ann.expires", { date: formatWhen(item.expiresAt) })}</span>}
      </div>
    </div>
  );
}

function NewAnnouncementDialog() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState<AnnouncementSeverity>("info");
  const [expiresAt, setExpiresAt] = useState("");

  const create = useMutation({
    mutationFn: () =>
      announcementsApi.create({
        title: title.trim(),
        body: body.trim(),
        severity,
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      }),
    onSuccess: () => {
      toast.success(t("ann.toast_posted"));
      void queryClient.invalidateQueries({ queryKey: ["announcements"] });
      setOpen(false);
      setTitle("");
      setBody("");
      setSeverity("info");
      setExpiresAt("");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t("common.error")),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !body.trim()) {
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
          {t("ann.new_btn")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("ann.form_title")}</DialogTitle>
            <DialogDescription>{t("ann.empty_sub")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="ann-title">{t("ann.label_title")}</Label>
            <Input
              id="ann-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("ann.ph_title")}
              maxLength={120}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ann-body">{t("ann.label_msg")}</Label>
            <Textarea
              id="ann-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("ann.ph_msg")}
              rows={4}
              maxLength={2000}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("ann.label_priority")}</Label>
              <Select
                value={severity}
                onValueChange={(v) => setSeverity(v as AnnouncementSeverity)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`ann.sev_${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ann-expires">{t("ann.label_expires")}</Label>
              <Input
                id="ann-expires"
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? t("ann.posting") : t("ann.post_btn")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
