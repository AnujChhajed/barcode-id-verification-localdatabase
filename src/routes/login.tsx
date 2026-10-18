import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, ClipboardList, Eye, EyeOff, Loader2, ScanLine, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { AbbLogo } from "@/components/AbbLogo";
import { ServerUnreachable } from "@/components/ServerUnreachable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/login")({ component: LoginPage });

const BRAND_FEATURES = [
  { icon: ScanLine, key: "login.feat_instant" },
  { icon: ClipboardList, key: "login.feat_mgmt" },
  { icon: ShieldCheck, key: "login.feat_audit" },
] as const;

function BrandPanel() {
  const { t } = useTranslation();
  return (
    <aside className="relative hidden flex-col justify-between overflow-hidden bg-sidebar-primary p-10 text-sidebar-primary-foreground lg:flex">
      <div>
        <AbbLogo className="h-10 w-auto" />
        <h1 className="mt-10 whitespace-pre-line text-4xl font-bold tracking-tight">
          {t("login.secure_campus")}
        </h1>
        <p className="mt-3 text-sm font-medium uppercase tracking-wide text-sidebar-primary-foreground/70">
          {t("login.brand_subtitle")}
        </p>
        <p className="mt-6 max-w-md text-sm leading-relaxed text-sidebar-primary-foreground/85">
          {t("login.scan_desc")}
        </p>
        <ul className="mt-8 space-y-3">
          {BRAND_FEATURES.map(({ icon: Icon, key }) => (
            <li key={key} className="flex items-center gap-3 text-sm">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/15">
                <Icon className="h-4 w-4" />
              </span>
              {t(key)}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-sidebar-primary-foreground/70">{t("login.dept_footer")}</p>
    </aside>
  );
}

function LoginPage() {
  const { t } = useTranslation();
  const { user, loading, serverUnreachable, isAdmin, signIn } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Redirect from an effect so `isAdmin` reflects the freshly signed-in user
  // rather than the signed-out render that submitted the form.
  useEffect(() => {
    if (user) navigate({ to: isAdmin ? "/dashboard" : "/verify", replace: true });
  }, [user, isAdmin, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (serverUnreachable) return <ServerUnreachable />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const result = await signIn(username.trim(), password);
    setSubmitting(false);
    // A successful sign-in sets `user` above; the effect performs the redirect.
    if (result.error) setError(result.error);
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <BrandPanel />

      <main className="flex items-center justify-center bg-background px-4 py-10 lg:py-16">
        <div className="w-full max-w-md">
          <div className="mb-6 flex justify-center lg:hidden">
            <AbbLogo className="h-9 w-auto" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl">{t("login.welcome")}</CardTitle>
              <CardDescription>{t("login.sign_in_desc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <Label htmlFor="username">{t("login.username")}</Label>
                  <Input
                    id="username"
                    name="username"
                    autoComplete="username"
                    required
                    placeholder={t("login.username_ph")}
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">{t("login.password")}</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                      title={showPassword ? "Hide password" : "Show password"}
                      tabIndex={-1}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {submitting ? t("login.please_wait") : t("login.sign_in")}
                </Button>
              </form>

              <p className="mt-6 text-center text-sm text-muted-foreground">
                {t("login.no_account")}{" "}
                <Link to="/signup" className="font-medium text-primary hover:underline">
                  {t("login.create_account")}
                </Link>
              </p>
            </CardContent>
          </Card>

          <p className="mt-6 px-2 text-center text-xs text-muted-foreground">
            {t("login.bootstrap_note", { username: "admin" })}
          </p>
        </div>
      </main>
    </div>
  );
}
