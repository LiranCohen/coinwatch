import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { isTxid, type Label, type TxDetail } from '@chainwatch/shared';

import { ApiError, getTx, postTxLabel } from '../api/client';
import { CoinjoinAnalysis } from '../components/CoinjoinAnalysis';
import { EntropyPanel } from '../components/EntropyPanel';
import { InfoPopover } from '../components/InfoPopover';
import { LabelForm } from '../components/LabelForm';
import { LabelList } from '../components/LabelList';
import { TxGraph, type FlowLink } from '../components/TxGraph';
import { readApiMessage, satsToBtc, timeAgo, truncateMiddle } from '../lib/format';
import { useSession } from '../session';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="tnum font-mono text-sm text-zinc-100">{children}</p>
    </div>
  );
}

/**
 * Any transaction on the chain, not only those the detector indexed. This is
 * the page a block explorer is for: read it, walk to what it touches, and tag
 * it if it is worth remembering.
 */
export function TxPage() {
  const { txid = '' } = useParams();
  const { token } = useSession();
  const [tx, setTx] = useState<TxDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const valid = isTxid(txid);

  const load = useCallback(() => {
    if (!valid) return;
    setError(null);
    getTx(txid)
      .then(setTx)
      .catch((err: unknown) => {
        setError(
          err instanceof ApiError && err.status === 404
            ? 'notfound'
            : readApiMessage(err, 'lookup failed'),
        );
      });
  }, [txid, valid]);

  useEffect(load, [load]);

  if (!valid) {
    return (
      <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
        That is not a transaction id — a txid is 64 hexadecimal characters.
      </p>
    );
  }
  if (error === 'notfound') {
    return (
      <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-sm text-zinc-300">
        No transaction with that id. It may never have been broadcast, or it may have been dropped
        from the mempool.
      </p>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
        <p className="text-sm text-amber-200">Could not load this transaction.</p>
        <p className="mt-1 text-xs text-amber-200/70">{error}</p>
        <button
          type="button"
          onClick={load}
          className="mt-2 rounded border border-zinc-600 px-3 py-1 text-xs text-zinc-200 hover:border-zinc-400"
        >
          Try again
        </button>
      </div>
    );
  }
  if (tx === null) {
    return <p className="cw-pulse text-sm text-zinc-500">Loading transaction…</p>;
  }

  const links: FlowLink[] = [];
  if (tx.entropy?.status === 'ok' && tx.entropy.entropy > 0) {
    const certain = new Set(tx.entropy.deterministicLinks.map((l) => `${l.input}:${l.output}`));
    tx.entropy.linkProbability.forEach((row, i) =>
      row.forEach((probability, j) => {
        if (probability > 0) {
          links.push({ inputIndex: i, outputIndex: j, probability, certain: certain.has(`${i}:${j}`) });
        }
      }),
    );
  }

  const onLabelCreated = (label: Label) => setTx({ ...tx, labels: [...tx.labels, label] });

  return (
    <div className="max-w-5xl space-y-5">
      <header className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {tx.confirmed ? (
            <span className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">
              confirmed
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-300">
              <span className="cw-pulse inline-block h-1.5 w-1.5 rounded-full bg-sky-400" />
              in mempool
            </span>
          )}
          {tx.isCoinbase && (
            <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300">
              coinbase
            </span>
          )}
          {tx.eventId && (
            <Link
              to={`/app?event=${tx.eventId}`}
              className="rounded border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-300 hover:bg-sky-500/20"
            >
              flagged: {tx.rules.join(', ')}
            </Link>
          )}
          {tx.time && <span className="ml-auto text-xs text-zinc-500">{timeAgo(tx.time)}</span>}
        </div>

        <p className="break-all font-mono text-xs text-zinc-400">{tx.txid}</p>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="amount">{satsToBtc(tx.totalOutSats)} BTC</Field>
          <Field label="fee">
            {tx.feeSats.toLocaleString()}
            <span className="text-zinc-500"> sat</span>
            {tx.feeRate !== null && (
              <span className="text-zinc-500"> · {tx.feeRate.toFixed(1)} sat/vB</span>
            )}
          </Field>
          <Field label="size">
            {tx.sizeBytes.toLocaleString()}
            <span className="text-zinc-500"> B · {Math.round(tx.weight / 4).toLocaleString()} vB</span>
          </Field>
          <Field label="block">
            {tx.blockHeight === null ? (
              <span className="text-zinc-500">pending</span>
            ) : (
              <Link to={`/app/block/${tx.blockHeight}`} className="text-sky-400 hover:underline">
                {tx.blockHeight.toLocaleString()}
              </Link>
            )}
            {tx.confirmations !== null && (
              <span className="text-zinc-500"> · {tx.confirmations.toLocaleString()} conf</span>
            )}
          </Field>
        </div>
      </header>

      <section>
        <h2 className="mb-2 text-xs font-semibold tracking-wider text-zinc-400">VALUE FLOW</h2>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <TxGraph
            txid={tx.txid}
            inputs={tx.inputs}
            outputs={tx.outputs}
            links={links}
            labels={[...tx.inputs, ...tx.outputs].flatMap((io) => io.labels)}
          />
        </div>
      </section>

      {tx.rules.includes('coinjoin') && <CoinjoinAnalysis txid={tx.txid} />}

      {!tx.rules.includes('coinjoin') && tx.entropy && (
        <EntropyPanel entropy={tx.entropy} nbInputs={tx.inputs.length} nbOutputs={tx.outputs.length} />
      )}

      <section>
        <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wider text-zinc-400">
          OUTPUTS
          <InfoPopover label="outputs">
            Each output either still holds its coins or has been spent by a later transaction. A spent
            output links to whatever consumed it, which is how you follow money forward.
          </InfoPopover>
        </h2>
        <div className="overflow-hidden rounded-lg border border-zinc-800">
          {tx.outputs.map((output, i) => (
            <div
              key={i}
              className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs ${
                i % 2 === 0 ? 'bg-zinc-900/60' : 'bg-zinc-900/30'
              }`}
            >
              <span className="tnum w-6 shrink-0 text-zinc-600">{i}</span>
              {output.address ? (
                <Link
                  to={`/app/address/${output.address}`}
                  className="font-mono text-sky-400 hover:underline"
                >
                  {truncateMiddle(output.address, 16, 10)}
                </Link>
              ) : (
                <span className="font-mono italic text-zinc-600">unspendable / data</span>
              )}
              {output.labels[0] && (
                <span className="rounded-full border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-[10px] text-zinc-200">
                  {output.labels[0].tag}
                </span>
              )}
              <span className="tnum ml-auto font-mono text-zinc-200">
                {satsToBtc(output.valueSats)} BTC
              </span>
              {output.spentBy ? (
                <Link
                  to={`/app/tx/${output.spentBy}`}
                  className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                >
                  spent →
                </Link>
              ) : (
                <span className="rounded border border-emerald-500/30 px-1.5 py-0.5 text-[10px] text-emerald-400/80">
                  unspent
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wider text-zinc-400">
          TAGS ON THIS TRANSACTION
          <InfoPopover label="tags">
            Anyone with an account can tag any transaction. Tags are public, carry the tagger's
            reputation, and can be voted on — that is how the crowd records what a transaction was.
          </InfoPopover>
        </h2>
        <LabelList labels={tx.labels} onVote={async () => undefined} subject="transaction" />
        <div className="mt-3">
          <LabelForm
            address={tx.txid}
            onSubmit={(body) => postTxLabel(tx.txid, body, token!)}
            onCreated={onLabelCreated}
          />
        </div>
      </section>
    </div>
  );
}
