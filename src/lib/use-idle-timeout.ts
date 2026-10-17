import { useEffect, useRef, useCallback } from "react";

/**
 * Calls `onTimeout` after `timeoutMs` ms of inactivity.
 * Calls `onWarn` `warnMs` ms before timeout (default 60 s warning).
 * Pass `enabled = false` to disable entirely (e.g. when timeout is 0).
 */
export function useIdleTimeout({
  timeoutMs,
  warnMs = 60_000,
  onTimeout,
  onWarn,
  enabled = true,
}: {
  timeoutMs: number;
  warnMs?: number;
  onTimeout: () => void;
  onWarn?: () => void;
  enabled?: boolean;
}) {
  const mainRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep callbacks in refs so they never stale-close over old values
  const onTimeoutRef = useRef(onTimeout);
  const onWarnRef = useRef(onWarn);
  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);
  useEffect(() => {
    onWarnRef.current = onWarn;
  }, [onWarn]);

  const reset = useCallback(() => {
    if (mainRef.current) clearTimeout(mainRef.current);
    if (warnRef.current) clearTimeout(warnRef.current);
    if (!enabled || timeoutMs <= 0) return;

    const warnAt = timeoutMs - warnMs;
    if (warnAt > 0 && onWarnRef.current) {
      warnRef.current = setTimeout(() => onWarnRef.current!(), warnAt);
    }
    mainRef.current = setTimeout(() => onTimeoutRef.current(), timeoutMs);
  }, [enabled, timeoutMs, warnMs]);

  useEffect(() => {
    if (!enabled || timeoutMs <= 0) return;

    const EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"] as const;
    const handler = () => reset();

    EVENTS.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    reset(); // start the clock immediately

    return () => {
      EVENTS.forEach((e) => window.removeEventListener(e, handler));
      if (mainRef.current) clearTimeout(mainRef.current);
      if (warnRef.current) clearTimeout(warnRef.current);
    };
  }, [enabled, timeoutMs, reset]);
}
