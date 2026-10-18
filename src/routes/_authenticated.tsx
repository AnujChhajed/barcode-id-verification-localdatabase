import { createFileRoute, Outlet, Link, Navigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { settingsApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useIdleTimeout } from "@/lib/use-idle-timeout";
import { toast } from "sonner";
import {
  ShieldCheck,
  ScanLine,
  ClipboardList,
  Settings,
  LogOut,
  UserCog,
  LayoutDashboard,
  ChevronLeft,
  ChevronRight,
  Eye,
  Users,
  Menu,
  X,
  AlertTriangle,
  Megaphone,
  ShieldAlert,
  ScrollText,
  UtensilsCrossed,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ServerUnreachable } from "@/components/ServerUnreachable";
import { AbbLogo } from "@/components/AbbLogo";

// ─── Nav definition ────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { to: "/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard, adminOnly: true },
  { to: "/verify", labelKey: "nav.gate_scan", icon: ScanLine, adminOnly: false },
  { to: "/inside", labelKey: "nav.whos_inside", icon: Eye, adminOnly: false },
  { to: "/logs", labelKey: "nav.logs_reports", icon: ClipboardList, adminOnly: false },
  { to: "/canteen", labelKey: "nav.canteen", icon: UtensilsCrossed, adminOnly: false },
  { to: "/register", labelKey: "nav.register", icon: Users, adminOnly: true },
  { to: "/users", labelKey: "nav.users", icon: UserCog, adminOnly: true },
  { to: "/settings", labelKey: "nav.settings", icon: Settings, adminOnly: true },
] as const;

// ─── Route ─────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

// ─── Layout ────────────────────────────────────────────────────────────────

function AuthenticatedLayout() {
  const { t } = useTranslation();
  const { user, loading, isAdmin, signOut, serverUnreachable } = useAuth();
  const { location } = useRouterState();

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("sidebar-collapsed", String(collapsed));
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  // Two separate refs because both desktop and mobile headers render simultaneously
  // (one hidden via CSS). A single ref would be overwritten by whichever mounts last,
  // making the outside-click handler fire immediately and close the menu on every click.
  const desktopAvatarRef = useRef<HTMLDivElement>(null);
  const mobileAvatarRef = useRef<HTMLDivElement>(null);
  const mobileDrawerRef = useRef<HTMLDivElement>(null);

  // Close avatar menu when clicking outside either header's avatar container
  useEffect(() => {
    if (!avatarMenuOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      const insideDesktop = desktopAvatarRef.current?.contains(t);
      const insideMobile = mobileAvatarRef.current?.contains(t);
      if (!insideDesktop && !insideMobile) setAvatarMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [avatarMenuOpen]);

  // Close mobile drawer when clicking the backdrop (outside the panel)
  useEffect(() => {
    if (!mobileDrawerOpen) return;
    const handler = (e: MouseEvent) => {
      if (!mobileDrawerRef.current?.contains(e.target as Node)) {
        setMobileDrawerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [mobileDrawerOpen]);

  // ── Sign out helper (defined before hooks that reference it) ──────────
  // Uses replace:true so the back button can't return to a protected page after logout.
  // No extra router.navigate needed — _authenticated renders <Navigate to="/login" replace />
  // when user becomes null, which handles the redirect without stacking history.
  const handleSignOut = async () => {
    await signOut();
    // Navigate is handled below by the `if (!user)` guard (replace:true)
  };

  // ── Session auto-logout — MUST be above early returns so hook count is stable ──
  const { data: timeoutSetting } = useQuery({
    queryKey: ["setting-session-timeout"],
    staleTime: 5 * 60_000,
    enabled: !!user,
    queryFn: async () => {
      const { settings } = await settingsApi.list();
      const row = settings.find((s) => s.key === "session.timeout_minutes");
      const minutes = Number(row?.value);
      return Number.isFinite(minutes) && minutes > 0 ? minutes : 30;
    },
  });

  const timeoutMs = (timeoutSetting ?? 30) * 60_000;

  useIdleTimeout({
    timeoutMs,
    enabled: !!user,
    onWarn: () => {
      toast.warning("Session expiring soon", {
        description: "You'll be signed out in 60 seconds due to inactivity.",
        duration: 55_000,
      });
    },
    onTimeout: async () => {
      toast.info("Signed out due to inactivity");
      await handleSignOut();
    },
  });

  // ── Loading / auth guards — after ALL hooks ───────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }
  // The API not answering is a different problem from "nobody is signed in",
  // and they need different screens: an outage notice versus the sign-in form.
  if (serverUnreachable) return <ServerUnreachable />;
  if (!user) return <Navigate to="/login" replace />;

  // ── Derived values ───────────────────────────────────────────────────
  const navItems = NAV_ITEMS.filter((i) => isAdmin || !i.adminOnly);
  const mobileNavItems = navItems.slice(0, 4);

  const pathname = location.pathname;
  const pageTitle = navItems.find(({ to }) => pathname === to || pathname.startsWith(to + "/"))
    ?.labelKey
    ? t(navItems.find(({ to }) => pathname === to || pathname.startsWith(to + "/"))!.labelKey)
    : "ABB";

  const initials = (user.fullName || user.username || "U").slice(0, 2).toUpperCase();
  const roleLabel = isAdmin ? t("common.admin") : t("common.operator");

  return (
    <div className="flex min-h-screen bg-background">
      {/* ═══════════════════════════════════════════
          DESKTOP SIDEBAR
      ═══════════════════════════════════════════ */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col",
          "border-r border-sidebar-border bg-sidebar",
          "transition-[width] duration-200 ease-in-out",
          "md:flex",
          collapsed ? "w-[64px]" : "w-[240px]",
        )}
      >
        {/* Logo ── */}
        <div
          className={cn(
            "flex h-16 shrink-0 items-center border-b border-sidebar-border",
            collapsed ? "justify-center px-0" : "gap-3 px-5",
          )}
        >
          {collapsed ? (
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary shadow-sm text-primary-foreground">
              <ShieldCheck className="h-5 w-5" />
            </div>
          ) : (
            <AbbLogo className="h-8 w-[76px] shrink-0 object-contain" />
          )}
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-bold tracking-tight text-sidebar-foreground">
                ABB
              </p>
              <p className="truncate text-[10px] text-sidebar-foreground/50 font-medium uppercase tracking-widest">
                Verification
              </p>
            </div>
          )}
        </div>

        {/* Nav links ── */}
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-3">
          {navItems.map(({ to, labelKey, icon: Icon }) => {
            const label = t(labelKey);
            const active = pathname === to || pathname.startsWith(to + "/");
            return (
              <Link
                key={to}
                to={to}
                title={collapsed ? label : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg text-sm font-medium",
                  "transition-all duration-150",
                  collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5",
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                    : "text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                )}
              >
                <span className="relative shrink-0">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                {!collapsed && <span className="truncate">{label}</span>}
                {!collapsed && active && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-current opacity-60 animate-pulse" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Collapse toggle ── */}
        <div className="px-2 py-1">
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-3 py-2",
              "text-xs text-sidebar-foreground/40 transition-colors",
              "hover:bg-sidebar-accent hover:text-sidebar-foreground",
              collapsed && "justify-center px-2",
            )}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" />
                <span>{t("common.collapse")}</span>
              </>
            )}
          </button>
        </div>

        {/* User section ── */}
        <div
          className={cn(
            "flex items-center gap-3 border-t border-sidebar-border p-3",
            collapsed && "justify-center",
          )}
        >
          {/* Avatar */}
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">
            {initials}
          </div>

          {!collapsed && (
            <>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-sidebar-foreground">
                  {user.fullName}
                </p>
                <p className="text-[10px] font-medium text-sidebar-foreground/50">{roleLabel}</p>
              </div>
              <button
                onClick={handleSignOut}
                title="Sign out"
                className="rounded-lg p-1.5 text-sidebar-foreground/40 transition-colors hover:bg-sidebar-accent hover:text-destructive"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </aside>

      {/* ═══════════════════════════════════════════
          MAIN AREA  (offset by sidebar width)
      ═══════════════════════════════════════════ */}
      <div
        className={cn(
          "flex min-h-screen flex-1 flex-col",
          "transition-[margin-left] duration-200 ease-in-out",
          "md:ml-[240px]",
          collapsed && "md:ml-[64px]",
        )}
      >
        {/* ── Desktop top header ─────────────────── */}
        <header className="sticky top-0 z-20 hidden h-14 items-center justify-between border-b border-border bg-card/80 px-6 backdrop-blur-md md:flex">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-foreground">{pageTitle}</span>
            {/* Live system status indicator */}
            <span className="flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              {t("common.live")}
            </span>
          </div>
          {/* Avatar dropdown */}
          <div className="relative" ref={desktopAvatarRef}>
            <button
              onClick={() => setAvatarMenuOpen((o) => !o)}
              className="flex items-center gap-3 rounded-lg px-2 py-1 transition-colors hover:bg-accent"
              title="Account menu"
            >
              <span className="text-xs text-muted-foreground hidden lg:block">{user.fullName}</span>
              <div
                className={cn(
                  "grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary ring-2 transition-all duration-150",
                  avatarMenuOpen ? "ring-primary scale-105" : "ring-primary/20 hover:scale-110",
                )}
              >
                {initials}
              </div>
            </button>

            {/* Dropdown panel */}
            {avatarMenuOpen && (
              <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-56 rounded-xl border border-border bg-card shadow-lg ring-1 ring-black/5 animate-in fade-in slide-in-from-top-1 duration-150">
                {/* User info */}
                <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                    {initials}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-foreground">
                      {user.fullName}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{roleLabel}</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="p-1.5">
                  <button
                    onClick={() => {
                      setAvatarMenuOpen(false);
                      handleSignOut();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
                  >
                    <LogOut className="h-4 w-4" />
                    {t("common.sign_out")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </header>

        {/* ── Mobile top header ──────────────────── */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-card/90 px-4 backdrop-blur-md md:hidden">
          <div className="flex items-center gap-2.5">
            {/* Hamburger menu button */}
            <button
              onClick={() => setMobileDrawerOpen((o) => !o)}
              className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              title="All pages"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <p className="text-sm font-bold leading-tight tracking-tight">ABB</p>
              <p className="text-[10px] font-medium leading-tight text-muted-foreground">
                {pageTitle}
              </p>
            </div>
          </div>

          {/* Mobile avatar dropdown */}
          <div className="relative" ref={mobileAvatarRef}>
            <button
              onClick={() => setAvatarMenuOpen((o) => !o)}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-primary ring-2 transition-all duration-150",
                avatarMenuOpen
                  ? "bg-primary/20 ring-primary scale-105"
                  : "bg-primary/10 ring-primary/20",
              )}
              title="Account menu"
            >
              {initials}
            </button>

            {avatarMenuOpen && (
              <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-56 rounded-xl border border-border bg-card shadow-lg ring-1 ring-black/5 animate-in fade-in slide-in-from-top-1 duration-150">
                {/* User info */}
                <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                    {initials}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-foreground">
                      {user.fullName}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{roleLabel}</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="p-1.5">
                  <button
                    onClick={() => {
                      setAvatarMenuOpen(false);
                      handleSignOut();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
                  >
                    <LogOut className="h-4 w-4" />
                    {t("common.sign_out")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </header>

        {/* ── Page content ───────────────────────── */}
        <main className="flex-1 pb-24 md:pb-0">
          <div
            key={pathname}
            className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8 animate-in fade-in slide-in-from-bottom-3 duration-300 ease-out"
          >
            <Outlet />
          </div>
        </main>
      </div>

      {/* ═══════════════════════════════════════════
          MOBILE BOTTOM NAV BAR  (4 shortcuts + More)
      ═══════════════════════════════════════════ */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-card/95 backdrop-blur-md md:hidden">
        {mobileNavItems.map(({ to, labelKey, icon: Icon }) => {
          const label = t(labelKey);
          const active = pathname === to || pathname.startsWith(to + "/");
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-semibold uppercase tracking-wide transition-all duration-200",
                active
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground active:scale-95",
              )}
            >
              <div
                className={cn(
                  "relative flex h-7 w-7 items-center justify-center rounded-xl transition-all duration-200",
                  active && "bg-primary/10 scale-110",
                )}
              >
                <Icon className="h-5 w-5" />
              </div>
              <span className={cn(active && "font-bold")}>{label}</span>
            </Link>
          );
        })}

        {/* "More" button — opens the full drawer */}
        <button
          onClick={() => setMobileDrawerOpen(true)}
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-semibold uppercase tracking-wide transition-all duration-200",
            mobileDrawerOpen
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground active:scale-95",
          )}
        >
          <div
            className={cn(
              "relative flex h-7 w-7 items-center justify-center rounded-xl transition-all duration-200",
              mobileDrawerOpen && "bg-primary/10 scale-110",
            )}
          >
            <Menu className="h-5 w-5" />
            {/* Dot if current page is in overflow (not in the 4 shortcuts) */}
            {!mobileNavItems.some((i) => pathname === i.to || pathname.startsWith(i.to + "/")) && (
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary" />
            )}
          </div>
          <span>{t("common.all_pages")}</span>
        </button>
      </nav>

      {/* ═══════════════════════════════════════════
          MOBILE SLIDE-IN DRAWER  (all nav items)
      ═══════════════════════════════════════════ */}
      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200" />

          {/* Drawer panel */}
          <div
            ref={mobileDrawerRef}
            className="absolute inset-y-0 left-0 flex w-72 flex-col bg-sidebar shadow-2xl animate-in slide-in-from-left duration-250"
          >
            {/* Drawer header */}
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-sidebar-border px-4">
              <div className="flex items-center gap-2.5">
                <AbbLogo className="h-6 w-[58px] shrink-0 object-contain" />
                <div>
                  <p className="text-sm font-bold text-sidebar-foreground">ABB</p>
                  <p className="text-[10px] font-medium text-sidebar-foreground/50">{roleLabel}</p>
                </div>
              </div>
              <button
                onClick={() => setMobileDrawerOpen(false)}
                className="rounded-lg p-1.5 text-sidebar-foreground/40 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Nav links */}
            <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-3">
              {navItems.map(({ to, labelKey, icon: Icon }) => {
                const label = t(labelKey);
                const active = pathname === to || pathname.startsWith(to + "/");
                return (
                  <Link
                    key={to}
                    to={to}
                    onClick={() => setMobileDrawerOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                      active
                        ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                        : "text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    )}
                  >
                    <span className="relative shrink-0">
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="flex-1 truncate">{label}</span>
                    {active && (
                      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60 animate-pulse" />
                    )}
                  </Link>
                );
              })}
            </nav>

            {/* Drawer footer — user info + sign out */}
            <div className="flex items-center gap-3 border-t border-sidebar-border p-4">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-sidebar-foreground">
                  {user.fullName}
                </p>
                <p className="text-[10px] font-medium text-sidebar-foreground/50">{roleLabel}</p>
              </div>
              <button
                onClick={() => {
                  setMobileDrawerOpen(false);
                  handleSignOut();
                }}
                title={t("common.sign_out")}
                className="rounded-lg p-1.5 text-sidebar-foreground/40 hover:bg-sidebar-accent hover:text-destructive transition-colors"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
