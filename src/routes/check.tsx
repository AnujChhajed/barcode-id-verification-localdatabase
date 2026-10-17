import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, HelpCircle, Loader2, Search, XCircle } from "lucide-react";
import { ApiError, checkApi, type CardStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AbbLogo } from "@/components/AbbLogo";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/check")({
  component: CheckPage,
});

/**
 * `validTo` is a plain calendar date, so it is rebuilt from its own parts:
 * `new Date("YYYY-MM-DD")` would read it as UTC and shift the day for everyone
 * west of Greenwich. A malformed value yields no date line at all.
 */
function formatDate(value: string): string | null {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Shared frame for the three verdict panels; each adds its own tone. */
const PANEL = "flex items-start gap-3 rounded-xl border p-4";

function CheckPage() {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  const [code, setCode] = useState("");
  const [card, setCard] = useState<CardStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const validTo = card?.validTo ? formatDate(card.validTo) : null;
  const hasAnswer = card !== null || error !== null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;

    setBusy(true);
    setError(null);
    try {
      setCard(await checkApi.card(trimmed));
    } catch (caught) {
      setCard(null);
      // A status of 0 is the network failure, whose message is not meant for a
      // worker at the gate — so that case gets the plain-language wording.
      setError(
        caught instanceof ApiError && caught.status > 0 ? caught.message : t("check.error_network"),
      );
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setCode("");
    setCard(null);
    setError(null);
    inputRef.current?.focus();
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <header className="mb-6 flex items-center gap-3">
          <AbbLogo className="h-8 w-auto" />
          <div className="leading-tight">
            <p className="text-lg font-bold tracking-tight">{t("check.header_title")}</p>
            <p className="text-xs text-muted-foreground">{t("check.card_status")}</p>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">{t("check.title")}</CardTitle>
            <CardDescription>{t("check.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleSubmit} className="space-y-3">
              <Label htmlFor="card-code" className="sr-only">
                {t("check.placeholder")}
              </Label>
              <Input
                id="card-code"
                ref={inputRef}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder={t("check.placeholder")}
                disabled={busy}
                className="h-11 text-center text-base font-medium tracking-wide"
              />
              <Button type="submit" className="h-11 w-full" disabled={busy || !code.trim()}>
                {busy ? <Loader2 className="animate-spin" /> : <Search />}
                {busy ? t("check.checking") : t("check.button")}
              </Button>
            </form>

            {error && (
              <Alert variant="destructive">
                <XCircle />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {card?.valid && (
              <div className={cn(PANEL, "border-success/40 bg-success/10")}>
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                <div className="space-y-1">
                  <p className="font-semibold text-success">{t("check.valid_title")}</p>
                  {card.kind && (
                    <p className="text-xs font-semibold uppercase tracking-wide text-success">
                      {card.kind === "id_card" ? t("check.id_card") : t("check.gate_pass")}
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground">{t("check.valid_hint")}</p>
                  {validTo && (
                    <p className="text-sm text-muted-foreground">
                      {t("check.valid_until", { date: validTo })}
                    </p>
                  )}
                </div>
              </div>
            )}

            {card && !card.valid && card.status === "not_found" && (
              <div className={cn(PANEL, "border-border bg-muted/50")}>
                <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="font-semibold">{t("check.not_found_title")}</p>
                  {card.reasonText && (
                    <p className="text-sm text-muted-foreground">{card.reasonText}</p>
                  )}
                </div>
              </div>
            )}

            {card && !card.valid && card.status !== "not_found" && (
              <div className={cn(PANEL, "border-destructive/40 bg-destructive/10")}>
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                <div className="space-y-1">
                  <p className="font-semibold text-destructive">{t("check.invalid_title")}</p>
                  {/* The server's own words — never re-derived on the client. */}
                  {card.reasonText && (
                    <p className="text-sm text-muted-foreground">{card.reasonText}</p>
                  )}
                  {validTo && (
                    <p className="text-sm text-muted-foreground">
                      {t("check.expired_on", { date: validTo })}
                    </p>
                  )}
                </div>
              </div>
            )}

            {hasAnswer && (
              <Button variant="ghost" className="w-full" onClick={reset}>
                {t("check.check_another")}
              </Button>
            )}

            <p className="text-center text-xs text-muted-foreground">{t("check.public_note")}</p>
          </CardContent>
        </Card>

        <footer className="mt-6 flex items-center justify-center gap-3 text-xs text-muted-foreground">
          <span>{t("check.footer")}</span>
          <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            {t("check.staff_login")}
          </Link>
        </footer>
      </div>
    </div>
  );
}
