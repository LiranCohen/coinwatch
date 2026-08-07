import { useEffect, useState } from 'react';

import type { AddressInfo, Label } from '@chainwatch/shared';

import { getAddress } from '../api/client';
import { isHttpUrl, satsToBtc, timeAgo, truncateDid } from '../lib/format';

interface EvidencePanelProps {
  label: Label;
  onClose: () => void;
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-2 text-center">
      <p className="tnum font-mono text-sm font-semibold text-zinc-100">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
    </div>
  );
}

/**
 * What we can actually stand behind for a label: who asserted it, how the crowd
 * voted, and the address's real on-chain footprint. Nothing here is inferred —
 * if we do not have a figure, it shows as unavailable rather than as a guess.
 */
export function EvidencePanel({ label, onClose }: EvidencePanelProps) {
  const [info, setInfo] = useState<AddressInfo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    setFailed(false);
    getAddress(label.address)
      .then((res) => {
        if (!cancelled) setInfo(res);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [label.address]);

  const asserter = label.author
    ? (label.author.handle ?? truncateDid(label.author.did))
    : 'GraphSense TagPacks import';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-400">Evidence</p>
            <h3 className="text-lg font-semibold text-zinc-100">{label.tag}</h3>
            <p className="break-all font-mono text-xs text-sky-400">{label.address}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded px-2 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          >
            ✕
          </button>
        </div>

        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
          On-chain footprint
        </p>
        {failed ? (
          <p className="mb-4 rounded border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-xs text-zinc-500">
            Address lookup unavailable right now.
          </p>
        ) : info === null ? (
          <div className="cw-pulse mb-4 h-[58px] rounded-lg border border-zinc-800 bg-zinc-950/40" />
        ) : (
          <div className="mb-4 grid grid-cols-3 gap-2">
            <Stat
              value={info.balanceSats === null ? '—' : satsToBtc(info.balanceSats)}
              label="BTC balance"
            />
            <Stat value={info.txCount === null ? '—' : info.txCount.toLocaleString()} label="transactions" />
            <Stat value={String(info.labels.length)} label="labels on record" />
          </div>
        )}

        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Assertion</p>
        <dl className="mb-4 space-y-1.5 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-zinc-400">Asserted by</dt>
            <dd className="text-right text-zinc-200">{asserter}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-zinc-400">Source</dt>
            <dd className="text-right text-zinc-200">
              {label.source === 'seed' ? 'Curated dataset import' : 'Crowd analyst'}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-zinc-400">Crowd score</dt>
            <dd
              className={`tnum text-right font-mono ${
                label.score > 0 ? 'text-emerald-300' : label.score < 0 ? 'text-red-300' : 'text-zinc-300'
              }`}
            >
              {label.score > 0 ? `+${label.score}` : label.score}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-zinc-400">Recorded</dt>
            <dd className="text-right text-zinc-200">{timeAgo(label.createdAt)}</dd>
          </div>
        </dl>

        {label.note && (
          <>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Analyst note
            </p>
            <p className="mb-4 rounded border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm text-zinc-300">
              {label.note}
            </p>
          </>
        )}

        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] text-zinc-600">
            A label is a claim, not a fact. Weigh the source and the score.
          </span>
          {label.evidenceUrl && isHttpUrl(label.evidenceUrl) && (
            <a
              href={label.evidenceUrl}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded border border-sky-500/50 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/20"
            >
              Cited source ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
