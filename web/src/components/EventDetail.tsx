import type { EventDetail as EventDetailType } from '@chainwatch/shared';

import { postVote } from '../api/client';
import { satsToBtc, timeAgo } from '../lib/format';
import { useSession } from '../session';
import { AiCard } from './AiCard';
import { DemoBadge, RuleBadge, StatusBadge } from './badges';
import { LabelList } from './LabelList';
import { TxGraph } from './TxGraph';

interface EventDetailProps {
  event: EventDetailType;
  onUpdate: (event: EventDetailType) => void;
}

export function EventDetail({ event, onUpdate }: EventDetailProps) {
  const { token } = useSession();
  const isDemo = event.source === 'demo' || event.rules.includes('demo');

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
          {isDemo && <DemoBadge />}
          <span className="ml-auto text-xs text-zinc-500">detected {timeAgo(event.detectedAt)}</span>
        </div>
        <p className="tnum mt-3 font-mono text-4xl font-semibold text-zinc-50">
          {satsToBtc(event.valueSats)}
          <span className="ml-2 text-base font-normal text-zinc-500">BTC</span>
        </p>
        <p className="mt-2 break-all font-mono text-xs text-zinc-500">{event.txid}</p>
        <a
          href={`https://mempool.space/tx/${event.txid}`}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-xs text-sky-400 hover:underline"
        >
          View on mempool.space
        </a>
      </header>

      <AiCard event={event} onFeedback={(aiFeedback) => onUpdate({ ...event, aiFeedback })} />

      <section>
        <h3 className="mb-2 text-xs font-semibold tracking-wider text-zinc-400">
          CROWD LABELS ON INVOLVED ADDRESSES
        </h3>
        <LabelList labels={event.labels} onVote={vote} />
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold tracking-wider text-zinc-400">VALUE FLOW</h3>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <TxGraph txid={event.txid} inputs={event.inputs} outputs={event.outputs} labels={event.labels} />
        </div>
      </section>
    </div>
  );
}
