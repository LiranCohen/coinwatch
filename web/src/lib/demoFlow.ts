import type { EventDetail } from '@chainwatch/shared';

interface Io {
  address: string | null;
  valueSats: number;
}

/** Deterministic PRNG seeded from the txid so a given event always renders the same graph. */
function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
  };
}

const B32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function fakeAddress(rand: () => number): string {
  let s = 'bc1q';
  for (let i = 0; i < 38; i++) s += B32[Math.floor(rand() * 32)];
  return s;
}

/**
 * Demo events arrive with a single synthetic input/output, which makes the
 * flow graph trivial. Expand them into a plausible io set shaped by the
 * matched rule; real (labeled) addresses from the event are kept in place.
 */
export function enrichIo(event: EventDetail): { inputs: Io[]; outputs: Io[] } {
  if (event.source !== 'demo' || event.inputs.length > 1 || event.outputs.length > 1) {
    return { inputs: event.inputs, outputs: event.outputs };
  }
  const rand = rng(event.txid);
  const realIn = event.inputs[0]?.address ?? null;
  const realOut = event.outputs[0]?.address ?? null;
  const total = event.valueSats;

  if (event.rules.includes('coinjoin')) {
    // N participants, each contributing denom + change + fee. Equal-denomination
    // outputs are shuffled; change outputs stay value-linked to their input so
    // the change-match heuristic has something honest to find.
    const n = 6 + Math.floor(rand() * 4); // 6-9 participants
    const denom = Math.round(total / n / 1_000_000) * 1_000_000 || Math.round(total / n);
    const inputs: Io[] = [];
    const change: Io[] = [];
    for (let i = 0; i < n; i++) {
      const changeSats = Math.floor(denom * (0.05 + rand() * 0.85));
      const fee = Math.floor(3000 + rand() * 12000);
      inputs.push({
        address: i === 0 ? realIn : fakeAddress(rand),
        valueSats: denom + changeSats + fee,
      });
      change.push({ address: fakeAddress(rand), valueSats: changeSats });
    }
    const equal: Io[] = Array.from({ length: n }, (_, i) => ({
      address: i === 0 ? realOut : fakeAddress(rand),
      valueSats: denom,
    }));
    // interleave equal + change so the column doesn't look sorted
    const outputs: Io[] = [];
    while (equal.length || change.length) {
      if (equal.length && (rand() < 0.6 || !change.length)) outputs.push(equal.shift()!);
      else outputs.push(change.shift()!);
    }
    return { inputs, outputs };
  }

  if (event.rules.includes('dormant-wake')) {
    const sweep = Math.floor(total * (0.82 + rand() * 0.12));
    return {
      inputs: [{ address: realIn, valueSats: total + 25_000 }],
      outputs: [
        { address: realOut, valueSats: sweep },
        { address: fakeAddress(rand), valueSats: total - sweep },
      ],
    };
  }

  // whale (default): a few consolidated inputs → destination + change
  const nIn = 2 + Math.floor(rand() * 3);
  const weights = Array.from({ length: nIn }, () => 0.4 + rand());
  const wSum = weights.reduce((a, b) => a + b, 0);
  const inputs: Io[] = weights.map((w, i) => ({
    address: i === 0 ? realIn : fakeAddress(rand),
    valueSats: Math.floor(((total + 40_000) * w) / wSum),
  }));
  const main = Math.floor(total * (0.9 + rand() * 0.08));
  return {
    inputs,
    outputs: [
      { address: realOut, valueSats: main },
      { address: fakeAddress(rand), valueSats: total - main },
    ],
  };
}

export interface LinkGuess {
  inputIndex: number;
  outputIndex: number;
  confidence: number; // 0..1
  reason: string;
}

/**
 * Change-match heuristic for coinjoins: the modal output value is the mixed
 * denomination; every non-denomination output is change, and its likely owner
 * is the input whose (value - denom) sits closest to it.
 */
export function guessLinks(inputs: Io[], outputs: Io[]): LinkGuess[] {
  if (inputs.length < 3 || outputs.length < 3) return [];
  const counts = new Map<number, number>();
  for (const o of outputs) counts.set(o.valueSats, (counts.get(o.valueSats) ?? 0) + 1);
  let denom = 0;
  let best = 1;
  for (const [v, c] of counts) if (c > best || (c === best && v > denom)) [denom, best] = [v, c];
  if (best < 3) return [];

  const guesses: LinkGuess[] = [];
  const taken = new Set<number>();
  outputs.forEach((o, oi) => {
    if (o.valueSats === denom) return;
    let bestIn = -1;
    let bestResidual = Infinity;
    inputs.forEach((inp, ii) => {
      if (taken.has(ii)) return;
      const residual = Math.abs(inp.valueSats - denom - o.valueSats);
      if (residual < bestResidual) {
        bestResidual = residual;
        bestIn = ii;
      }
    });
    if (bestIn === -1) return;
    const rel = bestResidual / Math.max(o.valueSats, 1);
    if (rel > 0.5) return;
    taken.add(bestIn);
    // deterministic jitter so a page of guesses doesn't show one uniform number
    const jitter = ((o.valueSats % 271) / 271) * 0.34;
    guesses.push({
      inputIndex: bestIn,
      outputIndex: oi,
      confidence: Math.max(0.42, Math.min(0.93, 1 - rel * 2.2) - jitter),
      reason: 'change match',
    });
  });
  return guesses;
}
