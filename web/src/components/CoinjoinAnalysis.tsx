import { useEffect, useState } from 'react';

import type { CoinjoinAnalysis as Analysis } from '@chainwatch/shared';

import { getCoinjoinAnalysis } from '../api/client';
import { satsToBtc, truncateMiddle } from '../lib/format';
import { MappingMatrix } from './MappingMatrix';

interface CoinjoinAnalysisProps {
  txid: string;
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

/**
 * What a coinjoin does and does not hide.
 *
 * Clustering across the inputs is invalid here by construction, so this reports
 * the mixing quality and the one thing that genuinely undoes it: participants
 * spending their mixed outputs together afterwards.
 */
export function CoinjoinAnalysis({ txid }: CoinjoinAnalysisProps) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setAnalysis(null);
    setFailed(false);
    getCoinjoinAnalysis(txid)
      .then((res) => {
        if (!cancelled) setAnalysis(res);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [txid]);

  if (failed) {
    return (
      <section className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/40 p-4">
        <h3 className="mb-1 text-xs font-semibold tracking-wider text-zinc-400">COINJOIN ANALYSIS</h3>
        <p className="text-xs text-zinc-500">
          The chain source could not be reached, so mixing quality could not be assessed.
        </p>
      </section>
    );
  }

  if (analysis === null) {
    return <div className="cw-pulse h-40 rounded-lg border border-zinc-800 bg-zinc-900/40" />;
  }

  const degraded = analysis.degradation > 0;
  const proven = analysis.linkages.length;

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold tracking-wider text-zinc-300">COINJOIN ANALYSIS</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
          {analysis.participants} parties · {analysis.inputCount} in / {analysis.outputCount} out
        </span>
        <span className={`ml-auto text-xs font-medium ${degraded ? 'text-amber-300' : 'text-emerald-300'}`}>
          {degraded ? `${Math.round(analysis.degradation * 100)}% of the anonymity set lost` : 'Anonymity set intact'}
        </span>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          value={satsToBtc(analysis.denominationSats)}
          label="denomination BTC"
          hint={`${analysis.equalOutputs} outputs share it`}
        />
        <Stat
          value={`${analysis.anonymitySet} → ${analysis.effectiveAnonymitySet}`}
          label="anonymity set"
          hint="indistinguishable outputs, then and now"
          tone={degraded ? 'text-amber-300' : 'text-emerald-300'}
        />
        <Stat
          value={String(proven)}
          label="proven links"
          hint="later spends that merged outputs of this join"
          tone={proven > 0 ? 'text-amber-300' : undefined}
        />
        <Stat
          value={String(analysis.spentMixedOutputs)}
          label="mixed outputs spent"
          hint={`of ${analysis.equalOutputs}`}
        />
      </div>

      <p className="mt-3 rounded border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs leading-relaxed text-sky-200/90">
        The inputs of this transaction are <strong className="font-semibold">not</strong> treated as one wallet.
        A coinjoin's inputs belong to different people by design, so the usual co-spend heuristic would invent a
        wallet spanning strangers — the mistake that makes naive clustering of coinjoins wrong more often than
        right.
      </p>

      {analysis.entropy.status === 'ok' ? (
        <div className="mt-4">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Input-to-output mappings
          </p>
          <p className="mb-2 text-xs leading-relaxed text-zinc-400">
            {analysis.entropy.combinations.toLocaleString(undefined, { maximumFractionDigits: 0 })} distinct
            readings of this transaction are consistent with its amounts — {analysis.entropy.entropy.toFixed(2)}{' '}
            bits of ambiguity, found by searching {analysis.entropy.states.toLocaleString()} value-class states.{' '}
            {analysis.entropy.entropy === 0 ? (
              <>
                <strong className="font-semibold text-amber-300">Only one reading exists</strong>, so this
                transaction provides no mixing at all despite its shape: the amounts admit a single grouping,
                and every pairing in it is forced.
              </>
            ) : analysis.entropy.deterministicLinks.length === 0 ? (
              <>No single link holds across all of them: nothing about who paid whom is forced by the amounts.</>
            ) : (
              <>
                <strong className="font-semibold text-amber-300">
                  {analysis.entropy.deterministicLinks.length} link
                  {analysis.entropy.deterministicLinks.length === 1 ? '' : 's'}
                </strong>{' '}
                hold in every one of them, so that much is provable despite the mixing.
              </>
            )}
          </p>
          <MappingMatrix
            entropy={analysis.entropy}
            inputs={analysis.inputValues.map((valueSats) => ({ address: null, valueSats }))}
            outputs={analysis.outputValues.map((valueSats) => ({ address: null, valueSats }))}
          />
        </div>
      ) : (
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">
          Enumerating every valid input-to-output mapping is out of reach here
          {analysis.entropy.reason ? ` (${analysis.entropy.reason})` : ''}, so no figure is claimed. Coins that
          all take different values cannot be grouped into interchangeable classes, and that irreducibility is
          itself the protection.
        </p>
      )}

      {!analysis.linkageAvailable ? (
        <p className="mt-3 text-xs text-zinc-500">
          Spend status could not be read, so post-mix linkage is unknown rather than absent.
        </p>
      ) : proven === 0 ? (
        <p className="mt-3 text-xs text-zinc-500">
          No two outputs of this join have been spent together yet. Consolidating them later is what undoes the
          mixing — it proves one party held both.
        </p>
      ) : (
        <div className="mt-3">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Post-mix consolidations — proven common ownership
          </p>
          <div className="overflow-hidden rounded border border-zinc-800">
            {analysis.linkages.slice(0, 6).map((link, i) => (
              <div
                key={link.spendTxid}
                className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 text-xs ${
                  i % 2 === 0 ? 'bg-zinc-900/60' : 'bg-zinc-900/30'
                }`}
              >
                <span className="font-mono text-zinc-400">{truncateMiddle(link.spendTxid, 12, 8)}</span>
                <span className="text-[10px] text-zinc-500">
                  merged outputs {link.outputs.join(', ')}
                </span>
                {link.denominatedOutputs >= 2 && (
                  <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                    shrinks the anonymity set
                  </span>
                )}
                <span className="tnum ml-auto font-mono text-zinc-300">
                  {satsToBtc(link.valueSats)} BTC
                </span>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-600">
            Each row is one later transaction that spent several of this join's outputs at once. Whoever signed
            it held every one of those keys, so those outputs share an owner — by the same co-spend logic that
            cannot be applied to the join itself. Only consolidations inside the equal-value group reduce the
            anonymity set; the rest prove ownership without shrinking it.
          </p>
        </div>
      )}
    </section>
  );
}
