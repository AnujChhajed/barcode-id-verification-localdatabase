import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { ServerUnreachable } from "@/components/ServerUnreachable";

export const Route = createFileRoute("/")({
  component: IndexRedirect,
});

/**
 * There is no public landing page: this is an internal gate system. `/` sends a
 * signed-in user to the page their role actually needs, an anonymous visitor to
 * the sign-in form, and only shows the outage notice when the API itself is not
 * answering.
 */
function IndexRedirect() {
  const { user, loading, isAdmin, serverUnreachable } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Starting…</p>
        </div>
      </div>
    );
  }

  if (serverUnreachable) return <ServerUnreachable />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={isAdmin ? "/dashboard" : "/verify"} replace />;
}
