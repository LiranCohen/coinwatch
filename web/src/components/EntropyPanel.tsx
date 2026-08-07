import type { ReactNode } from 'react';

import type { TxEntropy } from '@chainwatch/shared';

import { InfoPopover } from './InfoPopover';

interface EntropyPanelProps {
  entropy: TxEntropy;
  nbInputs: number;
  nbOutputs: number;
}

function Stat({
  value,
  label,
  tone,
  info,
}: {
  value: string;
  label: string;
  tone?: string;
  info?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2">
      <p className={`tnum font-mono text-lg font-semibold ${tone ?? 'text-zinc-100'}`}>{value}</p>
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
        {info && <InfoPopover label={label}>{info}</InfoPopover>}
      </p>
    </div>
  );
}

/** Plain-language reading, so the panel leads with what it found. */
function verdict(entropy: TxEntropy, totalLinks: number): { line: string; tone: string } {
  const certain = entropy.deterministicLinks.length;
  if (entropy.entropy === 0) {
    return {
      line: 'Fully traceable — there is only one way to read this transaction, so every payment in it is visible.',
      tone: 'text-amber-300',
    };
  }
  if (certain === 0) {
    return {
      line: 'Nothing provable — no input can be pinned to any output.',
      tone: 'text-emerald-300',
    };
  }
  return {
    line: `Partly traceable — ${certain} of ${totalLinks} possible pairings hold no matter how you read it.`,
    tone: 'text-sky-300',
  };
}

/**
 * How much this transaction gives away, for transactions that are not coinjoins.
 * Coinjoins get their own panel, which reports the same measure alongside the
 * mixing-specific findings.
 */
export function EntropyPanel({ entropy, nbInputs, nbOutputs }: EntropyPanelProps) {
  if (entropy.status !== 'ok') {
    return (
      <section className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/40 p-4">
        <header className="mb-1 flex flex-wrap items-center gap-2">
          <h3 className="text-xs font-semibold tracking-wider text-zinc-400">TRACEABILITY</h3>
          <InfoPopover label="why this was not scored">
            Scoring needs every possible reading of the amounts enumerated, which grows out of hand for
            transactions whose coins all take different values
            {entropy.reason ? ` (${entropy.reason})` : ''}. Rather than publish a guess, nothing is
            claimed — and that difficulty is itself part of the protection.
          </InfoPopover>
        </header>
        <p className="text-sm text-zinc-400">Not scored for this transaction.</p>
      </section>
    );
  }

  const totalLinks = nbInputs * nbOutputs;
  const read = verdict(entropy, totalLinks);

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold tracking-wider text-zinc-300">TRACEABILITY</h3>
        <InfoPopover label="traceability">
          Every way this transaction's amounts could add up was worked out. If only one reading fits,
          the payments are plain to see. If many fit, an observer cannot tell which one actually
          happened.
        </InfoPopover>
      </header>

      <p className={`mb-3 text-sm font-medium ${read.tone}`}>{read.line}</p>

      <div className="grid grid-cols-3 gap-2">
        <Stat
          value={entropy.entropy.toFixed(1)}
          label="bits of doubt"
          tone={entropy.entropy === 0 ? 'text-amber-300' : undefined}
          info={
            <>
              {entropy.combinations.toLocaleString(undefined, { maximumFractionDigits: 0 })} different
              readings fit these amounts. Zero bits means exactly one fits, and nothing is hidden.
            </>
          }
        />
        <Stat
          value={`${entropy.deterministicLinks.length}/${totalLinks}`}
          label="forced links"
          tone={entropy.deterministicLinks.length > 0 ? 'text-amber-300' : 'text-emerald-300'}
          info={
            <>
              Input-to-output pairings that hold in <em>every</em> reading, and are therefore provable
              from the chain alone.
            </>
          }
        />
        <Stat
          value={`${Math.round(entropy.efficiency * 100)}%`}
          label="of best possible"
          info={
            <>
              How close this transaction comes to the most private one that could be built with the
              same number of inputs and outputs. An ordinary payment scores high simply because little
              better is possible at that shape.
            </>
          }
        />
      </div>
    </section>
  );
}
