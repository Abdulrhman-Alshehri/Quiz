import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

/**
 * Keeps a piece of server state fresh.
 * - Realtime: listens for changes to the session row and refetches at once.
 * - Polling: always on as a safety net; faster when Realtime is not connected.
 * - Refetches when the tab becomes visible again or the network comes back.
 *
 * connection: 'connecting' | 'live' (Realtime) | 'polling' (no Realtime) | 'offline'
 */
export function useFeed({ key, fetcher, sessionId, pollMs = 4000, fastPollMs = 1500, enabled = true }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [connection, setConnection] = useState('connecting');
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const inflight = useRef(false);
  const queued = useRef(false);
  const failures = useRef(0);
  const realtimeOk = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (inflight.current) {
      queued.current = true;
      return;
    }
    inflight.current = true;
    try {
      const next = await fetcherRef.current();
      if (!alive.current) return;
      failures.current = 0;
      setData(next);
      setError(null);
      setConnection(realtimeOk.current ? 'live' : 'polling');
    } catch (e) {
      if (!alive.current) return;
      if (e?.code === 'NETWORK') {
        failures.current += 1;
        if (failures.current >= 2) setConnection('offline');
      } else {
        setError(e);
      }
    } finally {
      inflight.current = false;
      if (queued.current) {
        queued.current = false;
        refresh();
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setError(null);
    refresh();
  }, [key, enabled, refresh]);

  useEffect(() => {
    if (!enabled || !sessionId || !supabase) return undefined;
    const channel = supabase
      .channel(`session:${sessionId}:${Math.random().toString(36).slice(2, 8)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
        () => refresh(),
      )
      .subscribe((status) => {
        realtimeOk.current = status === 'SUBSCRIBED';
        if (status === 'SUBSCRIBED') {
          setConnection((c) => (c === 'offline' ? c : 'live'));
          refresh();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setConnection((c) => (c === 'offline' ? c : 'polling'));
        }
      });
    return () => {
      realtimeOk.current = false;
      supabase.removeChannel(channel);
    };
  }, [sessionId, enabled, refresh]);

  useEffect(() => {
    if (!enabled) return undefined;
    let timer;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState !== 'hidden') await refresh();
      const base = realtimeOk.current ? pollMs : fastPollMs;
      timer = setTimeout(tick, base + Math.random() * 300);
    };
    timer = setTimeout(tick, fastPollMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, pollMs, fastPollMs, refresh, key]);

  return { data, error, connection, refresh, setData };
}
