import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { validateBitcoinAddress, type AddressInfo, type Label } from '@chainwatch/shared';

import { ApiError, getAddress, postLabel, postVote } from '../api/client';
import { FeedItem } from '../components/FeedItem';
import { LabelForm } from '../components/LabelForm';
import { LabelList } from '../components/LabelList';
import { satsToBtc, timeAgo, truncateMiddle } from '../lib/format';
import { useSession } from '../session';

interface Failure {
  /** the address this failure belongs to, so it cannot outlive a navigation to another one */
  address: string;
  /** 'rejected': the API refused the address itself, so retrying cannot help */
  kind: 'rejected' | 'failed';
  message: string;
}

/** ApiError carries the raw response body, and the API answers errors as {"error": "…"} */
function readApiMessage(error: ApiError): string {
  try {
    const body: unknown = JSON.parse(error.message);
    if (body !== null && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
      return body.error;
    }
  } catch {
    // a proxy or the dev server answered with HTML instead of the API
  }
  return error.message || `HTTP ${error.status}`;
}

function toFailure(address: string, error: unknown): Failure {
  if (error instanceof ApiError) {
    return {
      address,
      kind: error.status === 400 ? 'rejected' : 'failed',
      message: readApiMessage(error),
    };
  }
  return { address, kind: 'failed', message: error instanceof Error ? error.message : 'lookup failed' };
}

/**
 * `recentEvents` is a page the server caps, so its length is a floor and never a
 * total: an address with 60 detections arrives with 10. `eventCount` is the only
 * number that counts them all, and a server predating it leaves the total
 * unknowable — except when it returns no events, which no cap can hide.
 */
function indexedTotal(info: AddressInfo): number | null {
  const reported: unknown = (info as { eventCount?: unknown }).eventCount;
  // a total below the page it arrived with is provably wrong, so it is no total at all
  if (typeof reported === 'number' && Number.isInteger(reported) && reported >= info.recentEvents.length) {
    return reported;
  }
  return info.recentEvents.length === 0 ? 0 : null;
}

/**
 * The three things this page knows come from three different places and routinely
 * disagree: balance and transaction count are the chain's, events and history are
 * only what CoinWatch's own node indexed, labels are claims people typed. An address
 * with thousands of transactions and nothing here is the ordinary case, so the page
 * has to say which of the three is empty instead of implying the address is.
 */
function coverageNote(info: AddressInfo): string | null {
  if (info.history.length > 0 || info.recentEvents.length > 0) return null;
  const labelled = info.labels.length > 0;
  const claimsNote = labelled
    ? ' The labels below are claims made by people, not CoinWatch detections.'
    : '';
  if (info.txCount === null && info.balanceSats === null) {
    return (
      'CoinWatch has not indexed any transaction of this address, and its chain stats could not be read ' +
      'either — so nothing here says whether the address has ever been used.' +
      claimsNote
    );
  }
  const usedOnChain = (info.txCount ?? 0) > 0 || (info.balanceSats ?? 0) > 0;
  if (usedOnChain) {
    return (
      'This address is in use on chain, but none of its transactions has tripped a CoinWatch detection ' +
      'rule while this node has been watching, so there is nothing indexed for it. That is the ordinary ' +
      'state for almost every address and is not a judgement about this one.' +
      (labelled
        ? ' The labels below are claims made by people, not CoinWatch detections.'
        : ' Nobody has labelled it either — tagging it below is what makes it mean something to the next person who looks it up.')
    );
  }
  return (
    'The chain shows no activity on this address at all, and CoinWatch has nothing indexed for it.' +
    (labelled
      ? ' The labels below are claims made by people, not CoinWatch detections.'
      : ' A label added now sticks, and applies the moment the address does show up.')
  );
}

/**
 * A non-mainnet address is not a failed lookup: this deployment watches mainnet and
 * nothing else, so its blanks are permanent and no retry, node or wait changes them.
 * Saying "could not be read" here would sell a structural impossibility as an outage.
 */
function OffNetworkNote({ network }: { network: string }) {
  return (
    <div className="max-w-3xl space-y-2 rounded-lg border border-amber-900/60 bg-amber-950/20 px-4 py-3">
      <p className="text-sm text-amber-100">
        This is a {network} address. CoinWatch indexes mainnet only, so it holds no balance, no
        transaction count, no detections and no history for it, and never will. The dashes above are
        that — not zeros, and not a node that failed to answer.
      </p>
      <p className="text-xs text-amber-200/70">
        Labelling is not offered for a {network} address either: a label is permanent and public, and
        this deployment can never show the address it describes, so nobody would meet the label where
        it would mean something.
      </p>
    </div>
  );
}

function ErrorCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="max-w-3xl space-y-3 rounded-lg border border-red-900/60 bg-red-950/20 p-4">
      <h2 className="text-sm font-semibold text-red-200">{title}</h2>
      {children}
      <p className="text-xs text-zinc-500">
        <Link to="/app" className="text-sky-400 hover:underline">
          Back to the live feed
        </Link>
      </p>
    </div>
  );
}

export function AddressPage() {
  const { address = '' } = useParams();
  const navigate = useNavigate();
  const { token } = useSession();
  const [info, setInfo] = useState<AddressInfo | null>(null);
  const [lastFailure, setLastFailure] = useState<Failure | null>(null);
  const [attempt, setAttempt] = useState(0);

  // checksum-checking here keeps a mistyped address from costing a round trip and
  // coming back as a bare 400 the page would have to translate anyway
  const validation = useMemo(() => validateBitcoinAddress(address), [address]);
  const normalized = validation.normalized;

  useEffect(() => {
    if (normalized === null) return;
    let cancelled = false;
    setLastFailure(null);
    getAddress(normalized, token)
      .then((next) => {
        if (!cancelled) setInfo(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLastFailure(toFailure(normalized, err));
      });
    return () => {
      cancelled = true;
    };
  }, [normalized, token, attempt]);

  const vote = async (labelId: string, value: 1 | -1) => {
    if (!token || !info) return;
    const updated = await postVote(labelId, value, token);
    setInfo({ ...info, labels: info.labels.map((l) => (l.id === updated.id ? updated : l)) });
  };

  const onLabelCreated = (label: Label) => {
    if (!info) return;
    setInfo({ ...info, labels: [...info.labels, label] });
  };

  if (normalized === null) {
    return (
      <ErrorCard title="Not a valid Bitcoin address">
        <p className="break-all font-mono text-xs text-zinc-400">{address || '(nothing to look up)'}</p>
        <p className="text-sm text-zinc-300">{validation.reason ?? 'not a bitcoin address'}</p>
        <p className="text-xs text-zinc-500">
          Addresses are checked against their checksum before any lookup, so a single wrong character is
          caught here rather than shown as an empty page.
        </p>
      </ErrorCard>
    );
  }

  // state outlives the route param by a render, so both are pinned to the address they describe
  const failure = lastFailure !== null && lastFailure.address === normalized ? lastFailure : null;
  if (failure) {
    return failure.kind === 'rejected' ? (
      <ErrorCard title="The API did not accept this address">
        <p className="break-all font-mono text-xs text-zinc-400">{normalized}</p>
        <p className="text-sm text-zinc-300">{failure.message}</p>
      </ErrorCard>
    ) : (
      <ErrorCard title="Could not load this address">
        <p className="break-all font-mono text-xs text-zinc-400">{normalized}</p>
        <p className="text-sm text-zinc-300">{failure.message}</p>
        <p className="text-xs text-zinc-500">
          The address itself is fine. The API did not answer, so nothing about it could be fetched.
        </p>
        <button
          type="button"
          onClick={() => setAttempt((n) => n + 1)}
          className="rounded border border-zinc-600 px-3 py-1.5 text-sm text-zinc-200 hover:border-zinc-400"
        >
          Try again
        </button>
      </ErrorCard>
    );
  }

  // a response for the previously viewed address must never render under this one
  const current = info !== null && info.address === normalized ? info : null;
  if (!current) {
    return <p className="cw-pulse text-sm text-zinc-500">Looking up address…</p>;
  }

  const history = current.history ?? [];
  const total = indexedTotal(current);
  const shown = current.recentEvents.length;
  // validated addresses always carry a network, so a non-mainnet one is known, not unknown
  const offNetwork = validation.network !== null && validation.network !== 'mainnet';
  const note = offNetwork ? null : coverageNote({ ...current, history });

  return (
    <div className="max-w-3xl space-y-6">
      <header className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <p className="break-all font-mono text-sm text-zinc-100">{current.address}</p>
        {validation.kind !== null && (
          <p className="mt-1 text-[11px] uppercase tracking-wider text-zinc-500">
            {validation.kind}
            {validation.network !== null && validation.network !== 'mainnet' && ` · ${validation.network}`}
          </p>
        )}
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-zinc-500">On chain</p>
            <p className="tnum font-mono text-xl text-zinc-50">
              {current.balanceSats !== null ? `${satsToBtc(current.balanceSats)} BTC` : '—'}
            </p>
            <p className="tnum mt-0.5 text-xs text-zinc-400">
              {current.txCount !== null
                ? `${current.txCount.toLocaleString()} transaction${current.txCount === 1 ? '' : 's'}`
                : 'transaction count unavailable'}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-zinc-500">Indexed by CoinWatch</p>
            <p className="tnum font-mono text-xl text-zinc-50">
              {total !== null ? total.toLocaleString() : '—'}
            </p>
            <p className="tnum mt-0.5 text-xs text-zinc-400">
              {total !== null
                ? `detection${total === 1 ? '' : 's'} on this address`
                : 'detection count unavailable'}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-zinc-500">Claimed by the crowd</p>
            <p className="tnum font-mono text-xl text-zinc-50">{current.labels.length}</p>
            <p className="mt-0.5 text-xs text-zinc-400">
              {current.labels.length === 0 && !offNetwork ? (
                <a href="#add-label" className="text-sky-400 hover:underline">
                  labels — add the first
                </a>
              ) : (
                `label${current.labels.length === 1 ? '' : 's'}`
              )}
            </p>
          </div>
        </div>
        {!offNetwork && (current.balanceSats === null || current.txCount === null) && (
          <p className="mt-3 text-xs text-zinc-500">
            Anything shown as — could not be read from the node. It is not a zero.
          </p>
        )}
        {!offNetwork && total === null && (
          <p className="mt-1 text-xs text-zinc-500">
            The detection total is dashed because this server reports no usable one. What is listed
            below is the page it returned, which is a floor and not a count.
          </p>
        )}
      </header>

      {offNetwork && validation.network !== null && <OffNetworkNote network={validation.network} />}

      {note && (
        <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-sm text-zinc-300">
          {note}
        </p>
      )}

      <section>
        <h2 className="mb-2 text-xs font-semibold tracking-wider text-zinc-400">
          BALANCE CHANGES COINWATCH HAS ON FILE
        </h2>
        {history.length > 0 && (
          <p className="mb-2 text-xs text-zinc-500">
            One row per transaction CoinWatch stored for this address, and how much it moved the
            balance. The node sees every transaction in every block and keeps only the ones that trip
            a detection rule, so this is never the address's full transaction history.
          </p>
        )}
        {history.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-6 text-center text-xs text-zinc-500">
            {offNetwork
              ? `Nothing on file. CoinWatch indexes mainnet only, so a ${validation.network} address never gets a row here.`
              : 'Nothing on file. No transaction of this address has tripped a detection rule while this node has been watching, and an untripped transaction is never stored — so an address in daily use shows nothing here.'}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-800">
            {history.map((entry, i) => (
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
        {total !== null && history.length > 0 && history.length < total && (
          <p className="mt-2 text-xs text-zinc-500">
            Capped the same way as the list below: these {history.length} rows are the newest of{' '}
            {total.toLocaleString()} detections, so the balance changes shown do not add up to
            anything.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold tracking-wider text-zinc-400">LABELS</h2>
        <LabelList labels={current.labels} onVote={vote} />
      </section>

      {!offNetwork && (
        <section id="add-label" className="scroll-mt-4">
          <h2 className="mb-2 text-xs font-semibold tracking-wider text-zinc-400">ADD LABEL</h2>
          <LabelForm
            address={current.address}
            onSubmit={(body) => postLabel(current.address, body, token!)}
            onCreated={onLabelCreated}
          />
        </section>
      )}

      {shown > 0 && (
        <section>
          <h2 className="mb-1 text-xs font-semibold tracking-wider text-zinc-400">RECENT EVENTS</h2>
          <p className="mb-2 text-xs text-zinc-500">
            {total !== null && total > shown
              ? `Shows only the ${shown} most recent of ${total.toLocaleString()} detections on this address. The API caps this page, so the older ones are not on this screen.`
              : total !== null
                ? `All ${total} detection${total === 1 ? '' : 's'} on this address.`
                : `Shows only the ${shown} most recent detections the API returned. It caps this page and reports no usable total, so ${shown} is a floor, not the count.`}
          </p>
          <div className="space-y-3">
            {current.recentEvents.map((event) => (
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
