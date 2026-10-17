import { ServerCrash, RefreshCw } from "lucide-react";

/**
 * Shown when the API could not be reached at all.
 *
 * It deliberately says so instead of showing a sign-in prompt: while the login
 * screen is removed, a session is established automatically on load, so "no
 * identity" can only mean "the server is not answering". Asking for a password
 * would fail in exactly the same way and hide the real problem.
 */
export function ServerUnreachable() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-2xl bg-destructive/10 text-destructive">
          <ServerCrash size={30} />
        </div>
        <h1 className="text-xl font-bold tracking-tight">Cannot reach the verification server</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The application started but the local server is not answering. Make sure it is running,
          then try again.
        </p>
        <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-left font-mono text-xs text-muted-foreground">
          npm run dev
          <br />
          <span className="text-muted-foreground/70">— or, after a build —</span>
          <br />
          npm start
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 active:scale-[0.97]"
        >
          <RefreshCw size={16} />
          Try again
        </button>
      </div>
    </div>
  );
}
