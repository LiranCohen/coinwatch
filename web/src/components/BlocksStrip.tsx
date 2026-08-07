import { useEffect, useState } from 'react';

import type { BlockSummary } from '@chainwatch/shared';

import { Link } from 'react-router-dom';

import { getBlocks } from '../api/client';

interface BlocksStripProps {
  /** height currently filtering the feed, if any */
  selectedHeight: number | null;
  onSelectHeight: (height: number | null) => void;
}

const REFRESH_MS = 60_000;

function fmtAgo(iso: string | null, nowMs: number): string {
  if (iso === null) return '';
  const minutes = Math.floor((nowMs - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

/**
 * Live chain head. Blocks, miners and fee rates come from the node/explorer the
 * server ingests from, so this is the same chain the feed is derived from.
 */
export function BlocksStrip({ selectedHeight, onSelectHeight }: BlocksStripProps) {
  const [blocks, setBlocks] = useState<BlockSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getBlocks(6)
        .then((res) => {
          if (cancelled) return;
          setBlocks(res.blocks);
          setFailed(false);
          setNow(Date.now());
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    };
    load();
    const refresh = setInterval(load, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      cancelled = true;
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, []);

  if (failed && blocks === null) {
    return (
      <p className="mb-4 rounded-lg border border-dashed border-zinc-800 px-3 py-2 text-xs text-zinc-500">
        Chain head unavailable — the server could not reach its chain data source.
      </p>
    );
  }

  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Chain head</span>
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
        </span>
        <span className="text-[10px] text-zinc-600">
          {selectedHeight === null
            ? 'open a block to browse it, or filter the feed to it'
            : `filtering feed to block ${selectedHeight.toLocaleString()}`}
        </span>
        {selectedHeight !== null && (
          <button
            type="button"
            onClick={() => onSelectHeight(null)}
            className="text-[10px] text-sky-400 hover:underline"
          >
            clear
          </button>
        )}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {blocks === null
          ? [0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="cw-pulse h-[76px] min-w-[132px] shrink-0 rounded-lg border border-zinc-800 bg-zinc-900/40" />
            ))
          : blocks.map((block, i) => (
              <div
                key={block.hash}
                title={block.hash}
                className={`relative min-w-[132px] shrink-0 rounded-lg border transition-colors ${
                  selectedHeight === block.height
                    ? 'border-sky-400 bg-sky-500/10'
                    : i === 0
                      ? 'border-emerald-500/50 bg-emerald-500/5 hover:border-emerald-400'
                      : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-600'
                }`}
              >
                <Link to={`/app/block/${block.height}`} className="block px-3 py-2">
                  <p className="tnum font-mono text-sm font-semibold text-zinc-100">
                    #{block.height.toLocaleString()}
                  </p>
                  <p className="text-[10px] text-zinc-500">
                    {block.txCount.toLocaleString()} txs · {(block.sizeBytes / 1e6).toFixed(2)} MB
                  </p>
                  <p className="text-[10px] text-zinc-500">
                    {block.medianFeeRate === null ? '—' : `~${block.medianFeeRate.toFixed(1)} sat/vB`}
                  </p>
                  <p className="mt-0.5 flex items-baseline justify-between gap-2 text-[10px]">
                    <span className="truncate text-zinc-400">{block.miner ?? 'unknown pool'}</span>
                    <span className="shrink-0 text-zinc-600">{fmtAgo(block.time, now)}</span>
                  </p>
                </Link>
                <button
                  type="button"
                  onClick={() => onSelectHeight(selectedHeight === block.height ? null : block.height)}
                  aria-pressed={selectedHeight === block.height}
                  aria-label={`Filter the feed to block ${block.height}`}
                  className={`absolute right-1 top-1 rounded px-1 text-[10px] ${
                    selectedHeight === block.height
                      ? 'text-sky-300'
                      : 'text-zinc-600 hover:bg-zinc-700/60 hover:text-zinc-300'
                  }`}
                >
                  filter
                </button>
              </div>
            ))}
      </div>
    </div>
  );
}
