import { describe, test, expect } from 'bun:test';
import { analyzeBoltzmann, perfectCoinjoinCombinations } from '../src/analytics/boltzmann';

const BTC = 100_000_000;

describe('perfectCoinjoinCombinations', () => {
  test('matches the worked examples from the entropy literature', () => {
    // 2 equal inputs, 2 equal outputs: (a->x,b->y), (a->y,b->x), (ab->xy)
    expect(perfectCoinjoinCombinations(2, 2)).toBe(3);
    expect(perfectCoinjoinCombinations(3, 3)).toBe(16);
    expect(perfectCoinjoinCombinations(4, 4)).toBe(131);
    // a single input funding a single output is unambiguous
    expect(perfectCoinjoinCombinations(1, 1)).toBe(1);
  });

  test('handles asymmetric shapes through the reduced ratio', () => {
    // 1 input : 2 outputs admits only the whole-transaction grouping
    expect(perfectCoinjoinCombinations(1, 2)).toBe(1);
    // 2 inputs : 4 outputs — 6 ways to deal two outputs to each input, plus the
    // interpretation where both inputs jointly fund all four
    expect(perfectCoinjoinCombinations(2, 4)).toBe(7);
    expect(perfectCoinjoinCombinations(0, 3)).toBe(0);
  });
});

describe('analyzeBoltzmann', () => {
  test('a simple spend leaks everything: one interpretation, zero entropy', () => {
    const result = analyzeBoltzmann([10 * BTC], [8 * BTC, 2 * BTC - 1000]);
    expect(result.status).toBe('ok');
    expect(result.combinations).toBe(1);
    expect(result.entropy).toBe(0);
    expect(result.feeSats).toBe(1000);
    // the lone input provably funded both outputs
    expect(result.deterministicLinks).toEqual([
      { input: 0, output: 0 },
      { input: 0, output: 1 },
    ]);
    expect(result.linkProbability).toEqual([[1, 1]]);
  });

  test('a 2x2 equal-value coinjoin has three interpretations and no certain links', () => {
    const result = analyzeBoltzmann([BTC, BTC], [BTC, BTC]);
    expect(result.status).toBe('ok');
    expect(result.combinations).toBe(3);
    expect(result.entropy).toBeCloseTo(Math.log2(3), 10);
    expect(result.deterministicLinks).toEqual([]);
    // each input is grouped with each output in 2 of the 3 interpretations
    for (const row of result.linkProbability) {
      for (const p of row) expect(p).toBeCloseTo(2 / 3, 10);
    }
    // a perfect coinjoin is by definition maximally efficient for its shape
    expect(result.efficiency).toBeCloseTo(1, 10);
    expect(result.maxEntropy).toBeCloseTo(result.entropy, 10);
  });

  test('the general engine agrees with the closed form on perfect coinjoins', () => {
    for (const [n, m] of [
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
      [2, 4],
      [3, 6],
      [4, 2],
    ] as const) {
      const total = 120 * BTC;
      const inputs = Array.from({ length: n }, () => total / n);
      const outputs = Array.from({ length: m }, () => total / m);
      const result = analyzeBoltzmann(inputs, outputs);
      expect(result.status).toBe('ok');
      expect(result.combinations).toBe(perfectCoinjoinCombinations(n, m));
    }
  });

  test('link probabilities are a proper distribution over interpretations', () => {
    // 2-in / 4-out coinjoin: two participants, each taking a mixed output plus change
    const result = analyzeBoltzmann(
      [10 * BTC, 10 * BTC],
      [8 * BTC, 8 * BTC, 2 * BTC - 500, 2 * BTC - 500],
    );
    expect(result.status).toBe('ok');
    expect(result.combinations).toBeGreaterThan(1);
    for (const row of result.linkProbability) {
      for (const p of row) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
    // every output must be funded by at least one input in every interpretation
    for (let j = 0; j < result.nbOutputs; j++) {
      const columnMax = Math.max(...result.linkProbability.map((row) => row[j]));
      expect(columnMax).toBeGreaterThan(0);
    }
  });

  test('a fee-paying single-participant transaction stays deterministic', () => {
    // consolidation: three inputs, one output, no ambiguity possible
    const result = analyzeBoltzmann([3 * BTC, 2 * BTC, 1 * BTC], [6 * BTC - 2000]);
    expect(result.status).toBe('ok');
    expect(result.combinations).toBe(1);
    expect(result.entropy).toBe(0);
    expect(result.deterministicLinks).toHaveLength(3);
    expect(result.efficiency).toBeCloseTo(1 / perfectCoinjoinCombinations(3, 1), 10);
  });

  test('entropy density normalizes across transaction sizes', () => {
    const small = analyzeBoltzmann([BTC, BTC], [BTC, BTC]);
    const large = analyzeBoltzmann(
      Array.from({ length: 4 }, () => BTC),
      Array.from({ length: 4 }, () => BTC),
    );
    expect(large.entropy).toBeGreaterThan(small.entropy);
    expect(small.density).toBeCloseTo(small.entropy / 4, 10);
    expect(large.density).toBeCloseTo(large.entropy / 8, 10);
  });

  describe('refuses to guess', () => {
    test('rejects transactions whose outputs exceed their inputs', () => {
      const result = analyzeBoltzmann([BTC], [2 * BTC]);
      expect(result.status).toBe('skipped');
      expect(result.reason).toContain('exceed');
    });

    test('rejects empty sides', () => {
      expect(analyzeBoltzmann([], [BTC]).status).toBe('skipped');
      expect(analyzeBoltzmann([BTC], []).status).toBe('skipped');
    });

    test('skips transactions wider than the configured bound', () => {
      const wide = Array.from({ length: 30 }, () => BTC);
      const result = analyzeBoltzmann(wide, wide);
      expect(result.status).toBe('skipped');
      expect(result.reason).toContain('too large');
      expect(result.combinations).toBe(0);
    });

    test('aborts rather than hanging when the search budget runs out', () => {
      const inputs = Array.from({ length: 10 }, () => BTC);
      const outputs = Array.from({ length: 10 }, () => BTC);
      const result = analyzeBoltzmann(inputs, outputs, { maxSteps: 50 });
      expect(result.status).toBe('aborted');
      expect(result.reason).toContain('steps');
      expect(result.steps).toBeGreaterThan(0);
    });
  });

  test('unequal coinjoin scores below a perfect one of the same shape', () => {
    const perfect = analyzeBoltzmann(
      [5 * BTC, 5 * BTC, 5 * BTC],
      [5 * BTC, 5 * BTC, 5 * BTC],
    );
    const sloppy = analyzeBoltzmann(
      [5 * BTC, 5 * BTC, 5 * BTC],
      [7 * BTC, 5 * BTC, 3 * BTC],
    );
    expect(perfect.efficiency).toBeCloseTo(1, 10);
    expect(sloppy.efficiency).toBeLessThan(perfect.efficiency);
    expect(sloppy.entropy).toBeLessThan(perfect.entropy);
  });
});

describe('reporting the ceiling when exact counting is out of reach', () => {
  test('a large coinjoin still reports what its shape could achieve', () => {
    const wide = Array.from({ length: 85 }, () => 100_000_000);
    const result = analyzeBoltzmann(wide, wide);
    expect(result.status).toBe('skipped');
    expect(result.combinations).toBe(0);
    // exact entropy is unknown, but the ceiling for 85x85 is enormous and finite
    expect(result.maxEntropy).toBeGreaterThan(100);
    expect(Number.isFinite(result.maxEntropy)).toBe(true);
  });

  test('degenerate shapes report no ceiling rather than a bogus one', () => {
    expect(analyzeBoltzmann([], []).maxEntropy).toBe(0);
  });
});
