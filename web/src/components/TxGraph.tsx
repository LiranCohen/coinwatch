import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { Label } from '@chainwatch/shared';

import { satsToBtc, truncateMiddle } from '../lib/format';
import type { LinkGuess } from '../lib/demoFlow';

interface IoEntry {
  address: string | null;
  valueSats: number;
}

interface TxGraphProps {
  txid: string;
  inputs: IoEntry[];
  outputs: IoEntry[];
  labels: Label[];
  links?: LinkGuess[];
}

type Trace =
  | { kind: 'none' }
  | { kind: 'in'; index: number }
  | { kind: 'out'; index: number }
  | { kind: 'all' };

interface BoxGeom {
  y: number;
  h: number;
}

const ROW_H = 54;
const ROW_GAP = 12;
const PAD_Y = 12;
const HEADER_H = 22;
const WIDTH = 1000;
const COL_IN_X = 0;
const COL_TX_X = 430;
const COL_OUT_X = 860;
const COL_W = 140;
const TX_H = 64;

function columnGeometry(count: number): { boxes: BoxGeom[]; height: number } {
  const boxes: BoxGeom[] = [];
  let y = HEADER_H + PAD_Y;
  for (let i = 0; i < count; i++) {
    boxes.push({ y, h: ROW_H });
    y += ROW_H + ROW_GAP;
  }
  return { boxes, height: y - ROW_GAP + PAD_Y };
}

function flowPath(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

function fmtShare(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

/** halo behind floating labels so they never collide with bands or boxes */
const LABEL_HALO = {
  paintOrder: 'stroke',
  stroke: '#09090b',
  strokeWidth: 5,
  strokeLinejoin: 'round',
} as const;

export function TxGraph({ txid, inputs, outputs, labels, links = [] }: TxGraphProps) {
  const navigate = useNavigate();
  const [trace, setTrace] = useState<Trace>({ kind: 'none' });
  const [showGuesses, setShowGuesses] = useState(true);

  const totalOut = Math.max(
    1,
    outputs.reduce((sum, o) => sum + o.valueSats, 0),
  );

  const inGeom = useMemo(() => columnGeometry(inputs.length), [inputs.length]);
  const outGeom = useMemo(() => columnGeometry(outputs.length), [outputs.length]);
  const height = Math.max(inGeom.height, outGeom.height, HEADER_H + TX_H + 2 * PAD_Y);
  const txY = height / 2;

  const labelByAddress = useMemo(() => {
    const map = new Map<string, Label[]>();
    for (const label of labels) {
      const list = map.get(label.address) ?? [];
      list.push(label);
      map.set(label.address, list);
    }
    return map;
  }, [labels]);

  const inputKnown = inputs.map((io) => io.address !== null);
  const anyInputUnknown = inputKnown.some((k) => !k);
  const sharesValid = !anyInputUnknown && inputs.length > 0 && outputs.length > 0;

  const inputShare = (index: number, of: number): number => {
    if (!sharesValid) return 0;
    const contributed = inputs[index].valueSats * of;
    return contributed / totalOut;
  };

  const dimmed = (side: 'in' | 'out', index: number): boolean => {
    if (trace.kind === 'none' || trace.kind === 'all') return false;
    if (trace.kind === 'in') return side === 'in' && trace.index !== index;
    return side === 'out' && trace.index !== index;
  };

  const flowState = (
    side: 'in' | 'out',
    index: number,
  ): { opacity: number; emphasized: boolean } => {
    if (trace.kind === 'none') return { opacity: 0.35, emphasized: false };
    if (trace.kind === 'all') return { opacity: 0.85, emphasized: true };
    if (trace.kind === 'in') {
      return side === 'in'
        ? trace.index === index
          ? { opacity: 0.95, emphasized: true }
          : { opacity: 0.06, emphasized: false }
        : { opacity: 0.85, emphasized: true };
    }
    return side === 'out'
      ? trace.index === index
        ? { opacity: 0.95, emphasized: true }
        : { opacity: 0.06, emphasized: false }
      : { opacity: 0.85, emphasized: true };
  };

  const toggle = (next: Trace) =>
    setTrace((current) => (current.kind === next.kind && JSON.stringify(current) === JSON.stringify(next) ? { kind: 'none' } : next));

  const renderBox = (
    io: IoEntry,
    geom: BoxGeom,
    side: 'in' | 'out',
    index: number,
  ) => {
    const x = side === 'in' ? COL_IN_X : COL_OUT_X;
    const entryLabels = io.address ? (labelByAddress.get(io.address) ?? []) : [];
    const labeled = entryLabels.length > 0;
    const active =
      (trace.kind === 'in' && side === 'in' && trace.index === index) ||
      (trace.kind === 'out' && side === 'out' && trace.index === index);
    const clickable = io.address !== null;

    return (
      <g
        key={`${side}-${index}`}
        opacity={dimmed(side, index) ? 0.35 : 1}
        style={{ transition: 'opacity 150ms', cursor: clickable ? 'pointer' : 'default' }}
        onMouseEnter={() =>
          setTrace(side === 'in' ? { kind: 'in', index } : { kind: 'out', index })
        }
        onMouseLeave={() => setTrace({ kind: 'none' })}
        onClick={(e) => {
          e.stopPropagation();
          toggle(side === 'in' ? { kind: 'in', index } : { kind: 'out', index });
        }}
      >
        <title>
          {io.address ?? 'no address'}. Click to pin/unpin the trace, hover to preview
        </title>
        <rect
          x={x}
          y={geom.y}
          width={COL_W}
          height={geom.h}
          rx={7}
          className={`${
            labeled
              ? 'fill-sky-500/10 stroke-sky-400'
              : 'fill-zinc-900 stroke-zinc-700'
          } ${active ? 'stroke-2' : ''}`}
          style={active ? { stroke: '#e4e4e7' } : undefined}
        />
        {io.address ? (
          <text
            x={x + 10}
            y={geom.y + 18}
            className="cursor-pointer fill-sky-400 font-mono text-[11px] hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/app/address/${io.address}`);
            }}
          >
            {truncateMiddle(io.address, 9, 6)}
          </text>
        ) : (
          <text x={x + 10} y={geom.y + 18} className="fill-zinc-600 font-mono text-[11px] italic">
            n/a
          </text>
        )}
        <text x={x + 10} y={geom.y + 36} className="tnum fill-zinc-200 font-mono text-[12px]">
          {satsToBtc(io.valueSats)}
          <tspan className="fill-zinc-500 text-[10px]"> BTC</tspan>
        </text>
        {labeled && (
          <text x={x + 10} y={geom.y + geom.h - 5} className="fill-sky-300 text-[9px]">
            {entryLabels[0].tag}
            {entryLabels.length > 1 ? ` +${entryLabels.length - 1}` : ''}
          </text>
        )}
      </g>
    );
  };

  const renderFlow = (io: IoEntry, geom: BoxGeom, side: 'in' | 'out', index: number) => {
    const share = io.valueSats / totalOut;
    const width = 1.5 + Math.sqrt(Math.max(share, 0.001)) * 22;
    const { opacity, emphasized } = flowState(side, index);
    const known = side === 'out' || io.address !== null;

    let x1: number, y1: number, x2: number, y2: number;
    if (side === 'in') {
      x1 = COL_IN_X + COL_W;
      y1 = geom.y + geom.h / 2;
      x2 = COL_TX_X;
      y2 = txY;
    } else {
      x1 = COL_TX_X + COL_W;
      y1 = txY;
      x2 = COL_OUT_X;
      y2 = geom.y + geom.h / 2;
    }

    const label = (() => {
      if (trace.kind === 'in') {
        if (side === 'in' && trace.index === index) {
          return `${satsToBtc(io.valueSats)} BTC traced`;
        }
        if (side === 'out' && sharesValid) {
          const s = inputShare(trace.index, io.valueSats);
          return `≈ ${satsToBtc(s)} BTC · ${fmtShare(s / Math.max(io.valueSats, 1))} of this output`;
        }
      }
      if (trace.kind === 'out') {
        if (side === 'out' && trace.index === index) {
          return `${satsToBtc(io.valueSats)} BTC · ${fmtShare(share)} of total`;
        }
        if (side === 'in' && sharesValid) {
          const s = inputShare(index, outputs[trace.index].valueSats);
          return `≈ ${satsToBtc(s)} BTC`;
        }
      }
      return null;
    })();

    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    return (
      <g key={`flow-${side}-${index}`} style={{ transition: 'opacity 150ms', pointerEvents: 'none' }}>
        <path
          d={flowPath(x1, y1, x2, y2)}
          fill="none"
          strokeWidth={width}
          strokeLinecap="round"
          className={
            emphasized
              ? 'stroke-sky-400'
              : known
                ? side === 'in'
                  ? 'stroke-rose-400/80'
                  : 'stroke-emerald-400/80'
                : 'stroke-zinc-600'
          }
          strokeDasharray={known ? undefined : '5 5'}
          opacity={opacity}
          style={{ transition: 'opacity 150ms, stroke-width 150ms' }}
        />
        {label && (
          <text
            x={midX}
            y={Math.max(28, midY - width / 2 - 6)}
            textAnchor="middle"
            className="tnum fill-sky-200 font-mono text-[10px]"
            style={LABEL_HALO}
          >
            {label}
          </text>
        )}
      </g>
    );
  };

  const renderGuess = (link: LinkGuess, i: number) => {
    const inBox = inGeom.boxes[link.inputIndex];
    const outBox = outGeom.boxes[link.outputIndex];
    if (!inBox || !outBox) return null;
    const x1 = COL_IN_X + COL_W;
    const y1 = inBox.y + inBox.h / 2;
    const x2 = COL_OUT_X;
    const y2 = outBox.y + outBox.h / 2;
    const lift = 26 + (i % 4) * 10;
    const involved =
      (trace.kind === 'in' && trace.index === link.inputIndex) ||
      (trace.kind === 'out' && trace.index === link.outputIndex);
    const faded = trace.kind !== 'none' && trace.kind !== 'all' && !involved;
    const midY = (y1 + y2) / 2 - lift * 0.72;
    return (
      <g
        key={`guess-${i}`}
        opacity={faded ? 0.08 : involved ? 1 : 0.55}
        style={{ transition: 'opacity 150ms', pointerEvents: 'none' }}
      >
        <path
          d={`M ${x1} ${y1} C ${x1 + 240} ${y1 - lift}, ${x2 - 240} ${y2 - lift}, ${x2} ${y2}`}
          fill="none"
          strokeWidth={involved ? 2.5 : 1.5}
          strokeDasharray="6 5"
          strokeLinecap="round"
          className="stroke-amber-400"
        />
        <circle cx={x2 - 4} cy={y2} r={involved ? 4 : 3} className="fill-amber-400" />
        <text
          x={(x1 + x2) / 2}
          y={midY}
          textAnchor="middle"
          className="tnum fill-amber-300 font-mono text-[10px]"
          style={LABEL_HALO}
        >
          {involved ? `suspected ${link.reason} · ${Math.round(link.confidence * 100)}%` : `${Math.round(link.confidence * 100)}%`}
        </text>
      </g>
    );
  };

  return (
    <div onClick={() => setTrace({ kind: 'none' })}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded border border-zinc-700 text-[11px]">
          <button
            type="button"
            className={`px-2.5 py-1 ${trace.kind === 'none' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800'}`}
            onClick={(e) => {
              e.stopPropagation();
              setTrace({ kind: 'none' });
            }}
          >
            Off
          </button>
          <button
            type="button"
            className={`px-2.5 py-1 ${trace.kind === 'all' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800'}`}
            onClick={(e) => {
              e.stopPropagation();
              toggle({ kind: 'all' });
            }}
          >
            Trace all
          </button>
        </div>
        {links.length > 0 && (
          <button
            type="button"
            className={`rounded border px-2.5 py-1 text-[11px] ${showGuesses ? 'border-amber-400/50 bg-amber-400/10 text-amber-300' : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'}`}
            onClick={(e) => {
              e.stopPropagation();
              setShowGuesses((s) => !s);
            }}
          >
            Suspected links ({links.length})
          </button>
        )}
        <span className="text-[11px] text-zinc-500">
          Hover or click a box to trace its flow. Sky outline = labeled address.
          {links.length > 0 && ' Amber dashes = heuristic input↔output guesses.'}
        </span>
      </div>

      {/* fixed-height slot: swapping the banner in/out must not shift the svg below (hover flicker) */}
      <div className="mb-2 h-[30px]">
        <p
          className={`truncate rounded border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-[11px] text-zinc-400 ${trace.kind === 'in' ? 'visible' : 'invisible'}`}
        >
          {sharesValid
            ? "Proportional split (conservative lower bound): assumes this input's coins spread evenly across all outputs."
            : 'Input addresses unknown (node without txindex). Flow tracing shows amounts only.'}
        </p>
      </div>

      <svg viewBox={`0 0 ${WIDTH} ${height}`} className="w-full select-none">
        <text x={COL_IN_X} y={14} className="fill-zinc-500 text-[10px] font-semibold tracking-widest">
          INPUTS ({inputs.length})
        </text>
        <text x={COL_TX_X} y={14} className="fill-zinc-500 text-[10px] font-semibold tracking-widest">
          TRANSACTION
        </text>
        <text x={COL_OUT_X} y={14} className="fill-zinc-500 text-[10px] font-semibold tracking-widest">
          OUTPUTS ({outputs.length})
        </text>

        {inputs.map((io, i) => renderFlow(io, inGeom.boxes[i], 'in', i))}
        {outputs.map((io, i) => renderFlow(io, outGeom.boxes[i], 'out', i))}
        {showGuesses && links.map(renderGuess)}

        <g>
          <rect
            x={COL_TX_X}
            y={txY - TX_H / 2}
            width={COL_W}
            height={TX_H}
            rx={9}
            className="fill-zinc-800 stroke-zinc-500"
          />
          <text
            x={COL_TX_X + COL_W / 2}
            y={txY - 6}
            textAnchor="middle"
            className="tnum fill-zinc-100 font-mono text-[13px] font-semibold"
          >
            {satsToBtc(totalOut)} BTC
          </text>
          <text
            x={COL_TX_X + COL_W / 2}
            y={txY + 10}
            textAnchor="middle"
            className="fill-zinc-400 font-mono text-[9px]"
          >
            {truncateMiddle(txid, 8, 6)}
          </text>
          <text
            x={COL_TX_X + COL_W / 2}
            y={txY + 23}
            textAnchor="middle"
            className="fill-zinc-500 text-[9px]"
          >
            {inputs.length} in → {outputs.length} out
          </text>
        </g>

        {inputs.map((io, i) => renderBox(io, inGeom.boxes[i], 'in', i))}
        {outputs.map((io, i) => renderBox(io, outGeom.boxes[i], 'out', i))}
      </svg>
    </div>
  );
}
