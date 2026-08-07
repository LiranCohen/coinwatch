import type { EventSummary } from '@chainwatch/shared';

import { formatCoins, timeAgo } from '../lib/format';
import { LabelBadge, RuleBadge, SimulatedBadge, StatusBadge } from './badges';

interface FeedItemProps {
  event: EventSummary;
  selected: boolean;
  onSelect: (id: string) => void;
}

export function FeedItem({ event, selected, onSelect }: FeedItemProps) {
  const isDemo = event.source === 'demo';
  return (
    <button
      type="button"
      onClick={() => onSelect(event.id)}
      className={`block w-full rounded-lg border p-3 text-left transition-colors ${
        selected
          ? 'border-zinc-500 bg-zinc-900 ring-1 ring-zinc-500'
          : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-600'
      } ${event.status === 'evicted' ? 'opacity-50' : ''}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="tnum font-mono text-2xl font-semibold text-zinc-50">
          {formatCoins(event.valueSats)}
        </span>
        <span className="shrink-0 text-xs text-zinc-500">{timeAgo(event.detectedAt)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {event.rules.map((rule) => (
          <RuleBadge key={rule} rule={rule} />
        ))}
        <StatusBadge status={event.status} />
        {isDemo && <SimulatedBadge />}
        {event.aiStatus !== 'done' && (
          <span className="text-[11px] italic text-zinc-500">
            {event.aiStatus === 'pending' ? 'analysis pending' : 'analysis failed'}
          </span>
        )}
        {event.aiStatus === 'done' && event.aiTag && (
          <span className="text-[11px] text-sky-300">{event.aiTag}</span>
        )}
      </div>
      {event.matchedLabels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {event.matchedLabels.map((label) => (
            <LabelBadge key={label.id} label={label} link={false} />
          ))}
        </div>
      )}
    </button>
  );
}
