import { LogoMark } from './LogoMark';
import { Reveal } from './Reveal';
import { HUB_CARDS, type HubCard } from './data';

const KIND_STYLES: Record<HubCard['kind'], { label: string; classes: string }> = {
  model: { label: 'MODEL', classes: 'border-signal/30 bg-signal/10 text-signal' },
  dataset: { label: 'DATASET', classes: 'border-gold/30 bg-gold/10 text-goldbright' },
  paper: { label: 'PAPER', classes: 'border-up/30 bg-up/10 text-up' },
};

function HubCardView({ c }: { c: HubCard }) {
  const kind = KIND_STYLES[c.kind];
  return (
    <article className="panel-metal flex flex-col rounded-lg p-5 transition-all duration-300 hover:-translate-y-1 hover:border-signal/50 hover:shadow-[0_20px_36px_-20px_rgba(0,0,0,0.75)]">
      <div className="flex items-center gap-2.5">
        <LogoMark size={22} />
        <span className="truncate font-mono text-sm text-zinc-100">{c.name}</span>
        <span
          className={`ml-auto shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] tracking-[0.16em] ${kind.classes}`}
        >
          {kind.label}
        </span>
      </div>

      <p className="mt-3.5 flex-1 text-sm leading-relaxed text-mist">{c.blurb}</p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {c.tags.map((t) => (
          <span
            key={t}
            className="rounded-full border border-line bg-white/[0.03] px-2.5 py-0.5 font-mono text-[10px] text-mist"
          >
            {t}
          </span>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-4 border-t border-line pt-3.5 font-mono text-[11px] text-mist">
        {c.downloads && <span className="text-zinc-300">↓ {c.downloads}</span>}
        <span>♥ {c.likes}</span>
        <span className="ml-auto">{c.meta}</span>
      </div>
    </article>
  );
}

export function Hub() {
  return (
    <section id="research" className="scroll-mt-24 border-t border-line bg-panel2/40">
      <div className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
        <Reveal>
          <div className="max-w-xl">
            <div className="font-mono text-[11px] tracking-[0.28em] text-gold/80">03 / RESEARCH HUB</div>
            <h2 className="mt-4 font-display text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
              Research-grade analysis, <span className="font-serif text-[1.08em] font-normal italic">open</span> by default.
            </h2>
            <p className="mt-4 leading-relaxed text-mist">
              Models, datasets, and papers: versioned, forkable, and benchmarked against
              confirmed cases. If a model&apos;s calls stop holding up, the leaderboard says so.
            </p>
          </div>
        </Reveal>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {HUB_CARDS.map((c, i) => (
            <Reveal key={c.name} delay={i * 90} className="h-full">
              <HubCardView c={c} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
