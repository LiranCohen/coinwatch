import { useEffect, useState } from 'react';

import type { LeaderboardEntry } from '@chainwatch/shared';

import { getLeaderboard } from '../api/client';
import { ReputationBadge } from '../components/badges';
import { truncateDid } from '../lib/format';

export function LeaderboardPage() {
  const [analysts, setAnalysts] = useState<LeaderboardEntry[] | null>(null);

  useEffect(() => {
    getLeaderboard()
      .then((res) => setAnalysts(res.analysts))
      .catch(() => setAnalysts([]));
  }, []);

  return (
    <div className="max-w-3xl">
      <h2 className="mb-1 text-lg font-semibold text-zinc-50">Top analysts</h2>
      <p className="mb-4 text-sm text-zinc-500">
        Reputation accrues when the crowd upvotes your labels. Seed imports earn nothing.
      </p>
      {analysts === null ? (
        <p className="cw-pulse text-sm text-zinc-500">Loading…</p>
      ) : analysts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-800 px-4 py-10 text-center">
          <p className="text-sm text-zinc-300">No analysts yet.</p>
          <p className="mt-1 text-xs text-zinc-500">Create an account and label an address to take the top spot.</p>
        </div>
      ) : (
        <table className="w-full border-collapse overflow-hidden rounded-lg text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
              <th className="py-2 pr-3 font-medium">#</th>
              <th className="py-2 pr-3 font-medium">Analyst</th>
              <th className="py-2 pr-3 font-medium">Reputation</th>
              <th className="py-2 pr-3 font-medium">Labels</th>
              <th className="py-2 font-medium">Net votes</th>
            </tr>
          </thead>
          <tbody>
            {analysts.map((entry, i) => (
              <tr key={entry.did} className="border-b border-zinc-800/60 last:border-0">
                <td className="tnum py-2.5 pr-3 text-zinc-500">{i + 1}</td>
                <td className="py-2.5 pr-3">
                  <span className={entry.handle ? 'text-zinc-100' : 'font-mono text-zinc-400'}>
                    {entry.handle ?? truncateDid(entry.did)}
                  </span>
                </td>
                <td className="py-2.5 pr-3">
                  <ReputationBadge reputation={entry.reputation} />
                </td>
                <td className="tnum py-2.5 pr-3 text-zinc-300">{entry.labelCount}</td>
                <td className="tnum py-2.5 text-zinc-300">
                  {entry.netVotes > 0 ? `+${entry.netVotes}` : entry.netVotes}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
