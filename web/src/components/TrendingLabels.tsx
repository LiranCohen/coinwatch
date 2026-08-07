import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { Label } from '@chainwatch/shared';

import { getTrending } from '../api/client';

export function TrendingLabels() {
  const [labels, setLabels] = useState<Label[]>([]);

  useEffect(() => {
    let cancelled = false;
    getTrending()
      .then((res) => {
        if (!cancelled) setLabels(res.labels);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (labels.length === 0) return null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      <span className="shrink-0 text-xs font-semibold tracking-wider text-zinc-500">TRENDING</span>
      {labels.slice(0, 10).map((label) => (
        <Link
          key={label.id}
          to={`/address/${label.address}`}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-xs text-zinc-200 hover:border-zinc-500"
        >
          {label.tag}
          <span className="tnum text-emerald-300">+{label.score}</span>
        </Link>
      ))}
    </div>
  );
}
