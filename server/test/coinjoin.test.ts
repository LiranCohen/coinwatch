import { describe, test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { Hono } from 'hono';
import { openDatabase, addBatchTx, findBatchByTxid, insertBatch, insertEvent, listBatchTxs, parseEventMeta, type EventRow } from '../src/store/db';
import { setEventMeta } from '../src/store/batchQueries';
import { createPipeline } from '../src/detect/pipeline';
import { classifyCoinjoin, type NormalizedTx } from '../src/detect/rules';
import { createCoinjoinRoutes } from '../src/api/coinjoins';
import type { BitcoinRpc, VerboseTx, BlockInfo, BlockchainInfo } from '../src/rpc/client';
import { loadConfig, type Config } from '../src/config';
import type { CoinjoinsResponse } from '@chainwatch/shared';

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

function makeTx(overrides: Partial<NormalizedTx> = {}): NormalizedTx {
  return {
    txid: txid('0'),
    // a coinjoin needs enough separate inputs to stand for its participants;
    // tests that care about input structure override this explicitly
    inputs: Array.from({ length: 12 }, (_, n) => ({
      address: `bc1qin${n}`,
      valueSats: SATS,
    })),
    outputs: [{ address: 'bc1qout', valueSats: SATS }],
    totalOutputSats: SATS,
    ...overrides,
  };
}

function equalIo(prefix: string, count: number, valueSats: number) {
  return Array.from({ length: count }, (_, n) => ({
    address: `bc1q${prefix}${n}`,
    valueSats,
  }));
}

describe('classifyCoinjoin', () => {
  test('exactly 5 equal outputs with 5 equal inputs is whirlpool', () => {
    const meta = classifyCoinjoin(
      makeTx({
        inputs: equalIo('in', 5, 50_000_000),
        outputs: equalIo('out', 5, 50_000_000),
        totalOutputSats: 250_000_000,
      }),
      5,
    );
    expect(meta).toEqual({
      kind: 'whirlpool',
      denominationSats: 50_000_000,
      equalOutputCount: 5,
      participantCount: 5,
    });
  });

  test('5 equal outputs without 5 equal inputs is generic', () => {
    const meta = classifyCoinjoin(
      makeTx({
        inputs: [
          { address: 'bc1qa', valueSats: 130_000_000 },
          { address: 'bc1qb', valueSats: 90_000_000 },
          { address: 'bc1qc', valueSats: 40_000_000 },
        ],
        outputs: equalIo('out', 5, 50_000_000),
        totalOutputSats: 250_000_000,
      }),
      5,
    );
    expect(meta?.kind).toBe('generic');
    expect(meta?.equalOutputCount).toBe(5);
    expect(meta?.participantCount).toBe(3);
  });

  describe('rejects transactions that only look like coinjoins', () => {
    test('a single payer batching equal outputs is not a join', () => {
      const meta = classifyCoinjoin(
        makeTx({
          inputs: [{ address: 'bc1qexchange', valueSats: 260_000_000 }],
          outputs: equalIo('out', 8, 50_000_000),
          totalOutputSats: 400_000_000,
        }),
        5,
      );
      expect(meta).toBeNull();
    });

    test('dust-value equal outputs are spray, not mixing', () => {
      const meta = classifyCoinjoin(
        makeTx({ outputs: equalIo('out', 20, 546), totalOutputSats: 20 * 546 }),
        5,
      );
      expect(meta).toBeNull();
    });

    test('far more equal outputs than inputs is a payout batch', () => {
      const meta = classifyCoinjoin(
        makeTx({
          inputs: [
            { address: 'bc1qa', valueSats: 500_000_000 },
            { address: 'bc1qb', valueSats: 500_000_000 },
          ],
          outputs: equalIo('out', 40, 20_000_000),
          totalOutputSats: 800_000_000,
        }),
        5,
      );
      expect(meta).toBeNull();
    });

    test('the denomination floor is configurable', () => {
      const tx = makeTx({ outputs: equalIo('out', 6, 5_000), totalOutputSats: 30_000 });
      expect(classifyCoinjoin(tx, { minEqualOutputs: 5 })).toBeNull();
      expect(
        classifyCoinjoin(tx, { minEqualOutputs: 5, minDenominationSats: 1_000 })?.equalOutputCount,
      ).toBe(6);
    });
  });

  test('6-9 equal outputs is generic (wasabi boundary)', () => {
    for (const count of [6, 9]) {
      const meta = classifyCoinjoin(
        makeTx({ outputs: equalIo('out', count, 100_000), totalOutputSats: count * 100_000 }),
        5,
      );
      expect(meta?.kind).toBe('generic');
      expect(meta?.equalOutputCount).toBe(count);
    }
  });

  test('10+ equal outputs is wasabi', () => {
    for (const count of [10, 12]) {
      const meta = classifyCoinjoin(
        makeTx({ outputs: equalIo('out', count, 100_000), totalOutputSats: count * 100_000 }),
        5,
      );
      expect(meta?.kind).toBe('wasabi');
      expect(meta?.equalOutputCount).toBe(count);
    }
  });

  test('10+ equal outputs takes wasabi even with 5 equal inputs', () => {
    const meta = classifyCoinjoin(
      makeTx({
        inputs: equalIo('in', 5, 200_000),
        outputs: equalIo('out', 10, 100_000),
        totalOutputSats: 1_000_000,
      }),
      5,
    );
    expect(meta?.kind).toBe('wasabi');
  });

  test('fewer equal outputs than the minimum classifies as null', () => {
    const meta = classifyCoinjoin(
      makeTx({ outputs: equalIo('out', 4, 100_000), totalOutputSats: 400_000 }),
      5,
    );
    expect(meta).toBeNull();
  });

  test('denomination picks the largest equal-value group', () => {
    const meta = classifyCoinjoin(
      makeTx({
        outputs: [
          ...equalIo('a', 5, 100_000),
          ...equalIo('b', 6, 200_000),
        ],
        totalOutputSats: 5 * 100_000 + 6 * 200_000,
      }),
      5,
    );
    expect(meta?.denominationSats).toBe(200_000);
    expect(meta?.equalOutputCount).toBe(6);
    expect(meta?.kind).toBe('generic');
  });
});

function makeRawTx(
  id: string,
  outputs: { address: string; btc: number }[],
  inputs: { address: string; btc: number }[],
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

function coinjoinRawTx(
  seed: string,
  inputs: { address: string; btc: number }[],
  outputCount = 5,
): VerboseTx {
  return makeRawTx(
    txid(seed),
    Array.from({ length: outputCount }, (_, n) => ({ address: `bc1q${seed}out${n}`, btc: 0.5 })),
    inputs,
  );
}

class FakeRpc implements BitcoinRpc {
  mempool = new Set<string>();
  txs = new Map<string, VerboseTx>();
  blocks = 800_000;

  addTx(tx: VerboseTx): void {
    this.txs.set(tx.txid, tx);
    this.mempool.add(tx.txid);
  }

  async getblockchaininfo(): Promise<BlockchainInfo> {
    return { chain: 'main', blocks: this.blocks, headers: this.blocks, bestblockhash: txid('e') };
  }

  async getrawmempool(): Promise<string[]> {
    return [...this.mempool];
  }

  async getrawtransaction(id: string): Promise<VerboseTx> {
    const tx = this.txs.get(id);
    if (!tx) throw new Error(`No such mempool or blockchain transaction ${id}`);
    return tx;
  }

  async getblockhash(): Promise<string> {
    return txid('b');
  }

  async getblock(hash: string): Promise<BlockInfo> {
    return { hash, height: this.blocks, time: 1_785_000_000, tx: [] };
  }
}

function makeHarness() {
  const db = openDatabase(':memory:');
  const rpc = new FakeRpc();
  const emitter = new EventEmitter();
  const newEvents: EventRow[] = [];
  emitter.on('event:new', (row: EventRow) => newEvents.push(row));
  const pipeline = createPipeline({
    db,
    rpc,
    config: CONFIG,
    addressInfo: null,
    emitter,
    warn: () => {},
    log: () => {},
  });
  return { db, rpc, pipeline, newEvents };
}

const WHIRLPOOL_INPUTS = (seed: string) =>
  Array.from({ length: 5 }, (_, n) => ({ address: `bc1q${seed}in${n}`, btc: 0.5 }));

async function detectRound(
  harness: ReturnType<typeof makeHarness>,
  tx: VerboseTx,
): Promise<void> {
  harness.rpc.addTx(tx);
  await harness.pipeline.poll();
}

describe('coinjoin pipeline integration', () => {
  test('coinjoin meta is persisted on the event row and emitted', async () => {
    const harness = makeHarness();
    await harness.pipeline.poll();
    const round = coinjoinRawTx('a', WHIRLPOOL_INPUTS('a'));
    await detectRound(harness, round);

    expect(harness.newEvents).toHaveLength(1);
    expect(JSON.parse(harness.newEvents[0].rules)).toEqual(['coinjoin']);
    expect(parseEventMeta(harness.newEvents[0])?.coinjoin).toEqual({
      kind: 'whirlpool',
      denominationSats: 50_000_000,
      equalOutputCount: 5,
      participantCount: 5,
    });
    const stored = harness.db
      .query('SELECT * FROM events WHERE txid = ?')
      .get(round.txid) as EventRow;
    expect(parseEventMeta(stored)?.coinjoin?.kind).toBe('whirlpool');
  });

  test('two chained rounds share one batch with round-chain link reason', async () => {
    const harness = makeHarness();
    await harness.pipeline.poll();
    const round1 = coinjoinRawTx('a', WHIRLPOOL_INPUTS('a'));
    await detectRound(harness, round1);
    // a remix round is still a full round: the prior round's output joins four
    // other participants rather than funding the whole transaction alone
    const round2 = coinjoinRawTx('b', [
      { address: 'bc1qaout0', btc: 0.5 },
      ...Array.from({ length: 4 }, (_, n) => ({ address: `bc1qbin${n}`, btc: 0.5 })),
    ]);
    await detectRound(harness, round2);

    const batch1 = findBatchByTxid(harness.db, round1.txid);
    const batch2 = findBatchByTxid(harness.db, round2.txid);
    expect(batch1).not.toBeNull();
    expect(batch2?.id).toBe(batch1!.id);
    expect(batch1!.kind).toBe('coinjoin-round');
    expect(batch1!.source).toBe('auto');
    expect(batch1!.title).toBe('Coinjoin round (whirlpool)');

    const rows = listBatchTxs(harness.db, batch1!.id);
    expect(rows).toHaveLength(2);
    const byTxid = new Map(rows.map((row) => [row.txid, row]));
    expect(byTxid.get(round1.txid)?.link_reason).toBe('round');
    expect(byTxid.get(round2.txid)?.link_reason).toBe(
      `round chain: spends output of ${round1.txid}`,
    );
    expect(byTxid.get(round1.txid)?.value_sats).toBe(250_000_000);
    expect(byTxid.get(round2.txid)?.value_sats).toBe(250_000_000);
    expect(byTxid.get(round2.txid)?.block_height).toBeNull();
    expect(byTxid.get(round2.txid)?.block_hash).toBeNull();
    expect(byTxid.get(round2.txid)?.block_time).toBeNull();
  });

  test('an unchained round creates its own batch', async () => {
    const harness = makeHarness();
    await harness.pipeline.poll();
    const round1 = coinjoinRawTx('a', WHIRLPOOL_INPUTS('a'));
    await detectRound(harness, round1);
    const loner = coinjoinRawTx('z', WHIRLPOOL_INPUTS('z'));
    await detectRound(harness, loner);

    const batch1 = findBatchByTxid(harness.db, round1.txid);
    const batch2 = findBatchByTxid(harness.db, loner.txid);
    expect(batch1).not.toBeNull();
    expect(batch2).not.toBeNull();
    expect(batch2!.id).not.toBe(batch1!.id);
    const rows = listBatchTxs(harness.db, batch2!.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].link_reason).toBe('round');
  });
});

describe('GET /api/coinjoins', () => {
  function seedCoinjoinEvent(detectedAt: string) {
    const db = openDatabase(':memory:');
    insertEvent(db, {
      txid: txid('w'),
      rules: ['whale'],
      valueSats: 15 * SATS,
      inputs: [{ address: 'bc1qwhalein', valueSats: 16 * SATS }],
      outputs: [{ address: 'bc1qwhaleout', valueSats: 15 * SATS }],
      detectedAt: '2026-08-01T00:00:00.000Z',
    });
    const batch = insertBatch(db, {
      kind: 'coinjoin-round',
      title: 'Coinjoin round (generic)',
      source: 'auto',
    })!;
    const first = insertEvent(db, {
      txid: txid('a'),
      rules: ['coinjoin'],
      valueSats: 250_000_000,
      inputs: [{ address: 'bc1qain0', valueSats: 260_000_000 }],
      outputs: equalIo('aout', 5, 50_000_000),
      detectedAt,
    }).row!;
    setEventMeta(db, first.id, {
      coinjoin: { kind: 'generic', denominationSats: 50_000_000, equalOutputCount: 5, participantCount: 1 },
    });
    const second = insertEvent(db, {
      txid: txid('b'),
      rules: ['coinjoin'],
      valueSats: 1_200_000,
      inputs: [{ address: 'bc1qbin0', valueSats: 1_300_000 }],
      outputs: equalIo('bout', 12, 100_000),
      detectedAt: '2026-08-03T00:00:00.000Z',
    }).row!;
    setEventMeta(db, second.id, {
      coinjoin: { kind: 'wasabi', denominationSats: 100_000, equalOutputCount: 12, participantCount: 1 },
    });
    addBatchTx(db, {
      batchId: batch.id,
      txid: txid('b'),
      valueSats: 1_200_000,
      linkReason: 'round',
    });
    return { db, batch };
  }

  test('returns coinjoin events newest-first with meta and batchId', async () => {
    const { db, batch } = seedCoinjoinEvent('2026-08-02T00:00:00.000Z');
    const app = new Hono();
    app.route('/', createCoinjoinRoutes(db));

    const res = await app.request('/api/coinjoins');
    expect(res.status).toBe(200);
    const body = (await res.json()) as CoinjoinsResponse;
    expect(body.coinjoins).toHaveLength(2);
    const [newest, oldest] = body.coinjoins;
    expect(newest.txid).toBe(txid('b'));
    expect(newest.meta?.coinjoin?.kind).toBe('wasabi');
    expect(newest.batchId).toBe(batch.id);
    expect(newest.rules).toEqual(['coinjoin']);
    expect(oldest.txid).toBe(txid('a'));
    expect(oldest.batchId).toBeNull();
  });

  test('limit query caps and validates', async () => {
    const { db } = seedCoinjoinEvent('2026-08-02T00:00:00.000Z');
    const app = new Hono();
    app.route('/', createCoinjoinRoutes(db));

    const res = await app.request('/api/coinjoins?limit=1');
    const body = (await res.json()) as CoinjoinsResponse;
    expect(body.coinjoins).toHaveLength(1);
    expect(body.coinjoins[0].txid).toBe(txid('b'));

    const bad = await app.request('/api/coinjoins?limit=nope');
    expect(bad.status).toBe(400);
  });
});
