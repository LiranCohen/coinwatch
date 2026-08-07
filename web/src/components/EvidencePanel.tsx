import { useEffect } from 'react';

import type { Label } from '@chainwatch/shared';

import { isHttpUrl, truncateMiddle } from '../lib/format';

interface EvidencePanelProps {
  label: Label;
  onClose: () => void;
}

/** Deterministic pseudo-stats from the label so the dossier is stable per label. */
function seeded(label: Label): () => number {
  let h = 2166136261;
  const s = label.address + label.tag;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
  };
}

const HEX = '0123456789abcdef';

export function EvidencePanel({ label, onClose }: EvidencePanelProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rand = seeded(label);
  const firstSeenYear = 2013 + Math.floor(rand() * 10);
  const txCount = 40 + Math.floor(rand() * 4200);
  const clusterSize = 2 + Math.floor(rand() * 340);
  const received = (rand() * 12000 + 4).toFixed(2);
  const confidence = Math.floor(55 + rand() * 40);
  const sampleTxs = Array.from({ length: 3 }, () => {
    let tx = '';
    for (let i = 0; i < 64; i++) tx += HEX[Math.floor(rand() * 16)];
    return tx;
  });
  const heuristics = [
    ['Co-spend clustering', `${clusterSize} addresses in cluster`],
    ['Behavioral fingerprint', `${txCount.toLocaleString()} txs, consistent batching pattern`],
    ['Attribution source', label.source === 'seed' ? 'GraphSense TagPacks (curated import)' : 'Crowd analyst report'],
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-400">Evidence dossier</p>
            <h3 className="text-lg font-semibold text-zinc-100">{label.tag}</h3>
            <p className="font-mono text-xs text-sky-400">{label.address}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            ['First seen', String(firstSeenYear)],
            ['Total received', `${received} BTC`],
            ['Confidence', `${confidence}%`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-2">
              <p className="tnum font-mono text-sm font-semibold text-zinc-100">{v}</p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">{k}</p>
            </div>
          ))}
        </div>

        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Supporting heuristics</p>
        <ul className="mb-4 space-y-1.5">
          {heuristics.map(([name, detail]) => (
            <li key={name} className="flex items-baseline gap-2 text-sm">
              <span className="text-emerald-400">✓</span>
              <span className="text-zinc-200">{name}</span>
              <span className="ml-auto text-right text-xs text-zinc-500">{detail}</span>
            </li>
          ))}
        </ul>

        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Referenced transactions</p>
        <ul className="mb-4 space-y-1">
          {sampleTxs.map((tx) => (
            <li key={tx} className="font-mono text-xs text-zinc-400">
              {truncateMiddle(tx, 18, 14)}
            </li>
          ))}
        </ul>

        {label.note && <p className="mb-4 rounded border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm text-zinc-300">{label.note}</p>}

        <div className="flex items-center justify-between">
          <span className="text-[10px] text-zinc-600">Dossier is illustrative — full provenance ships post-MVP.</span>
          {label.evidenceUrl && isHttpUrl(label.evidenceUrl) && (
            <a
              href={label.evidenceUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-sky-500/50 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/20"
            >
              Open source record ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
