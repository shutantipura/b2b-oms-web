"use client";

import { useEffect, useRef } from "react";

export const AUTO_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const RESUME_REFRESH_MIN_MS = 30 * 1000;

export function isAutoRefreshDue(lastRefreshAt: number, now: number, minimumMs: number) {
  return now - lastRefreshAt >= minimumMs;
}

/**
 * Re-fetches a mounted view without reloading the page or clearing staff drafts.
 * Background tabs are refreshed when they become visible again.
 */
export function useAutoRefresh(
  refresh: () => void | Promise<unknown>,
  enabled = true
) {
  const refreshRef = useRef(refresh);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let pending = false;
    let lastRefreshAt = Date.now();
    let timer: number | undefined;

    const schedule = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (document.hidden || !navigator.onLine) {
          schedule();
          return;
        }
        void runRefresh();
      }, AUTO_REFRESH_INTERVAL_MS);
    };

    const runRefresh = async () => {
      if (disposed || document.hidden || !navigator.onLine) return;
      if (pending) {
        schedule();
        return;
      }
      pending = true;
      lastRefreshAt = Date.now();
      schedule();

      try {
        await refreshRef.current();
      } catch (error) {
        console.warn("Automatic OMS refresh failed:", error);
      } finally {
        pending = false;
      }
    };

    const onResume = () => {
      if (isAutoRefreshDue(lastRefreshAt, Date.now(), RESUME_REFRESH_MIN_MS)) {
        void runRefresh();
      }
    };

    schedule();
    window.addEventListener("focus", onResume);
    window.addEventListener("online", onResume);
    document.addEventListener("visibilitychange", onResume);

    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("focus", onResume);
      window.removeEventListener("online", onResume);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, [enabled]);
}
