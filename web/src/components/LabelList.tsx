import { useState } from 'react';

import type { Label } from '@chainwatch/shared';

import { timeAgo, truncateDid } from '../lib/format';
import { EvidencePanel } from './EvidencePanel';
import { VoteButton } from './VoteButton';

interface LabelListProps {
  labels: Label[];
  onVote: (labelId: string, value: 1 | -1) => Promise<void>;
  /** what is being labelled, for the empty state */
  subject?: 'address' | 'transaction';
}

export function LabelList({ labels, onVote, subject = 'address' }: LabelListProps) {
  const [evidenceFor, setEvidenceFor] = useState<Label | null>(null);

  if (labels.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-6 text-center text-sm text-zinc-500">
        No tags yet. Be the first to tag this {subject}.
      </p>
    );
  }
  return (
    <>
      <ul className="space-y-3">
        {labels.map((label) => (
          <li key={label.id} className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
            <VoteButton
              compact
              score={label.score}
              myVote={label.myVote}
              onVote={(value) => onVote(label.id, value)}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-zinc-100">{label.tag}</span>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-400">
                  {label.source === 'seed' ? 'seed import' : 'crowd'}
                </span>
              </div>
              {label.note && <p className="mt-1 text-sm text-zinc-300">{label.note}</p>}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                <span>
                  {label.author ? (label.author.handle ?? truncateDid(label.author.did)) : 'GraphSense TagPacks'}
                </span>
                <span>{timeAgo(label.createdAt)}</span>
                <button
                  type="button"
                  onClick={() => setEvidenceFor(label)}
                  className="text-sky-400 hover:underline"
                >
                  evidence
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {evidenceFor && <EvidencePanel label={evidenceFor} onClose={() => setEvidenceFor(null)} />}
    </>
  );
}
