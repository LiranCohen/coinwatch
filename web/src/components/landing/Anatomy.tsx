import { Reveal } from './Reveal';

const TICKS = Array.from({ length: 60 }, (_, i) => i * 6);
const CX = 400;

interface CalloutSpec {
  n: string;
  cy: number;
  side: 'left' | 'right';
  title: string;
  spec: string;
  edge: number;
}

const CALLOUTS: CalloutSpec[] = [
  { n: '1', cy: 100, side: 'right', title: 'REEDED BEZEL', spec: '60-SECOND MINUTE TRACK · MILLED COIN RIM', edge: 472 },
  { n: '2', cy: 210, side: 'left', title: 'OBSIDIAN DIAL', spec: 'LACQUERED BLACK · ANTI-GLARE FOR LATE BLOCKS', edge: 344 },
  { n: '3', cy: 320, side: 'right', title: 'CAL. CW-01 HAND', spec: "FACTORY-SET TO 2 O'CLOCK · ALWAYS RISING", edge: 476 },
  { n: '4', cy: 440, side: 'left', title: 'THE MOVEMENT', spec: '48,213 JEWELS · EVERY ANALYST A BEARING', edge: 318 },
];

function Bezel({ cy }: { cy: number }) {
  return (
    <g>
      {TICKS.map((deg) => (
        <line
          key={deg}
          x1={CX}
          y1={cy - 71}
          x2={CX}
          y2={cy - (deg % 30 === 0 ? 61 : 65)}
          stroke="#f2b33d"
          strokeOpacity={deg % 30 === 0 ? 0.9 : 0.36}
          strokeWidth={deg % 30 === 0 ? 1.4 : 1}
          transform={`rotate(${deg} ${CX} ${cy})`}
        />
      ))}
      <circle cx={CX} cy={cy} r={72.5} fill="none" stroke="#f2b33d" strokeOpacity="0.75" strokeWidth="1.5" />
      <circle cx={CX} cy={cy} r={56} fill="none" stroke="#2a3244" strokeWidth="1" />
    </g>
  );
}

function Dial({ cy }: { cy: number }) {
  return (
    <g>
      <circle cx={CX} cy={cy} r={56} fill="url(#anat-face)" stroke="#f2b33d" strokeOpacity="0.3" strokeWidth="1" />
      {[0, 90, 180, 270].map((deg) => (
        <circle
          key={deg}
          cx={CX}
          cy={cy - 47}
          r={1.6}
          fill="#f2b33d"
          fillOpacity="0.8"
          transform={`rotate(${deg} ${CX} ${cy})`}
        />
      ))}
    </g>
  );
}

function Hand({ cy }: { cy: number }) {
  return (
    <g transform={`rotate(60 ${CX} ${cy})`}>
      <path d={`M${CX} ${cy - 64} L${CX + 4.5} ${cy - 8} L${CX} ${cy + 3} L${CX - 4.5} ${cy - 8} Z`} fill="url(#anat-edge)" />
      <path d={`M${CX - 1.3} ${cy + 3} L${CX - 1.3} ${cy + 26} L${CX + 1.3} ${cy + 26} L${CX + 1.3} ${cy + 3} Z`} fill="#f2b33d" fillOpacity="0.85" />
      <circle cx={CX} cy={cy + 29.5} r={2.2} fill="none" stroke="#f2b33d" strokeOpacity="0.55" strokeWidth="1.1" />
      <circle cx={CX} cy={cy} r={3.4} fill="#f2b33d" />
      <circle cx={CX} cy={cy} r={1.3} fill="#05070b" />
    </g>
  );
}

function Movement({ cy }: { cy: number }) {
  return (
    <g>
      <circle cx={CX} cy={cy} r={82} fill="none" stroke="#e5484d" strokeWidth="1.2" strokeOpacity="0.85" />
      <circle cx={CX} cy={cy} r={64} fill="none" stroke="#f2b33d" strokeOpacity="0.75" strokeWidth="1.5" />
      <circle cx={CX} cy={cy} r={46} fill="none" stroke="#2a3244" strokeWidth="1" />
      {Array.from({ length: 6 }, (_, i) => i * 60).map((deg) => (
        <line
          key={deg}
          x1={CX}
          y1={cy}
          x2={CX}
          y2={cy - 46}
          stroke="#2a3244"
          strokeWidth="1.2"
          transform={`rotate(${deg} ${CX} ${cy})`}
        />
      ))}
      {Array.from({ length: 8 }, (_, i) => i * 45 + 22.5).map((deg) => (
        <circle
          key={deg}
          cx={CX}
          cy={cy - 55}
          r={2.2}
          fill="#f2b33d"
          fillOpacity="0.85"
          transform={`rotate(${deg} ${CX} ${cy})`}
        />
      ))}
      <circle cx={CX} cy={cy} r={3.4} fill="#f2b33d" />
    </g>
  );
}

function Callout({ c }: { c: CalloutSpec }) {
  const right = c.side === 'right';
  const textX = right ? 612 : 208;
  const numeralX = right ? 588 : 232;
  const lineStart = right ? 577 : 243;
  return (
    <g>
      <line x1={lineStart} y1={c.cy} x2={c.edge} y2={c.cy} stroke="#2a3244" strokeWidth="1" />
      <circle cx={c.edge} cy={c.cy} r={2.6} fill="#e5484d" />
      <circle cx={numeralX} cy={c.cy} r={9.5} fill="#0a0d13" stroke="#3a4358" strokeWidth="1" />
      <text
        x={numeralX}
        y={c.cy}
        dy="0.34em"
        textAnchor="middle"
        className="font-mono text-mist"
        fill="currentColor"
        fontSize="9.5"
      >
        {c.n}
      </text>
      <text
        x={textX}
        y={c.cy - 3}
        textAnchor={right ? 'start' : 'end'}
        className="font-mono font-semibold text-zinc-100"
        fill="currentColor"
        fontSize="11"
        letterSpacing="0.16em"
      >
        {c.title}
      </text>
      <text
        x={textX}
        y={c.cy + 12}
        textAnchor={right ? 'start' : 'end'}
        className="font-mono text-mist"
        fill="currentColor"
        fontSize="9.5"
        letterSpacing="0.1em"
      >
        {c.spec}
      </text>
    </g>
  );
}

function Cross({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 12 12" className={`absolute h-3 w-3 text-line ${className}`} aria-hidden="true">
      <path d="M6 0 V12 M0 6 H12" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function Anatomy() {
  return (
    <section id="anatomy" className="scroll-mt-24 border-t border-line">
      <div className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <div className="font-mono text-[11px] tracking-[0.28em] text-gold/80">01 / ANATOMY · CAL. CW-01</div>
            <h2 className="mt-4 font-display text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
              Every part, held to{' '}
              <span className="font-serif text-[1.08em] font-normal italic">tolerance.</span>
            </h2>
            <p className="mt-4 leading-relaxed text-mist">
              Swiss-movement discipline, applied to forensic intelligence. Every component of the
              CoinWatch calibre is specified, inspectable, and replaceable, down to the last
              analyst.
            </p>
          </div>
        </Reveal>

        <Reveal delay={140}>
          <div className="panel-metal relative mt-14 rounded-lg px-4 py-10 sm:px-10">
            <Cross className="-top-1.5 -left-1.5" />
            <Cross className="-top-1.5 -right-1.5" />
            <Cross className="-bottom-1.5 -left-1.5" />
            <Cross className="-right-1.5 -bottom-1.5" />

            <svg viewBox="0 0 820 560" className="mx-auto w-full max-w-3xl" role="img" aria-label="Exploded technical diagram of the CoinWatch calibre">
              <defs>
                <linearGradient id="anat-edge" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#ffd97a" />
                  <stop offset="55%" stopColor="#f2b33d" />
                  <stop offset="100%" stopColor="#9a6a15" />
                </linearGradient>
                <radialGradient id="anat-face" cx="0.38" cy="0.3" r="0.9">
                  <stop offset="0%" stopColor="#171e2b" />
                  <stop offset="70%" stopColor="#0b0f16" />
                  <stop offset="100%" stopColor="#07090d" />
                </radialGradient>
              </defs>

              <line x1={CX} y1={20} x2={CX} y2={534} stroke="#232b3a" strokeWidth="1" strokeDasharray="3 6" />

              <Bezel cy={100} />
              <Dial cy={210} />
              <Hand cy={320} />
              <Movement cy={440} />

              {CALLOUTS.map((c) => (
                <Callout key={c.n} c={c} />
              ))}
            </svg>

            <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
              <span className="font-mono text-[10px] tracking-[0.2em] text-mist">
                ±0.4% BRIER TOLERANCE · 28,800 SIGNALS/H
              </span>
              <div className="flex divide-x divide-line border border-line font-mono text-[10px] tracking-wider text-mist">
                <span className="px-3 py-1.5 text-zinc-300">COINWATCH · CAL. CW-01</span>
                <span className="px-3 py-1.5">SCALE 1:1</span>
                <span className="hidden px-3 py-1.5 sm:inline">SHEET 01/01</span>
                <span className="hidden px-3 py-1.5 md:inline">DRAWN BY THE CROWD</span>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
