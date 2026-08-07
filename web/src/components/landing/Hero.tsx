import { Link } from 'react-router-dom';

import { HeroCanvas } from './HeroCanvas';
import { LogoMark } from './LogoMark';

const QUICKNODE_URL = 'https://www.quicknode.com/';

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-36 pb-20 sm:pt-40">
      <div className="bg-grid absolute inset-0 [mask-image:radial-gradient(ellipse_75%_65%_at_50%_0%,black,transparent)]" />
      <div className="tex-brushed pointer-events-none absolute inset-x-0 top-0 h-px w-full bg-line" />

      <div className="relative mx-auto grid max-w-6xl items-center gap-16 px-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <div className="inline-flex items-center gap-2.5 rounded-full border border-line bg-white/[0.03] px-3.5 py-1.5 font-mono text-[11px] tracking-[0.22em] text-mist">
            <span className="cw-pulse inline-block h-1.5 w-1.5 rounded-full bg-gold" />
            CAL. CW-01 · CROWD-VERIFIED CHAIN FORENSICS
          </div>

          <h1 className="mt-7 font-display text-5xl leading-[1.04] font-semibold tracking-tight text-zinc-50 sm:text-6xl lg:text-[4.6rem]">
            Time is money.
            <br />
            <span className="text-goldbright">
              The crowd <span className="font-serif text-[1.06em] font-normal italic">traces</span> both.
            </span>
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-relaxed text-mist">
            CoinWatch pairs your own node&apos;s view of the mempool with a crowd of forensic
            analysts. Trace suspicious flows as they happen, attach evidence-backed labels, and
            let reputation separate signal from noise.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-4">
            <a href={QUICKNODE_URL} target="_blank" rel="noreferrer" className="btn-brass px-6 py-3 text-sm">
              Spin up your node
              <span aria-hidden="true">→</span>
            </a>
            <Link to="/app" className="btn-steel px-6 py-3 text-sm">
              Launch the live app
            </Link>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[520px]">
          <HeroCanvas className="absolute inset-0 h-full w-full" />
          <div className="relative aspect-square p-[13%]">
            <LogoMark animate className="h-full w-full drop-shadow-[0_12px_28px_rgba(0,0,0,0.65)]" />
          </div>

          <div className="animate-floaty absolute top-[6%] right-[2%] rounded-xl border border-line bg-panel/85 px-4 py-3 backdrop-blur-md">
            <div className="font-mono text-[10px] tracking-[0.18em] text-mist">WHALE #3,114 → MIXER?</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="tnum font-display text-xl font-semibold text-zinc-50">87.4%</span>
              <span className="tnum font-mono text-[11px] text-up">▲ 2.1</span>
            </div>
            <div className="mt-1 font-mono text-[9px] tracking-[0.14em] text-mist/70">CROWD CONSENSUS</div>
          </div>

          <div
            className="animate-floaty absolute bottom-[8%] left-[0%] rounded-xl border border-line bg-panel/85 px-4 py-3 backdrop-blur-md"
            style={{ animationDelay: '-3.4s' }}
          >
            <div className="font-mono text-[11px] text-zinc-200">coinwatch/mempool-sentiment-v2</div>
            <div className="mt-1 font-mono text-[10px] text-mist">↓ 84.2k · ♥ 1,204 · transformers</div>
          </div>
        </div>
      </div>
    </section>
  );
}
