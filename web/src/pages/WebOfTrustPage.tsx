import { useEffect, useState } from 'react';

import type { LeaderboardEntry, TrustGraphData } from '@chainwatch/shared';

import { getLeaderboard, getTrustGraph } from '../api/client';
import { ReputationBadge } from '../components/badges';
import { TrustGraph } from '../components/TrustGraph';
import { truncateDid } from '../lib/format';

export function WebOfTrustPage() {
  const [analysts, setAnalysts] = useState<LeaderboardEntry[] | null>(null);
  const [graph, setGraph] = useState<TrustGraphData | null>(null);

  useEffect(() => {
    getLeaderboard()
      .then((res) => setAnalysts(res.analysts))
      .catch(() => setAnalysts([]));
    getTrustGraph()
      .then(setGraph)
      .catch(() => setGraph(null));
  }, []);

  return (
    <div className="max-w-5xl space-y-8">
      <header>
        <h2 className="text-lg font-semibold text-zinc-50">Web of trust</h2>
        <p className="mt-1 max-w-2xl text-sm text-zinc-500">
          Every label is an attestation and every vote is a trust signal, each anchored to a
          portable DID. Reputation is the visible residue of that graph — analysts who attest
          accurately pull their neighborhood toward the truth.
        </p>
      </header>

      <section>
        <h3 className="mb-2 text-xs font-semibold tracking-wider text-zinc-400">THE CROWD, MAPPED</h3>
        {graph ? (
          <TrustGraph data={graph} />
        ) : (
          <p className="cw-pulse rounded-lg border border-zinc-800 px-4 py-16 text-center text-sm text-zinc-500">
            Mapping the crowd…
          </p>
        )}
        <p className="mt-2 text-xs text-zinc-600">
          Drag nodes to untangle the web. Hover or tap a node to isolate its trust neighborhood; click
          empty space to reset.
        </p>
      </section>

      <section>
        <h3 className="mb-1 text-xs font-semibold tracking-wider text-zinc-400">TOP ANALYSTS</h3>
        <p className="mb-3 text-sm text-zinc-500">
          Reputation accrues when the crowd upvotes your labels. Seed imports earn nothing.
        </p>
        {analysts === null ? (
          <p className="cw-pulse text-sm text-zinc-500">Loading…</p>
        ) : analysts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-800 px-4 py-10 text-center">
            <p className="text-sm text-zinc-300">The web is empty.</p>
            <p className="mt-1 text-xs text-zinc-500">
              Create an account and label an address to become the first node.
            </p>
          </div>
        ) : (
          <table className="w-full max-w-3xl border-collapse overflow-hidden rounded-lg text-sm">
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
      </section>
    </div>
  );
}
