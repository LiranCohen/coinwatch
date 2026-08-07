import { useEffect, useMemo, useState } from 'react';

import type { EventDetail as EventDetailType, Hack } from '@chainwatch/shared';

import { getHack, postVote } from '../api/client';
import { enrichIo, guessLinks } from '../lib/demoFlow';
import { satsToBtc, timeAgo } from '../lib/format';
import { useSession } from '../session';
import { AiCard } from './AiCard';
import { RuleBadge, StatusBadge } from './badges';
import { HackTracer } from './HackTracer';
import { LabelList } from './LabelList';
import { TxGraph } from './TxGraph';

interface EventDetailProps {
  event: EventDetailType;
  onUpdate: (event: EventDetailType) => void;
  onOpenEvent?: (eventId: string) => void;
}

export function EventDetail({ event, onUpdate, onOpenEvent }: EventDetailProps) {
  const { token } = useSession();
  const [hack, setHack] = useState<Hack | null>(null);
  const [copied, setCopied] = useState(false);

  const flow = useMemo(() => {
    const io = enrichIo(event);
    return { ...io, links: guessLinks(io.inputs, io.outputs) };
  }, [event]);

  const copyTxid = async () => {
    try {
      await navigator.clipboard.writeText(event.txid);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (permissions or non-secure context)
    }
  };

  useEffect(() => {
    let cancelled = false;
    setHack(null);
    if (event.hackId) {
      getHack(event.hackId)
        .then((h) => {
          if (!cancelled) setHack(h);
        })
        .catch(() => {
          if (!cancelled) setHack(null);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [event.id, event.hackId]);

  const vote = async (labelId: string, value: 1 | -1) => {
    if (!token) return;
    const updated = await postVote(labelId, value, token);
    onUpdate({
      ...event,
      labels: event.labels.map((l) => (l.id === updated.id ? updated : l)),
      matchedLabels: event.matchedLabels.map((l) => (l.id === updated.id ? updated : l)),
    });
  };

  return (
    <div className="space-y-5">
      <header className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {event.rules.map((rule) => (
            <RuleBadge key={rule} rule={rule} />
          ))}
          <StatusBadge status={event.status} />
          <span className="ml-auto text-xs text-zinc-500">detected {timeAgo(event.detectedAt)}</span>
        </div>
        <p className="tnum mt-3 font-mono text-4xl font-semibold text-zinc-50">
          {satsToBtc(event.valueSats)}
          <span className="ml-2 text-base font-normal text-zinc-500">BTC</span>
        </p>
        <div className="mt-2 flex items-center gap-2">
          <p className="break-all font-mono text-xs text-zinc-500">{event.txid}</p>
          <button
            type="button"
            onClick={() => void copyTxid()}
            className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          >
            {copied ? 'COPIED' : 'COPY'}
          </button>
        </div>
      </header>

      <section>
        <h3 className="mb-2 text-xs font-semibold tracking-wider text-zinc-400">
          {hack ? 'VALUE FLOW: THIS TRANSACTION' : 'VALUE FLOW'}
        </h3>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <TxGraph txid={event.txid} inputs={flow.inputs} outputs={flow.outputs} links={flow.links} labels={event.labels} />
        </div>
      </section>

      {hack && (
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wider text-red-400">MULTI-TX HACK</h3>
          <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-3">
            <div className="mb-1 flex flex-wrap items-baseline gap-2">
              <span className="text-sm font-semibold text-red-200">{hack.title}</span>
              <span className="tnum text-xs text-red-300/80">
                {satsToBtc(hack.totalSats)} BTC · {hack.hops.length} hops
              </span>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-zinc-400">{hack.summary}</p>
            <HackTracer
              hack={hack}
              currentEventId={event.id}
              labels={event.labels.concat(event.matchedLabels)}
              onOpenEvent={onOpenEvent}
            />
          </div>
        </section>
      )}

      <AiCard event={event} onFeedback={(aiFeedback) => onUpdate({ ...event, aiFeedback })} />

      <section>
        <h3 className="mb-2 text-xs font-semibold tracking-wider text-zinc-400">
          CROWD LABELS ON INVOLVED ADDRESSES
        </h3>
        <LabelList labels={event.labels} onVote={vote} />
      </section>
    </div>
  );
}
