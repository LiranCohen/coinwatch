import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import type { EventDetail as EventDetailType, EventSummary, Label, Rule } from '@chainwatch/shared';

import { getEvent, getEvents, postInject, probeInject } from '../api/client';
import { useEventStream } from '../api/sse';
import { BlocksStrip } from '../components/BlocksStrip';
import { EventDetail } from '../components/EventDetail';
import { FeedItem } from '../components/FeedItem';
import { TrendingLabels } from '../components/TrendingLabels';
import { useSession } from '../session';

const FEED_CAP = 50;
const RULE_FILTERS: (Rule | 'all')[] = ['all', 'whale', 'dormant-wake', 'coinjoin', 'hack'];
const NODE_STALE_MS = 15_000;

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
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(requestedEvent);
  const [detail, setDetail] = useState<EventDetailType | null>(null);
  const [ruleFilter, setRuleFilter] = useState<Rule | 'all'>('all');
  const [injectAvailable, setInjectAvailable] = useState(false);
  const [injecting, setInjecting] = useState(false);
  const [nodeStale, setNodeStale] = useState(false);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  useEffect(() => {
    let cancelled = false;
    getEvents(ruleFilter === 'all' ? {} : { rule: ruleFilter })
      .then((res) => {
        if (cancelled) return;
        setEvents(res.events);
        setSelectedId((current) => current ?? res.events[0]?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [ruleFilter]);

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

  useEffect(() => {
    probeInject().then(setInjectAvailable).catch(() => setInjectAvailable(false));
  }, []);

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

  const inject = async () => {
    setInjecting(true);
    try {
      const created = await postInject({});
      select(created.id);
    } finally {
      setInjecting(false);
    }
  };

  return (
    <div className="space-y-4">
      <BlocksStrip />
      {nodeStale && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
          Node connection stale: no successful poll in the last {NODE_STALE_MS / 1000}s. Events may be delayed.
        </div>
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
        <div className="ml-auto flex items-center gap-2">
          {false && injectAvailable && (
            <button
              type="button"
              disabled={injecting}
              onClick={() => void inject()}
              className="rounded border border-amber-500/50 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
            >
              {injecting ? 'Injecting…' : 'Inject simulated event'}
            </button>
          )}
        </div>
      </div>

      <TrendingLabels />

      <div className="grid items-start gap-4 lg:grid-cols-[380px_1fr]">
        <div className="space-y-3">
          {events === null ? (
            <SkeletonFeed />
          ) : events.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-800 px-4 py-10 text-center">
              <p className="text-sm text-zinc-300">Listening to your node. No matching events yet.</p>
              <p className="mt-2 text-xs text-zinc-500">
                Active detection: whale ≥ 10 BTC · dormant-wake ≥ 1 BTC after ~30 days quiet · coinjoin ≥ 5 equal
                outputs · hack (multi-tx drain patterns).
              </p>
              {false && injectAvailable && (
                <p className="mt-2 text-xs text-amber-300/80">
                  Rehearsing? Use the inject button to fire a clearly-marked simulated event through the pipeline.
                </p>
              )}
            </div>
          ) : (
            events.map((event) => (
              <FeedItem key={event.id} event={event} selected={event.id === selectedId} onSelect={select} />
            ))
          )}
        </div>

        <div className="min-w-0">
          {detail ? (
            <EventDetail event={detail} onUpdate={setDetail} onOpenEvent={select} />
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-800 px-4 py-10 text-center text-sm text-zinc-500">
              {selectedId ? 'Loading event…' : 'Select an event to inspect it.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
