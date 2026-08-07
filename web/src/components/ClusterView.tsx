import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { AddressCluster } from '@chainwatch/shared';

import { getAddressCluster } from '../api/client';
import { truncateMiddle } from '../lib/format';
import { InfoPopover } from './InfoPopover';

interface ClusterViewProps {
  address: string;
}

/**
 * Wallet clustering by common input ownership. Signing one transaction with
 * several inputs proves a single party held all those keys, which is the one
 * link chain data establishes rather than infers.
 */
export function ClusterView({ address }: ClusterViewProps) {
  const [cluster, setCluster] = useState<AddressCluster | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCluster(null);
    setFailed(false);
    getAddressCluster(address)
      .then((res) => {
        if (!cancelled) setCluster(res);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  return (
    <section>
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wider text-zinc-400">
        SAME OWNER
        <InfoPopover label="same owner">
          Addresses that signed a transaction together with this one. Signing for several inputs at
          once means one party held all those keys, so this is proven rather than guessed. Coinjoins
          are excluded, because their inputs belong to different people on purpose.
        </InfoPopover>
      </h2>

      {failed || cluster?.available === false ? (
        <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-6 text-center text-xs text-zinc-500">
          The chain source could not be reached, so no clustering was attempted. This is not a
          statement that the address stands alone.
        </p>
      ) : cluster === null ? (
        <div className="cw-pulse h-24 rounded-lg border border-zinc-800 bg-zinc-900/40" />
      ) : (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="mb-3 flex flex-wrap gap-4">
            <div>
              <p className="tnum font-mono text-lg font-semibold text-zinc-100">
                {cluster.members.length}
              </p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">linked addresses</p>
            </div>
            <div>
              <p className="tnum font-mono text-lg font-semibold text-zinc-100">
                {cluster.bindingTxids.length}
              </p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">proving signatures</p>
            </div>
          </div>

          {cluster.patterns.length > 0 && (
            <ul className="mb-3 space-y-1">
              {cluster.patterns.map((pattern) => (
                <li key={pattern} className="flex items-baseline gap-2 text-xs text-zinc-300">
                  <span className="text-amber-400">▸</span>
                  <span>{pattern}</span>
                </li>
              ))}
            </ul>
          )}

          {cluster.members.length > 0 && (
            <div className="overflow-hidden rounded border border-zinc-800">
              {cluster.members.slice(0, 12).map((member, i) => (
                <div
                  key={member.address}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 text-xs ${
                    i % 2 === 0 ? 'bg-zinc-900/60' : 'bg-zinc-900/30'
                  }`}
                >
                  <Link
                    to={`/app/address/${member.address}`}
                    className="font-mono text-sky-400 hover:underline"
                  >
                    {truncateMiddle(member.address, 14, 10)}
                  </Link>
                  {member.labels.length > 0 && (
                    <span className="text-[10px] text-sky-300">{member.labels[0]}</span>
                  )}
                  <span className="tnum ml-auto text-[10px] text-zinc-500">
                    {member.cospends} co-spend{member.cospends === 1 ? '' : 's'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {cluster.note && <p className="mt-2 text-[11px] text-zinc-600">{cluster.note}</p>}
        </div>
      )}
    </section>
  );
}
