import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usersApi, ApiError, type Role } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/users")({
  component: UsersPage,
});

const ROLE_OPTIONS: Role[] = ["security_staff", "administrator"];

function roleLabel(role: Role, t: (key: string) => string) {
  return role === "administrator" ? t("users.role_administrator") : t("users.role_security_staff");
}

function formatTimestamp(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function UsersPage() {
  const { t } = useTranslation();
  const { isAdmin, loading, user: me } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["users"],
    enabled: isAdmin,
    queryFn: () => usersApi.list(),
  });

  // Approving a signup and disabling an account are the same call. It must be
  // declared above the early returns so the hook count never changes.
  const setActive = useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      usersApi.setActive(input.id, input.isActive),
    onSuccess: (_user, input) => {
      toast.success(input.isActive ? t("users.enabled_toast") : t("users.disabled_toast"));
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    // The server owns the policy (no self-disable, never the last active
    // administrator), so its wording is what gets shown.
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : t("users.status_change_failed"));
    },
  });

  if (loading) return null;
  if (!isAdmin) return <Navigate to="/verify" />;

  const users = data?.users ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("users.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("users.subtitle")}</p>
        </div>
        <NewUserDialog />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">{t("users.col_username")}</th>
              <th className="px-4 py-3 text-left">{t("users.col_name")}</th>
              <th className="px-4 py-3 text-left">{t("users.col_role")}</th>
              <th className="px-4 py-3 text-left">{t("users.col_status")}</th>
              <th className="px-4 py-3 text-left">{t("users.col_last_login")}</th>
              <th className="px-4 py-3 text-right">{t("users.col_actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3 font-medium">
                  {u.username}
                  {u.id === me?.id && (
                    <span className="ml-2 text-xs text-muted-foreground">{t("users.you")}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {u.fullName}
                  {u.email && (
                    <span className="block text-xs text-muted-foreground">{u.email}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge
                    className={
                      u.role === "administrator" ? "bg-primary text-primary-foreground" : ""
                    }
                    variant={u.role === "administrator" ? "default" : "secondary"}
                  >
                    {roleLabel(u.role, t)}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge variant={u.isActive ? "secondary" : "destructive"}>
                    {u.isActive ? t("users.status_active") : t("users.status_inactive")}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {formatTimestamp(u.lastLoginAt) ?? t("users.never")}
                </td>
                <td className="px-4 py-3 text-right">
                  {u.isActive ? (
                    // Disabling yourself is refused by the server, so the button
                    // is not offered for your own row.
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={u.id === me?.id || setActive.isPending}
                      title={u.id === me?.id ? t("users.no_self_disable") : undefined}
                      onClick={() => setActive.mutate({ id: u.id, isActive: false })}
                    >
                      {t("users.disable")}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={setActive.isPending}
                      onClick={() => setActive.mutate({ id: u.id, isActive: true })}
                    >
                      {t("users.enable")}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {!isLoading && users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  {t("users.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">{t("users.pending_note")}</p>
      <p className="text-xs text-muted-foreground">{t("users.admin_only_note")}</p>
    </div>
  );
}

function NewUserDialog() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("security_staff");

  const reset = () => {
    setUsername("");
    setFullName("");
    setEmail("");
    setPassword("");
    setRole("security_staff");
  };

  const create = useMutation({
    mutationFn: () =>
      usersApi.create({
        username: username.trim(),
        fullName: fullName.trim(),
        role,
        password,
        ...(email.trim() ? { email: email.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success(t("users.created_toast"));
      setOpen(false);
      reset();
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : t("common.error"));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="mr-2 h-4 w-4" />
          {t("users.new_user")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("users.create_title")}</DialogTitle>
          <DialogDescription>{t("users.create_desc")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-username">{t("users.field_username")}</Label>
            <Input
              id="new-username"
              required
              autoComplete="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-fullname">{t("users.field_full_name")}</Label>
            <Input
              id="new-fullname"
              required
              autoComplete="off"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-email">{t("users.field_email_optional")}</Label>
            <Input
              id="new-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-password">{t("users.field_password")}</Label>
            <Input
              id="new-password"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("users.password_hint")}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-role">{t("users.col_role")}</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger id="new-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {roleLabel(option, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? t("users.creating") : t("users.create_btn")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
