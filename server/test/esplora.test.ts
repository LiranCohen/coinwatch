import { describe, expect, test } from 'bun:test';
import { EsploraClient, EsploraError, type EsploraClientOptions } from '../src/ingest/esplora';

// Fixtures trimmed from live captures (mempool.space, 2026-08-07).

const CONFIRMED_TX = {
  txid: 'd41f5de48325e79070ccd3a23005f7a3b405f3ce1faa4df09f6d71770497e9d5',
  version: 2,
  locktime: 0,
  vin: [
    {
      txid: 'a992dbddbeb7382e3defc6914f970ea769ef813e69a923afa336976f2cbf0465',
      vout: 1,
      prevout: {
        scriptpubkey: '001464dbbc84f12f32699ca5010faa618d6a25559b6f',
        scriptpubkey_type: 'v0_p2wpkh',
        scriptpubkey_address: 'bc1qvndmep839uexn899qy865cvddgj4txm0nkjua9',
        value: 604308,
      },
      scriptsig: '',
      is_coinbase: false,
      sequence: 4294967295,
    },
  ],
  vout: [
    {
      scriptpubkey_type: 'v1_p2tr',
      scriptpubkey_address: 'bc1p94scc8mn65fnlhyh64zml064kn9692e2n4q7gkttrhmt365ajdyq0m2mzh',
      value: 143332,
    },
    {
      scriptpubkey_type: 'v0_p2wpkh',
      scriptpubkey_address: 'bc1qvndmep839uexn899qy865cvddgj4txm0nkjua9',
      value: 291851,
    },
  ],
  size: 235,
  weight: 610,
  sigops: 1,
  fee: 169125,
  status: {
    confirmed: true,
    block_height: 800000,
    block_hash: '00000000000000000002a7c4c1e48d76c5a37902165a270156b7a8d72728a054',
    block_time: 1690168629,
  },
};

const COINBASE_TX = {
  txid: 'b75ca3106ed100521aa50e3ec267a06431c6319538898b25e1b757a5736f5fb4',
  version: 1,
  locktime: 0,
  vin: [
    {
      txid: '0000000000000000000000000000000000000000000000000000000000000000',
      vout: 4294967295,
      prevout: null,
      scriptsig: '0300350c0120130909092009092009102cda1492140000000000',
      is_coinbase: true,
      sequence: 4294967295,
    },
  ],
  vout: [
    {
      scriptpubkey_type: 'p2sh',
      scriptpubkey_address: '3KZDwmJHB6QJ13QPXHaW7SS3yTESFPZoxb',
      value: 638687680,
    },
    { scriptpubkey_type: 'op_return', value: 0 },
  ],
  size: 192,
  weight: 660,
  sigops: 0,
  fee: 0,
  status: {
    confirmed: true,
    block_height: 800000,
    block_hash: '00000000000000000002a7c4c1e48d76c5a37902165a270156b7a8d72728a054',
    block_time: 1690168629,
  },
};

const UNCONFIRMED_TX = {
  ...CONFIRMED_TX,
  txid: '5ac5b2b3684be14bcec9b2b37c4da04514ddf0094219267154bed3fb37133f0a',
  status: { confirmed: false },
};

const RAW_BLOCK = {
  id: '00000000000000000002a7c4c1e48d76c5a37902165a270156b7a8d72728a054',
  height: 800000,
  version: 874340352,
  timestamp: 1690168629,
  tx_count: 3721,
  size: 1634536,
  weight: 3992881,
  mediantime: 1690165851,
};

const V1_BLOCK = {
  id: '00000000000000000001e686beefab4f87b662addc543b5fd72714bb56fcd4a2',
  height: 961366,
  timestamp: 1786069776,
  tx_count: 3099,
  size: 1269467,
  weight: 3185552,
  extras: {
    reward: 314780842,
    medianFee: 1.7700572649309423,
    totalFees: 2280842,
    pool: { id: 142, name: 'OCEAN', slug: 'ocean' },
  },
};

const GENESIS_ADDRESS = {
  address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
  chain_stats: {
    funded_txo_count: 77777,
    funded_txo_sum: 5732945354,
    spent_txo_count: 0,
    spent_txo_sum: 0,
    tx_count: 65039,
  },
  mempool_stats: {
    funded_txo_count: 1,
    funded_txo_sum: 546,
    spent_txo_count: 0,
    spent_txo_sum: 0,
    tx_count: 1,
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textRes(body: string, status = 200): Response {
  return new Response(body, { status });
}

function makeClient(
  handler: (url: string) => Response | Promise<Response>,
  options: EsploraClientOptions = {},
): { client: EsploraClient; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    return handler(url);
  }) as unknown as typeof fetch;
  const client = new EsploraClient({
    endpoints: ['https://a.test', 'https://b.test'],
    fetchImpl,
    minIntervalMs: 0,
    retries: 0,
    ...options,
  });
  return { client, calls };
}

describe('normalization', () => {
  test('normalizes a realistic confirmed tx', async () => {
    const { client } = makeClient(() => json(CONFIRMED_TX));
    const tx = await client.tx(CONFIRMED_TX.txid);
    expect(tx).toEqual({
      txid: 'd41f5de48325e79070ccd3a23005f7a3b405f3ce1faa4df09f6d71770497e9d5',
      inputs: [
        {
          txid: 'a992dbddbeb7382e3defc6914f970ea769ef813e69a923afa336976f2cbf0465',
          vout: 1,
          address: 'bc1qvndmep839uexn899qy865cvddgj4txm0nkjua9',
          valueSats: 604308,
        },
      ],
      outputs: [
        {
          address: 'bc1p94scc8mn65fnlhyh64zml064kn9692e2n4q7gkttrhmt365ajdyq0m2mzh',
          valueSats: 143332,
          n: 0,
        },
        { address: 'bc1qvndmep839uexn899qy865cvddgj4txm0nkjua9', valueSats: 291851, n: 1 },
      ],
      feeSats: 169125,
      sizeBytes: 235,
      weight: 610,
      confirmed: true,
      blockHeight: 800000,
      blockHash: '00000000000000000002a7c4c1e48d76c5a37902165a270156b7a8d72728a054',
      blockTime: '2023-07-24T03:17:09.000Z',
      isCoinbase: false,
    });
  });

  test('normalizes a coinbase tx', async () => {
    const { client } = makeClient(() => json(COINBASE_TX));
    const tx = await client.tx(COINBASE_TX.txid);
    expect(tx).not.toBeNull();
    expect(tx!.isCoinbase).toBe(true);
    expect(tx!.inputs).toEqual([{ txid: null, vout: null, address: null, valueSats: 0 }]);
    expect(tx!.feeSats).toBe(0);
    // OP_RETURN output has no address.
    expect(tx!.outputs[1]).toEqual({ address: null, valueSats: 0, n: 1 });
  });

  test('unconfirmed tx has null block fields', async () => {
    const { client } = makeClient(() => json(UNCONFIRMED_TX));
    const tx = await client.tx(UNCONFIRMED_TX.txid);
    expect(tx!.confirmed).toBe(false);
    expect(tx!.blockHeight).toBeNull();
    expect(tx!.blockHash).toBeNull();
    expect(tx!.blockTime).toBeNull();
  });

  test('normalizes address stats', async () => {
    const { client } = makeClient(() => json(GENESIS_ADDRESS));
    const addr = await client.address(GENESIS_ADDRESS.address);
    expect(addr).toEqual({
      address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      balanceSats: 5732945354,
      txCount: 65039,
      totalReceivedSats: 5732945354,
      totalSentSats: 0,
      unconfirmedTxCount: 1,
    });
  });

  test('parses text endpoints and address txs and mempool txids', async () => {
    const { client } = makeClient((url) => {
      if (url.endsWith('/blocks/tip/height')) return textRes('961366');
      if (url.endsWith('/block-height/800000')) return textRes(RAW_BLOCK.id);
      if (url.endsWith('/txs')) return json([CONFIRMED_TX, UNCONFIRMED_TX]);
      if (url.endsWith('/mempool/recent')) {
        return json([
          { txid: 'a'.repeat(64), fee: 254, vsize: 140, value: 120214 },
          { txid: 'b'.repeat(64), fee: 568, vsize: 141, value: 131373644 },
        ]);
      }
      return textRes('not found', 404);
    });
    expect(await client.tipHeight()).toBe(961366);
    expect(await client.blockHashAt(800000)).toBe(RAW_BLOCK.id);
    const txs = await client.addressTxs('bc1qvndmep839uexn899qy865cvddgj4txm0nkjua9');
    expect(txs.map((tx) => tx.confirmed)).toEqual([true, false]);
    expect(await client.recentMempoolTxids()).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
  });
});

describe('404 handling', () => {
  test('tx returns null on 404 without failing over', async () => {
    const { client, calls } = makeClient(() => textRes('Transaction not found', 404));
    expect(await client.tx('f'.repeat(64))).toBeNull();
    expect(calls).toEqual([`https://a.test/tx/${'f'.repeat(64)}`]);
  });

  test('address returns null on 404', async () => {
    const { client, calls } = makeClient(() => textRes('not found', 404));
    expect(await client.address('bc1qnothing')).toBeNull();
    expect(calls).toHaveLength(1);
  });

  test('block throws EsploraError with status 404', async () => {
    const { client } = makeClient(() => textRes('Block not found', 404));
    const err = await client.block('0'.repeat(64)).catch((thrown: unknown) => thrown);
    expect(err).toBeInstanceOf(EsploraError);
    expect((err as EsploraError).status).toBe(404);
  });
});

describe('failover', () => {
  test('fails over from a 500 on endpoint A to endpoint B', async () => {
    const { client, calls } = makeClient((url) =>
      url.startsWith('https://a.test') ? textRes('boom', 500) : textRes('961366'),
    );
    expect(await client.tipHeight()).toBe(961366);
    expect(calls).toEqual(['https://a.test/blocks/tip/height', 'https://b.test/blocks/tip/height']);
  });

  test('prefers the endpoint that last succeeded', async () => {
    const { client, calls } = makeClient((url) =>
      url.startsWith('https://a.test') ? textRes('boom', 500) : textRes(url.endsWith('height') ? '961366' : RAW_BLOCK.id),
    );
    await client.tipHeight();
    await client.blockHashAt(800000);
    expect(calls[2]).toBe('https://b.test/block-height/800000');
  });

  test('fails over on network error', async () => {
    const { client, calls } = makeClient((url) => {
      if (url.startsWith('https://a.test')) throw new Error('connection refused');
      return textRes('961366');
    });
    expect(await client.tipHeight()).toBe(961366);
    expect(calls).toHaveLength(2);
  });

  test('retries the same endpoint before failing over', async () => {
    let aAttempts = 0;
    const { client, calls } = makeClient(
      (url) => {
        if (url.startsWith('https://a.test')) {
          aAttempts += 1;
          return aAttempts === 1 ? textRes('boom', 503) : textRes('961366');
        }
        return textRes('unreachable', 500);
      },
      { retries: 1 },
    );
    expect(await client.tipHeight()).toBe(961366);
    expect(calls).toEqual(['https://a.test/blocks/tip/height', 'https://a.test/blocks/tip/height']);
  });

  test('throws EsploraError when all endpoints fail', async () => {
    const { client, calls } = makeClient(() => textRes('boom', 502), { retries: 1 });
    expect(client.tipHeight()).rejects.toThrow(EsploraError);
    await client.tipHeight().catch(() => undefined);
    // 2 endpoints x 2 attempts, twice.
    expect(calls).toHaveLength(8);
  });
});

describe('caching', () => {
  test('cache hit avoids a second fetch', async () => {
    const { client, calls } = makeClient(() => json(CONFIRMED_TX));
    const first = await client.tx(CONFIRMED_TX.txid);
    const second = await client.tx(CONFIRMED_TX.txid);
    expect(calls).toHaveLength(1);
    expect(second).toEqual(first!);
  });

  test('volatile entries expire after cacheTtlMs', async () => {
    let t = 0;
    const { client, calls } = makeClient(() => json(GENESIS_ADDRESS), {
      cacheTtlMs: 1000,
      now: () => t,
    });
    await client.address(GENESIS_ADDRESS.address);
    t = 999;
    await client.address(GENESIS_ADDRESS.address);
    expect(calls).toHaveLength(1);
    t = 1000;
    await client.address(GENESIS_ADDRESS.address);
    expect(calls).toHaveLength(2);
  });

  test('confirmed txs stay cached far beyond cacheTtlMs; unconfirmed do not', async () => {
    let t = 0;
    const { client, calls } = makeClient(
      (url) => json(url.includes(UNCONFIRMED_TX.txid) ? UNCONFIRMED_TX : CONFIRMED_TX),
      { cacheTtlMs: 1000, now: () => t },
    );
    await client.tx(CONFIRMED_TX.txid);
    await client.tx(UNCONFIRMED_TX.txid);
    t = 10 * 60 * 1000;
    await client.tx(CONFIRMED_TX.txid); // immutable: still cached
    expect(calls).toHaveLength(2);
    await client.tx(UNCONFIRMED_TX.txid); // volatile: refetched
    expect(calls).toHaveLength(3);
  });

  test('evicts the oldest entry when maxCacheEntries is exceeded', async () => {
    const { client, calls } = makeClient(
      (url) => json({ ...GENESIS_ADDRESS, address: url.split('/').pop() }),
      { maxCacheEntries: 2 },
    );
    await client.address('addr1');
    await client.address('addr2');
    await client.address('addr3'); // evicts addr1
    expect(calls).toHaveLength(3);
    await client.address('addr3'); // still cached
    expect(calls).toHaveLength(3);
    await client.address('addr1'); // evicted, refetched
    expect(calls).toHaveLength(4);
  });
});

describe('pacing', () => {
  test('spaces request starts by at least minIntervalMs and serializes them', async () => {
    const starts: number[] = [];
    const { client, calls } = makeClient(
      (url) => {
        starts.push(Date.now());
        return textRes(url.endsWith('height') ? '961366' : RAW_BLOCK.id);
      },
      { minIntervalMs: 25 },
    );
    await Promise.all([client.tipHeight(), client.blockHashAt(800000)]);
    expect(calls).toEqual(['https://a.test/blocks/tip/height', 'https://a.test/block-height/800000']);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(20);
  });
});

describe('blocks', () => {
  test('recentBlocks maps v1 extras (miner, median fee) newest first', async () => {
    const older = {
      ...V1_BLOCK,
      id: 'a'.repeat(64),
      height: 961365,
      extras: { medianFee: 2.5, pool: { id: 1, name: 'Foundry USA', slug: 'foundryusa' } },
    };
    const { client } = makeClient((url) =>
      url.endsWith('/v1/blocks') ? json([V1_BLOCK, older]) : textRes('not found', 404),
    );
    const blocks = await client.recentBlocks(2);
    expect(blocks).toEqual([
      {
        hash: V1_BLOCK.id,
        height: 961366,
        time: '2026-08-07T02:29:36.000Z',
        txCount: 3099,
        sizeBytes: 1269467,
        weight: 3185552,
        miner: 'OCEAN',
        medianFeeRate: 1.7700572649309423,
      },
      {
        hash: 'a'.repeat(64),
        height: 961365,
        time: '2026-08-07T02:29:36.000Z',
        txCount: 3099,
        sizeBytes: 1269467,
        weight: 3185552,
        miner: 'Foundry USA',
        medianFeeRate: 2.5,
      },
    ]);
  });

  test('recentBlocks pages v1 until count is reached', async () => {
    const at = (height: number) => ({ ...V1_BLOCK, id: `${height}`.padStart(64, '0'), height });
    const { client, calls } = makeClient((url) => {
      if (url.endsWith('/v1/blocks')) return json([at(200), at(199)]);
      if (url.endsWith('/v1/blocks/198')) return json([at(198), at(197)]);
      return textRes('not found', 404);
    });
    const blocks = await client.recentBlocks(3);
    expect(blocks.map((b) => b.height)).toEqual([200, 199, 198]);
    expect(calls).toEqual(['https://a.test/v1/blocks', 'https://a.test/v1/blocks/198']);
  });

  test('recentBlocks falls back to plain /blocks when v1 is unavailable everywhere', async () => {
    const { client, calls } = makeClient((url) => {
      if (url.includes('/v1/')) return textRes('not found', 404);
      if (url.endsWith('/blocks')) return json([RAW_BLOCK]);
      return textRes('not found', 404);
    });
    const blocks = await client.recentBlocks(1);
    expect(blocks).toEqual([
      {
        hash: RAW_BLOCK.id,
        height: 800000,
        time: '2023-07-24T03:17:09.000Z',
        txCount: 3721,
        sizeBytes: 1634536,
        weight: 3992881,
        miner: null,
        medianFeeRate: null,
      },
    ]);
    // v1 404s fail over across both endpoints instead of being definitive.
    expect(calls.filter((url) => url.includes('/v1/'))).toHaveLength(2);
  });

  test('block enriches miner from the v1 page at its height', async () => {
    const v1Entry = {
      ...V1_BLOCK,
      id: RAW_BLOCK.id,
      height: 800000,
      extras: { medianFee: 6, pool: { id: 44, name: 'Carbon Negative', slug: 'carbonnegative' } },
    };
    const { client } = makeClient((url) => {
      if (url.endsWith(`/block/${RAW_BLOCK.id}`)) return json(RAW_BLOCK);
      if (url.endsWith('/v1/blocks/800000')) return json([v1Entry, V1_BLOCK]);
      return textRes('not found', 404);
    });
    const block = await client.block(RAW_BLOCK.id);
    expect(block.miner).toBe('Carbon Negative');
    expect(block.medianFeeRate).toBe(6);
  });

  test('block degrades to miner null when enrichment fails', async () => {
    const { client } = makeClient((url) => {
      if (url.endsWith(`/block/${RAW_BLOCK.id}`)) return json(RAW_BLOCK);
      return textRes('boom', 500);
    });
    const block = await client.block(RAW_BLOCK.id);
    expect(block.hash).toBe(RAW_BLOCK.id);
    expect(block.miner).toBeNull();
    expect(block.medianFeeRate).toBeNull();
  });

  test('blockTxids returns txids and blockTxs normalizes a page', async () => {
    const { client } = makeClient((url) => {
      if (url.endsWith('/txids')) return json([COINBASE_TX.txid, CONFIRMED_TX.txid]);
      if (url.endsWith('/txs/0')) return json([COINBASE_TX, CONFIRMED_TX]);
      return textRes('not found', 404);
    });
    expect(await client.blockTxids(RAW_BLOCK.id)).toEqual([COINBASE_TX.txid, CONFIRMED_TX.txid]);
    const txs = await client.blockTxs(RAW_BLOCK.id, 0);
    expect(txs.map((tx) => tx.isCoinbase)).toEqual([true, false]);
  });

  test('blockTxs rejects a startIndex that is not a multiple of 25', async () => {
    const { client, calls } = makeClient(() => json([]));
    expect(client.blockTxs(RAW_BLOCK.id, 10)).rejects.toThrow(EsploraError);
    await client.blockTxs(RAW_BLOCK.id, 10).catch(() => undefined);
    expect(calls).toHaveLength(0);
  });
});
