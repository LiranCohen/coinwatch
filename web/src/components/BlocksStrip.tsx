import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { formatCoins, truncateMiddle } from '../lib/format';

/**
 * Live-looking incoming block ticker. Heights advance on a fixed cadence from a
 * constant anchor, so every visitor sees the same chain state and a new block
 * "arrives" while they watch. Notable txs reference real labeled addresses so
 * the tag flow lands on a populated address page.
 */
const ANCHOR_MS = 1786060800000; // 2026-08-07T00:00Z
const ANCHOR_HEIGHT = 935_112;
const BLOCK_MS = 150_000;

const MINERS = ['Foundry USA', 'AntPool', 'F2Pool', 'ViaBTC', 'MARA Pool', 'SpiderPool', 'Ocean', 'Braiins'];

const NOTABLE_ADDRESSES = [
  '16ftSEQ4ctQFDtVZiUBusQUjRrGhM3JYwe',
  '1129A9dFqy4ABDsGQ8RGusbMWYBoZc4myc',
  '196pUYs6kGpwii2KjV138SXrJ2hwKLaMVr',
  '12qTdZHx6f77aQ74CPCZGSY47VaRwYjVD8',
  '17Jhdq75dX77ZdkVQrcozMXd54WGHAxrw',
  '19jQz2ajiCN1hmavUkCrxKWnZwCfhQgJ9e',
  '17K6RT4s3RidxRhq5gPwkLARs86wUQvk7C',
  '16TTYQEwSM5krF5MkQx6d1ePaHk4DPeq7a',
  '18Zcyxqna6h7Z7bRjhKvGpr8HSfieQWXqj',
  '14XKsv8tT6tt8P8mfDQZgNF8wtN5erNu5D',
  '152f1muMCNa7goXYhYAQC61hxEgGacmncB',
  '19VBqLkbMywnX5QMUg7LsHgbzsLh9as4MS',
];

const HEX = '0123456789abcdef';

function rng(seed: number): () => number {
  let h = seed | 0 || 1;
  return () => {
    h = Math.imul(h ^ (h >>> 15), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
  };
}

interface MockBlock {
  height: number;
  txCount: number;
  sizeMb: number;
  feeRate: number;
  miner: string;
  agoMs: number;
}

interface NotableTx {
  txid: string;
  valueSats: number;
  address: string;
}

function blockAt(height: number, agoMs: number): MockBlock {
  const rand = rng(height);
  return {
    height,
    txCount: 2400 + Math.floor(rand() * 1900),
    sizeMb: 1.42 + rand() * 0.55,
    feeRate: 3 + Math.floor(rand() * 18),
    miner: MINERS[Math.floor(rand() * MINERS.length)],
    agoMs,
  };
}

function notableTxs(height: number): NotableTx[] {
  const rand = rng(height * 31 + 7);
  return Array.from({ length: 4 }, () => {
    let txid = '';
    for (let i = 0; i < 64; i++) txid += HEX[Math.floor(rand() * 16)];
    return {
      txid,
      valueSats: Math.floor((0.4 + rand() * 220) * 1e8),
      address: NOTABLE_ADDRESSES[Math.floor(rand() * NOTABLE_ADDRESSES.length)],
    };
  });
}

function fmtAgo(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

export function BlocksStrip() {
  const navigate = useNavigate();
  const [now, setNow] = useState(() => Date.now());
  const [openHeight, setOpenHeight] = useState<number | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const tip = ANCHOR_HEIGHT + Math.floor((now - ANCHOR_MS) / BLOCK_MS);
  const sinceTip = (now - ANCHOR_MS) % BLOCK_MS;

  const blocks = useMemo(
    () => Array.from({ length: 6 }, (_, i) => blockAt(tip - i, sinceTip + i * BLOCK_MS)),
    [tip, sinceTip],
  );
  const open = openHeight === null ? null : blocks.find((b) => b.height === openHeight) ?? null;
  const txs = useMemo(() => (open ? notableTxs(open.height) : []), [open]);

  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Incoming blocks</span>
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
        </span>
        <span className="text-[10px] text-zinc-600">click a block for notable transactions</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {blocks.map((b, i) => (
          <button
            key={b.height}
            type="button"
            onClick={() => setOpenHeight(openHeight === b.height ? null : b.height)}
            className={`min-w-[118px] shrink-0 rounded-lg border px-3 py-2 text-left transition-colors ${
              openHeight === b.height
                ? 'border-sky-400 bg-sky-500/10'
                : i === 0
                  ? 'border-emerald-500/50 bg-emerald-500/5 hover:border-emerald-400'
                  : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-600'
            }`}
          >
            <p className="tnum font-mono text-sm font-semibold text-zinc-100">#{b.height.toLocaleString()}</p>
            <p className="text-[10px] text-zinc-500">
              {b.txCount.toLocaleString()} txs · {b.sizeMb.toFixed(2)} MB
            </p>
            <p className="text-[10px] text-zinc-500">~{b.feeRate} sat/vB</p>
            <p className="mt-0.5 flex items-baseline justify-between gap-2 text-[10px]">
              <span className="text-zinc-400">{b.miner}</span>
              <span className="text-zinc-600">{fmtAgo(b.agoMs)}</span>
            </p>
          </button>
        ))}
      </div>

      {open && (
        <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Notable in block #{open.height.toLocaleString()} — spot something? Tag it.
          </p>
          <ul className="space-y-1.5">
            {txs.map((tx) => (
              <li key={tx.txid} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="font-mono text-zinc-500">{truncateMiddle(tx.txid, 10, 8)}</span>
                <span className="tnum font-mono text-zinc-200">{formatCoins(tx.valueSats)}</span>
                <span className="font-mono text-sky-400">{truncateMiddle(tx.address, 8, 6)}</span>
                <button
                  type="button"
                  onClick={() => navigate(`/app/address/${tx.address}`)}
                  className="ml-auto rounded border border-sky-500/50 bg-sky-500/10 px-2 py-0.5 font-medium text-sky-300 hover:bg-sky-500/20"
                >
                  Tag address
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
