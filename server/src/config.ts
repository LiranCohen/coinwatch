import { join } from 'node:path';

const serverRoot = join(import.meta.dir, '..');

export interface Config {
  /**
   * Where transactions come from. 'bitcoind' insists on the operator's own node,
   * 'esplora' uses public explorers, 'auto' prefers the node and falls back.
   */
  chainSource: 'auto' | 'bitcoind' | 'esplora';
  bitcoindRpcUrl: string;
  bitcoindRpcUser: string | null;
  bitcoindRpcPassword: string | null;
  pollIntervalMs: number;
  whaleThresholdBtc: number;
  dormantBlocks: number;
  dormantMinValueBtc: number;
  coinjoinMinEqualOutputs: number;
  /** equal-output value floor below which a match is batching, not mixing */
  coinjoinMinDenominationBtc: number;
  mempoolApi: string;
  blockstreamApi: string;
  aiBaseUrl: string | null;
  aiApiKey: string | null;
  aiModel: string | null;
  injectorEnabled: boolean;
  /** load the fabricated demo analysts/events/votes fixture (off by default) */
  demoSeedEnabled: boolean;
  port: number;
  seedFile: string;
  dbFile: string;
}

type Env = Record<string, string | undefined>;

function str(env: Env, key: string, fallback: string): string {
  const v = env[key];
  return v === undefined || v === '' ? fallback : v;
}

function strOrNull(env: Env, key: string): string | null {
  const v = env[key];
  return v === undefined || v === '' ? null : v;
}

function num(env: Env, key: string, fallback: number): number {
  const v = env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`config: ${key} must be a number, got ${JSON.stringify(v)}`);
  }
  return n;
}

function bool(env: Env, key: string, fallback: boolean): boolean {
  const v = env[key];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1';
}

function chainSource(env: Env): Config['chainSource'] {
  const value = str(env, 'CHAIN_SOURCE', 'auto');
  if (value !== 'auto' && value !== 'bitcoind' && value !== 'esplora') {
    throw new Error(`config: CHAIN_SOURCE must be auto, bitcoind or esplora, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function loadConfig(env: Env = process.env): Config {
  return {
    chainSource: chainSource(env),
    bitcoindRpcUrl: str(env, 'BITCOIND_RPC_URL', 'http://127.0.0.1:8332'),
    bitcoindRpcUser: strOrNull(env, 'BITCOIND_RPC_USER'),
    bitcoindRpcPassword: strOrNull(env, 'BITCOIND_RPC_PASSWORD'),
    pollIntervalMs: num(env, 'POLL_INTERVAL_MS', 5000),
    whaleThresholdBtc: num(env, 'WHALE_THRESHOLD_BTC', 10),
    dormantBlocks: num(env, 'DORMANT_BLOCKS', 4320),
    dormantMinValueBtc: num(env, 'DORMANT_MIN_VALUE_BTC', 1),
    coinjoinMinEqualOutputs: num(env, 'COINJOIN_MIN_EQUAL_OUTPUTS', 5),
    coinjoinMinDenominationBtc: num(env, 'COINJOIN_MIN_DENOMINATION_BTC', 0.001),
    mempoolApi: str(env, 'MEMPOOL_API', 'https://mempool.space/api'),
    blockstreamApi: str(env, 'BLOCKSTREAM_API', 'https://blockstream.info/api'),
    aiBaseUrl: strOrNull(env, 'AI_BASE_URL'),
    aiApiKey: strOrNull(env, 'AI_API_KEY'),
    aiModel: strOrNull(env, 'AI_MODEL'),
    injectorEnabled: bool(env, 'INJECTOR_ENABLED', false),
    demoSeedEnabled: bool(env, 'DEMO_SEED', false),
    port: num(env, 'PORT', 3001),
    seedFile: str(env, 'SEED_FILE', join(serverRoot, 'fixtures/seed-labels.json')),
    dbFile: str(env, 'DB_FILE', join(serverRoot, 'data/chainwatch.sqlite')),
  };
}
