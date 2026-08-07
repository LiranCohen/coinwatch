import { NavLink, Navigate, Route, Routes } from 'react-router-dom';

import { AccountButton } from './components/AccountButton';
import { AddressPage } from './pages/AddressPage';
import { FeedPage } from './pages/FeedPage';
import { LeaderboardPage } from './pages/LeaderboardPage';

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
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

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <NavLink to="/" className="flex items-baseline gap-2">
            <span className="text-lg font-bold tracking-tight text-zinc-50">CoinWatch</span>
            <span className="hidden text-xs text-zinc-500 sm:inline">live Bitcoin chain intelligence</span>
          </NavLink>
          <nav className="flex items-center gap-1">
            <NavItem to="/" label="Feed" />
            <NavItem to="/leaderboard" label="Leaderboard" />
          </nav>
          <div className="ml-auto">
            <AccountButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-5">
        <Routes>
          <Route path="/" element={<FeedPage />} />
          <Route path="/address/:address" element={<AddressPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
