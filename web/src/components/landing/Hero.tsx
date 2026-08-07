import { Link } from 'react-router-dom';

import { HeroCanvas } from './HeroCanvas';
import { LogoMark } from './LogoMark';
import { TxPopups } from './TxPopups';

const QUICKNODE_URL = 'https://www.quicknode.com/';

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-36 pb-20 sm:pt-40">
      <div className="bg-grid absolute inset-0 [mask-image:radial-gradient(ellipse_75%_65%_at_50%_0%,black,transparent)]" />
      <div className="tex-brushed pointer-events-none absolute inset-x-0 top-0 h-px w-full bg-line" />

      <div className="relative mx-auto grid max-w-6xl items-center gap-16 px-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <h1 className="font-display text-5xl leading-[1.04] font-semibold tracking-tight text-zinc-50 sm:text-6xl lg:text-[4.6rem]">
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

          <TxPopups />
        </div>
      </div>
    </section>
  );
}
