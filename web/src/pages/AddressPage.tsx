import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { AddressInfo, Label } from '@chainwatch/shared';

import { getAddress, postLabel, postVote } from '../api/client';
import { FeedItem } from '../components/FeedItem';
import { LabelForm } from '../components/LabelForm';
import { LabelList } from '../components/LabelList';
import { satsToBtc, timeAgo, truncateMiddle } from '../lib/format';
import { useSession } from '../session';

export function AddressPage() {
  const { address = '' } = useParams();
  const navigate = useNavigate();
  const { token } = useSession();
  const [info, setInfo] = useState<AddressInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!address) return;
    getAddress(address, token)
      .then(setInfo)
      .catch((err) => setError(err instanceof Error ? err.message : 'lookup failed'));
  }, [address, token]);

  useEffect(load, [load]);

  const vote = async (labelId: string, value: 1 | -1) => {
    if (!token || !info) return;
    const updated = await postVote(labelId, value, token);
    setInfo({ ...info, labels: info.labels.map((l) => (l.id === updated.id ? updated : l)) });
  };

  const onLabelCreated = (label: Label) => {
    if (!info) return;
    setInfo({ ...info, labels: [...info.labels, label] });
  };

  if (error) {
    return <p className="text-sm text-red-400">Address lookup failed: {error}</p>;
  }
  if (!info) {
    return <p className="cw-pulse text-sm text-zinc-500">Looking up address…</p>;
  }

  return (
    <div className="max-w-3xl space-y-6">
      <header className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <p className="break-all font-mono text-sm text-zinc-100">{info.address}</p>
        <div className="mt-3 flex flex-wrap gap-6">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-zinc-500">Balance</p>
            <p className="tnum font-mono text-xl text-zinc-50">
              {info.balanceSats !== null ? `${satsToBtc(info.balanceSats)} BTC` : '—'}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-zinc-500">Transactions</p>
            <p className="tnum font-mono text-xl text-zinc-50">{info.txCount !== null ? info.txCount : '—'}</p>
          </div>
        </div>
        {(info.balanceSats === null || info.txCount === null) && (
          <p className="mt-2 text-xs text-zinc-500">Lookup unavailable: no stats for this address yet.</p>
        )}
      </header>

      <section>
        <h2 className="mb-2 text-xs font-semibold tracking-wider text-zinc-400">
          HISTORY OBSERVED BY YOUR NODE
        </h2>
        {(info.history ?? []).length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-6 text-center text-xs text-zinc-500">
            Nothing seen from this address yet. History here is built from your own node's traffic, not an external
            explorer, so it grows as your node watches.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-800">
            {(info.history ?? []).map((entry, i) => (
              <div
                key={entry.txid}
                className={`flex flex-wrap items-center gap-3 px-3 py-2.5 text-xs ${
                  i % 2 === 0 ? 'bg-zinc-900/60' : 'bg-zinc-900/30'
                }`}
              >
                <span className="tnum w-20 shrink-0 text-zinc-500">{timeAgo(entry.time)}</span>
                <span className="tnum font-mono text-zinc-300">{truncateMiddle(entry.txid, 10, 8)}</span>
                <span
                  className={`tnum ml-auto font-mono font-semibold ${
                    entry.deltaSats < 0 ? 'text-red-300' : 'text-emerald-300'
                  }`}
                >
                  {entry.deltaSats < 0 ? '−' : '+'}
                  {satsToBtc(Math.abs(entry.deltaSats))} BTC
                </span>
                {entry.eventId && (
                  <Link
                    to={`/app?event=${entry.eventId}`}
                    className="rounded border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-sky-300 hover:bg-sky-500/20"
                  >
                    TRACKED
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold tracking-wider text-zinc-400">LABELS</h2>
        <LabelList labels={info.labels} onVote={vote} />
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold tracking-wider text-zinc-400">ADD LABEL</h2>
        <LabelForm
          address={info.address}
          onSubmit={(body) => postLabel(info.address, body, token!)}
          onCreated={onLabelCreated}
        />
      </section>

      {info.recentEvents.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold tracking-wider text-zinc-400">RECENT EVENTS</h2>
          <div className="space-y-3">
            {info.recentEvents.map((event) => (
              <FeedItem
                key={event.id}
                event={event}
                selected={false}
                onSelect={(id) => navigate(`/app?event=${id}`)}
              />
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            <Link to="/app" className="text-sky-400 hover:underline">
              Back to the live feed
            </Link>
          </p>
        </section>
      )}
    </div>
  );
}
