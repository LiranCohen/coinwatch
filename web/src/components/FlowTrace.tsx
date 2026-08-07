import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { AddressFlow, FlowNode } from '@chainwatch/shared';

import { getAddressFlow } from '../api/client';
import { satsToBtc, truncateMiddle } from '../lib/format';

interface FlowTraceProps {
  address: string;
}

const COL_W = 250;
const ROW_H = 46;
const BOX_W = 190;
const BOX_H = 34;
const PAD = 16;

/** Edge thickness carries the value share, the way flow diagrams should. */
function edgeWidth(share: number): number {
  return 1 + Math.sqrt(Math.max(share, 0.01)) * 9;
}

function columnLabel(hop: number): string {
  if (hop === 0) return 'THIS ADDRESS';
  if (hop < 0) return hop === -1 ? 'FUNDED BY' : `${-hop} HOPS BACK`;
  return hop === 1 ? 'SENT TO' : `${hop} HOPS ON`;
}

export function FlowTrace({ address }: FlowTraceProps) {
  const [flow, setFlow] = useState<AddressFlow | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    setFlow(null);
    setFailed(null);
    setRunning(false);
  }, [address]);

  const run = () => {
    setRunning(true);
    setFailed(null);
    getAddressFlow(address)
      .then(setFlow)
      .catch((err: unknown) => setFailed(err instanceof Error ? err.message : 'request failed'))
      .finally(() => setRunning(false));
  };

  const layout = useMemo(() => {
    if (!flow) return null;
    const byHop = new Map<number, FlowNode[]>();
    for (const node of flow.nodes) {
      const list = byHop.get(node.hop) ?? [];
      list.push(node);
      byHop.set(node.hop, list);
    }
    const hops = [...byHop.keys()].sort((a, b) => a - b);
    const positions = new Map<string, { x: number; y: number }>();
    let maxRows = 0;
    hops.forEach((hop, column) => {
      const list = (byHop.get(hop) ?? []).sort((a, b) => b.tracedSats - a.tracedSats);
      maxRows = Math.max(maxRows, list.length);
      list.forEach((node, row) => {
        positions.set(node.address, { x: PAD + column * COL_W, y: PAD + 20 + row * ROW_H });
      });
    });
    return {
      hops,
      byHop,
      positions,
      width: PAD * 2 + Math.max(1, hops.length) * COL_W,
      height: PAD * 2 + 30 + maxRows * ROW_H,
    };
  }, [flow]);

  if (!flow && !running && failed === null) {
    return (
      <section>
        <h2 className="mb-1 text-xs font-semibold tracking-wider text-zinc-400">VALUE FLOW TRACE</h2>
        <div className="rounded-lg border border-dashed border-zinc-800 px-4 py-6 text-center">
          <p className="text-sm text-zinc-300">Follow this address's money backwards and forwards.</p>
          <p className="mx-auto mt-1 max-w-lg text-xs text-zinc-500">
            Walks the chain from here to find which addresses funded it and where it sent value, then
            shows what stopped and what moved on. This reads dozens of addresses from the chain source
            and takes a few seconds.
          </p>
          <button
            type="button"
            onClick={run}
            className="mt-3 rounded border border-sky-500/50 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20"
          >
            Trace the funds
          </button>
        </div>
      </section>
    );
  }

  if (running || !flow || !layout) {
    return (
      <section>
        <h2 className="mb-1 text-xs font-semibold tracking-wider text-zinc-400">VALUE FLOW TRACE</h2>
        {failed !== null ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-5 text-center">
            <p className="text-sm text-amber-200">The trace could not be run.</p>
            <p className="mt-1 break-all text-xs text-amber-200/70">{failed}</p>
            <button
              type="button"
              onClick={run}
              className="mt-3 rounded border border-zinc-600 px-3 py-1 text-xs text-zinc-200 hover:border-zinc-400"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="cw-pulse h-40 rounded-lg border border-zinc-800 bg-zinc-900/40" />
        )}
      </section>
    );
  }

  if (!flow.available || flow.nodes.length <= 1) {
    return (
      <section>
        <h2 className="mb-1 text-xs font-semibold tracking-wider text-zinc-400">VALUE FLOW TRACE</h2>
        <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-6 text-center text-xs text-zinc-500">
          {!flow.available
            ? 'The chain source did not answer, so no trace could be run. This is not a statement that the address is isolated.'
            : flow.truncated
              ? (flow.note ?? 'The trace could not be completed.')
              : 'No flows above the dust threshold connect to this address.'}
        </p>
      </section>
    );
  }

  return (
    <section>
      <h2 className="mb-1 text-xs font-semibold tracking-wider text-zinc-400">VALUE FLOW TRACE</h2>
      <p className="mb-2 text-xs text-zinc-500">
        Line thickness is the share of the destination's traced inflow. Green means the address still
        holds what it received — the money stopped there.
      </p>
      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <svg width={layout.width} height={layout.height} className="select-none">
          {layout.hops.map((hop, column) => (
            <text
              key={`h${hop}`}
              x={PAD + column * COL_W}
              y={12}
              className="fill-zinc-600 text-[9px] font-semibold tracking-widest"
            >
              {columnLabel(hop)}
            </text>
          ))}

          {flow.edges.map((edge, i) => {
            const from = layout.positions.get(edge.from);
            const to = layout.positions.get(edge.to);
            if (!from || !to) return null;
            const x1 = from.x + BOX_W;
            const y1 = from.y + BOX_H / 2;
            const x2 = to.x;
            const y2 = to.y + BOX_H / 2;
            const mid = (x1 + x2) / 2;
            const lit = hovered === edge.from || hovered === edge.to;
            return (
              <g key={`e${i}`} opacity={hovered === null ? 0.75 : lit ? 1 : 0.12}>
                <path
                  d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  strokeWidth={edgeWidth(edge.share)}
                  strokeLinecap="round"
                  className={lit ? 'stroke-sky-400' : 'stroke-zinc-600'}
                />
                {lit && (
                  <text
                    x={mid}
                    y={(y1 + y2) / 2 - 6}
                    textAnchor="middle"
                    className="tnum fill-sky-200 font-mono text-[9px]"
                    style={{ paintOrder: 'stroke', stroke: '#09090b', strokeWidth: 4 }}
                  >
                    {satsToBtc(edge.valueSats)} BTC · {Math.round(edge.share * 100)}%
                  </text>
                )}
              </g>
            );
          })}

          {flow.nodes.map((node) => {
            const pos = layout.positions.get(node.address);
            if (!pos) return null;
            const focus = node.hop === 0;
            return (
              <g
                key={node.address}
                transform={`translate(${pos.x} ${pos.y})`}
                className="cursor-pointer"
                onMouseEnter={() => setHovered(node.address)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => navigate(`/app/address/${node.address}`)}
              >
                <title>
                  {node.address}
                  {node.labels.length > 0 ? ` — ${node.labels.join(', ')}` : ''}
                </title>
                <rect
                  width={BOX_W}
                  height={BOX_H}
                  rx={6}
                  className={
                    focus
                      ? 'fill-sky-500/15 stroke-sky-400'
                      : node.unmoved
                        ? 'fill-emerald-500/10 stroke-emerald-500/50'
                        : 'fill-zinc-900 stroke-zinc-700'
                  }
                  strokeWidth={focus ? 2 : 1}
                />
                <text x={8} y={14} className="fill-zinc-300 font-mono text-[10px]">
                  {truncateMiddle(node.address, 12, 8)}
                </text>
                <text x={8} y={26} className="tnum fill-zinc-500 font-mono text-[9px]">
                  {node.tracedSats > 0 ? `${satsToBtc(node.tracedSats)} BTC` : ''}
                  {node.labels.length > 0 ? ` · ${node.labels[0]}` : ''}
                </text>
                {node.unmoved && (
                  <text x={BOX_W - 8} y={14} textAnchor="end" className="fill-emerald-400 text-[8px] font-semibold">
                    UNMOVED
                  </text>
                )}
                {node.frontier && (
                  <text x={BOX_W - 8} y={26} textAnchor="end" className="fill-amber-400/70 text-[8px]">
                    trail continues
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      {flow.note && <p className="mt-2 text-xs text-zinc-500">{flow.note}</p>}
    </section>
  );
}
