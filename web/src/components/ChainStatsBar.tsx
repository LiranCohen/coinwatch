import { useEffect, useState } from 'react';

import type { ChainStats } from '@chainwatch/shared';

import { getChainStats } from '../api/client';

const REFRESH_MS = 60_000;

function Stat({
  value,
  unit,
  label,
  tone,
}: {
  value: string;
  unit?: string;
  label: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0 flex-1 px-3 py-2">
      <p className={`tnum truncate font-mono text-base font-semibold ${tone ?? 'text-zinc-100'}`}>
        {value}
        {unit && <span className="ml-1 text-[10px] font-normal text-zinc-500">{unit}</span>}
      </p>
      <p className="truncate text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
    </div>
  );
}

/**
 * Chain-wide numbers, kept to one bounded strip. A dashboard answers "what is
 * happening right now" at a glance; a scrolling list cannot.
 */
export function ChainStatsBar() {
  const [stats, setStats] = useState<ChainStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getChainStats()
        .then((res) => {
          if (!cancelled) setStats(res);
        })
        .catch(() => undefined);
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (stats === null) {
    return <div className="cw-pulse mb-3 h-[52px] rounded-lg border border-zinc-800 bg-zinc-900/40" />;
  }

  return (
    <div className="mb-3 flex flex-wrap divide-x divide-zinc-800 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/60">
      <Stat
        value={stats.available ? stats.tipHeight.toLocaleString() : '—'}
        label="block height"
      />
      <Stat
        value={stats.available ? stats.mempoolCount.toLocaleString() : '—'}
        label="unconfirmed"
      />
      <Stat
        value={stats.available ? (stats.mempoolVsizeBytes / 1e6).toFixed(1) : '—'}
        unit="vMB"
        label="mempool size"
      />
      <Stat
        value={stats.fastestFee === null ? '—' : stats.fastestFee.toFixed(1)}
        unit="sat/vB"
        label="next block"
        tone="text-emerald-300"
      />
      <Stat
        value={stats.hourFee === null ? '—' : stats.hourFee.toFixed(1)}
        unit="sat/vB"
        label="~1 hour"
        tone="text-sky-300"
      />
      <Stat
        value={stats.indexedEvents.toLocaleString()}
        label="detections"
        tone="text-amber-300"
      />
    </div>
  );
}
