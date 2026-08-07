import type { TxEntropy } from '@chainwatch/shared';

interface EntropyPanelProps {
  entropy: TxEntropy;
  nbInputs: number;
  nbOutputs: number;
}

function Stat({ value, label, hint, tone }: { value: string; label: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2">
      <p className={`tnum font-mono text-lg font-semibold ${tone ?? 'text-zinc-100'}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
      {hint && <p className="mt-0.5 text-[10px] leading-tight text-zinc-600">{hint}</p>}
    </div>
  );
}

/** Plain-language reading of the entropy score, so the number means something. */
function verdict(entropy: TxEntropy, totalLinks: number): { headline: string; detail: string; tone: string } {
  const certain = entropy.deterministicLinks.length;
  if (entropy.entropy === 0) {
    return {
      headline: 'Fully transparent',
      detail:
        'Only one reading of this transaction is possible, so every input-to-output link is certain. Anyone watching the chain can reconstruct exactly where the money went.',
      tone: 'text-amber-300',
    };
  }
  if (certain === 0) {
    return {
      headline: 'No certain links',
      detail: `${entropy.combinations.toLocaleString()} readings of this transaction are equally valid, and no single input can be pinned to any output.`,
      tone: 'text-emerald-300',
    };
  }
  return {
    headline: 'Partially ambiguous',
    detail: `${entropy.combinations.toLocaleString()} readings are possible, but ${certain} of ${totalLinks} possible links hold in every one of them — those are provable.`,
    tone: 'text-sky-300',
  };
}

/**
 * Boltzmann entropy for a single transaction: how much ambiguity it actually
 * offers an observer, and which links survive that ambiguity.
 */
export function EntropyPanel({ entropy, nbInputs, nbOutputs }: EntropyPanelProps) {
  if (entropy.status !== 'ok') {
    return (
      <section className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/40 p-4">
        <header className="mb-1.5 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold tracking-wider text-zinc-400">PRIVACY ANALYSIS</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
            not run
          </span>
        </header>
        <p className="text-sm text-zinc-400">
          {entropy.status === 'aborted'
            ? 'This transaction is too tangled to enumerate exhaustively within the search budget.'
            : 'Exact entropy analysis was declined for this transaction.'}
          {entropy.reason && <span className="text-zinc-500"> ({entropy.reason})</span>}
        </p>
        {entropy.maxEntropy > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat
              value={entropy.maxEntropy.toFixed(1)}
              label="bits — ceiling"
              hint="if this shape were mixed perfectly"
              tone="text-sky-300"
            />
            <Stat value={`${nbInputs} → ${nbOutputs}`} label="inputs → outputs" />
          </div>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">
          Counting interpretations exactly is exponential in transaction size, so beyond a bound we report the
          ceiling for this transaction's shape rather than publishing a guess at its actual entropy.
        </p>
      </section>
    );
  }

  const totalLinks = nbInputs * nbOutputs;
  const read = verdict(entropy, totalLinks);

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold tracking-wider text-zinc-300">PRIVACY ANALYSIS</span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
          boltzmann entropy
        </span>
        <span className={`ml-auto text-xs font-medium ${read.tone}`}>{read.headline}</span>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          value={`${entropy.entropy.toFixed(2)}`}
          label="bits of entropy"
          hint={entropy.maxEntropy > 0 ? `${entropy.maxEntropy.toFixed(2)} possible for this shape` : undefined}
          tone={read.tone}
        />
        <Stat
          value={entropy.combinations.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          label="interpretations"
          hint="ways to map inputs to outputs"
        />
        <Stat
          value={`${(entropy.efficiency * 100).toFixed(0)}%`}
          label="efficiency"
          hint="vs. a perfect coinjoin of the same shape"
        />
        <Stat
          value={`${entropy.deterministicLinks.length}/${totalLinks}`}
          label="certain links"
          hint="hold in every interpretation"
        />
      </div>

      <p className="mt-3 text-sm leading-relaxed text-zinc-300">{read.detail}</p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-600">
        Entropy counts how many distinct input-to-output mappings are consistent with this transaction's amounts.
        A link that holds across all of them is provable from the chain alone; the rest are only probable, and the
        flow graph above shows those probabilities.
      </p>
    </section>
  );
}
