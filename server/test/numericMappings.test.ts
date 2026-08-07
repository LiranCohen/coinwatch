import { describe, test, expect } from 'bun:test';
import { countNumericMappings, toValueClasses } from '../src/analytics/numericMappings';
import { analyzeBoltzmann, perfectCoinjoinCombinations } from '../src/analytics/boltzmann';

const BTC = 100_000_000;

describe('toValueClasses', () => {
  test('collapses equal values into counted classes, largest first', () => {
    expect(toValueClasses([5, 1, 5, 3, 5])).toEqual([
      { valueSats: 5, count: 3 },
      { valueSats: 3, count: 1 },
      { valueSats: 1, count: 1 },
    ]);
  });

  test('all-distinct values give every coin its own class', () => {
    expect(toValueClasses([1, 2, 3])).toHaveLength(3);
  });
});

describe('countNumericMappings', () => {
  test('counts labelled mappings, not equivalence classes', () => {
    // two equal inputs against two equal outputs has three labelled readings:
    // a->x/b->y, a->y/b->x, and the pair funding both together
    const result = countNumericMappings(
      [{ valueSats: BTC, count: 2 }],
      [{ valueSats: BTC, count: 2 }],
    );
    expect(result.status).toBe('ok');
    expect(result.combinations).toBe(3);
  });

  test('a single value class needs one state per remaining coin', () => {
    const result = countNumericMappings(
      [{ valueSats: BTC, count: 40 }],
      [{ valueSats: BTC, count: 40 }],
    );
    expect(result.status).toBe('ok');
    // coin-subset enumeration would need 2^40 masks
    expect(result.states).toBeLessThanOrEqual(45);
  });

  test('class-level link probabilities are per coin, not per class', () => {
    const result = countNumericMappings(
      [{ valueSats: BTC, count: 2 }],
      [{ valueSats: BTC, count: 2 }],
    );
    // one specific input sits with one specific output in 2 of the 3 readings
    expect(result.classLinkProbability[0][0]).toBeCloseTo(2 / 3, 10);
  });

  test('declines rather than exhausting memory on too many distinct values', () => {
    const distinct = Array.from({ length: 26 }, (_, i) => ({
      valueSats: BTC + i * 1_000,
      count: 1,
    }));
    const result = countNumericMappings(distinct, distinct);
    expect(result.status).toBe('skipped');
    expect(result.reason).toContain('distinct');
  });
});

describe('agreement with coin-level enumeration', () => {
  /**
   * The value-class search must not change any answer, only the cost of
   * reaching it. These shapes are small enough that the closed form and hand
   * enumeration both apply, so a disagreement would be unambiguous.
   */
  test('matches the closed form across perfect coinjoin shapes', () => {
    for (const [n, m] of [
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
      [6, 6],
      [8, 8],
      [2, 4],
      [3, 6],
      [4, 2],
      [6, 4],
    ] as const) {
      const total = 120 * BTC;
      const inputs = Array.from({ length: n }, () => total / n);
      const outputs = Array.from({ length: m }, () => total / m);
      const result = analyzeBoltzmann(inputs, outputs);
      expect(result.status).toBe('ok');
      expect(result.combinations).toBe(perfectCoinjoinCombinations(n, m));
    }
  });

  test('mixed denominations still reconcile with an independent count', () => {
    // 2 participants each putting in 10 and taking 8 back plus change
    const result = analyzeBoltzmann(
      [10 * BTC, 10 * BTC],
      [8 * BTC, 8 * BTC, 2 * BTC - 500, 2 * BTC - 500],
    );
    expect(result.status).toBe('ok');
    // enumerated by hand: 4 ways to deal one 8 and one change to each input,
    // plus the reading where both inputs jointly fund all four outputs
    expect(result.combinations).toBe(5);
  });

  test('link probabilities remain symmetric for interchangeable coins', () => {
    const result = analyzeBoltzmann([BTC, BTC, BTC], [BTC, BTC, BTC]);
    const first = result.linkProbability[0][0];
    for (const row of result.linkProbability) {
      for (const p of row) expect(p).toBeCloseTo(first, 10);
    }
  });
});
