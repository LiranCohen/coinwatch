import type { CoinjoinMeta } from '@chainwatch/shared';

export interface NormalizedTx {
  txid: string;
  inputs: { address: string | null; valueSats: number }[];
  outputs: { address: string | null; valueSats: number }[];
  totalOutputSats: number;
}

export interface AddressActivity {
  txid: string;
  spendsFromAddress: boolean;
  blockHeight: number | null;
}

export function whale(tx: NormalizedTx, thresholdSats: number): boolean {
  return tx.totalOutputSats >= thresholdSats;
}

function largestEqualGroup(values: number[]): { valueSats: number; count: number } {
  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let valueSats = 0;
  let count = 0;
  for (const [value, n] of counts) {
    if (n > count || (n === count && value > valueSats)) {
      count = n;
      valueSats = value;
    }
  }
  return { valueSats, count };
}

export function classifyCoinjoin(tx: NormalizedTx, minEqualOutputs: number): CoinjoinMeta | null {
  const denomination = largestEqualGroup(tx.outputs.map((output) => output.valueSats));
  if (denomination.count < minEqualOutputs) return null;
  const equalInputCount = largestEqualGroup(tx.inputs.map((input) => input.valueSats)).count;
  let kind: CoinjoinMeta['kind'] = 'generic';
  if (denomination.count === 5 && equalInputCount === 5) {
    kind = 'whirlpool';
  } else if (denomination.count >= 10) {
    kind = 'wasabi';
  }
  const participantCount = new Set(
    tx.inputs.map((input) => input.address).filter((address) => address !== null),
  ).size;
  return {
    kind,
    denominationSats: denomination.valueSats,
    equalOutputCount: denomination.count,
    participantCount,
  };
}

export function coinjoin(tx: NormalizedTx, minEqualOutputs: number): boolean {
  return classifyCoinjoin(tx, minEqualOutputs) !== null;
}

export const DORMANT_MAX_CANDIDATE_ADDRESSES = 3;

export interface DormantOptions {
  minValueSats: number;
  dormantBlocks: number;
  tipHeight: number;
  maxCandidateAddresses?: number;
  getAddressActivity: (address: string) => Promise<AddressActivity[] | null>;
}

export async function dormantWake(tx: NormalizedTx, options: DormantOptions): Promise<boolean> {
  if (tx.totalOutputSats < options.minValueSats) return false;
  const maxCandidates = options.maxCandidateAddresses ?? DORMANT_MAX_CANDIDATE_ADDRESSES;
  const seen = new Set<string>();
  const candidates: string[] = [];
  const sorted = [...tx.inputs].sort((a, b) => b.valueSats - a.valueSats);
  for (const input of sorted) {
    if (input.address === null || seen.has(input.address)) continue;
    seen.add(input.address);
    candidates.push(input.address);
    if (candidates.length >= maxCandidates) break;
  }
  for (const address of candidates) {
    const history = await options.getAddressActivity(address);
    if (history === null) continue;
    if (isDormant(tx.txid, history, options.tipHeight, options.dormantBlocks)) return true;
  }
  return false;
}

function isDormant(
  inFlightTxid: string,
  history: AddressActivity[],
  tipHeight: number,
  dormantBlocks: number,
): boolean {
  const prior = history.filter((entry) => entry.txid !== inFlightTxid);
  const heightOf = (entry: AddressActivity): number => entry.blockHeight ?? tipHeight;
  let newestSpendHeight: number | null = null;
  let oldestActivityHeight: number | null = null;
  for (const entry of prior) {
    const height = heightOf(entry);
    if (entry.spendsFromAddress && (newestSpendHeight === null || height > newestSpendHeight)) {
      newestSpendHeight = height;
    }
    if (oldestActivityHeight === null || height < oldestActivityHeight) {
      oldestActivityHeight = height;
    }
  }
  if (newestSpendHeight !== null) {
    return tipHeight - newestSpendHeight >= dormantBlocks;
  }
  if (oldestActivityHeight === null) return false;
  return tipHeight - oldestActivityHeight >= dormantBlocks;
}
