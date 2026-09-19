import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  /** True only on the first load, so refreshes don't flash skeletons. */
  initial: boolean;
  reload: () => void;
}

/**
 * Fetch-on-mount with loading, error and refresh, plus an optional poll.
 * Results from a stale run are dropped, so a slow first request can never
 * overwrite a fresher one.
 */
export function useAsync<T>(
  fn: () => Promise<T>,
  deps: unknown[] = [],
  pollMs?: number,
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [initial, setInitial] = useState(true);
  const runId = useRef(0);
  const errorRef = useRef(false);

  const run = useCallback(async () => {
    const id = ++runId.current;
    setLoading(true);
    try {
      const result = await fn();
      if (id !== runId.current) return;
      setData(result);
      setError(null);
      errorRef.current = false;
    } catch (err) {
      if (id !== runId.current) return;
      setError(err instanceof Error ? err : new Error(String(err)));
      errorRef.current = true;
    } finally {
      if (id === runId.current) {
        setLoading(false);
        setInitial(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void run();
    if (!pollMs) return;
    const timer = setInterval(() => {
      // A failing call must not be retried forever on a timer; the user
      // reloads it deliberately instead.
      if (errorRef.current) return;
      void run();
    }, pollMs);
    return () => clearInterval(timer);
  }, [run, pollMs]);

  return {
    data,
    error,
    loading,
    initial,
    reload: () => {
      errorRef.current = false;
      void run();
    },
  };
}
