import { describe, test, expect } from 'bun:test';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  test('defaults match the backend brief env table', () => {
    const c = loadConfig({});
    expect(c.bitcoindRpcUrl).toBe('http://127.0.0.1:8332');
    expect(c.bitcoindRpcUser).toBeNull();
    expect(c.bitcoindRpcPassword).toBeNull();
    expect(c.pollIntervalMs).toBe(5000);
    expect(c.whaleThresholdBtc).toBe(10);
    expect(c.dormantBlocks).toBe(4320);
    expect(c.dormantMinValueBtc).toBe(1);
    expect(c.coinjoinMinEqualOutputs).toBe(5);
    expect(c.mempoolApi).toBe('https://mempool.space/api');
    expect(c.blockstreamApi).toBe('https://blockstream.info/api');
    expect(c.aiBaseUrl).toBeNull();
    expect(c.aiApiKey).toBeNull();
    expect(c.aiModel).toBeNull();
    expect(c.injectorEnabled).toBe(false);
    expect(c.port).toBe(3001);
    expect(c.seedFile).toBe('server/fixtures/seed-labels.json');
    expect(c.dbFile).toBe('server/data/chainwatch.sqlite');
  });

  test('env overrides are parsed with correct types', () => {
    const c = loadConfig({
      BITCOIND_RPC_URL: 'http://node:8332',
      BITCOIND_RPC_USER: 'u',
      BITCOIND_RPC_PASSWORD: 'p',
      POLL_INTERVAL_MS: '1500',
      WHALE_THRESHOLD_BTC: '25.5',
      DORMANT_BLOCKS: '100',
      DORMANT_MIN_VALUE_BTC: '0.5',
      COINJOIN_MIN_EQUAL_OUTPUTS: '8',
      MEMPOOL_API: 'http://localhost:8999/api',
      BLOCKSTREAM_API: 'http://localhost:3002',
      AI_BASE_URL: 'https://ai.example/v1',
      AI_API_KEY: 'sk-test',
      AI_MODEL: 'model-x',
      INJECTOR_ENABLED: 'true',
      PORT: '4000',
      SEED_FILE: '/tmp/seed.json',
      DB_FILE: ':memory:',
    });
    expect(c.bitcoindRpcUrl).toBe('http://node:8332');
    expect(c.bitcoindRpcUser).toBe('u');
    expect(c.bitcoindRpcPassword).toBe('p');
    expect(c.pollIntervalMs).toBe(1500);
    expect(c.whaleThresholdBtc).toBe(25.5);
    expect(c.dormantBlocks).toBe(100);
    expect(c.dormantMinValueBtc).toBe(0.5);
    expect(c.coinjoinMinEqualOutputs).toBe(8);
    expect(c.mempoolApi).toBe('http://localhost:8999/api');
    expect(c.blockstreamApi).toBe('http://localhost:3002');
    expect(c.aiBaseUrl).toBe('https://ai.example/v1');
    expect(c.aiApiKey).toBe('sk-test');
    expect(c.aiModel).toBe('model-x');
    expect(c.injectorEnabled).toBe(true);
    expect(c.port).toBe(4000);
    expect(c.seedFile).toBe('/tmp/seed.json');
    expect(c.dbFile).toBe(':memory:');
  });

  test('empty-string values fall back to defaults', () => {
    const c = loadConfig({ POLL_INTERVAL_MS: '', INJECTOR_ENABLED: '', AI_API_KEY: '' });
    expect(c.pollIntervalMs).toBe(5000);
    expect(c.injectorEnabled).toBe(false);
    expect(c.aiApiKey).toBeNull();
  });

  test('INJECTOR_ENABLED truthy values', () => {
    expect(loadConfig({ INJECTOR_ENABLED: 'true' }).injectorEnabled).toBe(true);
    expect(loadConfig({ INJECTOR_ENABLED: '1' }).injectorEnabled).toBe(true);
    expect(loadConfig({ INJECTOR_ENABLED: 'yes' }).injectorEnabled).toBe(false);
    expect(loadConfig({ INJECTOR_ENABLED: 'false' }).injectorEnabled).toBe(false);
  });

  test('non-numeric value for a numeric var throws', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow(/PORT/);
  });
});
