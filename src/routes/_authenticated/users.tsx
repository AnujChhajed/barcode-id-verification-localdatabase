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
import { Eye, EyeOff, KeyRound, UserPlus } from "lucide-react";
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
  const [resetTargetUser, setResetTargetUser] = useState<any | null>(null);

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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">Account ID</th>
                <th className="px-4 py-3 text-left">{t("users.col_username")}</th>
                <th className="px-4 py-3 text-left">{t("users.col_name")}</th>
                <th className="px-4 py-3 text-left">{t("users.col_role")}</th>
                <th className="px-4 py-3 text-left">{t("users.col_status")}</th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3 text-left">{t("users.col_last_login")}</th>
                <th className="px-4 py-3 text-right">{t("users.col_actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    <span title={u.id}>{u.id.slice(0, 8)}…</span>
                  </td>
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
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatTimestamp(u.createdAt) ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatTimestamp(u.lastLoginAt) ?? t("users.never")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setResetTargetUser(u)}
                        title="Reset Password"
                      >
                        <KeyRound className="mr-1 h-3.5 w-3.5" />
                        Reset Pwd
                      </Button>
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
                    </div>
                  </td>
                </tr>
              ))}
              {!isLoading && users.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    {t("users.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{t("users.pending_note")}</p>
      <p className="text-xs text-muted-foreground">{t("users.admin_only_note")}</p>

      {resetTargetUser && (
        <ResetPasswordDialog
          user={resetTargetUser}
          onClose={() => setResetTargetUser(null)}
        />
      )}
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
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [role, setRole] = useState<Role>("security_staff");

  const reset = () => {
    setUsername("");
    setFullName("");
    setEmail("");
    setPassword("");
    setShowNewPassword(false);
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
            <div className="relative">
              <Input
                id="new-password"
                type={showNewPassword ? "text" : "password"}
                required
                minLength={12}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                tabIndex={-1}
              >
                {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
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

function ResetPasswordDialog({
  user,
  onClose,
}: {
  user: any;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 12) {
      toast.error("Password must be at least 12 characters long.");
      return;
    }
    setBusy(true);
    try {
      await usersApi.resetPassword(user.id, password);
      toast.success(`Password reset successfully for ${user.username}`);
      onClose();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to reset password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary shrink-0" />
            Reset Password — {user.username}
          </DialogTitle>
          <DialogDescription>
            Set a new secure password for <strong>{user.fullName}</strong> ({user.username}). This action is recorded in the security audit trail.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="reset-pwd">New Password *</Label>
            <div className="relative">
              <Input
                id="reset-pwd"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 12 characters"
                minLength={12}
                required
                autoFocus
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Must be at least 12 characters. Passwords and hashes are never sent back or displayed in tables.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || password.length < 12}>
              {busy ? "Updating..." : "Reset Password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
