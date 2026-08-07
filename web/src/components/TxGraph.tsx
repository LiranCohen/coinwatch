import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { Label } from '@chainwatch/shared';

import { satsToBtc, truncateMiddle } from '../lib/format';
import { InfoPopover } from './InfoPopover';

interface IoEntry {
  address: string | null;
  valueSats: number;
}

/** A candidate input-to-output link surfaced by the entropy analysis. */
export interface FlowLink {
  inputIndex: number;
  outputIndex: number;
  /** P(this input funded this output) across all valid interpretations */
  probability: number;
  /** true when the link holds in every interpretation */
  certain: boolean;
}

interface TxGraphProps {
  txid: string;
  inputs: IoEntry[];
  outputs: IoEntry[];
  labels: Label[];
  links?: FlowLink[];
}

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

/** halo behind floating labels so they never collide with bands or boxes */
const LABEL_HALO = {
  paintOrder: 'stroke',
  stroke: '#09090b',
  strokeWidth: 5,
  strokeLinejoin: 'round',
} as const;

/**
 * Value flow, with hue reserved for meaning.
 *
 * The bands carry value only, so they stay neutral — which side a coin is on is
 * already obvious from the layout. Colour is spent entirely on what the entropy
 * analysis found: amber where a link is provable, blue where it is merely
 * possible. That is the same coding the mapping matrix uses, so the two read as
 * one system rather than two palettes.
 */
export function TxGraph({ txid, inputs, outputs, labels, links = [] }: TxGraphProps) {
  const navigate = useNavigate();
  const [focus, setFocus] = useState<{ side: 'in' | 'out'; index: number } | null>(null);

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

  const certainCount = links.filter((link) => link.certain).length;

  /** a box is dimmed when something else is focused */
  const dim = (side: 'in' | 'out', index: number): boolean =>
    focus !== null && !(focus.side === side && focus.index === index);

  const renderBox = (io: IoEntry, geom: BoxGeom, side: 'in' | 'out', index: number) => {
    const x = side === 'in' ? COL_IN_X : COL_OUT_X;
    const entryLabels = io.address ? (labelByAddress.get(io.address) ?? []) : [];
    const labeled = entryLabels.length > 0;
    const active = focus?.side === side && focus.index === index;

    return (
      <g
        key={`${side}-${index}`}
        opacity={dim(side, index) ? 0.4 : 1}
        style={{ transition: 'opacity 120ms', cursor: io.address ? 'pointer' : 'default' }}
        onMouseEnter={() => setFocus({ side, index })}
        onMouseLeave={() => setFocus(null)}
      >
        <title>{io.address ?? 'no address'}</title>
        <rect
          x={x}
          y={geom.y}
          width={COL_W}
          height={geom.h}
          rx={7}
          className={labeled ? 'fill-sky-500/10 stroke-sky-500/50' : 'fill-zinc-900 stroke-zinc-700'}
          strokeWidth={active ? 2 : 1}
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
    const active = focus?.side === side && focus.index === index;
    const faded = focus !== null && !active;

    const [x1, y1, x2, y2] =
      side === 'in'
        ? [COL_IN_X + COL_W, geom.y + geom.h / 2, COL_TX_X, txY]
        : [COL_TX_X + COL_W, txY, COL_OUT_X, geom.y + geom.h / 2];

    return (
      <g key={`flow-${side}-${index}`} style={{ pointerEvents: 'none', transition: 'opacity 120ms' }}>
        <path
          d={flowPath(x1, y1, x2, y2)}
          fill="none"
          strokeWidth={width}
          strokeLinecap="round"
          className={active ? 'stroke-zinc-200' : 'stroke-zinc-600'}
          opacity={faded ? 0.15 : active ? 0.9 : 0.5}
        />
        {active && (
          <text
            x={(x1 + x2) / 2}
            y={Math.max(24, (y1 + y2) / 2 - width / 2 - 6)}
            textAnchor="middle"
            className="tnum fill-zinc-100 font-mono text-[10px]"
            style={LABEL_HALO}
          >
            {satsToBtc(io.valueSats)} BTC
          </text>
        )}
      </g>
    );
  };

  /** only the focused coin's links are drawn: at rest they are a hairball, on demand they are an answer */
  const visibleLinks = useMemo(() => {
    if (focus === null) return [];
    return links.filter((link) =>
      focus.side === 'in' ? link.inputIndex === focus.index : link.outputIndex === focus.index,
    );
  }, [links, focus]);

  const renderLink = (link: FlowLink, i: number) => {
    const inBox = inGeom.boxes[link.inputIndex];
    const outBox = outGeom.boxes[link.outputIndex];
    if (!inBox || !outBox) return null;
    const x1 = COL_IN_X + COL_W;
    const y1 = inBox.y + inBox.h / 2;
    const x2 = COL_OUT_X;
    const y2 = outBox.y + outBox.h / 2;
    const lift = 22 + (i % 5) * 9;

    return (
      <g key={`link-${i}`} style={{ pointerEvents: 'none' }}>
        <path
          d={`M ${x1} ${y1} C ${x1 + 240} ${y1 - lift}, ${x2 - 240} ${y2 - lift}, ${x2} ${y2}`}
          fill="none"
          strokeWidth={2}
          strokeDasharray={link.certain ? undefined : '6 5'}
          strokeLinecap="round"
          className={link.certain ? 'stroke-amber-400' : 'stroke-sky-400'}
        />
        <text
          x={(x1 + x2) / 2}
          y={(y1 + y2) / 2 - lift * 0.72}
          textAnchor="middle"
          className={`tnum font-mono text-[10px] ${link.certain ? 'fill-amber-300' : 'fill-sky-300'}`}
          style={LABEL_HALO}
        >
          {link.certain ? 'certain' : `${Math.round(link.probability * 100)}%`}
        </text>
      </g>
    );
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <span className="text-zinc-400">
          Hover a coin to follow it
          {links.length > 0 && ' and see where it could have gone'}.
        </span>
        {certainCount > 0 && (
          <span className="flex items-center gap-1.5 text-zinc-500">
            <svg width="16" height="6" aria-hidden>
              <line x1="0" y1="3" x2="16" y2="3" strokeWidth="2" className="stroke-amber-400" />
            </svg>
            <span className="text-amber-300">{certainCount}</span> provable link
            {certainCount === 1 ? '' : 's'}
            <InfoPopover label="provable links">
              Every way this transaction's amounts could add up was worked out. An{' '}
              <span className="text-amber-300">amber</span> line means that input funded that output in{' '}
              <em>every</em> one of those readings, so it is provable from the chain alone. A{' '}
              <span className="text-sky-300">dashed blue</span> line fits some readings but not all,
              and the percentage is how many. Pairings that fit none are never drawn.
            </InfoPopover>
          </span>
        )}
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
        {visibleLinks.map(renderLink)}

        <g style={{ pointerEvents: 'none' }}>
          <rect
            x={COL_TX_X}
            y={txY - TX_H / 2}
            width={COL_W}
            height={TX_H}
            rx={9}
            className="fill-zinc-800 stroke-zinc-600"
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
          <text x={COL_TX_X + COL_W / 2} y={txY + 23} textAnchor="middle" className="fill-zinc-500 text-[9px]">
            {inputs.length} in → {outputs.length} out
          </text>
        </g>

        {inputs.map((io, i) => renderBox(io, inGeom.boxes[i], 'in', i))}
        {outputs.map((io, i) => renderBox(io, outGeom.boxes[i], 'out', i))}
      </svg>
    </div>
  );
}
