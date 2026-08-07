import { Link } from 'react-router-dom';

import type { TxDetail } from '@chainwatch/shared';

import { satsToBtc, truncateMiddle } from '../lib/format';

interface TxCardProps {
  tx: TxDetail;
  /** position within its block, when shown in a block listing */
  index?: number;
}

const MAX_ROWS = 6;

function Side({
  entries,
  side,
}: {
  entries: { address: string | null; valueSats: number; spentBy?: string | null; labels: { tag: string }[] }[];
  side: 'in' | 'out';
}) {
  const shown = entries.slice(0, MAX_ROWS);
  const hidden = entries.length - shown.length;

  return (
    <div className="min-w-0 flex-1 space-y-1">
      {shown.map((entry, i) => (
        <div key={i} className="flex items-baseline gap-2 text-xs">
          {side === 'out' && (
            <span
              className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                entry.spentBy ? 'bg-zinc-600' : 'bg-emerald-400/70'
              }`}
              title={entry.spentBy ? 'spent' : 'unspent'}
            />
          )}
          {entry.address ? (
            <Link
              to={`/app/address/${entry.address}`}
              className="min-w-0 truncate font-mono text-sky-400 hover:underline"
            >
              {truncateMiddle(entry.address, 10, 6)}
            </Link>
          ) : (
            <span className="truncate font-mono italic text-zinc-600">
              {side === 'in' ? 'coinbase' : 'data'}
            </span>
          )}
          {entry.labels[0] && (
            <span className="shrink-0 rounded-full border border-zinc-700 bg-zinc-800/60 px-1.5 text-[9px] text-zinc-300">
              {entry.labels[0].tag}
            </span>
          )}
          <span className="tnum ml-auto shrink-0 font-mono text-zinc-300">
            {satsToBtc(entry.valueSats)}
          </span>
        </div>
      ))}
      {hidden > 0 && <p className="text-[10px] text-zinc-600">+{hidden} more</p>}
    </div>
  );
}

/**
 * A transaction as a card showing both sides at once.
 *
 * A one-line row tells you a transaction exists; the useful question is where
 * the money went, and that needs inputs and outputs side by side. This is the
 * shape every mature explorer converges on.
 */
export function TxCard({ tx, index }: TxCardProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/50">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-800 bg-zinc-900/80 px-3 py-1.5">
        {index !== undefined && <span className="tnum text-[10px] text-zinc-600">#{index}</span>}
        <Link to={`/app/tx/${tx.txid}`} className="font-mono text-xs text-sky-400 hover:underline">
          {truncateMiddle(tx.txid, 12, 8)}
        </Link>
        {tx.isCoinbase && (
          <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 text-[9px] text-amber-300">
            coinbase
          </span>
        )}
        {tx.rules.map((rule) => (
          <span
            key={rule}
            className="rounded border border-sky-500/40 bg-sky-500/10 px-1.5 text-[9px] text-sky-300"
          >
            {rule}
          </span>
        ))}
        {tx.labels[0] && (
          <span className="rounded-full border border-zinc-600 bg-zinc-800 px-1.5 text-[9px] text-zinc-200">
            {tx.labels[0].tag}
          </span>
        )}
        <span className="tnum ml-auto font-mono text-xs text-zinc-200">
          {satsToBtc(tx.totalOutSats)} <span className="text-[10px] text-zinc-500">BTC</span>
        </span>
      </div>

      <div className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-start sm:gap-4">
        <Side entries={tx.inputs} side="in" />
        <span className="hidden shrink-0 select-none pt-0.5 text-zinc-600 sm:block">→</span>
        <Side entries={tx.outputs} side="out" />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 border-t border-zinc-800/70 px-3 py-1 text-[10px] text-zinc-500">
        <span>
          {tx.inputs.length} in → {tx.outputs.length} out
        </span>
        {!tx.isCoinbase && tx.feeRate !== null && (
          <span className="tnum">
            {tx.feeRate.toFixed(1)} sat/vB · {tx.feeSats.toLocaleString()} sat
          </span>
        )}
        {tx.entropy?.status === 'ok' && (
          <span className={`tnum ml-auto ${tx.entropy.entropy === 0 ? 'text-amber-400/80' : 'text-sky-400/80'}`}>
            {tx.entropy.entropy.toFixed(1)} bits
          </span>
        )}
      </div>
    </div>
  );
}
