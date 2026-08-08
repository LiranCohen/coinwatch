import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import { SessionProvider } from '../session';
import { AccountButton } from './AccountButton';
import { LogoMark } from './landing/LogoMark';

function NavItem({ to, label, end = false }: { to: string; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `rounded px-2.5 py-1 text-sm ${
          isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
        }`
      }
    >
      {label}
    </NavLink>
  );
}

export function AppShell() {
  return (
    <SessionProvider>
      <div className="min-h-screen">
      <header className="tex-brushed seam sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <NavLink to="/app" className="flex items-center gap-2.5">
            <LogoMark size={22} />
            <span className="text-lg font-bold tracking-tight text-zinc-50">CoinWatch</span>
          </NavLink>
          <nav className="flex items-center gap-1">
            <NavItem to="/app" label="Feed" end />
            <NavItem to="/app/web-of-trust" label="Web of Trust" />
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <a
              href="/api/feed.xml"
              className="hidden text-xs text-zinc-500 hover:text-zinc-300 sm:inline"
              title="RSS feed of detected events"
            >
              RSS
            </a>
            <AccountButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-5">
        <Suspense fallback={<p className="py-16 text-center text-sm text-zinc-500">Loading…</p>}>
          <Outlet />
        </Suspense>
      </main>
      </div>
    </SessionProvider>
  );
}
