import { Reveal } from './Reveal';

const STEPS = [
  {
    n: '01',
    title: 'Deploy',
    copy: 'Spin up a dedicated Bitcoin endpoint on QuickNode: free tier, roughly five minutes, no credit card. Your RPC, your rate limits, your view of the mempool.',
    foot: 'quicknode.com · free tier',
  },
  {
    n: '02',
    title: 'Analyze',
    copy: 'Point the CoinWatch indexer at your endpoint. Detection rules plus hub models turn raw mempool noise into case leads: whales, dormant wakes, coinjoins, exploit hops.',
    foot: 'coinwatch init --node <rpc>',
  },
  {
    n: '03',
    title: 'Publish',
    copy: 'File your findings with evidence attached. The crowd validates or refutes, Brier scores settle, and your track record compounds up the leaderboard.',
    foot: 'reputation-weighted · on-chain evidence',
  },
];

export function Protocol() {
  return (
    <section id="protocol" className="scroll-mt-24 border-t border-line">
      <div className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
        <Reveal>
          <div className="max-w-xl">
            <div className="font-mono text-[11px] tracking-[0.28em] text-gold/80">03 / PROTOCOL</div>
            <h2 className="mt-4 font-display text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
              From your node to the network in{' '}
              <span className="font-serif text-[1.08em] font-normal italic">three moves.</span>
            </h2>
          </div>
        </Reveal>

        <div className="relative mt-14 grid gap-10 lg:grid-cols-3 lg:gap-8">
          <div
            className="absolute top-5 right-[12%] left-[12%] hidden border-t border-dashed border-line lg:block"
            aria-hidden="true"
          />
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 120}>
              <div className="relative">
                <div className="inline-flex h-10 items-center rounded-full border border-gold/30 bg-ink px-4 font-mono text-sm font-semibold text-gold">
                  {s.n}
                </div>
                <h3 className="mt-5 font-display text-2xl font-semibold text-zinc-50">{s.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-mist">{s.copy}</p>
                <div className="mt-4 font-mono text-[11px] text-mist/70">{s.foot}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
