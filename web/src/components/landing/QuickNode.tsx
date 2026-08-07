import { useState } from 'react';

import { Reveal } from './Reveal';

const QUICKNODE_URL = 'https://www.quicknode.com/';
const INIT_CMD = 'coinwatch init --node "https://your-name.btc.quiknode.pro/your-key/"';

const CHECKLIST = [
  'Dedicated Bitcoin mainnet endpoint: your own view of the mempool',
  'Free tier: 10M API credits, 15 req/s, no credit card',
  'Streaming-ready for the CoinWatch ingest pipeline out of the box',
];

function Check() {
  return (
    <svg viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="none" stroke="#f2b33d" strokeOpacity="0.4" />
      <path d="M5 8.2 L7.2 10.2 L11 5.8" fill="none" stroke="#f2b33d" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Terminal() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INIT_CMD);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — leave the command readable */
    }
  };

  return (
    <div className="seam overflow-hidden rounded-lg border border-line bg-[#070a0f] shadow-[0_40px_80px_-40px_rgba(0,0,0,0.8)]">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-down/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-gold/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-up/70" />
        <span className="ml-2 font-mono text-[11px] text-mist">analyst@coinwatch: zsh</span>
        <button
          onClick={copy}
          className="ml-auto rounded-md border border-line bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] text-mist transition hover:border-gold/40 hover:text-goldbright"
        >
          {copied ? 'copied ✓' : 'copy init'}
        </button>
      </div>

      <div className="space-y-1.5 px-5 py-5 font-mono text-[12.5px] leading-relaxed">
        <p className="text-mist/70"># 1 · create a bitcoin endpoint at quicknode.com (free tier)</p>
        <p>
          <span className="text-gold">$ </span>
          <span className="text-zinc-100">coinwatch init --node </span>
          <span className="text-goldbright">"https://your-name.btc.quiknode.pro/your-key/"</span>
        </p>
        <p className="text-mist">
          <span className="text-up">  ✓</span> endpoint verified{' '}
          <span className="float-right tnum">412 ms</span>
        </p>
        <p className="text-mist">
          <span className="text-up">  ✓</span> mempool stream live{' '}
          <span className="float-right tnum">tip 908,114</span>
        </p>
        <p className="text-mist">
          <span className="text-up">  ✓</span> hub models synced{' '}
          <span className="float-right text-signal">mempool-sentiment-v2</span>
        </p>
        <p className="pt-3 text-mist/70"># 2 · file your first finding</p>
        <p>
          <span className="text-gold">$ </span>
          <span className="text-zinc-100">coinwatch labels publish </span>
          <span className="text-signal">--address bc1q9f4c…e2 --tag mixer --confidence 0.87</span>
        </p>
        <p className="text-mist">
          <span className="text-up">  ✓</span> evidence attached · welcome aboard, analyst{' '}
          <span className="text-goldbright">#48,214</span>
        </p>
      </div>
    </div>
  );
}

export function QuickNode() {
  return (
    <section id="quicknode" className="scroll-mt-24">
      <div className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
        <Reveal>
          <div className="chamfer bg-line/60 p-px">
            <div className="chamfer-inner tex-brushed bg-panel px-8 py-10 sm:px-12 sm:py-12">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div>
                <div className="font-mono text-[11px] tracking-[0.28em] text-gold/80">
                  04 / INFRASTRUCTURE · POWERED BY QUICKNODE
                </div>
                <h2 className="mt-4 font-display text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
                  Your node. Your edge.{' '}
                  <span className="font-serif text-[1.08em] font-normal italic">Five minutes,</span> tops.
                </h2>
                <p className="mt-5 leading-relaxed text-mist">
                  Every CoinWatch analyst runs their own infrastructure: forensics you
                  can&apos;t verify is just hearsay, and your evidence chain should start at the
                  source. QuickNode takes new analysts from zero to a synced, streaming endpoint
                  before the coffee cools, so you&apos;re tracing the chain yourself in no time.
                </p>

                <ul className="mt-7 space-y-3">
                  {CHECKLIST.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-sm text-zinc-300">
                      <Check />
                      {item}
                    </li>
                  ))}
                </ul>

                <div className="mt-9 flex flex-wrap items-center gap-4">
                  <a href={QUICKNODE_URL} target="_blank" rel="noreferrer" className="btn-brass px-6 py-3 text-sm">
                    Spin up your node
                    <span aria-hidden="true">→</span>
                  </a>
                  <span className="font-mono text-[11px] text-mist/80">
                    free QuickNode tier · then paste your RPC URL into{' '}
                    <span className="text-zinc-200">coinwatch init</span>
                  </span>
                </div>
              </div>

              <Terminal />
            </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
