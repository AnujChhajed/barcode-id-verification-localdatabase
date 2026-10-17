import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { settingsApi, ApiError, type SettingView } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

/**
 * The settings the backend actually reads. Each entry declares the key, how to
 * render it and the range the backend will accept, so a value that is saved
 * here can never be one the server would reject at scan time.
 */
interface NumericSetting {
  key: string;
  labelKey: string;
  hintKey: string;
  min: number;
  max: number;
  fallback: number;
}

const NUMERIC_SETTINGS: NumericSetting[] = [
  {
    key: "session.timeout_minutes",
    labelKey: "settings.label_timeout",
    hintKey: "settings.timeout_hint",
    min: 5,
    max: 480,
    fallback: 30,
  },
  {
    key: "scan.duplicate_window_seconds",
    labelKey: "settings.label_duplicate",
    hintKey: "settings.duplicate_hint",
    min: 0,
    max: 300,
    fallback: 5,
  },
  {
    key: "expiry.reminder_days",
    labelKey: "settings.label_reminder_days",
    hintKey: "settings.reminder_hint",
    min: 1,
    max: 365,
    fallback: 7,
  },
];

const TIMEZONE_KEY = "site.timezone";

function findValue(settings: SettingView[], key: string) {
  return settings.find((s) => s.key === key)?.value;
}

function SettingsPage() {
  const { t } = useTranslation();
  const { isAdmin, loading } = useAuth();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["settings"],
    enabled: isAdmin,
    queryFn: () => settingsApi.list(),
  });

  const [timezone, setTimezone] = useState("");
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Seed the form once the stored values arrive. Keyed off `data` so a refetch
  // after a save does not silently discard an in-progress edit.
  useEffect(() => {
    if (!data) return;
    setTimezone(String(findValue(data.settings, TIMEZONE_KEY) ?? ""));
    const next: Record<string, string> = {};
    for (const setting of NUMERIC_SETTINGS) {
      const stored = findValue(data.settings, setting.key);
      next[setting.key] = String(stored ?? setting.fallback);
    }
    setNumbers(next);
  }, [data]);

  if (loading) return null;
  if (!isAdmin) return <Navigate to="/verify" />;

  const save = async () => {
    if (!timezone.trim()) {
      toast.error(t("settings.timezone_error"));
      return;
    }

    const pending: Array<{ key: string; value: string }> = [
      { key: TIMEZONE_KEY, value: timezone.trim() },
    ];

    for (const setting of NUMERIC_SETTINGS) {
      const raw = numbers[setting.key] ?? String(setting.fallback);
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < setting.min || parsed > setting.max) {
        toast.error(t("settings.number_error", { min: setting.min, max: setting.max }));
        return;
      }
      pending.push({ key: setting.key, value: String(parsed) });
    }

    setSaving(true);
    try {
      for (const item of pending) {
        await settingsApi.update(item.key, item.value);
      }
      toast.success(t("settings.saved"));
      await qc.invalidateQueries({ queryKey: ["settings"] });
      await qc.invalidateQueries({ queryKey: ["setting-session-timeout"] });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("settings.subtitle")}</p>
      </div>

      <div className="grid max-w-2xl gap-6">
        <section className="space-y-5 rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("settings.sec_site")}
          </h2>

          <div className="space-y-1.5">
            <Label htmlFor="set-timezone">{t("settings.label_timezone")}</Label>
            <Input
              id="set-timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="Asia/Kolkata"
            />
            <p className="text-xs text-muted-foreground">{t("settings.timezone_hint")}</p>
          </div>
        </section>

        <section className="space-y-5 rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("settings.sec_behaviour")}
          </h2>

          {NUMERIC_SETTINGS.map((setting) => (
            <div key={setting.key} className="space-y-1.5">
              <Label htmlFor={`set-${setting.key}`}>{t(setting.labelKey)}</Label>
              <Input
                id={`set-${setting.key}`}
                type="number"
                min={setting.min}
                max={setting.max}
                value={numbers[setting.key] ?? ""}
                onChange={(e) => setNumbers((prev) => ({ ...prev, [setting.key]: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">{t(setting.hintKey)}</p>
            </div>
          ))}
        </section>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving ? t("settings.saving") : t("settings.save_btn")}
          </Button>
        </div>
      </div>
    </div>
  );
}
