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
}

export interface BoltzmannOptions {
  /** refuse to analyze wider transactions (search is exponential) */
  maxInputs?: number;
  maxOutputs?: number;
  /** abort once the search exceeds this many expansion steps */
  maxSteps?: number;
}

const DEFAULTS = {
  maxInputs: 12,
  maxOutputs: 12,
  maxSteps: 1_500_000,
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

  // Precompute subset sums. Output subsets are additionally sorted by sum so a
  // matching group can be found by range query instead of a linear scan.
  const inSubsetSum = subsetSums(inputSats);
  const outSubsetSum = subsetSums(outputSats);
  const outBySum: { mask: number; sum: number }[] = [];
  for (let mask = 1; mask < 1 << m; mask++) outBySum.push({ mask, sum: outSubsetSum[mask] });
  outBySum.sort((a, b) => a.sum - b.sum);
  const outSumsSorted = outBySum.map((entry) => entry.sum);

  const fullIn = (1 << n) - 1;
  const fullOut = (1 << m) - 1;
  const stateKey = (inMask: number, outMask: number) => inMask * (1 << m) + outMask;

  let steps = 0;
  let aborted = false;

  /** completions: interpretations of the sub-transaction left in this state */
  const completions = new Map<number, number>();

  const countFrom = (inMask: number, outMask: number): number => {
    if (inMask === 0 && outMask === 0) return 1;
    if (inMask === 0 || outMask === 0) return 0;
    const key = stateKey(inMask, outMask);
    const memo = completions.get(key);
    if (memo !== undefined) return memo;
    if (aborted) return 0;
    if (++steps > maxSteps) {
      aborted = true;
      return 0;
    }

    const budget = inSubsetSum[inMask] - outSubsetSum[outMask];
    if (budget < 0) {
      completions.set(key, 0);
      return 0;
    }

    let total = 0;
    forEachGroup(inMask, outMask, budget, (nextIn, nextOut) => {
      total += countFrom(nextIn, nextOut);
    });
    completions.set(key, total);
    return total;
  };

  /**
   * Enumerate every valid first group of a state: each subset of the remaining
   * inputs containing the lowest-indexed one (the anchor that keeps partitions
   * from being counted more than once), paired with every remaining-output
   * subset whose sum leaves non-negative, affordable slack.
   */
  function forEachGroup(
    inMask: number,
    outMask: number,
    budget: number,
    visit: (nextIn: number, nextOut: number, groupIn: number, groupOut: number) => void,
  ): void {
    const anchor = inMask & -inMask;
    const rest = inMask ^ anchor;
    for (let sub = rest; ; sub = (sub - 1) & rest) {
      const groupIn = sub | anchor;
      const need = inSubsetSum[groupIn];
      // outputs in this group must sum within [need - budget, need]
      const lo = lowerBound(outSumsSorted, need - budget);
      for (let idx = lo; idx < outBySum.length && outBySum[idx].sum <= need; idx++) {
        const groupOut = outBySum[idx].mask;
        if ((groupOut & outMask) !== groupOut) continue; // not available in this state
        visit(inMask ^ groupIn, outMask ^ groupOut, groupIn, groupOut);
      }
      if (sub === 0) break;
    }
  }

  const combinations = countFrom(fullIn, fullOut);

  if (aborted) {
    return skipped(
      `search exceeded ${maxSteps.toLocaleString()} steps`,
      n,
      m,
      fee,
      'aborted',
      steps,
    );
  }
  if (combinations === 0) {
    return skipped('no valid interpretation (input/output values do not reconcile)', n, m, fee, 'skipped', steps);
  }

  // Second pass: count, for each (input, output) pair, how many interpretations
  // place them in the same group. A group chosen at state X leading to state Y
  // appears in (paths reaching X) * (completions of Y) interpretations.
  const paths = new Map<number, number>();
  paths.set(stateKey(fullIn, fullOut), 1);
  const states = [...completions.keys()].filter((key) => (completions.get(key) ?? 0) > 0);
  // transitions only ever remove inputs, so wider states settle before narrower ones
  states.sort((a, b) => popcount(Math.floor(b / (1 << m))) - popcount(Math.floor(a / (1 << m))));

  const linkCount: number[][] = Array.from({ length: n }, () => new Array<number>(m).fill(0));

  for (const key of states) {
    const reaching = paths.get(key);
    if (reaching === undefined || reaching === 0) continue;
    const inMask = Math.floor(key / (1 << m));
    const outMask = key % (1 << m);
    const budget = inSubsetSum[inMask] - outSubsetSum[outMask];
    if (budget < 0) continue;

    forEachGroup(inMask, outMask, budget, (nextIn, nextOut, groupIn, groupOut) => {
      const completing = nextIn === 0 && nextOut === 0 ? 1 : (completions.get(stateKey(nextIn, nextOut)) ?? 0);
      if (completing === 0) return;
      const weight = reaching * completing;
      for (let i = 0; i < n; i++) {
        if ((groupIn & (1 << i)) === 0) continue;
        for (let j = 0; j < m; j++) {
          if ((groupOut & (1 << j)) !== 0) linkCount[i][j] += weight;
        }
      }
      if (nextIn !== 0 || nextOut !== 0) {
        const childKey = stateKey(nextIn, nextOut);
        paths.set(childKey, (paths.get(childKey) ?? 0) + reaching);
      }
    });
  }

  const linkProbability = linkCount.map((row) => row.map((count) => count / combinations));
  const deterministicLinks: BoltzmannLink[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (linkProbability[i][j] >= 1 - 1e-9) deterministicLinks.push({ input: i, output: j });
    }
  }

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
    steps,
  };
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
