/**
 * Boltzmann transaction entropy.
 *
 * An *interpretation* of a transaction is a way of partitioning its inputs and
 * outputs into matched groups, where each group's inputs could plausibly have
 * funded that group's outputs. A transaction with exactly one interpretation
 * leaks its full spending structure; one with many is ambiguous to an observer.
 *
 * Following LaurentMT's Boltzmann analysis (the engine behind OXT / kycp.org),
 * we count those interpretations and derive:
 *   - entropy         log2(interpretations) — bits of ambiguity
 *   - link probability P(input i funded output j) across all interpretations
 *   - deterministic links  pairs true in *every* interpretation (P = 1)
 *   - efficiency      how close the tx is to a perfect coinjoin of the same shape
 *
 * Validity rule for a group (S inputs, T outputs): sum(S) >= sum(T), i.e. the
 * group may surrender value to fees but never conjure it. Because every group's
 * slack is non-negative and all slacks sum to exactly the transaction fee, no
 * separate per-group fee bound is needed — it falls out of the arithmetic.
 *
 * Counting is exponential, so the engine is bounded on both transaction size and
 * search steps and reports honestly when it bails instead of guessing.
 */

import { countNumericMappings, toValueClasses } from './numericMappings';

export type BoltzmannStatus = 'ok' | 'skipped' | 'aborted';

export interface BoltzmannLink {
  input: number;
  output: number;
}

export interface BoltzmannResult {
  status: BoltzmannStatus;
  /** why the analysis is not 'ok' */
  reason: string | null;
  nbInputs: number;
  nbOutputs: number;
  feeSats: number;
  /** distinct interpretations; above 2^53 this is a floating-point approximation */
  combinations: number;
  /** log2(combinations), in bits */
  entropy: number;
  /** entropy of a perfect coinjoin with the same input/output counts */
  maxEntropy: number;
  /** combinations / perfect-coinjoin combinations, in [0, 1] */
  efficiency: number;
  /** entropy per input+output, comparable across transaction sizes */
  density: number;
  /** linkProbability[i][j] = P(input i funded output j) */
  linkProbability: number[][];
  /** links present in every interpretation */
  deterministicLinks: BoltzmannLink[];
  /** search steps consumed, for observability */
  steps: number;
  /**
   * p(I, o) from Kajaba et al.: for each output, the strongest link probability
   * to any single input. A conservative read of how well that output is mixed —
   * if an observer identifies one input, this bounds what they learn about o.
   */
  outputLinkMax: number[];
  /** distinct value-class states explored, a measure of the real search cost */
  states: number;
}

export interface BoltzmannOptions {
  /** sanity bound on raw coin counts, independent of how many values repeat */
  maxInputs?: number;
  maxOutputs?: number;
  /** refuse when the value-class state space exceeds this */
  maxStates?: number;
  /** abort once the search exceeds this many expansion steps */
  maxSteps?: number;
}

/**
 * Bounds are on value-class states rather than coin counts. Enumerating coin
 * subsets is exponential in coins, but enumerating value classes is exponential
 * only in *distinct* values — so a 40-input coinjoin drawn from four
 * denominations is cheap while a 20-input transaction of all-distinct amounts
 * is not, which is the opposite of what a coin-count limit assumes.
 */
const DEFAULTS = {
  maxInputs: 200,
  maxOutputs: 200,
  maxStates: 400_000,
  maxSteps: 4_000_000,
} as const;

function skipped(
  reason: string,
  nbInputs: number,
  nbOutputs: number,
  feeSats: number,
  status: BoltzmannStatus = 'skipped',
  steps = 0,
): BoltzmannResult {
  // Even when the exact count is out of reach, the ceiling for this shape is
  // cheap to compute and worth reporting: it bounds what the transaction could
  // possibly achieve, which is exactly the question asked of large coinjoins.
  const ceiling = nbInputs > 0 && nbOutputs > 0 ? perfectCoinjoinEntropyBits(nbInputs, nbOutputs) : 0;
  return {
    status,
    reason,
    nbInputs,
    nbOutputs,
    feeSats,
    combinations: 0,
    entropy: 0,
    maxEntropy: Number.isFinite(ceiling) && ceiling > 0 ? ceiling : 0,
    efficiency: 0,
    density: 0,
    linkProbability: [],
    deterministicLinks: [],
    steps,
    outputLinkMax: [],
    states: 0,
  };
}

/**
 * Interpretations of a *perfect* coinjoin: n equal inputs, m equal outputs, no
 * fee. Such a transaction is the entropy ceiling for its shape, so it is the
 * denominator of the efficiency score.
 *
 * Every valid group must hold inputs and outputs in the reduced n:m ratio, so
 * after removing any number of groups the remainder is still in that ratio.
 * That collapses the search to a one-dimensional recurrence over how many
 * "ratio units" remain.
 */
export function perfectCoinjoinCombinations(nbInputs: number, nbOutputs: number): number {
  if (nbInputs <= 0 || nbOutputs <= 0) return 0;
  const g = gcd(nbInputs, nbOutputs);
  const inPerUnit = nbInputs / g;
  const outPerUnit = nbOutputs / g;

  // f[s] = interpretations when s ratio-units of inputs and outputs remain
  const f = new Array<number>(g + 1).fill(0);
  f[0] = 1;
  for (let s = 1; s <= g; s++) {
    const inLeft = inPerUnit * s;
    const outLeft = outPerUnit * s;
    let total = 0;
    for (let t = 1; t <= s; t++) {
      // anchor on one specific input so each partition is counted once
      total += binomial(inLeft - 1, inPerUnit * t - 1) * binomial(outLeft, outPerUnit * t) * f[s - t];
    }
    f[s] = total;
  }
  return f[g];
}

/**
 * The same ceiling in bits, evaluated entirely in log space.
 *
 * Wide coinjoins have interpretation counts far beyond what a float can hold —
 * an 85-in/85-out round overflows to Infinity — but their *entropy* is an
 * ordinary number, and it is the figure we actually report.
 */
export function perfectCoinjoinEntropyBits(nbInputs: number, nbOutputs: number): number {
  if (nbInputs <= 0 || nbOutputs <= 0) return 0;
  const g = gcd(nbInputs, nbOutputs);
  const inPerUnit = nbInputs / g;
  const outPerUnit = nbOutputs / g;

  const logF = new Array<number>(g + 1).fill(Number.NEGATIVE_INFINITY);
  logF[0] = 0;
  for (let s = 1; s <= g; s++) {
    const inLeft = inPerUnit * s;
    const outLeft = outPerUnit * s;
    let acc = Number.NEGATIVE_INFINITY;
    for (let t = 1; t <= s; t++) {
      const term =
        log2Binomial(inLeft - 1, inPerUnit * t - 1) +
        log2Binomial(outLeft, outPerUnit * t) +
        logF[s - t];
      acc = log2SumExp(acc, term);
    }
    logF[s] = acc;
  }
  return logF[g];
}

function log2Binomial(n: number, k: number): number {
  if (k < 0 || k > n || n < 0) return Number.NEGATIVE_INFINITY;
  const kk = Math.min(k, n - k);
  let total = 0;
  for (let i = 1; i <= kk; i++) total += Math.log2(n - kk + i) - Math.log2(i);
  return total;
}

function log2SumExp(a: number, b: number): number {
  if (a === Number.NEGATIVE_INFINITY) return b;
  if (b === Number.NEGATIVE_INFINITY) return a;
  const hi = Math.max(a, b);
  return hi + Math.log2(1 + 2 ** (Math.min(a, b) - hi));
}

function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

const binomialCache = new Map<number, number>();

function binomial(n: number, k: number): number {
  if (k < 0 || k > n || n < 0) return 0;
  if (k === 0 || k === n) return 1;
  const key = n * 64 + k;
  const hit = binomialCache.get(key);
  if (hit !== undefined) return hit;
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= kk; i++) result = (result * (n - kk + i)) / i;
  result = Math.round(result);
  binomialCache.set(key, result);
  return result;
}

/**
 * Analyze a transaction's input/output value structure.
 *
 * Values are satoshis. Inputs must cover outputs; the difference is the fee.
 */
export function analyzeBoltzmann(
  inputSats: readonly number[],
  outputSats: readonly number[],
  options: BoltzmannOptions = {},
): BoltzmannResult {
  const maxInputs = options.maxInputs ?? DEFAULTS.maxInputs;
  const maxOutputs = options.maxOutputs ?? DEFAULTS.maxOutputs;
  const maxSteps = options.maxSteps ?? DEFAULTS.maxSteps;

  const n = inputSats.length;
  const m = outputSats.length;
  const totalIn = sum(inputSats);
  const totalOut = sum(outputSats);
  const fee = totalIn - totalOut;

  if (n === 0 || m === 0) return skipped('transaction has no inputs or no outputs', n, m, fee);
  if (inputSats.some((v) => v < 0) || outputSats.some((v) => v < 0)) {
    return skipped('negative value', n, m, fee);
  }
  if (fee < 0) return skipped('outputs exceed inputs (missing prevout values)', n, m, fee);
  if (n > maxInputs || m > maxOutputs) {
    return skipped(`transaction too large to analyze (${n} in, ${m} out)`, n, m, fee);
  }
  void maxSteps;

  const inputClasses = toValueClasses(inputSats);
  const outputClasses = toValueClasses(outputSats);
  const mapping = countNumericMappings(inputClasses, outputClasses, {
    maxStates: options.maxStates ?? DEFAULTS.maxStates,
    maxSteps: options.maxSteps ?? DEFAULTS.maxSteps,
  });

  if (mapping.status !== 'ok') {
    return skipped(mapping.reason ?? 'analysis declined', n, m, fee, mapping.status, mapping.steps);
  }

  // expand class-level probabilities back onto individual coins
  const inputClassOf = classIndex(inputSats, inputClasses);
  const outputClassOf = classIndex(outputSats, outputClasses);
  const linkProbability: number[][] = inputSats.map((_, i) =>
    outputSats.map((__, j) => mapping.classLinkProbability[inputClassOf[i]][outputClassOf[j]]),
  );

  const deterministicLinks: BoltzmannLink[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (linkProbability[i][j] >= 1 - 1e-9) deterministicLinks.push({ input: i, output: j });
    }
  }
  const outputLinkMax = outputSats.map((_, j) => {
    let strongest = 0;
    for (let i = 0; i < n; i++) strongest = Math.max(strongest, linkProbability[i][j]);
    return strongest;
  });

  const combinations = mapping.combinations;
  const entropy = Math.log2(combinations);
  // computed in log space so wide shapes cannot overflow the ceiling
  const maxEntropy = perfectCoinjoinEntropyBits(n, m);

  return {
    status: 'ok',
    reason: null,
    nbInputs: n,
    nbOutputs: m,
    feeSats: fee,
    combinations,
    entropy,
    maxEntropy,
    // ratio of counts, evaluated as a difference of logs to stay overflow-safe
    efficiency: maxEntropy > 0 ? Math.min(1, 2 ** (entropy - maxEntropy)) : entropy === 0 ? 1 : 0,
    density: entropy / (n + m),
    linkProbability,
    deterministicLinks,
    steps: mapping.steps,
    outputLinkMax,
    states: mapping.states,
  };
}

/** index of each coin's value class */
function classIndex(values: readonly number[], classes: { valueSats: number }[]): number[] {
  const lookup = new Map<number, number>();
  classes.forEach((cls, index) => lookup.set(cls.valueSats, index));
  return values.map((value) => lookup.get(value) ?? 0);
}

function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/** subsetSums[mask] = total value of the entries selected by mask */
function subsetSums(values: readonly number[]): Float64Array {
  const size = 1 << values.length;
  const sums = new Float64Array(size);
  for (let mask = 1; mask < size; mask++) {
    const lowest = mask & -mask;
    const index = 31 - Math.clz32(lowest);
    sums[mask] = sums[mask ^ lowest] + values[index];
  }
  return sums;
}

/** first index whose value is >= target */
function lowerBound(sorted: number[], target: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function popcount(value: number): number {
  let v = value - ((value >> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >> 2) & 0x33333333);
  return (((v + (v >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
}
