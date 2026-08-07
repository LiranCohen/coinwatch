export interface Market {
  id: string;
  category: string;
  question: string;
  p: number;
  open: number;
  analysts: string;
  volume: string;
  spark: number[];
}

export interface HubCard {
  kind: 'model' | 'dataset' | 'paper';
  name: string;
  blurb: string;
  tags: string[];
  downloads?: string;
  likes: string;
  meta: string;
}

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function walk(seed: number, start: number, n = 28): number[] {
  const r = rng(seed);
  const out = [start];
  for (let i = 1; i < n; i++) {
    out.push(Math.min(96, Math.max(4, out[i - 1] + (r() - 0.48) * 4)));
  }
  return out;
}

export const MARKETS: Market[] = [
  {
    id: 'whale-3114-mixer',
    category: 'WHALES',
    question: 'Dormant whale #3,114 is routing funds to a mixer?',
    p: 87.4,
    open: 85.3,
    analysts: '12.4k',
    volume: '1,204',
    spark: walk(11, 79),
  },
  {
    id: 'cluster-july-breach',
    category: 'EXPLOITS',
    question: 'Cluster 9f4c…e2 is tied to the July exchange breach?',
    p: 63.2,
    open: 61.8,
    analysts: '8.1k',
    volume: '862',
    spark: walk(23, 55),
  },
  {
    id: 'coinjoin-coordinated',
    category: 'PRIVACY',
    question: 'This week\u2019s CoinJoin spike is coordinated across wallets?',
    p: 35.2,
    open: 36.4,
    analysts: '5.9k',
    volume: '647',
    spark: walk(37, 41),
  },
  {
    id: 'dust-attack',
    category: 'MEMPOOL',
    question: 'The fee-market spike is an active dust attack?',
    p: 28.4,
    open: 29.7,
    analysts: '4.2k',
    volume: '389',
    spark: walk(53, 35),
  },
];

export const TICKER_ITEMS: { label: string; p: string; delta: number }[] = [
  { label: 'Whale #3,114 → mixer', p: '87.4%', delta: 2.1 },
  { label: 'Cluster 9f4c… = July breach', p: '63.2%', delta: 1.4 },
  { label: 'CoinJoin spike coordinated', p: '35.2%', delta: 0.6 },
  { label: 'Fee spike = dust attack', p: '28.4%', delta: 3.2 },
  { label: '2011-era coins moving', p: '54.6%', delta: 0.9 },
  { label: 'Exchange wallet mislabeled', p: '22.8%', delta: -1.2 },
  { label: 'Ransom via CoinJoin chain', p: '41.7%', delta: -0.8 },
  { label: 'Treasury accumulation pattern', p: '71.9%', delta: 1.1 },
];

export const HUB_CARDS: HubCard[] = [
  {
    kind: 'model',
    name: 'coinwatch/mempool-sentiment-v2',
    blurb: 'Transformer that scores mempool composition shifts before they show up in fee markets.',
    tags: ['time-series', 'transformer', 'bitcoin'],
    downloads: '84.2k',
    likes: '1,204',
    meta: 'Updated 3h ago',
  },
  {
    kind: 'model',
    name: 'coinwatch/whale-cluster-gnn',
    blurb: 'Graph network that clusters UTXO flows into probable entities, and the crowd keeps it honest.',
    tags: ['graph', 'clustering', 'utxo'],
    downloads: '31.7k',
    likes: '862',
    meta: 'Updated 1d ago',
  },
  {
    kind: 'dataset',
    name: 'coinwatch/liquidation-events-2026',
    blurb: 'Every labeled liquidation cascade this year, cross-checked against three independent nodes.',
    tags: ['parquet', '4.1M rows', 'labeled'],
    downloads: '12.9k',
    likes: '445',
    meta: 'Updated 6h ago',
  },
  {
    kind: 'paper',
    name: 'Reputation-Weighted Consensus for Wallet Attribution',
    blurb: 'Brier-scored analyst reputation as a weighting mechanism, beating naive vote-counting by 18%.',
    tags: ['CW-2026-014', 'attribution'],
    likes: '38 citations',
    meta: 'Aug 2026',
  },
];
