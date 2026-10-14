import { useEffect, useState } from 'react';
import { api } from './api';

// Phone clocks drift. Every countdown is drawn from the database deadline using
// the offset between this device and the database clock. The database alone
// decides whether an answer arrived in time; the countdown is a visual aid.
let offsetMs = 0;
let lastSync = 0;
let syncing = null;

export function parseTs(value) {
  if (!value) return NaN;
  // Postgres sends microseconds; trim to milliseconds for every browser's parser.
  return Date.parse(String(value).replace(/(\.\d{3})\d+/, '$1'));
}

export function serverNow() {
  return Date.now() + offsetMs;
}

export async function syncClock() {
  if (syncing) return syncing;
  syncing = (async () => {
    const samples = [];
    for (let i = 0; i < 3; i += 1) {
      const t0 = Date.now();
      try {
        const ts = await api.serverTime();
        const t1 = Date.now();
        const server = parseTs(ts);
        if (!Number.isNaN(server)) samples.push({ rtt: t1 - t0, off: server - (t0 + t1) / 2 });
      } catch {
        // Try again on the next sync.
      }
    }
    if (samples.length) {
      samples.sort((a, b) => a.rtt - b.rtt);
      offsetMs = samples[0].off;
      lastSync = Date.now();
    }
    syncing = null;
    return offsetMs;
  })();
  return syncing;
}

export function useServerClock() {
  useEffect(() => {
    if (Date.now() - lastSync > 60_000) syncClock();
    const id = setInterval(syncClock, 5 * 60_000);
    return () => clearInterval(id);
  }, []);
}

export function useNow(intervalMs = 100) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
