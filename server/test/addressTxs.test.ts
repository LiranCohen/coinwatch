import { describe, test, expect } from 'bun:test';
import type { AddressChainTxsResponse } from '@chainwatch/shared';
import { openDatabase, insertEvent } from '../src/store/db';
import { createAddressTxRoutes } from '../src/api/addressTxs';
import { loadConfig } from '../src/config';
import type { EsploraClient, EsploraTx } from '../src/ingest/esplora';

const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const OTHER = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';

function txid(seed: string): string {
  return seed.repeat(64).slice(0, 64);
}

function makeTx(overrides: Partial<EsploraTx> = {}): EsploraTx {
  return {
    txid: txid('a'),
    inputs: [{ txid: txid('f'), vout: 0, address: OTHER, valueSats: 100_000 }],
    outputs: [{ address: ADDRESS, valueSats: 90_000, n: 0 }],
    feeSats: 10_000,
    sizeBytes: 200,
    weight: 800,
    confirmed: true,
    blockHeight: 800_000,
    blockHash: txid('b'),
    blockTime: '2026-08-07T00:00:00.000Z',
    isCoinbase: false,
    ...overrides,
  };
}

/** only addressTxs is exercised; the rest of the client is irrelevant here */
function stubEsplora(behaviour: () => Promise<EsploraTx[]>): EsploraClient {
  return { addressTxs: behaviour } as unknown as EsploraClient;
}

function makeApp(behaviour: () => Promise<EsploraTx[]>) {
  const db = openDatabase(':memory:');
  const app = createAddressTxRoutes({ db, esplora: stubEsplora(behaviour), warn: () => {} });
  return { db, app };
}

describe('GET /api/addresses/:address/transactions', () => {
  test('reports value movement signed from the address point of view', async () => {
    const { app } = makeApp(async () => [makeTx()]);
    const res = await app.request(`/api/addresses/${ADDRESS}/transactions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AddressChainTxsResponse;
    expect(body.available).toBe(true);
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0].deltaSats).toBe(90_000);
    expect(body.transactions[0].inputCount).toBe(1);
    expect(body.transactions[0].outputCount).toBe(1);
  });

  test('nets out an address that appears on both sides', async () => {
    const { app } = makeApp(async () => [
      makeTx({
        inputs: [{ txid: txid('f'), vout: 0, address: ADDRESS, valueSats: 500_000 }],
        outputs: [
          { address: OTHER, valueSats: 300_000, n: 0 },
          { address: ADDRESS, valueSats: 190_000, n: 1 },
        ],
      }),
    ]);
    const body = (await (await app.request(`/api/addresses/${ADDRESS}/transactions`)).json()) as AddressChainTxsResponse;
    // spent 500_000, received 190_000 back as change
    expect(body.transactions[0].deltaSats).toBe(-310_000);
  });

  test('carries entropy so a caller can judge each transaction', async () => {
    const { app } = makeApp(async () => [
      makeTx({
        inputs: [
          { txid: txid('f'), vout: 0, address: OTHER, valueSats: 100_000_000 },
          { txid: txid('e'), vout: 0, address: OTHER, valueSats: 100_000_000 },
        ],
        outputs: [
          { address: ADDRESS, valueSats: 100_000_000, n: 0 },
          { address: OTHER, valueSats: 100_000_000, n: 1 },
        ],
        feeSats: 0,
      }),
    ]);
    const body = (await (await app.request(`/api/addresses/${ADDRESS}/transactions`)).json()) as AddressChainTxsResponse;
    const entropy = body.transactions[0].entropy;
    expect(entropy?.status).toBe('ok');
    // two equal inputs against two equal outputs is the canonical ambiguous shape
    expect(entropy?.combinations).toBe(3);
  });

  test('links a transaction the detector already caught', async () => {
    const { db, app } = makeApp(async () => [makeTx()]);
    const { row } = insertEvent(db, {
      txid: txid('a'),
      rules: ['whale'],
      valueSats: 90_000,
      inputs: [{ address: OTHER, valueSats: 100_000 }],
      outputs: [{ address: ADDRESS, valueSats: 90_000 }],
    });
    const body = (await (await app.request(`/api/addresses/${ADDRESS}/transactions`)).json()) as AddressChainTxsResponse;
    expect(body.transactions[0].eventId).toBe(row!.id);
  });

  test('coinbase transactions are reported without entropy rather than with a wrong one', async () => {
    const { app } = makeApp(async () => [
      makeTx({
        isCoinbase: true,
        inputs: [{ txid: null, vout: null, address: null, valueSats: 0 }],
      }),
    ]);
    const body = (await (await app.request(`/api/addresses/${ADDRESS}/transactions`)).json()) as AddressChainTxsResponse;
    expect(body.transactions[0].entropy).toBeNull();
  });

  test('an unreachable chain source is stated, not disguised as an empty address', async () => {
    const { app } = makeApp(async () => {
      throw new Error('all endpoints failed');
    });
    const res = await app.request(`/api/addresses/${ADDRESS}/transactions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AddressChainTxsResponse;
    expect(body.available).toBe(false);
    expect(body.transactions).toEqual([]);
  });

  test('rejects an address that fails checksum validation', async () => {
    const { app } = makeApp(async () => []);
    const res = await app.request('/api/addresses/notanaddress/transactions');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBeTruthy();
  });

  test('normalizes before lookup so casing cannot split an address', async () => {
    let asked = '';
    const { app } = makeApp(async () => []);
    const db = openDatabase(':memory:');
    const app2 = createAddressTxRoutes({
      db,
      esplora: {
        addressTxs: async (addr: string) => {
          asked = addr;
          return [];
        },
      } as unknown as EsploraClient,
      warn: () => {},
    });
    await app2.request(`/api/addresses/${ADDRESS.toUpperCase()}/transactions`);
    expect(asked).toBe(ADDRESS);
    void app;
  });
});

describe('chain provider configuration', () => {
  test('defaults span independent operators so one outage is survivable', () => {
    const apis = loadConfig({}).chainApis;
    expect(apis.length).toBeGreaterThan(2);
    expect(new Set(apis).size).toBe(apis.length);
    for (const url of apis) expect(url.startsWith('https://')).toBe(true);
  });

  test('CHAIN_APIS replaces the list outright', () => {
    const apis = loadConfig({ CHAIN_APIS: 'https://a.test/api, https://b.test/api' }).chainApis;
    expect(apis).toEqual(['https://a.test/api', 'https://b.test/api']);
  });

  test('a single-endpoint override is tried first, with the defaults kept as fallback', () => {
    const apis = loadConfig({ MEMPOOL_API: 'https://mine.test/api' }).chainApis;
    expect(apis[0]).toBe('https://mine.test/api');
    expect(apis.length).toBeGreaterThan(1);
  });

  test('an empty CHAIN_APIS list is a configuration error, not a silent no-provider state', () => {
    expect(() => loadConfig({ CHAIN_APIS: ' , ' })).toThrow(/at least one endpoint/);
  });
});
