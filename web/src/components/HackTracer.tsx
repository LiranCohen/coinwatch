import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { Hack, Label } from '@chainwatch/shared';

import { satsToBtc, truncateMiddle } from '../lib/format';

interface HackTracerProps {
  hack: Hack;
  /** the event currently open in the detail pane, marked on its hop */
  currentEventId?: string;
  labels?: Label[];
  onOpenEvent?: (eventId: string) => void;
}

type Trace =
  | { kind: 'none' }
  | { kind: 'path' }
  | { kind: 'hop'; index: number }
  | { kind: 'side'; hop: number; index: number };

const HOP_W = 150;
const HOP_H = 64;
const SIDE_H = 44;
const SIDE_GAP = 10;
const TOP_PAD = 60;
const COL_SPAN = 270;
const IN_X = 0;
const BOX_W = 140;

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

export function HackTracer({ hack, currentEventId, labels = [], onOpenEvent }: HackTracerProps) {
  const navigate = useNavigate();
  const [trace, setTrace] = useState<Trace>({ kind: 'none' });

  const hops = hack.hops;
  const n = hops.length;
  const total = Math.max(1, hack.totalSats);

  const labelByAddress = useMemo(() => {
    const map = new Map<string, Label[]>();
    for (const label of labels) {
      const list = map.get(label.address) ?? [];
      list.push(label);
      map.set(label.address, list);
    }
    return map;
  }, [labels]);

  const hopX = (i: number) => 230 + i * COL_SPAN;
  const terminalX = 230 + n * COL_SPAN;
  const width = terminalX + BOX_W + 20;

  /** side outputs per hop: everything that is not the carried (largest) output */
  const sideOutputs = useMemo(
    () =>
      hops.map((hop) => {
        const carried = hop.outputs.reduce((best, o) => (o.valueSats > best.valueSats ? o : best), hop.outputs[0]);
        return hop.outputs.filter((o) => o !== carried);
      }),
    [hops],
  );

  const maxSide = sideOutputs.reduce((m, s) => Math.max(m, s.length), 0);
  // origin/terminal columns fan out ±26px per entry around cy; grow the canvas
  // instead of clipping when a hack has many victim wallets
  const maxEnds = Math.max(hops[0].inputs.length, hops[n - 1].outputs.length);
  const cy = Math.max(TOP_PAD, 34 + (maxEnds - 1) * 26);
  const height = Math.max(
    cy + HOP_H / 2 + 40,
    cy + (maxEnds - 1) * 26 + 40,
    cy + HOP_H / 2 + 24 + (maxSide > 0 ? maxSide * (SIDE_H + SIDE_GAP) + 20 : 0),
    TOP_PAD,
  );

  const pathActive = trace.kind !== 'none' && trace.kind !== 'side';
  const sideEmphasized = (hop: number, index: number) =>
    trace.kind === 'side' && trace.hop === hop && trace.index === index;
  const sideDimmed = (hop: number, index: number) =>
    (pathActive && !sideEmphasized(hop, index)) ||
    (trace.kind === 'side' && !sideEmphasized(hop, index));

  const toggle = (next: Trace) =>
    setTrace((current) =>
      JSON.stringify(current) === JSON.stringify(next) ? { kind: 'none' } : next,
    );

  const bandWidth = (sats: number) => 1.5 + Math.sqrt(Math.max(sats / total, 0.001)) * 22;

  const renderHop = (i: number) => {
    const hop = hops[i];
    const x = hopX(i);
    const isCurrent = currentEventId === hop.eventId;
    const active = trace.kind === 'path' || (trace.kind === 'hop' && trace.index === i);
    return (
      <g
        key={`hop-${i}`}
        style={{ cursor: hop.eventId && onOpenEvent ? 'pointer' : 'default' }}
        onMouseEnter={() => setTrace({ kind: 'hop', index: i })}
        onMouseLeave={() => setTrace({ kind: 'none' })}
        onClick={(e) => {
          e.stopPropagation();
          if (hop.eventId && onOpenEvent) onOpenEvent(hop.eventId);
        }}
      >
        <title>
          {`hop ${i + 1} of ${n}: ${hop.txid}`}
          {hop.eventId ? '. Click to open this event.' : ''}
        </title>
        <rect
          x={x}
          y={cy - HOP_H / 2}
          width={HOP_W}
          height={HOP_H}
          rx={9}
          className={`${isCurrent ? 'fill-red-500/10' : 'fill-zinc-800'} ${
            active ? 'stroke-2' : ''
          }`}
          style={{ stroke: active ? '#f87171' : isCurrent ? '#ef4444' : '#71717a' }}
        />
        <text
          x={x + HOP_W / 2}
          y={cy - 8}
          textAnchor="middle"
          className={`font-mono text-[10px] font-semibold tracking-wider ${isCurrent ? 'fill-red-300' : 'fill-zinc-400'}`}
        >
          {isCurrent ? `HOP ${i + 1}/${n} · VIEWING` : `HOP ${i + 1}/${n}`}
        </text>
        <text
          x={x + HOP_W / 2}
          y={cy + 7}
          textAnchor="middle"
          className="fill-zinc-300 font-mono text-[10px]"
        >
          {truncateMiddle(hop.txid, 8, 6)}
        </text>
        <text
          x={x + HOP_W / 2}
          y={cy + 21}
          textAnchor="middle"
          className="tnum fill-zinc-500 font-mono text-[10px]"
        >
          {satsToBtc(hop.inputs.reduce((s, io) => s + io.valueSats, 0))} BTC in
        </text>
      </g>
    );
  };

  const renderCarryLink = (i: number) => {
    const x1 = hopX(i) + HOP_W;
    const x2 = hopX(i + 1);
    const sats = hops[i].carrySats;
    const w = bandWidth(sats);
    const emphasized = pathActive;
    return (
      <g key={`link-${i}`} style={{ transition: 'opacity 150ms' }} opacity={trace.kind === 'side' ? 0.12 : 1}>
        <path
          d={flowPath(x1, cy, x2, cy)}
          fill="none"
          strokeWidth={w}
          strokeLinecap="round"
          className={emphasized ? 'stroke-red-400' : 'stroke-red-400/70'}
          opacity={emphasized ? 0.9 : 0.35}
          style={{ transition: 'opacity 150ms' }}
          onMouseEnter={() => setTrace({ kind: 'path' })}
          onMouseLeave={() => setTrace({ kind: 'none' })}
        />
        {pathActive && (
          <text
            x={(x1 + x2) / 2}
            y={cy - w / 2 - 7}
            textAnchor="middle"
            className="tnum fill-red-200 font-mono text-[10px]"
            style={LABEL_HALO}
          >
            {satsToBtc(sats)} BTC · {fmtShare(sats / total)} of stolen
          </text>
        )}
      </g>
    );
  };

  const renderInput = (index: number) => {
    const io = hops[0].inputs[index];
    const y = cy - (hops[0].inputs.length - 1) * 26 + index * 52;
    const entryLabels = io.address ? (labelByAddress.get(io.address) ?? []) : [];
    const labeled = entryLabels.length > 0;
    return (
      <g key={`in-${index}`} opacity={trace.kind === 'side' ? 0.12 : 1} style={{ transition: 'opacity 150ms' }}>
        <path
          d={flowPath(IN_X + BOX_W, y, hopX(0), cy)}
          fill="none"
          strokeWidth={bandWidth(io.valueSats)}
          strokeLinecap="round"
          className={pathActive ? 'stroke-rose-400' : 'stroke-rose-400/70'}
          opacity={pathActive ? 0.9 : 0.35}
          style={{ transition: 'opacity 150ms' }}
        />
        <g
          style={{ cursor: io.address ? 'pointer' : 'default' }}
          onMouseEnter={() => setTrace({ kind: 'path' })}
          onMouseLeave={() => setTrace({ kind: 'none' })}
          onClick={(e) => {
            e.stopPropagation();
            toggle({ kind: 'path' });
          }}
        >
          <rect
            x={IN_X}
            y={y - 24}
            width={BOX_W}
            height={48}
            rx={7}
            className={labeled ? 'fill-red-500/10 stroke-red-400' : 'fill-zinc-900 stroke-zinc-700'}
          />
          {io.address ? (
            <text
              x={IN_X + 10}
              y={y - 6}
              className="cursor-pointer fill-sky-400 font-mono text-[11px] hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/app/address/${io.address}`);
              }}
            >
              {truncateMiddle(io.address, 9, 6)}
            </text>
          ) : (
            <text x={IN_X + 10} y={y - 6} className="fill-zinc-600 font-mono text-[11px] italic">
              n/a
            </text>
          )}
          <text x={IN_X + 10} y={y + 12} className="tnum fill-zinc-200 font-mono text-[12px]">
            {satsToBtc(io.valueSats)}
            <tspan className="fill-zinc-500 text-[10px]"> BTC</tspan>
          </text>
          {labeled && (
            <text x={IN_X + 10} y={y + 21} className="fill-red-300 text-[9px]">
              {entryLabels[0].tag}
            </text>
          )}
        </g>
      </g>
    );
  };

  const renderTerminal = (index: number) => {
    const last = hops[n - 1];
    const io = last.outputs[index];
    const count = last.outputs.length;
    const y = cy - (count - 1) * 26 + index * 52;
    const entryLabels = io.address ? (labelByAddress.get(io.address) ?? []) : [];
    const labeled = entryLabels.length > 0;
    return (
      <g key={`out-${index}`} opacity={trace.kind === 'side' ? 0.12 : 1} style={{ transition: 'opacity 150ms' }}>
        <path
          d={flowPath(hopX(n - 1) + HOP_W, cy, terminalX, y)}
          fill="none"
          strokeWidth={bandWidth(io.valueSats)}
          strokeLinecap="round"
          className={pathActive ? 'stroke-emerald-400' : 'stroke-emerald-400/70'}
          opacity={pathActive ? 0.9 : 0.35}
          style={{ transition: 'opacity 150ms' }}
        />
        {pathActive && (
          <text
            x={(hopX(n - 1) + HOP_W + terminalX) / 2}
            y={(cy + y) / 2 - bandWidth(io.valueSats) / 2 - 6}
            textAnchor="middle"
            className="tnum fill-emerald-200 font-mono text-[10px]"
            style={LABEL_HALO}
          >
            {satsToBtc(io.valueSats)} BTC · {fmtShare(io.valueSats / total)}
          </text>
        )}
        <g
          style={{ cursor: io.address ? 'pointer' : 'default' }}
          onMouseEnter={() => setTrace({ kind: 'path' })}
          onMouseLeave={() => setTrace({ kind: 'none' })}
          onClick={(e) => {
            e.stopPropagation();
            toggle({ kind: 'path' });
          }}
        >
          <rect
            x={terminalX}
            y={y - 24}
            width={BOX_W}
            height={48}
            rx={7}
            className={labeled ? 'fill-red-500/10 stroke-red-400' : 'fill-zinc-900 stroke-zinc-700'}
          />
          {io.address ? (
            <text
              x={terminalX + 10}
              y={y - 6}
              className="cursor-pointer fill-sky-400 font-mono text-[11px] hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/app/address/${io.address}`);
              }}
            >
              {truncateMiddle(io.address, 9, 6)}
            </text>
          ) : (
            <text x={terminalX + 10} y={y - 6} className="fill-zinc-600 font-mono text-[11px] italic">
              n/a
            </text>
          )}
          <text x={terminalX + 10} y={y + 12} className="tnum fill-zinc-200 font-mono text-[12px]">
            {satsToBtc(io.valueSats)}
            <tspan className="fill-zinc-500 text-[10px]"> BTC</tspan>
          </text>
          {labeled && (
            <text x={terminalX + 10} y={y + 21} className="fill-red-300 text-[9px]">
              {entryLabels[0].tag}
            </text>
          )}
        </g>
      </g>
    );
  };

  const renderSideOutput = (hopIndex: number, index: number) => {
    const io = sideOutputs[hopIndex][index];
    const x = hopX(hopIndex) + 5;
    const y = cy + HOP_H / 2 + 24 + index * (SIDE_H + SIDE_GAP);
    const emphasized = sideEmphasized(hopIndex, index);
    return (
      <g key={`side-${hopIndex}-${index}`} opacity={sideDimmed(hopIndex, index) ? 0.25 : 1} style={{ transition: 'opacity 150ms' }}>
        <line
          x1={hopX(hopIndex) + HOP_W / 2}
          y1={cy + HOP_H / 2}
          x2={x + BOX_W / 2}
          y2={y}
          className={emphasized ? 'stroke-zinc-300' : 'stroke-zinc-600'}
          strokeWidth={emphasized ? 2 : 1}
          strokeDasharray="3 3"
          pointerEvents="none"
        />
        <g
          style={{ cursor: io.address ? 'pointer' : 'default' }}
          onMouseEnter={() => setTrace({ kind: 'side', hop: hopIndex, index })}
          onMouseLeave={() => setTrace({ kind: 'none' })}
          onClick={(e) => {
            e.stopPropagation();
            toggle({ kind: 'side', hop: hopIndex, index });
          }}
        >
          <title>peeled off the main trail. Click to pin/unpin.</title>
          <rect
            x={x}
            y={y}
            width={BOX_W}
            height={SIDE_H}
            rx={7}
            className="fill-zinc-900/80 stroke-zinc-700"
            style={emphasized ? { stroke: '#e4e4e7' } : undefined}
          />
          {io.address ? (
            <text
              x={x + 8}
              y={y + 16}
              className="cursor-pointer fill-sky-400 font-mono text-[10px] hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/app/address/${io.address}`);
              }}
            >
              {truncateMiddle(io.address, 9, 6)}
            </text>
          ) : (
            <text x={x + 8} y={y + 16} className="fill-zinc-600 font-mono text-[10px] italic">
              n/a
            </text>
          )}
          <text x={x + 8} y={y + 32} className="tnum fill-zinc-300 font-mono text-[11px]">
            {satsToBtc(io.valueSats)}
            <tspan className="fill-zinc-500 text-[9px]"> BTC peeled</tspan>
          </text>
        </g>
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
            className={`px-2.5 py-1 ${trace.kind === 'path' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800'}`}
            onClick={(e) => {
              e.stopPropagation();
              toggle({ kind: 'path' });
            }}
          >
            Trace the funds
          </button>
        </div>
        <span className="text-[11px] text-zinc-500">
          {satsToBtc(total)} BTC stolen across {n} hops. Hover any element to light the trail. Click a hop to open its event.
        </span>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full select-none">
        <text x={IN_X} y={14} className="fill-zinc-500 text-[10px] font-semibold tracking-widest">
          ORIGIN
        </text>
        <text x={hopX(0)} y={14} className="fill-zinc-500 text-[10px] font-semibold tracking-widest">
          HOPS
        </text>
        <text x={terminalX} y={14} className="fill-zinc-500 text-[10px] font-semibold tracking-widest">
          TERMINAL OUTPUTS
        </text>

        {hops[0].inputs.map((_, i) => renderInput(i))}
        {hops.slice(0, -1).map((_, i) => renderCarryLink(i))}
        {hops[n - 1].outputs.map((_, i) => renderTerminal(i))}
        {hops.map((_, i) => renderHop(i))}
        {sideOutputs.map((sides, hopIndex) => sides.map((_, index) => renderSideOutput(hopIndex, index)))}
      </svg>
    </div>
  );
}
