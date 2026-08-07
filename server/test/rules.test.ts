import { describe, test, expect } from 'bun:test';
import {
  whale,
  coinjoin,
  dormantWake,
  type NormalizedTx,
  type AddressActivity,
} from '../src/detect/rules';

const SATS = 100_000_000;

function makeTx(overrides: Partial<NormalizedTx> = {}): NormalizedTx {
  return {
    txid: 'aa'.repeat(32),
    inputs: [{ address: 'bc1qinputaddress0000000000000000000000000', valueSats: 2 * SATS }],
    outputs: [{ address: 'bc1qoutputaddress000000000000000000000000', valueSats: 2 * SATS }],
    totalOutputSats: 2 * SATS,
    ...overrides,
  };
}

describe('whale rule', () => {
  const threshold = 10 * SATS;

  test('hits at or above threshold', () => {
    expect(whale(makeTx({ totalOutputSats: 10 * SATS }), threshold)).toBe(true);
    expect(whale(makeTx({ totalOutputSats: 25 * SATS }), threshold)).toBe(true);
  });

  test('AE1: below threshold produces no hit', () => {
    expect(whale(makeTx({ totalOutputSats: 10 * SATS - 1 }), threshold)).toBe(false);
  });
});

describe('coinjoin rule', () => {
  test('hits when >= min equal-value outputs', () => {
    const outputs = Array.from({ length: 5 }, () => ({
      address: 'bc1qeq',
      valueSats: 100_000,
    }));
    expect(coinjoin(makeTx({ outputs }), 5)).toBe(true);
  });

  test('misses below min equal-value outputs', () => {
    const outputs = Array.from({ length: 4 }, () => ({ address: 'bc1qeq', valueSats: 100_000 }));
    outputs.push({ address: 'bc1qodd', valueSats: 123 });
    expect(coinjoin(makeTx({ outputs }), 5)).toBe(false);
  });

  test('multi-rule tx: whale + coinjoin both hit', () => {
    const outputs = Array.from({ length: 6 }, () => ({
      address: 'bc1qeq',
      valueSats: 2 * SATS,
    }));
    const tx = makeTx({ outputs, totalOutputSats: 12 * SATS });
    const rules = [whale(tx, 10 * SATS) && 'whale', coinjoin(tx, 5) && 'coinjoin'].filter(Boolean);
    expect(rules).toEqual(['whale', 'coinjoin']);
  });
});

describe('dormant-wake rule', () => {
  const TIP = 800_000;
  const DORMANT_BLOCKS = 4320;
  const MIN_VALUE = 1 * SATS;

  const baseOptions = {
    minValueSats: MIN_VALUE,
    dormantBlocks: DORMANT_BLOCKS,
    tipHeight: TIP,
  };

  function stubHistory(map: Record<string, AddressActivity[]>) {
    const calls: string[] = [];
    const getAddressActivity = async (address: string): Promise<AddressActivity[]> => {
      calls.push(address);
      return map[address] ?? [];
    };
    return { calls, getAddressActivity };
  }

  test('AE2: gated tx with stale input yields dormant hit naming top address', async () => {
    const stale = 'bc1qstale';
    const tx = makeTx({
      inputs: [
        { address: 'bc1qsmall', valueSats: 1000 },
        { address: stale, valueSats: 3 * SATS },
      ],
      totalOutputSats: 3 * SATS,
    });
    const { calls, getAddressActivity } = stubHistory({
      [stale]: [
        { txid: 'bb'.repeat(32), spendsFromAddress: true, blockHeight: TIP - 10_000 },
        { txid: 'cc'.repeat(32), spendsFromAddress: false, blockHeight: TIP - 500 },
        { txid: tx.txid, spendsFromAddress: true, blockHeight: null },
      ],
    });
    const hit = await dormantWake(tx, { ...baseOptions, getAddressActivity });
    expect(hit).toBe(true);
    expect(calls).toEqual([stale]);
  });

  test('recent spend within window misses', async () => {
    const addr = 'bc1qactive';
    const tx = makeTx({ inputs: [{ address: addr, valueSats: 2 * SATS }] });
    const { getAddressActivity } = stubHistory({
      [addr]: [{ txid: 'bb'.repeat(32), spendsFromAddress: true, blockHeight: TIP - 100 }],
    });
    expect(await dormantWake(tx, { ...baseOptions, getAddressActivity })).toBe(false);
  });

  test('first-ever-spend address (receives only, recent) does NOT hit', async () => {
    const addr = 'bc1qnew';
    const tx = makeTx({ inputs: [{ address: addr, valueSats: 2 * SATS }] });
    const { getAddressActivity } = stubHistory({
      [addr]: [
        { txid: 'dd'.repeat(32), spendsFromAddress: false, blockHeight: TIP - 50 },
        { txid: tx.txid, spendsFromAddress: true, blockHeight: null },
      ],
    });
    expect(await dormantWake(tx, { ...baseOptions, getAddressActivity })).toBe(false);
  });

  test('empty history (genuinely new address) does NOT hit', async () => {
    const addr = 'bc1qbrandnew';
    const tx = makeTx({ inputs: [{ address: addr, valueSats: 2 * SATS }] });
    const { getAddressActivity } = stubHistory({ [addr]: [] });
    expect(await dormantWake(tx, { ...baseOptions, getAddressActivity })).toBe(false);
  });

  test('no prior spend but oldest activity older than window hits', async () => {
    const addr = 'bc1qoldstacker';
    const tx = makeTx({ inputs: [{ address: addr, valueSats: 2 * SATS }] });
    const { getAddressActivity } = stubHistory({
      [addr]: [
        { txid: 'ee'.repeat(32), spendsFromAddress: false, blockHeight: TIP - 200 },
        { txid: 'ff'.repeat(32), spendsFromAddress: false, blockHeight: TIP - 20_000 },
      ],
    });
    expect(await dormantWake(tx, { ...baseOptions, getAddressActivity })).toBe(true);
  });

  test('tx below DORMANT_MIN_VALUE_BTC never triggers a lookup', async () => {
    const tx = makeTx({ totalOutputSats: MIN_VALUE - 1 });
    const { calls, getAddressActivity } = stubHistory({});
    const hit = await dormantWake(tx, { ...baseOptions, getAddressActivity });
    expect(hit).toBe(false);
    expect(calls).toEqual([]);
  });

  test('lookup failure (null) skips that address without throwing', async () => {
    const addr = 'bc1qflaky';
    const tx = makeTx({ inputs: [{ address: addr, valueSats: 2 * SATS }] });
    const hit = await dormantWake(tx, {
      ...baseOptions,
      getAddressActivity: async () => null,
    });
    expect(hit).toBe(false);
  });
});
