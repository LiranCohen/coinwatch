import { Link } from 'react-router-dom';

import type { EventStatus, Label, Rule } from '@chainwatch/shared';

import { truncateMiddle } from '../lib/format';

const RULE_STYLES: Record<Rule, string> = {
  whale: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  'dormant-wake': 'border-violet-500/40 bg-violet-500/10 text-violet-300',
  coinjoin: 'border-teal-500/40 bg-teal-500/10 text-teal-300',
  hack: 'border-red-500/40 bg-red-500/10 text-red-300',
};

const RULE_LABELS: Record<Rule, string> = {
  whale: 'WHALE',
  'dormant-wake': 'DORMANT WAKE',
  coinjoin: 'COINJOIN',
  hack: 'HACK',
};

export function RuleBadge({ rule }: { rule: Rule }) {
  if (!(rule in RULE_LABELS)) return null;
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wider ${RULE_STYLES[rule]}`}
    >
      {RULE_LABELS[rule]}
    </span>
  );
}

/** AE6: injected events must be unmistakable. */
export function SimulatedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded border-2 border-amber-400 bg-amber-400/15 px-2 py-0.5 text-[11px] font-bold tracking-widest text-amber-300">
      SIMULATED
    </span>
  );
}

export function StatusBadge({ status }: { status: EventStatus }) {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-sky-300">
        <span className="cw-pulse inline-block h-2 w-2 rounded-full bg-sky-400" />
        in mempool
      </span>
    );
  }
  if (status === 'confirmed') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
        <svg viewBox="0 0 12 12" className="h-3 w-3 fill-current">
          <path d="M4.7 9.1 1.9 6.3l1-1 1.8 1.8 4.4-4.4 1 1z" />
        </svg>
        confirmed
      </span>
    );
  }
  return <span className="text-xs text-zinc-500">evicted</span>;
}

export function LabelBadge({ label, link = true }: { label: Label; link?: boolean }) {
  const inner = (
    <>
      <span
        className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
          label.source === 'seed' ? 'bg-zinc-500' : 'bg-sky-400'
        }`}
      />
      <span className="truncate">{label.tag}</span>
      <span className="tnum text-zinc-400">{label.score > 0 ? `+${label.score}` : label.score}</span>
    </>
  );
  const className =
    'inline-flex max-w-full items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800/60 px-2.5 py-0.5 text-xs text-zinc-200';
  if (!link) {
    return (
      <span className={className} title={label.address}>
        {inner}
      </span>
    );
  }
  return (
    <Link
      to={`/app/address/${label.address}`}
      className={`${className} hover:border-zinc-500`}
      title={label.address}
    >
      {inner}
    </Link>
  );
}

export function ReputationBadge({ reputation }: { reputation: number }) {
  return (
    <span className="tnum inline-flex items-center rounded border border-zinc-700 bg-zinc-800/60 px-1.5 py-0.5 text-[11px] text-zinc-300">
      rep {reputation}
    </span>
  );
}

export function truncateForDisplay(value: string): string {
  return truncateMiddle(value, 12, 8);
}
