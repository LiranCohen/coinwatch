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

export function coinjoin(tx: NormalizedTx, minEqualOutputs: number): boolean {
  const counts = new Map<number, number>();
  for (const output of tx.outputs) {
    counts.set(output.valueSats, (counts.get(output.valueSats) ?? 0) + 1);
  }
  for (const count of counts.values()) {
    if (count >= minEqualOutputs) return true;
  }
  return false;
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
