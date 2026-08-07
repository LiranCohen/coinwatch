/**
 * Interpretation counting over *numeric mappings*.
 *
 * Counting a transaction's possible input-to-output mappings by enumerating
 * subsets of coins is exponential in the number of coins, which puts real
 * coinjoins out of reach — exactly the transactions worth analyzing. The fix,
 * from Kajaba et al., "Analysis of Input-Output Mappings in Coinjoin
 * Transactions with Arbitrary Values" (arXiv:2510.17284), is to enumerate only
 * mappings up to a permutation of same-valued coins. Coins of equal value are
 * interchangeable, so the search runs over *value classes* and their
 * multiplicities rather than over individual coins.
 *
 * A coinjoin is precisely the case where that collapses the space: 21 outputs
 * drawn from four distinct denominations give a few hundred class-states
 * instead of two million coin-subsets.
 *
 * The counts reported are still counts of full (labelled) mappings — each
 * numeric mapping is weighted by how many labelled arrangements it stands for,
 * so results match coin-level enumeration exactly. What changes is the cost of
 * getting them.
 */

export interface ValueClass {
  valueSats: number;
  count: number;
}

export interface NumericMappingResult {
  status: 'ok' | 'skipped' | 'aborted';
  reason: string | null;
  /** labelled mappings, summed over numeric mappings weighted by multiplicity */
  combinations: number;
  /** linkProbability[inputClass][outputClass] for any single coin of each class */
  classLinkProbability: number[][];
  states: number;
  steps: number;
}

export interface NumericMappingOptions {
  /** refuse when the class-state space exceeds this */
  maxStates?: number;
  /** abort once expansion exceeds this many steps */
  maxSteps?: number;
}

const DEFAULTS = {
  maxStates: 400_000,
  maxSteps: 4_000_000,
} as const;

/**
 * Compositions are materialised, so this bounds memory directly. The reachable
 * state count is bounded separately at search time — most (remaining-input,
 * remaining-output) pairs never arise, so the size of the encoding range says
 * almost nothing about the real cost.
 */
const MAX_COMPOSITIONS = 1_000_000;

/** Group equal values, largest first so the heaviest constraints bind earliest. */
export function toValueClasses(values: readonly number[]): ValueClass[] {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([valueSats, count]) => ({ valueSats, count }))
    .sort((a, b) => b.valueSats - a.valueSats);
}

const binomialCache = new Map<number, number>();

function binomial(n: number, k: number): number {
  if (k < 0 || k > n || n < 0) return 0;
  if (k === 0 || k === n) return 1;
  const key = n * 1024 + k;
  const hit = binomialCache.get(key);
  if (hit !== undefined) return hit;
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= kk; i++) result = (result * (n - kk + i)) / i;
  result = Math.round(result);
  binomialCache.set(key, result);
  return result;
}

interface Composition {
  counts: number[];
  sum: number;
}

/** Every multiset drawn from these classes, with its value, sorted by value. */
function enumerateCompositions(classes: ValueClass[], includeEmpty: boolean): Composition[] {
  let all: Composition[] = [{ counts: [], sum: 0 }];
  for (const cls of classes) {
    const next: Composition[] = [];
    for (const partial of all) {
      for (let take = 0; take <= cls.count; take++) {
        next.push({
          counts: [...partial.counts, take],
          sum: partial.sum + take * cls.valueSats,
        });
      }
    }
    all = next;
  }
  if (!includeEmpty) all = all.filter((c) => c.counts.some((take) => take > 0));
  all.sort((a, b) => a.sum - b.sum);
  return all;
}

export function countNumericMappings(
  inputClasses: ValueClass[],
  outputClasses: ValueClass[],
  options: NumericMappingOptions = {},
): NumericMappingResult {
  const maxStates = options.maxStates ?? DEFAULTS.maxStates;
  const maxSteps = options.maxSteps ?? DEFAULTS.maxSteps;

  const k = inputClasses.length;
  const m = outputClasses.length;

  // mixed-radix encoding of (remaining input counts, remaining output counts)
  const inRadix = inputClasses.map((c) => c.count + 1);
  const outRadix = outputClasses.map((c) => c.count + 1);
  const inCompositionCount = inRadix.reduce((a, b) => a * b, 1);
  const outCompositionCount = outRadix.reduce((a, b) => a * b, 1);
  const encodingRange = inCompositionCount * outCompositionCount;
  if (
    !Number.isFinite(encodingRange) ||
    encodingRange > Number.MAX_SAFE_INTEGER ||
    inCompositionCount > MAX_COMPOSITIONS ||
    outCompositionCount > MAX_COMPOSITIONS
  ) {
    return {
      status: 'skipped',
      reason: 'too many distinct coin values to enumerate value classes',
      combinations: 0,
      classLinkProbability: [],
      states: 0,
      steps: 0,
    };
  }

  const inStride: number[] = [];
  let stride = 1;
  for (let i = 0; i < k; i++) {
    inStride.push(stride);
    stride *= inRadix[i];
  }
  const outStride: number[] = [];
  for (let j = 0; j < m; j++) {
    outStride.push(stride);
    stride *= outRadix[j];
  }
  const encode = (inRem: number[], outRem: number[]): number => {
    let key = 0;
    for (let i = 0; i < k; i++) key += inRem[i] * inStride[i];
    for (let j = 0; j < m; j++) key += outRem[j] * outStride[j];
    return key;
  };

  const outCompositions = enumerateCompositions(outputClasses, false);
  const outSums = outCompositions.map((c) => c.sum);
  const inCompositions = enumerateCompositions(inputClasses, false);

  const sumOf = (counts: number[], classes: ValueClass[]): number => {
    let total = 0;
    for (let i = 0; i < classes.length; i++) total += counts[i] * classes[i].valueSats;
    return total;
  };

  let steps = 0;
  let aborted = false;
  const completions = new Map<number, number>();

  /**
   * Enumerate every valid first group of a state. The group must contain one
   * designated input — the anchor, taken from the first non-empty input class —
   * which is what stops a partition being counted once per ordering of its
   * groups.
   */
  const forEachGroup = (
    inRem: number[],
    outRem: number[],
    visit: (take: number[], give: number[], ways: number) => void,
  ): void => {
    const anchor = inRem.findIndex((remaining) => remaining > 0);
    if (anchor === -1) return;
    const budget = sumOf(inRem, inputClasses) - sumOf(outRem, outputClasses);
    if (budget < 0) return;

    for (const candidate of inCompositions) {
      if (aborted) return;
      const take = candidate.counts;
      if (take[anchor] < 1) continue;
      let fitsIn = true;
      for (let i = 0; i < k; i++) {
        if (take[i] > inRem[i]) {
          fitsIn = false;
          break;
        }
      }
      if (!fitsIn) continue;

      const need = candidate.sum;
      // outputs in this group must sum within [need - budget, need]
      let lo = lowerBound(outSums, need - budget);
      for (; lo < outCompositions.length && outSums[lo] <= need; lo++) {
        if (++steps > maxSteps) {
          aborted = true;
          return;
        }
        const give = outCompositions[lo].counts;
        let fits = true;
        for (let j = 0; j < m; j++) {
          if (give[j] > outRem[j]) {
            fits = false;
            break;
          }
        }
        if (!fits) continue;
        // labelled arrangements: the anchor is fixed, the rest are chosen
        let ways = binomial(inRem[anchor] - 1, take[anchor] - 1);
        for (let i = 0; i < k && ways > 0; i++) {
          if (i !== anchor) ways *= binomial(inRem[i], take[i]);
        }
        for (let j = 0; j < m && ways > 0; j++) ways *= binomial(outRem[j], give[j]);
        if (ways > 0) visit(take, give, ways);
      }
    }
  };

  const countFrom = (inRem: number[], outRem: number[]): number => {
    const emptyIn = inRem.every((r) => r === 0);
    const emptyOut = outRem.every((r) => r === 0);
    if (emptyIn && emptyOut) return 1;
    if (emptyIn || emptyOut) return 0;
    const key = encode(inRem, outRem);
    const memo = completions.get(key);
    if (memo !== undefined) return memo;
    if (aborted) return 0;
    if (completions.size > maxStates) {
      aborted = true;
      return 0;
    }

    let total = 0;
    forEachGroup(inRem, outRem, (take, give, ways) => {
      const nextIn = inRem.map((r, i) => r - take[i]);
      const nextOut = outRem.map((r, j) => r - give[j]);
      total += ways * countFrom(nextIn, nextOut);
    });
    completions.set(key, total);
    return total;
  };

  const rootIn = inputClasses.map((c) => c.count);
  const rootOut = outputClasses.map((c) => c.count);
  const combinations = countFrom(rootIn, rootOut);

  if (aborted) {
    return {
      status: 'aborted',
      reason:
        completions.size > maxStates
          ? `search reached ${maxStates.toLocaleString()} distinct states`
          : `search exceeded ${maxSteps.toLocaleString()} steps`,
      combinations: 0,
      classLinkProbability: [],
      states: completions.size,
      steps,
    };
  }
  if (combinations === 0) {
    return {
      status: 'skipped',
      reason: 'no valid interpretation (input/output values do not reconcile)',
      combinations: 0,
      classLinkProbability: [],
      states: completions.size,
      steps,
    };
  }

  // Second pass: how many mappings co-group a coin of class i with one of
  // class j. Reached-path counts are propagated forward; every state's inputs
  // strictly shrink, so processing by descending remaining-input count settles
  // each state before it is used.
  const paths = new Map<number, number>();
  paths.set(encode(rootIn, rootOut), 1);
  const decode = (key: number): { inRem: number[]; outRem: number[] } => {
    const inRem: number[] = [];
    const outRem: number[] = [];
    let rest = key;
    for (let i = 0; i < k; i++) {
      inRem.push(Math.floor(rest / inStride[i]) % inRadix[i]);
    }
    for (let j = 0; j < m; j++) {
      outRem.push(Math.floor(rest / outStride[j]) % outRadix[j]);
    }
    rest = 0;
    return { inRem, outRem };
  };

  const reachable = [...completions.keys()].filter((key) => (completions.get(key) ?? 0) > 0);
  reachable.sort((a, b) => {
    const ra = decode(a).inRem.reduce((x, y) => x + y, 0);
    const rb = decode(b).inRem.reduce((x, y) => x + y, 0);
    return rb - ra;
  });

  const pairCount: number[][] = Array.from({ length: k }, () => new Array<number>(m).fill(0));
  for (const key of reachable) {
    const reaching = paths.get(key);
    if (reaching === undefined || reaching === 0) continue;
    const { inRem, outRem } = decode(key);
    forEachGroup(inRem, outRem, (take, give, ways) => {
      const nextIn = inRem.map((r, i) => r - take[i]);
      const nextOut = outRem.map((r, j) => r - give[j]);
      const done = nextIn.every((r) => r === 0) && nextOut.every((r) => r === 0);
      const completing = done ? 1 : (completions.get(encode(nextIn, nextOut)) ?? 0);
      if (completing === 0) return;
      const weight = reaching * ways * completing;
      for (let i = 0; i < k; i++) {
        if (take[i] === 0) continue;
        for (let j = 0; j < m; j++) {
          // every input of class i in this group is co-grouped with every
          // output of class j in it
          if (give[j] > 0) pairCount[i][j] += weight * take[i] * give[j];
        }
      }
      if (!done) {
        const childKey = encode(nextIn, nextOut);
        paths.set(childKey, (paths.get(childKey) ?? 0) + reaching * ways);
      }
    });
  }

  // a specific coin pair, rather than all pairs of the two classes
  const classLinkProbability = pairCount.map((row, i) =>
    row.map(
      (count, j) => count / (inputClasses[i].count * outputClasses[j].count) / combinations,
    ),
  );

  return {
    status: 'ok',
    reason: null,
    combinations,
    classLinkProbability,
    states: completions.size,
    steps,
  };
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
