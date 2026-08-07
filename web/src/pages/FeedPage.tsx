import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  isTxid,
  type EventDetail as EventDetailType,
  type EventSummary,
  type Label,
  type Rule,
  type ServerMeta,
} from '@chainwatch/shared';

import { getEvent, getEventByTxid, getEvents, getServerMeta } from '../api/client';
import { useEventStream } from '../api/sse';
import { BlocksStrip } from '../components/BlocksStrip';
import { ChainStatsBar } from '../components/ChainStatsBar';
import { EventDetail } from '../components/EventDetail';
import { FeedItem } from '../components/FeedItem';
import { TrendingLabels } from '../components/TrendingLabels';
import { useSession } from '../session';

const FEED_CAP = 50;
/** detections shown per page in the left column */
const LIST_PAGE = 8;
// 'hack' is a multi-transaction pattern the detector does not yet emit, so it
// is not offered as a filter that would always come back empty
const RULE_FILTERS: (Rule | 'all')[] = ['all', 'whale', 'dormant-wake', 'coinjoin'];
const NODE_STALE_MS = 15_000;

/** thresholds arrive already in BTC; every one of them is deployment configuration */
const btcFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 });

interface TxidHit {
  txid: string;
  status: 'found';
  eventId: string;
  /** list filters dropped so the left column cannot contradict the opened event */
  cleared: string[];
}

interface TxidMiss {
  txid: string;
  /** 'untracked': the txid is well formed, it simply never matched a detection rule */
  status: 'loading' | 'invalid' | 'untracked' | 'failed';
}

type TxidLookup = TxidHit | TxidMiss;

/** whether the found event is among the ones the left column is currently showing */
type HitListState = 'loading' | 'listed' | 'unlisted';

/**
 * Every threshold below is read from the server's own config, so an unreachable
 * /api/meta means the numbers are unknown — and an unknown threshold is never
 * worth more than saying so.
 */
function DetectionThresholds({ meta }: { meta: ServerMeta | null }): React.JSX.Element {
  if (!meta) {
    return (
      <>
        The thresholds are set per deployment and this one has not reported them, so they are not listed
        here.
      </>
    );
  }
  const d = meta.detection;
  // the fixture lane answers /api/meta out of a canned object, so its numbers describe
  // the demo data and not whatever deployment the reader is looking at
  const preamble =
    meta.chainSource === 'fixtures' ? 'Thresholds behind this demo data' : 'Thresholds on this deployment';
  return (
    <>
      {preamble}: whale ≥ {btcFormatter.format(d.whaleThresholdBtc)} BTC · dormant-wake ≥{' '}
      {btcFormatter.format(d.dormantMinValueBtc)} BTC moved after {d.dormantBlocks.toLocaleString()} blocks
      of no activity · coinjoin ≥ {d.coinjoinMinEqualOutputs} equal outputs of ≥{' '}
      {btcFormatter.format(d.coinjoinMinDenominationBtc)} BTC each.
    </>
  );
}

function TxidNotice({
  lookup,
  meta,
  listState,
  onRetry,
  onDismiss,
}: {
  lookup: TxidLookup;
  meta: ServerMeta | null;
  listState: HitListState;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  // an unindexed transaction is the expected outcome for most of the chain, so it is
  // styled as information; only a lookup that actually broke gets the warning palette
  const alert = lookup.status === 'failed' || lookup.status === 'invalid';
  const palette =
    lookup.status === 'found'
      ? 'border-emerald-500/40 bg-emerald-500/10'
      : alert
        ? 'border-amber-500/40 bg-amber-500/10'
        : 'border-zinc-800 bg-zinc-900/40';
  return (
    <div className={`rounded-lg border px-4 py-3 ${palette}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          {lookup.status === 'loading' && (
            <p className="cw-pulse text-sm text-zinc-300">Looking up transaction…</p>
          )}
          {lookup.status === 'found' && (
            <>
              <p className="text-sm text-emerald-200">
                Found it. This transaction is in the CoinWatch index and is open in the panel on the right.
              </p>
              {lookup.cleared.length > 0 && (
                <p className="text-xs text-zinc-400">
                  Cleared {lookup.cleared.join(' and ')} so the list could not contradict what is open.
                </p>
              )}
              {listState === 'unlisted' && (
                <p className="text-xs text-zinc-400">
                  It is not in the list on the left, which shows only the {FEED_CAP} most recent detections
                  matching the current filters.
                </p>
              )}
            </>
          )}
          {lookup.status === 'invalid' && (
            <p className="text-sm text-amber-200">
              That is not a transaction id. A txid is 64 hexadecimal characters.
            </p>
          )}
          {lookup.status === 'untracked' && (
            <>
              <p className="text-sm text-zinc-200">This transaction is not in the CoinWatch index.</p>
              <p className="text-xs text-zinc-400">
                CoinWatch only records transactions that trip one of its detection rules.{' '}
                <DetectionThresholds meta={meta} /> Everything else is left alone, so a transaction missing
                here says nothing bad about it. The live feed below is unaffected.
              </p>
            </>
          )}
          {lookup.status === 'failed' && (
            <p className="text-sm text-amber-200">
              Could not check that transaction — the API did not answer.
            </p>
          )}
          <p className="tnum truncate font-mono text-[11px] text-zinc-500">{lookup.txid}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {lookup.status === 'failed' && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-200 hover:border-zinc-400"
            >
              Try again
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss transaction lookup"
            className="rounded px-2 py-1 text-xs text-zinc-500 hover:text-zinc-300"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A searched txid that the index does not hold has no event behind it, and the newest
 * whale move is not an answer to it: read beside the notice, an unrelated detail panel
 * is indistinguishable from a result. The pane states the miss instead.
 */
function detailPlaceholder(lookup: TxidLookup | null, selectedId: string | null): string {
  if (lookup !== null && lookup.status !== 'found') {
    switch (lookup.status) {
      case 'loading':
        return 'Looking up that transaction…';
      case 'invalid':
        return 'That is not a transaction id, so there is nothing to open here.';
      case 'untracked':
        return 'That transaction is not in the index, so there is no event to open here.';
      case 'failed':
        return 'That transaction could not be checked, so nothing is open here.';
    }
  }
  return selectedId ? 'Loading event…' : 'Select an event to inspect it.';
}

function SkeletonFeed() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="cw-pulse rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="h-7 w-32 rounded bg-zinc-800" />
          <div className="mt-2 h-4 w-48 rounded bg-zinc-800" />
        </div>
      ))}
    </div>
  );
}

export function FeedPage() {
  const { token } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedEvent = searchParams.get('event');
  const requestedTxid = searchParams.get('txid');
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(requestedEvent);
  const [detail, setDetail] = useState<EventDetailType | null>(null);
  const [ruleFilter, setRuleFilter] = useState<Rule | 'all'>('all');
  const [blockFilter, setBlockFilter] = useState<number | null>(null);
  const [listPage, setListPage] = useState(0);
  const [nodeStale, setNodeStale] = useState(false);
  const [txidLookup, setTxidLookup] = useState<TxidLookup | null>(null);
  const [txidAttempt, setTxidAttempt] = useState(0);
  const [feedFailed, setFeedFailed] = useState(false);
  const [feedAttempt, setFeedAttempt] = useState(0);
  const [meta, setMeta] = useState<ServerMeta | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;
  // the txid lookup has to know the current filters without re-running whenever they change
  const ruleFilterRef = useRef<Rule | 'all'>(ruleFilter);
  ruleFilterRef.current = ruleFilter;
  const blockFilterRef = useRef<number | null>(blockFilter);
  blockFilterRef.current = blockFilter;

  useEffect(() => {
    let cancelled = false;
    setFeedFailed(false);
    getEvents(ruleFilter === 'all' ? {} : { rule: ruleFilter })
      .then((res) => {
        if (!cancelled) setEvents(res.events);
      })
      .catch(() => {
        // an unreachable API says nothing about how many events exist, so the empty
        // state must not be reused for it
        if (cancelled) return;
        setEvents(null);
        setFeedFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ruleFilter, feedAttempt]);

  useEffect(() => {
    let cancelled = false;
    getServerMeta()
      .then((next) => {
        if (!cancelled) setMeta(next);
      })
      .catch(() => {
        if (!cancelled) setMeta(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (requestedTxid === null) {
      setTxidLookup(null);
      return;
    }
    // the search owns the detail pane from the moment it is made: whatever was open
    // belongs to a different transaction, and leaving it up reads as the answer
    setSelectedId(null);
    setDetail(null);
    // a malformed txid would only earn a 400, so it is answered without the round trip
    if (!isTxid(requestedTxid)) {
      setTxidLookup({ txid: requestedTxid, status: 'invalid' });
      return;
    }
    const txid = requestedTxid.toLowerCase();
    let cancelled = false;
    setTxidLookup({ txid, status: 'loading' });
    getEventByTxid(txid, token)
      .then((found) => {
        if (cancelled) return;
        if (!found) {
          setTxidLookup({ txid, status: 'untracked' });
          return;
        }
        // filters that exclude the hit would leave the list insisting nothing was found
        // while the detail pane shows it, so they are dropped and the drop is reported
        const cleared: string[] = [];
        const rule = ruleFilterRef.current;
        if (rule !== 'all' && !found.rules.includes(rule)) {
          cleared.push(`the ${rule} filter`);
          setEvents(null);
          setRuleFilter('all');
        }
        const block = blockFilterRef.current;
        if (block !== null && found.blockHeight !== block) {
          cleared.push(`the block ${block.toLocaleString()} filter`);
          setBlockFilter(null);
        }
        setTxidLookup({ txid, status: 'found', eventId: found.id, cleared });
        setSelectedId(found.id);
        // the detail is already in hand, so seeding it skips a "Loading event…" flash
        setDetail(found);
      })
      .catch(() => {
        if (!cancelled) setTxidLookup({ txid, status: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [requestedTxid, token, txidAttempt]);

  // a live ?txid search holds off auto-selection until it is dismissed, and not only
  // while it is in flight: once it misses there is nothing to select, and filling the
  // pane with the newest event would answer the search with an unrelated transaction
  useEffect(() => {
    if (selectedId !== null || txidLookup !== null) return;
    const first = events?.[0];
    if (first) setSelectedId(first.id);
  }, [events, selectedId, txidLookup]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    getEvent(selectedId, token)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, token]);

  const refetchDetail = useCallback(
    (id: string) => {
      getEvent(id, token).then(setDetail).catch(() => undefined);
    },
    [token],
  );

  const onEventNew = useCallback((event: EventSummary) => {
    setEvents((current) => {
      if (!current) return current;
      if (current.some((e) => e.id === event.id)) return current;
      return [event, ...current].slice(0, FEED_CAP);
    });
  }, []);

  const onEventUpdate = useCallback(
    (event: EventSummary) => {
      setEvents((current) => current?.map((e) => (e.id === event.id ? { ...e, ...event } : e)) ?? null);
      if (selectedRef.current === event.id) refetchDetail(event.id);
    },
    [refetchDetail],
  );

  const onLabelNew = useCallback(
    (label: Label) => {
      setEvents((current) => {
        if (!current) return current;
        return current.map((event) => {
          const idx = event.matchedLabels.findIndex((l) => l.address === label.address);
          if (idx === -1) return event;
          const matchedLabels = [...event.matchedLabels];
          if (matchedLabels[idx].id === label.id) {
            matchedLabels[idx] = label;
          } else {
            matchedLabels.push(label);
            matchedLabels.sort((a, b) => b.score - a.score);
          }
          return { ...event, matchedLabels: matchedLabels.slice(0, 3) };
        });
      });
      if (selectedRef.current) refetchDetail(selectedRef.current);
    },
    [refetchDetail],
  );

  const { lastHealthAt } = useEventStream({ onEventNew, onEventUpdate, onLabelNew });

  useEffect(() => {
    const timer = setInterval(() => {
      setNodeStale(lastHealthAt !== null && Date.now() - Date.parse(lastHealthAt) > NODE_STALE_MS);
    }, 5000);
    return () => clearInterval(timer);
  }, [lastHealthAt]);

  useEffect(() => {
    if (requestedEvent && requestedEvent !== selectedRef.current) setSelectedId(requestedEvent);
  }, [requestedEvent]);

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      setSearchParams({ event: id }, { replace: true });
    },
    [setSearchParams],
  );

  // dropping the param is what clears the notice: the lookup state is derived from the URL
  const dismissTxid = useCallback(() => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('txid');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const matching = (events ?? []).filter(
    (event) => blockFilter === null || event.blockHeight === blockFilter,
  );
  // The feed is unbounded by nature, so the column shows a page of it rather
  // than growing without limit. Scrolling a thousand rows is not browsing.
  const pageCount = Math.max(1, Math.ceil(matching.length / LIST_PAGE));
  const page = Math.min(listPage, pageCount - 1);
  const visible = matching.slice(page * LIST_PAGE, page * LIST_PAGE + LIST_PAGE);

  const hitListState: HitListState =
    events === null
      ? 'loading'
      : txidLookup?.status === 'found' && visible.some((event) => event.id === txidLookup.eventId)
        ? 'listed'
        : 'unlisted';

  return (
    <div className="space-y-4">
      <ChainStatsBar />
      <BlocksStrip selectedHeight={blockFilter} onSelectHeight={setBlockFilter} />
      {nodeStale && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
          Node connection stale: no successful poll in the last {NODE_STALE_MS / 1000}s. Events may be delayed.
        </div>
      )}
      {txidLookup && (
        <TxidNotice
          lookup={txidLookup}
          meta={meta}
          listState={hitListState}
          onRetry={() => setTxidAttempt((n) => n + 1)}
          onDismiss={dismissTxid}
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {RULE_FILTERS.map((rule) => (
            <button
              key={rule}
              type="button"
              onClick={() => {
                setEvents(null);
                setRuleFilter(rule);
                setListPage(0);
              }}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                ruleFilter === rule
                  ? 'border-sky-500/60 bg-sky-500/10 text-sky-300'
                  : 'border-zinc-800 text-zinc-400 hover:border-zinc-600'
              }`}
            >
              {rule}
            </button>
          ))}
        </div>
      </div>

      <TrendingLabels />

      <div className="grid items-start gap-4 lg:grid-cols-[380px_1fr]">
        <div className="space-y-3">
          {feedFailed ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-10 text-center">
              <p className="text-sm text-amber-200">Could not load the feed — the API did not answer.</p>
              <p className="mt-2 text-xs text-amber-200/80">
                This is a connection failure, not an empty feed. What has been detected is unknown until it
                loads.
              </p>
              <button
                type="button"
                onClick={() => setFeedAttempt((n) => n + 1)}
                className="mt-3 rounded border border-amber-500/50 px-3 py-1.5 text-xs text-amber-100 hover:border-amber-400"
              >
                Try again
              </button>
            </div>
          ) : events === null ? (
            <SkeletonFeed />
          ) : visible.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-800 px-4 py-10 text-center">
              <p className="text-sm text-zinc-300">
                {blockFilter === null
                  ? 'Watching the chain. No matching events yet.'
                  : `No detected events in block ${blockFilter.toLocaleString()} yet.`}
              </p>
              <p className="mt-2 text-xs text-zinc-500">
                <DetectionThresholds meta={meta} />
              </p>
            </div>
          ) : (
            <>
              {visible.map((event) => (
                <FeedItem
                  key={event.id}
                  event={event}
                  selected={event.id === selectedId}
                  onSelect={select}
                />
              ))}
              {pageCount > 1 && (
                <div className="flex items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    disabled={page === 0}
                    onClick={() => setListPage(page - 1)}
                    className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 disabled:opacity-30 hover:border-zinc-500"
                  >
                    ‹ newer
                  </button>
                  <span className="tnum text-[11px] text-zinc-500">
                    {page * LIST_PAGE + 1}–{Math.min((page + 1) * LIST_PAGE, matching.length)} of{' '}
                    {matching.length}
                  </span>
                  <button
                    type="button"
                    disabled={page >= pageCount - 1}
                    onClick={() => setListPage(page + 1)}
                    className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 disabled:opacity-30 hover:border-zinc-500"
                  >
                    older ›
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="min-w-0">
          {detail ? (
            <EventDetail event={detail} onUpdate={setDetail} onOpenEvent={select} />
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-800 px-4 py-10 text-center text-sm text-zinc-500">
              {detailPlaceholder(txidLookup, selectedId)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
