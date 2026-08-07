import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { Label } from '@chainwatch/shared';

import { formatCoins, truncateMiddle } from '../lib/format';

interface IoEntry {
  address: string | null;
  valueSats: number;
}

interface TxGraphProps {
  txid: string;
  inputs: IoEntry[];
  outputs: IoEntry[];
  labels: Label[];
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
const MIN_TX_H = 64;
const BAND_GAP = 4;

function columnGeometry(count: number): { boxes: BoxGeom[]; height: number } {
  const boxes: BoxGeom[] = [];
  let y = HEADER_H + PAD_Y;
  for (let i = 0; i < count; i++) {
    boxes.push({ y, h: ROW_H });
    y += ROW_H + ROW_GAP;
  }
  return { boxes, height: y - ROW_GAP + PAD_Y };
}

/** band thickness proportional to value, with a floor so dust stays visible */
function bandWidth(valueSats: number, totalSats: number): number {
  return 2 + (Math.max(valueSats, 0) / Math.max(totalSats, 1)) * 44;
}

/** y-center of each band's attachment slot on the tx box edge, stacked around the box center */
function edgeSlots(widths: number[], centerY: number): number[] {
  const total = widths.reduce((s, w) => s + w, 0) + BAND_GAP * Math.max(0, widths.length - 1);
  let y = centerY - total / 2;
  return widths.map((w) => {
    const c = y + w / 2;
    y += w + BAND_GAP;
    return c;
  });
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

export function TxGraph({ txid, inputs, outputs, labels }: TxGraphProps) {
  const navigate = useNavigate();
  const [trace, setTrace] = useState<Trace>({ kind: 'none' });

  const totalOut = Math.max(
    1,
    outputs.reduce((sum, o) => sum + o.valueSats, 0),
  );

  const inGeom = useMemo(() => columnGeometry(inputs.length), [inputs.length]);
  const outGeom = useMemo(() => columnGeometry(outputs.length), [outputs.length]);

  const inWidths = inputs.map((io) => bandWidth(io.valueSats, totalOut));
  const outWidths = outputs.map((io) => bandWidth(io.valueSats, totalOut));
  const stackH = (ws: number[]) => ws.reduce((s, w) => s + w, 0) + BAND_GAP * Math.max(0, ws.length - 1);
  const txH = Math.max(MIN_TX_H, stackH(inWidths) + 16, stackH(outWidths) + 16);
  const height = Math.max(inGeom.height, outGeom.height, HEADER_H + txH + 2 * PAD_Y);
  const txY = HEADER_H + PAD_Y + (height - HEADER_H - 2 * PAD_Y) / 2;
  const inSlots = edgeSlots(inWidths, txY);
  const outSlots = edgeSlots(outWidths, txY);

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
          {formatCoins(io.valueSats)}
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
    const width = side === 'in' ? inWidths[index] : outWidths[index];
    const { opacity, emphasized } = flowState(side, index);
    const known = side === 'out' || io.address !== null;

    let x1: number, y1: number, x2: number, y2: number;
    if (side === 'in') {
      x1 = COL_IN_X + COL_W;
      y1 = geom.y + geom.h / 2;
      x2 = COL_TX_X;
      y2 = inSlots[index];
    } else {
      x1 = COL_TX_X + COL_W;
      y1 = outSlots[index];
      x2 = COL_OUT_X;
      y2 = geom.y + geom.h / 2;
    }

    const label = (() => {
      if (trace.kind === 'in') {
        if (side === 'in' && trace.index === index) {
          return `${formatCoins(io.valueSats)} traced`;
        }
        if (side === 'out' && sharesValid) {
          const s = inputShare(trace.index, io.valueSats);
          return `≈ ${formatCoins(s)} · ${fmtShare(s / Math.max(io.valueSats, 1))} of this output`;
        }
      }
      if (trace.kind === 'out') {
        if (side === 'out' && trace.index === index) {
          return `${formatCoins(io.valueSats)} · ${fmtShare(share)} of total`;
        }
        if (side === 'in' && sharesValid) {
          const s = inputShare(index, outputs[trace.index].valueSats);
          return `≈ ${formatCoins(s)}`;
        }
      }
      return null;
    })();

    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    return (
      <g key={`flow-${side}-${index}`} style={{ transition: 'opacity 150ms' }}>
        <path
          d={flowPath(x1, y1, x2, y2)}
          fill="none"
          strokeWidth={width}
          strokeLinecap="butt"
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
        <span className="text-[11px] text-zinc-500">
          Hover or click a box to trace its flow. Sky outline = labeled address. Click an address to open its page.
        </span>
      </div>

      {trace.kind === 'in' && sharesValid && (
        <p className="mb-2 rounded border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-[11px] text-zinc-400">
          Proportional split (conservative lower bound): assumes this input's coins spread evenly across all outputs.
          Real attribution needs address clustering, which is out of MVP scope.
        </p>
      )}
      {trace.kind === 'in' && !sharesValid && (
        <p className="mb-2 rounded border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-[11px] text-zinc-400">
          Input addresses unknown (node without txindex). Flow tracing shows amounts only; proportional split
          unavailable.
        </p>
      )}

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

        <g>
          <rect
            x={COL_TX_X}
            y={txY - txH / 2}
            width={COL_W}
            height={txH}
            rx={9}
            className="fill-zinc-800 stroke-zinc-500"
          />
          <text
            x={COL_TX_X + COL_W / 2}
            y={txY - 6}
            textAnchor="middle"
            className="tnum fill-zinc-100 font-mono text-[13px] font-semibold"
          >
            {formatCoins(totalOut)}
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
