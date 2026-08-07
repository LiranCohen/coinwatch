import { useEffect, useState } from 'react';

import { Reveal } from './Reveal';
import { MARKETS, type Market } from './data';

function Sparkline({ points, up }: { points: number[]; up: boolean }) {
  const w = 120;
  const h = 36;
  const min = Math.min(...points);
  const span = Math.max(...points) - min || 1;
  const d = points
    .map((p, i) => `${((i / (points.length - 1)) * w).toFixed(1)},${(h - 4 - ((p - min) / span) * (h - 8)).toFixed(1)}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-28" aria-hidden="true">
      <polyline
        points={d}
        fill="none"
        stroke={up ? '#2fbf8f' : '#f0516c'}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.9"
      />
    </svg>
  );
}

function MarketCard({ m }: { m: Market }) {
  const delta = m.p - m.open;
  return (
    <article className="group panel-metal rounded-lg p-5 transition-colors duration-300 hover:border-gold/40">
      <div className="flex items-center justify-between">
        <span className="rounded border border-line bg-white/[0.03] px-2 py-0.5 font-mono text-[10px] tracking-[0.18em] text-mist">
          {m.category}
        </span>
        <span className={`tnum font-mono text-xs ${delta >= 0 ? 'text-up' : 'text-down'}`}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)} 24h
        </span>
      </div>

      <h3 className="mt-4 min-h-[3.5rem] font-display text-lg leading-snug font-medium text-zinc-100">
        {m.question}
      </h3>

      <div className="mt-4 flex items-end justify-between">
        <div className="tnum font-display text-4xl font-semibold text-zinc-50 transition-colors duration-500">
          {m.p.toFixed(1)}
          <span className="text-xl text-mist">%</span>
        </div>
        <Sparkline points={m.spark} up={delta >= 0} />
      </div>

      <div className="mt-4 flex h-1.5 overflow-hidden rounded-full bg-white/5">
        <div className="bg-up transition-[width] duration-700" style={{ width: `${m.p}%` }} />
        <div className="bg-down/70 transition-[width] duration-700" style={{ width: `${100 - m.p}%` }} />
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] tracking-wider text-mist">
        <span className="text-up/90">LIKELY {m.p.toFixed(0)}%</span>
        <span className="text-down/90">UNLIKELY {(100 - m.p).toFixed(0)}%</span>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-line pt-3.5 text-xs text-mist">
        <span>{m.analysts} analysts</span>
        <span className="font-mono text-[11px]">{m.volume} evidence filed</span>
      </div>
    </article>
  );
}

export function Markets() {
  const [markets, setMarkets] = useState<Market[]>(MARKETS);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => {
      setMarkets((prev) => {
        const next = [...prev];
        const touches = 1 + Math.floor(Math.random() * 2);
        for (let k = 0; k < touches; k++) {
          const i = Math.floor(Math.random() * next.length);
          const m = next[i];
          const p = Math.min(96.5, Math.max(3.5, m.p + (Math.random() - 0.5) * 0.9));
          next[i] = { ...m, p: Math.round(p * 10) / 10 };
        }
        return next;
      });
    }, 1800);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section id="cases" className="scroll-mt-24">
      <div className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-xl">
              <div className="font-mono text-[11px] tracking-[0.28em] text-gold/80">01 / OPEN INVESTIGATIONS</div>
              <h2 className="mt-4 font-display text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
                The crowd <span className="font-serif text-[1.08em] font-normal italic">sees</span> it first.
              </h2>
              <p className="mt-4 leading-relaxed text-mist">
                Every open case is a question the crowd weighs in on. Consensus is
                reputation-weighted, every vote carries evidence, and the record never forgets
                who was right.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.18em] text-mist">
              <span className="cw-pulse inline-block h-1.5 w-1.5 rounded-full bg-up" />
              CONSENSUS UPDATES LIVE · REPUTATION-WEIGHTED
            </div>
          </div>
        </Reveal>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {markets.map((m, i) => (
            <Reveal key={m.id} delay={i * 90}>
              <MarketCard m={m} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
