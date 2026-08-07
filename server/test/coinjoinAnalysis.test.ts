import { describe, test, expect } from 'bun:test';
import { looksLikeCoinjoin } from '../src/analytics/coinjoin';
import type { EsploraTx } from '../src/ingest/esplora';

function tx(overrides: Partial<EsploraTx> = {}): EsploraTx {
  return {
    txid: 'a'.repeat(64),
    inputs: [],
    outputs: [],
    feeSats: 1000,
    sizeBytes: 200,
    weight: 800,
    confirmed: true,
    blockHeight: 900_000,
    blockHash: 'b'.repeat(64),
    blockTime: '2026-08-07T00:00:00.000Z',
    isCoinbase: false,
    ...overrides,
  };
}

const inputs = (count: number, valueSats = 1_000_000) =>
  Array.from({ length: count }, (_, n) => ({
    txid: 'f'.repeat(64),
    vout: n,
    address: `bc1qin${n}`,
    valueSats,
  }));

const outputs = (count: number, valueSats: number) =>
  Array.from({ length: count }, (_, n) => ({ address: `bc1qout${n}`, valueSats, n }));

describe('looksLikeCoinjoin', () => {
  test('recognises a join with several parties and repeated output values', () => {
    expect(looksLikeCoinjoin(tx({ inputs: inputs(5), outputs: outputs(5, 900_000) }))).toBe(true);
  });

  test('a single payer batching equal outputs is not a join', () => {
    const solo = [{ txid: 'f'.repeat(64), vout: 0, address: 'bc1qpayer', valueSats: 9_000_000 }];
    expect(looksLikeCoinjoin(tx({ inputs: solo, outputs: outputs(8, 1_000_000) }))).toBe(false);
  });

  test('two parties are not enough to hide anyone', () => {
    expect(looksLikeCoinjoin(tx({ inputs: inputs(2), outputs: outputs(4, 400_000) }))).toBe(false);
  });

  test('distinct output values are an ordinary payment, however many inputs', () => {
    const varied = [
      { address: 'bc1qa', valueSats: 100, n: 0 },
      { address: 'bc1qb', valueSats: 200, n: 1 },
      { address: 'bc1qc', valueSats: 300, n: 2 },
      { address: 'bc1qd', valueSats: 400, n: 3 },
    ];
    expect(looksLikeCoinjoin(tx({ inputs: inputs(6), outputs: varied }))).toBe(false);
  });

  test('coinbase transactions are never joins', () => {
    expect(
      looksLikeCoinjoin(
        tx({
          isCoinbase: true,
          inputs: [{ txid: null, vout: null, address: null, valueSats: 0 }],
          outputs: outputs(5, 1_000_000),
        }),
      ),
    ).toBe(false);
  });

  test('errs toward exclusion: the detection threshold is looser than the feed rule', () => {
    // three equal outputs would not trip the coinjoin *rule* (which needs five),
    // but must still be kept out of clustering
    expect(looksLikeCoinjoin(tx({ inputs: inputs(3), outputs: outputs(3, 500_000) }))).toBe(true);
  });
});
