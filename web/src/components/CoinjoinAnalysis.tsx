import { useEffect, useState, type ReactNode } from 'react';

import type { CoinjoinAnalysis as Analysis } from '@chainwatch/shared';

import { getCoinjoinAnalysis } from '../api/client';
import { satsToBtc, truncateMiddle } from '../lib/format';
import { InfoPopover } from './InfoPopover';
import { MappingMatrix } from './MappingMatrix';

interface CoinjoinAnalysisProps {
  txid: string;
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

/**
 * One sentence of plain-language verdict, so the panel says what it found
 * before it says how it knows.
 */
function verdict(analysis: Analysis): { line: string; tone: string } {
  const entropy = analysis.entropy;
  if (entropy.status === 'ok' && entropy.entropy === 0) {
    return {
      line: 'Looks like a coinjoin, but hides nothing — the amounts add up only one way.',
      tone: 'text-amber-300',
    };
  }
  if (analysis.degradation >= 0.5) {
    return {
      line: `Most of the mixing has been undone: ${Math.round(analysis.degradation * 100)}% of the crowd it hid in is gone.`,
      tone: 'text-amber-300',
    };
  }
  if (analysis.linkages.length > 0) {
    return {
      line: 'The mixing held, but some outputs were later spent together — proving they share an owner.',
      tone: 'text-sky-300',
    };
  }
  if (entropy.status === 'ok' && entropy.deterministicLinks.length > 0) {
    return {
      line: `The amounts force ${entropy.deterministicLinks.length} link${entropy.deterministicLinks.length === 1 ? '' : 's'}, so that much is provable despite the mixing.`,
      tone: 'text-sky-300',
    };
  }
  return {
    line: 'Mixing intact — nothing here can be pinned to a particular participant.',
    tone: 'text-emerald-300',
  };
}

export function CoinjoinAnalysis({ txid }: CoinjoinAnalysisProps) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [failed, setFailed] = useState(false);
  const [showMatrix, setShowMatrix] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setAnalysis(null);
    setFailed(false);
    setShowMatrix(false);
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
        <h3 className="mb-1 text-xs font-semibold tracking-wider text-zinc-400">COINJOIN</h3>
        <p className="text-xs text-zinc-500">Chain data unavailable, so mixing quality was not assessed.</p>
      </section>
    );
  }

  if (analysis === null) {
    return <div className="cw-pulse h-36 rounded-lg border border-zinc-800 bg-zinc-900/40" />;
  }

  const read = verdict(analysis);
  const proven = analysis.linkages.length;
  const entropy = analysis.entropy;

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold tracking-wider text-zinc-300">COINJOIN</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
          {analysis.participants} parties · {analysis.inputCount} in / {analysis.outputCount} out
        </span>
        <InfoPopover label="coinjoin">
          Several people sign one transaction together so an observer cannot tell whose coin went
          where. Because those inputs belong to different people on purpose, CoinWatch never treats
          them as one wallet — doing so is the most common mistake in chain analysis.
        </InfoPopover>
      </header>

      <p className={`mb-3 text-sm font-medium ${read.tone}`}>{read.line}</p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          value={`${analysis.anonymitySet} → ${analysis.effectiveAnonymitySet}`}
          label="hidden among"
          tone={analysis.degradation > 0 ? 'text-amber-300' : 'text-emerald-300'}
          info={
            <>
              How many outputs an observer cannot tell apart: first at the moment of mixing, then
              today. The number falls when participants later spend mixed outputs together, which
              re-identifies them.
            </>
          }
        />
        <Stat
          value={entropy.status === 'ok' ? entropy.entropy.toFixed(1) : '—'}
          label="bits of doubt"
          tone={entropy.status === 'ok' && entropy.entropy === 0 ? 'text-amber-300' : undefined}
          info={
            entropy.status === 'ok' ? (
              <>
                {entropy.combinations.toLocaleString(undefined, { maximumFractionDigits: 0 })} different
                readings of this transaction fit its amounts. More readings means more doubt about who
                paid whom; zero bits means only one reading exists and nothing is hidden.
              </>
            ) : (
              <>
                Scoring this needs every possible reading of the amounts enumerated, and there are too
                many to finish here{entropy.reason ? ` (${entropy.reason})` : ''}. That difficulty is
                itself part of the protection.
              </>
            )
          }
        />
        <Stat
          value={
            entropy.status !== 'ok'
              ? '—'
              : entropy.combinations <= 1
                ? 'all'
                : String(entropy.deterministicLinks.length)
          }
          label="forced links"
          tone={
            entropy.status === 'ok' && entropy.deterministicLinks.length > 0 ? 'text-amber-300' : undefined
          }
          info={
            entropy.status === 'ok' && entropy.combinations <= 1 ? (
              <>
                Only one reading of the amounts exists, so every pairing is trivially forced. That is a
                statement about the transaction admitting no alternative split — not about each
                individual payment having been traced.
              </>
            ) : (
              <>
                Pairings that put an input and an output in the same group in <em>every</em> reading of
                the amounts. Being in one group is weaker than "this coin paid that coin": the analysis
                never attributes value inside a group.
              </>
            )
          }
        />
        <Stat
          value={String(proven)}
          label="later merges"
          tone={proven > 0 ? 'text-amber-300' : undefined}
          info={
            <>
              Transactions that later spent several of this join's outputs at once. Signing for all of
              them proves one party held every key — the usual way participants undo their own mixing.
            </>
          }
        />
      </div>

      {proven > 0 && (
        <div className="mt-3 overflow-hidden rounded border border-zinc-800">
          {analysis.linkages.slice(0, 4).map((link, i) => (
            <div
              key={link.spendTxid}
              className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 text-xs ${
                i % 2 === 0 ? 'bg-zinc-900/60' : 'bg-zinc-900/30'
              }`}
            >
              <span className="font-mono text-zinc-400">{truncateMiddle(link.spendTxid, 10, 6)}</span>
              <span className="text-[10px] text-zinc-500">merged {link.outputs.length} outputs</span>
              {link.denominatedOutputs >= 2 && (
                <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                  cost anonymity
                </span>
              )}
              <span className="tnum ml-auto font-mono text-zinc-300">{satsToBtc(link.valueSats)} BTC</span>
            </div>
          ))}
        </div>
      )}

      {entropy.status === 'ok' && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowMatrix((v) => !v)}
            aria-expanded={showMatrix}
            className="flex items-center gap-1.5 text-[11px] font-medium text-sky-400 hover:text-sky-300"
          >
            <span className={`inline-block transition-transform ${showMatrix ? 'rotate-90' : ''}`}>›</span>
            {showMatrix ? 'Hide' : 'Show'} every possible pairing
          </button>
          {showMatrix && (
            <div className="mt-2">
              <MappingMatrix
                entropy={entropy}
                inputs={analysis.inputValues.map((valueSats) => ({ address: null, valueSats }))}
                outputs={analysis.outputValues.map((valueSats) => ({ address: null, valueSats }))}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
