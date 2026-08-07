import { describe, test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { Database } from 'bun:sqlite';
import { openDatabase } from '../src/store/db';
import { createPipeline, normalizeTx, type Pipeline } from '../src/detect/pipeline';
import type {
  BitcoinRpc,
  VerboseTx,
  BlockInfo,
  BlockchainInfo,
} from '../src/rpc/client';
import type { AddressInfoClient } from '../src/external/addressinfo';
import { loadConfig, type Config } from '../src/config';
import type { EventRow } from '../src/store/db';
import type { AddressActivity } from '../src/detect/rules';

const SATS = 100_000_000;

const CONFIG: Config = {
  ...loadConfig({}),
  pollIntervalMs: 50,
  whaleThresholdBtc: 10,
  dormantBlocks: 4320,
  dormantMinValueBtc: 1,
  coinjoinMinEqualOutputs: 5,
};

function txid(seed: string): string {
  return seed.repeat(64).slice(0, 64);
}

function makeRawTx(
  id: string,
  outputs: { address: string; btc: number }[],
  inputs: { address: string; btc: number }[] = [{ address: 'bc1qsource', btc: 1 }],
): VerboseTx {
  return {
    txid: id,
    vin: inputs.map((input, n) => ({
      txid: txid(`${n}f`),
      vout: 0,
      prevout: {
        value: input.btc,
        scriptPubKey: { address: input.address },
      },
    })),
    vout: outputs.map((output, n) => ({
      value: output.btc,
      n,
      scriptPubKey: { address: output.address },
    })),
  };
}

class FakeRpc implements BitcoinRpc {
  mempool = new Set<string>();
  txs = new Map<string, VerboseTx>();
  confirmed = new Set<string>();
  blocks = 800_000;
  failMempool = false;
  fetchCalls: string[] = [];

  addTx(tx: VerboseTx): void {
    this.txs.set(tx.txid, tx);
    this.mempool.add(tx.txid);
  }

  async getblockchaininfo(): Promise<BlockchainInfo> {
    return { chain: 'main', blocks: this.blocks, headers: this.blocks, bestblockhash: txid('e') };
  }

  async getrawmempool(): Promise<string[]> {
    if (this.failMempool) throw new Error('bitcoind: connection refused');
    return [...this.mempool];
  }

  async getrawtransaction(id: string): Promise<VerboseTx> {
    this.fetchCalls.push(id);
    const tx = this.txs.get(id);
    if (!tx) throw new Error(`No such mempool or blockchain transaction ${id}`);
    if (this.confirmed.has(id)) return { ...tx, blockhash: txid('b') };
    return tx;
  }

  async getblockhash(height: number): Promise<string> {
    return txid('b');
  }

  async getblock(hash: string): Promise<BlockInfo> {
    return { hash, height: this.blocks, tx: [...this.confirmed] };
  }
}

function makeHarness(addressInfo?: AddressInfoClient) {
  const db = openDatabase(':memory:');
  const rpc = new FakeRpc();
  const emitter = new EventEmitter();
  const warnings: string[] = [];
  const newEvents: EventRow[] = [];
  const updates: EventRow[] = [];
  emitter.on('event:new', (row: EventRow) => newEvents.push(row));
  emitter.on('event:update', (row: EventRow) => updates.push(row));
  const pipeline = createPipeline({
    db,
    rpc,
    config: CONFIG,
    addressInfo: addressInfo ?? null,
    emitter,
    warn: (m) => warnings.push(m),
    log: () => {},
  });
  return { db, rpc, pipeline, newEvents, updates, warnings };
}

const WHALE_TX = () => makeRawTx(txid('a'), [{ address: 'bc1qdest', btc: 15 }], [{ address: 'bc1qwhalein', btc: 16 }]);
const SMALL_TX = (seed: string) => makeRawTx(txid(seed), [{ address: 'bc1qdest', btc: 0.5 }], [{ address: 'bc1qsmallin', btc: 0.6 }]);

describe('pipeline', () => {
  test('first poll is baseline-only: no fetches, no events, no backfill', async () => {
    const { db, rpc, pipeline, newEvents } = makeHarness();
    rpc.addTx(WHALE_TX());
    await pipeline.poll();
    expect(rpc.fetchCalls).toEqual([]);
    expect(newEvents).toEqual([]);
    expect((db.query('SELECT COUNT(*) n FROM events').get() as { n: number }).n).toBe(0);
  });

  test('new matching tx persists and emits event:new; below-threshold tx does not (AE1)', async () => {
    const { db, rpc, pipeline, newEvents } = makeHarness();
    await pipeline.poll();

    const whaleTx = WHALE_TX();
    rpc.addTx(whaleTx);
    rpc.addTx(SMALL_TX('c'));
    await pipeline.poll();

    expect(newEvents.map((r) => r.txid)).toEqual([whaleTx.txid]);
    expect(JSON.parse(newEvents[0].rules)).toEqual(['whale']);
    expect(newEvents[0].value_sats).toBe(15 * SATS);
    expect(newEvents[0].status).toBe('active');
    const stored = db.query('SELECT * FROM events').all() as EventRow[];
    expect(stored.map((r) => r.txid)).toEqual([whaleTx.txid]);
    expect(JSON.parse(stored[0].inputs)[0].address).toBe('bc1qwhalein');
  });

  test('re-seen txid does not duplicate; restart baseline creates no backfill', async () => {
    const { db, rpc, pipeline, newEvents } = makeHarness();
    await pipeline.poll();
    rpc.addTx(WHALE_TX());
    await pipeline.poll();
    await pipeline.poll();
    expect(newEvents).toHaveLength(1);

    const emitter = new EventEmitter();
    const restarted: EventRow[] = [];
    emitter.on('event:new', (row: EventRow) => restarted.push(row));
    const pipeline2 = createPipeline({ db, rpc, config: CONFIG, emitter, log: () => {}, warn: () => {} });
    await pipeline2.poll();
    expect(restarted).toEqual([]);
    expect((db.query('SELECT COUNT(*) n FROM events').get() as { n: number }).n).toBe(1);
  });

  test('tx vanishing from mempool becomes evicted; in-block becomes confirmed; both emit event:update', async () => {
    const { db, rpc, pipeline, updates } = makeHarness();
    await pipeline.poll();
    const evictTx = WHALE_TX();
    const confirmTx = SMALL_TX('d');
    rpc.addTx(evictTx);
    rpc.addTx(makeRawTx(txid('e'), [{ address: 'bc1qdest', btc: 20 }], [{ address: 'bc1qin2', btc: 21 }]));
    await pipeline.poll();

    rpc.mempool.delete(evictTx.txid);
    rpc.mempool.delete(txid('e'));
    rpc.confirmed.add(txid('e'));
    await pipeline.poll();

    expect(updates).toHaveLength(2);
    const byTxid = new Map(updates.map((r) => [r.txid, r.status]));
    expect(byTxid.get(evictTx.txid)).toBe('evicted');
    expect(byTxid.get(txid('e'))).toBe('confirmed');
    const rows = db.query('SELECT txid, status FROM events ORDER BY txid').all() as {
      txid: string;
      status: string;
    }[];
    expect(rows.find((r) => r.txid === evictTx.txid)!.status).toBe('evicted');
    expect(rows.find((r) => r.txid === txid('e'))!.status).toBe('confirmed');

    await pipeline.poll();
    expect(updates).toHaveLength(2);
  });

  test('RPC failure is swallowed and retried on next poll', async () => {
    const { rpc, pipeline, newEvents, warnings } = makeHarness();
    await pipeline.poll();
    rpc.failMempool = true;
    await pipeline.poll();
    expect(warnings.some((w) => w.includes('poll failed'))).toBe(true);

    rpc.failMempool = false;
    rpc.addTx(WHALE_TX());
    await pipeline.poll();
    expect(newEvents).toHaveLength(1);
  });

  test('dormant-wake flows through pipeline via address history stub (AE2)', async () => {
    const staleAddr = 'bc1qdormant';
    const activity: AddressActivity[] = [
      { txid: txid('9'), spendsFromAddress: true, blockHeight: 800_000 - 9000 },
    ];
    const addressInfo: AddressInfoClient = {
      getAddressTxs: async () => [],
      getAddressStats: async () => null,
      getAddressActivity: async () => activity,
    };
    const { rpc, pipeline, newEvents } = makeHarness(addressInfo);
    await pipeline.poll();
    rpc.addTx(
      makeRawTx(txid('f'), [{ address: 'bc1qdest', btc: 2 }], [{ address: staleAddr, btc: 2.5 }]),
    );
    await pipeline.poll();
    expect(newEvents).toHaveLength(1);
    expect(JSON.parse(newEvents[0].rules)).toEqual(['dormant-wake']);
  });

  test('normalizeTx maps prevout/vout and converts BTC to sats integers', () => {
    const raw = makeRawTx(
      txid('0'),
      [{ address: 'bc1qout', btc: 0.1 }],
      [{ address: 'bc1qin', btc: 0.2 }],
    );
    const tx = normalizeTx(raw);
    expect(tx.totalOutputSats).toBe(10_000_000);
    expect(tx.inputs[0]).toEqual({ address: 'bc1qin', valueSats: 20_000_000 });
    expect(tx.outputs[0]).toEqual({ address: 'bc1qout', valueSats: 10_000_000 });
  });
});
