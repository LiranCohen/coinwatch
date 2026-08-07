export interface Config {
  bitcoindRpcUrl: string;
  bitcoindRpcUser: string | null;
  bitcoindRpcPassword: string | null;
  pollIntervalMs: number;
  whaleThresholdBtc: number;
  dormantBlocks: number;
  dormantMinValueBtc: number;
  coinjoinMinEqualOutputs: number;
  mempoolApi: string;
  blockstreamApi: string;
  aiBaseUrl: string | null;
  aiApiKey: string | null;
  aiModel: string | null;
  injectorEnabled: boolean;
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

export function loadConfig(env: Env = process.env): Config {
  return {
    bitcoindRpcUrl: str(env, 'BITCOIND_RPC_URL', 'http://127.0.0.1:8332'),
    bitcoindRpcUser: strOrNull(env, 'BITCOIND_RPC_USER'),
    bitcoindRpcPassword: strOrNull(env, 'BITCOIND_RPC_PASSWORD'),
    pollIntervalMs: num(env, 'POLL_INTERVAL_MS', 5000),
    whaleThresholdBtc: num(env, 'WHALE_THRESHOLD_BTC', 10),
    dormantBlocks: num(env, 'DORMANT_BLOCKS', 4320),
    dormantMinValueBtc: num(env, 'DORMANT_MIN_VALUE_BTC', 1),
    coinjoinMinEqualOutputs: num(env, 'COINJOIN_MIN_EQUAL_OUTPUTS', 5),
    mempoolApi: str(env, 'MEMPOOL_API', 'https://mempool.space/api'),
    blockstreamApi: str(env, 'BLOCKSTREAM_API', 'https://blockstream.info/api'),
    aiBaseUrl: strOrNull(env, 'AI_BASE_URL'),
    aiApiKey: strOrNull(env, 'AI_API_KEY'),
    aiModel: strOrNull(env, 'AI_MODEL'),
    injectorEnabled: bool(env, 'INJECTOR_ENABLED', false),
    port: num(env, 'PORT', 3001),
    seedFile: str(env, 'SEED_FILE', 'server/fixtures/seed-labels.json'),
    dbFile: str(env, 'DB_FILE', 'server/data/chainwatch.sqlite'),
  };
}
