import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { Anatomy } from '../components/landing/Anatomy';
import { Hero } from '../components/landing/Hero';
import { Hub } from '../components/landing/Hub';
import { LogoMark } from '../components/landing/LogoMark';
import { Markets } from '../components/landing/Markets';
import { Protocol } from '../components/landing/Protocol';
import { QuickNode } from '../components/landing/QuickNode';
import { Reveal } from '../components/landing/Reveal';
import { Stats } from '../components/landing/Stats';
import { Ticker } from '../components/landing/Ticker';

const QUICKNODE_URL = 'https://www.quicknode.com/';

function LandingNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 transition-colors duration-300 ${
        scrolled ? 'tex-brushed seam border-b border-line bg-ink/90 backdrop-blur-md' : 'border-b border-transparent'
      }`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-6">
        <Link to="/" className="flex items-center gap-2.5">
          <LogoMark size={26} />
          <span className="font-display text-lg font-semibold tracking-tight text-zinc-50">
            CoinWatch
          </span>
        </Link>

        <nav className="hidden items-center gap-7 font-mono text-[12px] tracking-wider text-mist md:flex">
          <a href="#cases" className="transition hover:text-goldbright">CASES</a>
          <a href="#research" className="transition hover:text-goldbright">RESEARCH</a>
          <a href="#protocol" className="transition hover:text-goldbright">PROTOCOL</a>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <Link to="/app" className="btn-steel hidden px-4 py-1.5 text-sm sm:inline-flex">
            Launch app
          </Link>
          <a href={QUICKNODE_URL} target="_blank" rel="noreferrer" className="btn-brass px-4 py-1.5 text-sm">
            Spin up your node
          </a>
        </div>
      </div>
    </header>
  );
}

function FinalCta() {
  return (
    <section className="tex-knurl relative overflow-hidden border-y border-line bg-panel2">
      <div className="relative mx-auto max-w-6xl px-6 py-28 text-center sm:py-32">
        <Reveal>
          <div className="mx-auto w-fit">
            <LogoMark size={56} />
          </div>
          <h2 className="mt-8 font-display text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
            The next block is{' '}
            <span className="font-serif text-[1.08em] font-normal italic">coming.</span>
            <br />
            <span className="text-mist">What does the crowd say?</span>
          </h2>
          <p className="mx-auto mt-5 max-w-lg leading-relaxed text-mist">
            Deploy a node on QuickNode, point CoinWatch at it, and file your first finding
            before the next difficulty adjustment.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
            <a href={QUICKNODE_URL} target="_blank" rel="noreferrer" className="btn-brass px-7 py-3.5 text-sm">
              Spin up your node
              <span aria-hidden="true">→</span>
            </a>
            <Link to="/app" className="btn-steel px-7 py-3.5 text-sm">
              Watch the live feed
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const FOOTER_COLS: { title: string; links: { label: string; to: string; external?: boolean }[] }[] = [
  {
    title: 'PRODUCT',
    links: [
      { label: 'Live app', to: '/app' },
      { label: 'Open investigations', to: '#cases' },
      { label: 'Research hub', to: '#research' },
      { label: 'Leaderboard', to: '/app/web-of-trust' },
    ],
  },
  {
    title: 'RESOURCES',
    links: [
      { label: 'QuickNode setup', to: '#quicknode' },
      { label: 'Protocol', to: '#protocol' },
      { label: 'QuickNode', to: QUICKNODE_URL, external: true },
    ],
  },
  {
    title: 'COMMUNITY',
    links: [
      { label: 'GitHub', to: '#' },
      { label: 'Discord', to: '#' },
      { label: 'X', to: '#' },
    ],
  },
];

function Footer() {
  return (
    <footer className="tex-brushed border-t border-line bg-panel">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-12 md:grid-cols-[1.2fr_2fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <LogoMark size={28} />
              <span className="font-display text-lg font-semibold text-zinc-50">CoinWatch</span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-mist">
              Time is money. The crowd traces both.
            </p>
            <a
              href={QUICKNODE_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.03] px-3 py-1.5 font-mono text-[11px] text-mist transition hover:border-gold/40 hover:text-goldbright"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-gold" />
              BUILT ON QUICKNODE
            </a>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {FOOTER_COLS.map((col) => (
              <div key={col.title}>
                <div className="font-mono text-[10px] tracking-[0.24em] text-mist">{col.title}</div>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      {l.external || l.to.startsWith('#') ? (
                        <a
                          href={l.to}
                          {...(l.external ? { target: '_blank', rel: 'noreferrer' } : {})}
                          className="text-sm text-zinc-400 transition hover:text-goldbright"
                        >
                          {l.label}
                        </a>
                      ) : (
                        <Link to={l.to} className="text-sm text-zinc-400 transition hover:text-goldbright">
                          {l.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-7 font-mono text-[11px] text-mist/70">
          <span>© 2026 CoinWatch Labs</span>
          <span>Not financial advice. Findings come with receipts.</span>
        </div>
      </div>
    </footer>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-screen bg-ink font-sans text-zinc-100 selection:bg-gold/30 selection:text-goldbright">
      <div className="grain" />
      <LandingNav />
      <main>
        <Hero />
        <Ticker />
        <Anatomy />
        <Markets />
        <Hub />
        <Protocol />
        <QuickNode />
        <Stats />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
