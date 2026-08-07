import { useMemo, useState } from 'react';

import type { TxEntropy } from '@chainwatch/shared';

import { satsToBtc } from '../lib/format';

interface MappingMatrixProps {
  entropy: TxEntropy;
  inputs: { address: string | null; valueSats: number }[];
  outputs: { address: string | null; valueSats: number }[];
}

/**
 * Colour carries the probability. Impossible links stay background-dark so the
 * eye reads structure rather than a uniform wash; certain links are called out
 * in amber because they are the ones that actually leak.
 */
function cellStyle(p: number): { className: string; opacity: number } {
  if (p <= 0) return { className: 'fill-zinc-950', opacity: 1 };
  if (p >= 1 - 1e-9) return { className: 'fill-amber-400', opacity: 1 };
  return { className: 'fill-sky-400', opacity: 0.12 + p * 0.75 };
}

const CELL = 16;
const GAP = 1;
const LEFT = 92;
const TOP = 74;

export function MappingMatrix({ entropy, inputs, outputs }: MappingMatrixProps) {
  const [hover, setHover] = useState<{ i: number; j: number } | null>(null);

  const stats = useMemo(() => {
    let impossible = 0;
    let certain = 0;
    let probable = 0;
    for (const row of entropy.linkProbability) {
      for (const p of row) {
        if (p <= 0) impossible++;
        else if (p >= 1 - 1e-9) certain++;
        else probable++;
      }
    }
    return { impossible, certain, probable, total: impossible + certain + probable };
  }, [entropy.linkProbability]);

  if (entropy.status !== 'ok' || entropy.linkProbability.length === 0) return null;

  const rows = entropy.linkProbability.length;
  const cols = entropy.linkProbability[0]?.length ?? 0;
  const width = LEFT + cols * (CELL + GAP) + 16;
  const height = TOP + rows * (CELL + GAP) + 44;

  return (
    <div>
      <p className="mb-2 text-xs leading-relaxed text-zinc-400">
        Every cell is one input-to-output pair. Dark means that pairing appears in{' '}
        <strong className="font-semibold text-zinc-300">no</strong> valid reading of this transaction;
        brighter blue means it appears in more of them; amber means it holds in{' '}
        <strong className="font-semibold text-amber-300">every</strong> reading and is therefore
        provable from the amounts alone.
      </p>

      <div className="mb-2 flex flex-wrap gap-3 text-[11px]">
        <span className="text-zinc-500">
          <span className="tnum font-mono text-zinc-200">{stats.impossible}</span> ruled out
        </span>
        <span className="text-zinc-500">
          <span className="tnum font-mono text-sky-300">{stats.probable}</span> possible
        </span>
        <span className="text-zinc-500">
          <span className="tnum font-mono text-amber-300">{stats.certain}</span> certain
        </span>
        <span className="text-zinc-600">of {stats.total} pairs</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/50 p-2">
        <svg width={width} height={height} className="select-none">
          <text x={4} y={14} className="fill-zinc-500 text-[9px] font-semibold tracking-widest">
            INPUTS ↓ / OUTPUTS →
          </text>

          {outputs.map((output, j) => (
            <g key={`oc${j}`}>
              <text
                x={LEFT + j * (CELL + GAP) + CELL / 2}
                y={TOP - 8}
                transform={`rotate(-90 ${LEFT + j * (CELL + GAP) + CELL / 2} ${TOP - 8})`}
                textAnchor="start"
                className={`font-mono text-[8px] ${hover?.j === j ? 'fill-sky-300' : 'fill-zinc-600'}`}
              >
                {satsToBtc(output.valueSats)}
              </text>
            </g>
          ))}

          {entropy.linkProbability.map((row, i) => (
            <g key={`r${i}`}>
              <text
                x={LEFT - 6}
                y={TOP + i * (CELL + GAP) + CELL - 4}
                textAnchor="end"
                className={`tnum font-mono text-[9px] ${hover?.i === i ? 'fill-sky-300' : 'fill-zinc-500'}`}
              >
                {satsToBtc(inputs[i]?.valueSats ?? 0)}
              </text>
              {row.map((p, j) => {
                const style = cellStyle(p);
                const lit = hover !== null && (hover.i === i || hover.j === j);
                return (
                  <rect
                    key={`c${i}-${j}`}
                    x={LEFT + j * (CELL + GAP)}
                    y={TOP + i * (CELL + GAP)}
                    width={CELL}
                    height={CELL}
                    rx={2}
                    className={style.className}
                    opacity={hover === null ? style.opacity : lit ? style.opacity : style.opacity * 0.35}
                    stroke={lit ? '#71717a' : undefined}
                    strokeWidth={lit ? 0.5 : 0}
                    onMouseEnter={() => setHover({ i, j })}
                    onMouseLeave={() => setHover(null)}
                  >
                    <title>
                      {`input ${i} (${satsToBtc(inputs[i]?.valueSats ?? 0)} BTC) → output ${j} (${satsToBtc(outputs[j]?.valueSats ?? 0)} BTC): ${
                        p <= 0 ? 'impossible' : p >= 1 - 1e-9 ? 'certain' : `${(p * 100).toFixed(1)}%`
                      }`}
                    </title>
                  </rect>
                );
              })}
            </g>
          ))}

          {/* p(I,o): the strongest link any single input has to each output */}
          <text
            x={LEFT - 6}
            y={TOP + rows * (CELL + GAP) + 16}
            textAnchor="end"
            className="fill-zinc-500 text-[8px] font-semibold tracking-wider"
          >
            STRONGEST
          </text>
          {entropy.outputLinkMax.map((strongest, j) => (
            <rect
              key={`m${j}`}
              x={LEFT + j * (CELL + GAP)}
              y={TOP + rows * (CELL + GAP) + 6}
              width={CELL}
              height={12}
              rx={2}
              className={strongest >= 1 - 1e-9 ? 'fill-amber-400' : 'fill-emerald-400'}
              opacity={strongest >= 1 - 1e-9 ? 1 : 0.15 + strongest * 0.7}
            >
              <title>{`output ${j}: strongest link to any single input is ${(strongest * 100).toFixed(1)}%`}</title>
            </rect>
          ))}
        </svg>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">
        The bar under each column is p(I,o) — the strongest link that output has to any single input.
        A full amber bar means the output is pinned to one input regardless of the mixing; short bars
        mean it is genuinely hidden among the others.
      </p>
    </div>
  );
}
