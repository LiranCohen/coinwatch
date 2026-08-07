import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import type { TrustGraphData, TrustGraphNode } from '@chainwatch/shared';

interface SimNode extends TrustGraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const WIDTH = 900;
const HEIGHT = 560;
const LINK_DISTANCE = 120;

function nodeRadius(node: TrustGraphNode): number {
  if (node.kind === 'seed') return 13;
  if (node.kind === 'analyst') return 6 + Math.min((node.reputation ?? 0) * 0.12, 12);
  return 5 + Math.min((node.score ?? 0) * 0.06, 8);
}

function nodeColor(node: TrustGraphNode): string {
  if (node.kind === 'seed') return 'fill-amber-400 stroke-amber-200';
  if (node.kind === 'analyst') return 'fill-sky-400 stroke-sky-200';
  return 'fill-zinc-500 stroke-zinc-400';
}

export function TrustGraph({ data }: { data: TrustGraphData }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dragRef = useRef<{ id: string } | null>(null);

  const focusId = hoverId ?? selectedId;

  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const edge of data.edges) {
      if (!map.has(edge.source)) map.set(edge.source, new Set());
      if (!map.has(edge.target)) map.set(edge.target, new Set());
      map.get(edge.source)!.add(edge.target);
      map.get(edge.target)!.add(edge.source);
    }
    return map;
  }, [data.edges]);

  const nodeById = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes]);

  useEffect(() => {
    const cx = WIDTH / 2;
    const cy = HEIGHT / 2;
    nodesRef.current = data.nodes.map((node, i) => {
      const angle = (i / Math.max(data.nodes.length, 1)) * Math.PI * 2;
      return {
        ...node,
        x: cx + Math.cos(angle) * 190,
        y: cy + Math.sin(angle) * 170,
        vx: 0,
        vy: 0,
      };
    });
    setNodes([...nodesRef.current]);

    const indexOf = new Map(nodesRef.current.map((n, i) => [n.id, i]));
    let raf = 0;

    const tick = () => {
      const sim = nodesRef.current;

      for (let i = 0; i < sim.length; i++) {
        for (let j = i + 1; j < sim.length; j++) {
          const a = sim[i];
          const b = sim[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let distSq = dx * dx + dy * dy;
          if (distSq < 1) {
            dx = Math.random() - 0.5;
            dy = Math.random() - 0.5;
            distSq = 1;
          }
          const dist = Math.sqrt(distSq);
          const force = Math.min(1400 / distSq, 3);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }

      for (const edge of data.edges) {
        const a = sim[indexOf.get(edge.source)!];
        const b = sim[indexOf.get(edge.target)!];
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(Math.hypot(dx, dy), 1);
        const stretch = (dist - LINK_DISTANCE) * 0.02;
        const fx = (dx / dist) * stretch;
        const fy = (dy / dist) * stretch;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }

      for (const node of sim) {
        if (dragRef.current?.id === node.id) {
          node.vx = 0;
          node.vy = 0;
          continue;
        }
        node.vx += (WIDTH / 2 - node.x) * 0.004;
        node.vy += (HEIGHT / 2 - node.y) * 0.004;
        node.vx *= 0.82;
        node.vy *= 0.82;
        node.x = Math.min(WIDTH - 70, Math.max(70, node.x + node.vx));
        node.y = Math.min(HEIGHT - 40, Math.max(40, node.y + node.vy));
      }

      setNodes([...sim]);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [data]);

  const toSvgPoint = (event: React.PointerEvent): { x: number; y: number } => {
    const svg = svgRef.current!;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: WIDTH / 2, y: HEIGHT / 2 };
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    return { x: point.x, y: point.y };
  };

  const isDimmed = (id: string): boolean => {
    if (!focusId) return false;
    if (id === focusId) return false;
    return !adjacency.get(focusId)?.has(id);
  };

  const selected = selectedId ? nodeById.get(selectedId) : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-[480px] w-full select-none rounded-lg border border-zinc-800 bg-zinc-950"
        onPointerUp={() => (dragRef.current = null)}
        onPointerLeave={() => (dragRef.current = null)}
        onPointerMove={(event) => {
          if (!dragRef.current) return;
          const node = nodesRef.current.find((n) => n.id === dragRef.current!.id);
          if (!node) return;
          const { x, y } = toSvgPoint(event);
          node.x = Math.min(WIDTH - 70, Math.max(70, x));
          node.y = Math.min(HEIGHT - 40, Math.max(40, y));
        }}
      >
        {/* Background hit-layer: clicking empty canvas clears the pinned
            selection. After a node drag, the click targets the svg ancestor,
            not this rect, so releasing a drag never clears the selection. */}
        <rect
          x={0}
          y={0}
          width={WIDTH}
          height={HEIGHT}
          className="fill-transparent"
          onClick={() => {
            setSelectedId(null);
            setHoverId(null);
          }}
        />
        {data.edges.map((edge, i) => {
          const source = nodes.find((n) => n.id === edge.source);
          const target = nodes.find((n) => n.id === edge.target);
          if (!source || !target) return null;
          const active = focusId !== null && (edge.source === focusId || edge.target === focusId);
          const dimmedEdge = focusId !== null && !active;
          return (
            <line
              key={i}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              pointerEvents="none"
              strokeWidth={active ? 2 : edge.kind === 'attestation' ? 1.2 : 1}
              strokeDasharray={edge.kind === 'vote' ? '4 3' : undefined}
              opacity={dimmedEdge ? 0.05 : active ? 0.95 : edge.kind === 'vote' ? 0.5 : 0.3}
              className={
                edge.kind === 'vote'
                  ? edge.weight >= 0
                    ? 'stroke-emerald-500'
                    : 'stroke-red-500'
                  : 'stroke-zinc-600'
              }
              style={{ transition: 'opacity 150ms' }}
            />
          );
        })}

        {nodes.map((node) => {
          const radius = nodeRadius(node);
          const focused = focusId === node.id;
          return (
            <g
              key={node.id}
              opacity={isDimmed(node.id) ? 0.15 : 1}
              style={{ transition: 'opacity 150ms', cursor: 'grab' }}
              onPointerDown={(event) => {
                event.preventDefault();
                (event.target as Element).setPointerCapture?.(event.pointerId);
                dragRef.current = { id: node.id };
                setSelectedId(node.id);
              }}
              onPointerEnter={() => setHoverId(node.id)}
              onPointerLeave={() => setHoverId(null)}
            >
              <circle
                cx={node.x}
                cy={node.y}
                r={radius}
                strokeWidth={focused ? 2.5 : 1}
                className={nodeColor(node)}
              />
              {node.kind === 'seed' && (
                <text
                  x={node.x}
                  y={node.y + 3}
                  textAnchor="middle"
                  className="pointer-events-none fill-zinc-950 text-[8px] font-bold"
                >
                  SEED
                </text>
              )}
              <text
                x={node.x}
                y={node.y + radius + 12}
                textAnchor="middle"
                className={`pointer-events-none text-[10px] ${
                  focused ? 'fill-zinc-100 font-medium' : 'fill-zinc-400'
                }`}
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="pointer-events-none absolute left-3 top-3 space-y-1 rounded border border-zinc-800 bg-zinc-950/85 px-3 py-2 text-[11px] text-zinc-400">
        <p>
          <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-sky-400 align-middle" />
          analyst (size = reputation)
        </p>
        <p>
          <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-amber-400 align-middle" />
          seed knowledge base
        </p>
        <p>
          <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-zinc-500 align-middle" />
          labeled address
        </p>
        <p>
          <span className="mr-1.5 inline-block h-0.5 w-4 bg-zinc-600 align-middle" />
          attestation
          <span className="ml-3 mr-1.5 inline-block h-0.5 w-4 border-t border-dashed border-emerald-500 align-middle" />
          upvote
          <span className="ml-3 mr-1.5 inline-block h-0.5 w-4 border-t border-dashed border-red-500 align-middle" />
          downvote
        </p>
      </div>

      {selected && (
        <div className="absolute bottom-3 left-3 max-w-xs rounded border border-zinc-700 bg-zinc-900/95 px-3 py-2 text-xs">
          <p className="font-medium text-zinc-100">{selected.label}</p>
          <p className="mt-0.5 text-zinc-500">
            {selected.kind === 'analyst' && (
              <>
                reputation {selected.reputation ?? 0} ·{' '}
                <span className="font-mono">{selected.did?.slice(0, 26)}…</span>
              </>
            )}
            {selected.kind === 'address' && (
              <>
                score {selected.score ?? 0} · <span className="font-mono">{selected.address?.slice(0, 20)}…</span>
              </>
            )}
            {selected.kind === 'seed' && 'bootstrap attribution data, imported at startup'}
          </p>
          {selected.kind === 'address' && selected.address && (
            <Link
              to={`/app/address/${selected.address}`}
              className="pointer-events-auto mt-1 inline-block text-sky-400 hover:underline"
            >
              Open address page
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
