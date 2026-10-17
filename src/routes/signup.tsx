import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  ScanLine,
  ShieldCheck,
} from "lucide-react";
import { ApiError, authApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AbbLogo } from "@/components/AbbLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/signup")({ component: SignupPage });

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

function SignupPage() {
  const { t } = useTranslation();
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Same redirect as the login page: `isAdmin` is only correct once `user` is set.
  useEffect(() => {
    if (user) navigate({ to: isAdmin ? "/dashboard" : "/verify", replace: true });
  }, [user, isAdmin, navigate]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (password !== confirm) {
      setError(t("signup.confirm_mismatch"));
      return;
    }
    if (password.length < 12) {
      setError(t("signup.password_hint"));
      return;
    }
    setSubmitting(true);
    try {
      await authApi.signup({
        username: username.trim(),
        fullName: fullName.trim(),
        password,
        ...(email.trim() ? { email: email.trim() } : {}),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <BrandPanel />

      <main className="flex items-center justify-center bg-background px-4 py-10 lg:py-16">
        <div className="w-full max-w-md">
          <div className="mb-6 flex justify-center lg:hidden">
            <AbbLogo className="h-9 w-auto" />
          </div>

          {done ? (
            <Card>
              <CardHeader className="items-center text-center">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-success/10 text-success">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <CardTitle className="mt-2">{t("signup.pending_title")}</CardTitle>
                <CardDescription>{t("signup.pending_body")}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild className="w-full">
                  <Link to="/login">{t("signup.back_to_login")}</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-xl">{t("signup.title")}</CardTitle>
                <CardDescription>{t("signup.subtitle")}</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={submit} noValidate className="space-y-4">
                  {error && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="username">{t("signup.username")}</Label>
                    <Input
                      id="username"
                      name="username"
                      autoComplete="username"
                      required
                      placeholder={t("signup.username_ph")}
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="fullName">{t("signup.full_name")}</Label>
                    <Input
                      id="fullName"
                      name="fullName"
                      autoComplete="name"
                      required
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">{t("signup.email")}</Label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">{t("signup.password")}</Label>
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={12}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">{t("signup.password_hint")}</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirm">{t("signup.confirm")}</Label>
                    <Input
                      id="confirm"
                      name="confirm"
                      type="password"
                      autoComplete="new-password"
                      required
                      value={confirm}
                      onChange={(event) => setConfirm(event.target.value)}
                    />
                  </div>

                  <Button type="submit" className="w-full" disabled={submitting}>
                    {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    {submitting ? t("signup.submitting") : t("signup.submit")}
                  </Button>
                </form>

                <p className="mt-6 text-center text-sm text-muted-foreground">
                  {t("signup.have_account")}{" "}
                  <Link to="/login" className="font-medium text-primary hover:underline">
                    {t("signup.sign_in")}
                  </Link>
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
