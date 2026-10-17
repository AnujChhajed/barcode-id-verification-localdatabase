import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { authApi, ApiError, type Role, type SessionUser } from "@/lib/api";

export type AppRole = Role;

interface AuthState {
  user: SessionUser | null;
  roles: AppRole[];
  loading: boolean;
  /**
   * True when the API could not be reached at all (as opposed to answering
   * "not signed in"). Screens use this to say so plainly instead of bouncing
   * the operator to a sign-in page that would fail in exactly the same way.
   */
  serverUnreachable: boolean;
  signIn: (username: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  hasRole: (role: AppRole) => boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

/**
 * How long to wait for the session probe before giving up and treating the
 * visitor as signed out. Without this a backend that is down (rather than
 * answering) would leave the app on the loading spinner forever.
 */
const SESSION_PROBE_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [serverUnreachable, setServerUnreachable] = useState(false);
  // Guards against a state update after unmount (React 18 no longer warns, but
  // the probe can resolve after navigation).
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const probeSession = async () => {
      try {
        const me = await withTimeout(authApi.me(), SESSION_PROBE_TIMEOUT_MS);
        if (mountedRef.current) {
          setUser(me);
          setServerUnreachable(false);
        }
      } catch (error) {
        if (error instanceof ApiError && error.isUnauthenticated) {
          // The server answered, and the answer is "nobody is signed in".
          // That is an ordinary state — the sign-in page handles it.
          if (mountedRef.current) {
            setUser(null);
            setServerUnreachable(false);
          }
          return;
        }
        // Network failure or a 5xx — the server is not answering at all.
        console.warn("[Auth] Could not confirm a session:", error);
        if (mountedRef.current) {
          setServerUnreachable(true);
          setUser(null);
        }
      }
    };

    void probeSession()
      .catch((error) => console.warn("[Auth] Session probe failed:", error))
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    try {
      const me = await authApi.login(username, password);
      setUser(me);
      return {};
    } catch (error) {
      if (error instanceof ApiError) return { error: error.message };
      return { error: "Cannot reach the verification server." };
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } catch (error) {
      // The local session may already be gone; clearing local state regardless
      // is what stops a stale identity lingering in the UI.
      console.warn("[Auth] Sign-out request failed:", error);
    } finally {
      setUser(null);
    }
  }, []);

  const roles = useMemo<AppRole[]>(() => (user ? [user.role] : []), [user]);
  const hasRole = useCallback((role: AppRole) => roles.includes(role), [roles]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      roles,
      loading,
      serverUnreachable,
      signIn,
      signOut,
      hasRole,
      isAdmin: roles.includes("administrator"),
    }),
    [user, roles, loading, serverUnreachable, signIn, signOut, hasRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
