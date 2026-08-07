import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import type { BlockDetail, BlockTxsResponse } from '@chainwatch/shared';

import { getBlock, getBlockTxs } from '../api/client';
import { InfoPopover } from '../components/InfoPopover';
import { TxCard } from '../components/TxCard';
import { readApiMessage, timeAgo } from '../lib/format';

const PAGE = 25;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="tnum font-mono text-sm text-zinc-100">{children}</p>
    </div>
  );
}

/** A block and its transactions, paged the way the chain source pages them. */
export function BlockPage() {
  const { id = '' } = useParams();
  const [block, setBlock] = useState<BlockDetail | null>(null);
  const [page, setPage] = useState<BlockTxsResponse | null>(null);
  const [start, setStart] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStart(0);
    setBlock(null);
    setError(null);
    getBlock(id)
      .then(setBlock)
      .catch((err: unknown) => setError(readApiMessage(err, 'lookup failed')));
  }, [id]);

  const loadPage = useCallback(() => {
    setPage(null);
    getBlockTxs(id, start)
      .then(setPage)
      .catch(() => setPage(null));
  }, [id, start]);

  useEffect(loadPage, [loadPage]);

  if (error) {
    return (
      <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
        Could not load that block. {error}
      </p>
    );
  }
  if (block === null) {
    return <p className="cw-pulse text-sm text-zinc-500">Loading block…</p>;
  }

  const last = Math.max(0, Math.floor((block.txCount - 1) / PAGE) * PAGE);

  return (
    <div className="max-w-5xl space-y-5">
      <header className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h1 className="tnum font-mono text-2xl font-semibold text-zinc-50">
            #{block.height.toLocaleString()}
          </h1>
          <div className="flex gap-1">
            <Link
              to={`/app/block/${block.height - 1}`}
              className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            >
              ← older
            </Link>
            <Link
              to={`/app/block/${block.height + 1}`}
              className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            >
              newer →
            </Link>
          </div>
          {block.time && <span className="ml-auto text-xs text-zinc-500">{timeAgo(block.time)}</span>}
        </div>

        <p className="break-all font-mono text-xs text-zinc-500">{block.hash}</p>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Field label="transactions">{block.txCount.toLocaleString()}</Field>
          <Field label="size">{(block.sizeBytes / 1e6).toFixed(2)} MB</Field>
          <Field label="median fee">
            {block.medianFeeRate === null ? '—' : `${block.medianFeeRate.toFixed(1)} sat/vB`}
          </Field>
          <Field label="mined by">{block.miner ?? 'unknown'}</Field>
          <Field label="depth">
            {block.confirmations === null ? '—' : block.confirmations.toLocaleString()}
          </Field>
        </div>
      </header>

      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-zinc-400">
            TRANSACTIONS
            <InfoPopover label="transactions">
              Every transaction in this block, in the order it was included. The first is always the
              coinbase, which pays the miner. Open any of them to inspect or tag it.
            </InfoPopover>
          </h2>
          <span className="text-[11px] text-zinc-500">
            {(start + 1).toLocaleString()}–{Math.min(start + PAGE, block.txCount).toLocaleString()} of{' '}
            {block.txCount.toLocaleString()}
          </span>
          <div className="ml-auto flex gap-1">
            <button
              type="button"
              disabled={start === 0}
              onClick={() => setStart(Math.max(0, start - PAGE))}
              className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 disabled:opacity-30 hover:border-zinc-500"
            >
              ← prev
            </button>
            <button
              type="button"
              disabled={start >= last}
              onClick={() => setStart(Math.min(last, start + PAGE))}
              className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 disabled:opacity-30 hover:border-zinc-500"
            >
              next →
            </button>
          </div>
        </div>

        {page === null ? (
          <div className="cw-pulse h-64 rounded-lg border border-zinc-800 bg-zinc-900/40" />
        ) : (
          <div className="space-y-2">
            {page.transactions.map((tx, i) => (
              <TxCard key={tx.txid} tx={tx} index={start + i} />
            ))}
          </div>
        )}

        <div className="mt-3 flex items-center justify-center gap-2">
          <button
            type="button"
            disabled={start === 0}
            onClick={() => setStart(0)}
            className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 disabled:opacity-30 hover:border-zinc-500"
          >
            « first
          </button>
          <button
            type="button"
            disabled={start === 0}
            onClick={() => setStart(Math.max(0, start - PAGE))}
            className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 disabled:opacity-30 hover:border-zinc-500"
          >
            ‹ prev
          </button>
          <span className="tnum text-xs text-zinc-500">
            page {Math.floor(start / PAGE) + 1} of {Math.max(1, Math.ceil(block.txCount / PAGE)).toLocaleString()}
          </span>
          <button
            type="button"
            disabled={start >= last}
            onClick={() => setStart(Math.min(last, start + PAGE))}
            className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 disabled:opacity-30 hover:border-zinc-500"
          >
            next ›
          </button>
          <button
            type="button"
            disabled={start >= last}
            onClick={() => setStart(last)}
            className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 disabled:opacity-30 hover:border-zinc-500"
          >
            last »
          </button>
        </div>
      </section>
    </div>
  );
}
