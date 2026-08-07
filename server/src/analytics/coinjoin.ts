/**
 * Coinjoin analysis.
 *
 * A coinjoin exists to break the common-input-ownership heuristic: its inputs
 * come from unrelated parties on purpose. Clustering across one therefore
 * merges strangers into a single fictitious wallet — measured error rates for
 * that mistake exceed 60%. So this module does the opposite of clustering on
 * the join itself, and instead separates three very different kinds of claim:
 *
 *   proven      links that hold in every valid input-to-output mapping, and
 *               post-mix consolidations, where a later transaction spent
 *               several of this join's outputs together and thereby proved
 *               common ownership of them by ordinary co-spend logic
 *   probable    subset-sum candidates, reported with the arithmetic that
 *               produced them rather than as a verdict
 *   unknowable  everything the mixing actually protects
 *
 * The post-mix half is where real deanonymization happens: mixing buys an
 * anonymity set, and consolidating outputs later spends it. That analysis costs
 * exactly one request, because Esplora reports the spend status of every output
 * of a transaction in one call.
 */

import type { CoinjoinAnalysis, CoinjoinLinkage, TxEntropy } from '@chainwatch/shared';
import type { EsploraClient, EsploraTx } from '../ingest/esplora';
import { analyzeBoltzmann } from './boltzmann';

/**
 * Deliberately looser than the detection rule. For clustering the cost of a
 * miss is a fabricated link between strangers, so anything join-shaped is
 * excluded rather than risk that.
 */
export function looksLikeCoinjoin(tx: EsploraTx): boolean {
  if (tx.isCoinbase) return false;
  if (tx.inputs.length < 3 || tx.outputs.length < 3) return false;
  const counts = new Map<number, number>();
  for (const output of tx.outputs) counts.set(output.valueSats, (counts.get(output.valueSats) ?? 0) + 1);
  const largestEqualGroup = Math.max(...counts.values());
  if (largestEqualGroup < 3) return false;
  // several parties must plausibly be present on the input side
  const distinctInputs = new Set(tx.inputs.map((input) => input.address).filter(Boolean));
  return distinctInputs.size >= 3;
}

function entropyOf(tx: EsploraTx): TxEntropy {
  const result = analyzeBoltzmann(
    tx.inputs.map((io) => io.valueSats),
    tx.outputs.map((io) => io.valueSats),
  );
  return {
    status: result.status,
    reason: result.reason,
    combinations: result.combinations,
    entropy: result.entropy,
    maxEntropy: result.maxEntropy,
    efficiency: result.efficiency,
    density: result.density,
    linkProbability: result.linkProbability,
    deterministicLinks: result.deterministicLinks,
    outputLinkMax: result.outputLinkMax,
    states: result.states,
  };
}

export async function analyzeCoinjoin(
  client: EsploraClient,
  txid: string,
): Promise<CoinjoinAnalysis | null> {
  const tx = await client.tx(txid);
  if (tx === null) return null;

  const counts = new Map<number, number>();
  for (const output of tx.outputs) counts.set(output.valueSats, (counts.get(output.valueSats) ?? 0) + 1);
  let denominationSats = 0;
  let equalOutputs = 0;
  for (const [value, count] of counts) {
    if (count > equalOutputs || (count === equalOutputs && value > denominationSats)) {
      equalOutputs = count;
      denominationSats = value;
    }
  }

  const entropy = entropyOf(tx);
  const participants = new Set(tx.inputs.map((input) => input.address).filter(Boolean)).size;

  // Post-mix linkage. Outputs of the same denomination are interchangeable at
  // the moment of mixing; if a later transaction spends two of them together,
  // whoever signed it held both keys, and their indistinguishability is gone.
  let outspends: Awaited<ReturnType<EsploraClient['outspends']>> = [];
  let linkageAvailable = true;
  try {
    outspends = await client.outspends(txid);
  } catch {
    linkageAvailable = false;
  }

  // Every output counts here, not just the modal denomination. WabiSabi
  // decomposes a participant's value into several standard amounts, so the
  // non-modal outputs are mixed too — restricting linkage to the modal value
  // would discard most of the evidence.
  const spenders = new Map<string, number[]>();
  outspends.forEach((spend, index) => {
    if (!spend.spent || spend.txid === null) return;
    const list = spenders.get(spend.txid) ?? [];
    list.push(index);
    spenders.set(spend.txid, list);
  });

  const linkages: CoinjoinLinkage[] = [];
  for (const [spendTxid, outputs] of spenders) {
    if (outputs.length < 2) continue;
    linkages.push({
      spendTxid,
      outputs,
      valueSats: outputs.reduce((total, index) => total + (tx.outputs[index]?.valueSats ?? 0), 0),
      denominatedOutputs: outputs.filter((index) => tx.outputs[index]?.valueSats === denominationSats)
        .length,
    });
  }
  linkages.sort((a, b) => b.outputs.length - a.outputs.length);

  // Indistinguishability only exists within an equal-value group, so the
  // anonymity set is eroded only by consolidations among those outputs.
  const linkedDenominated = new Set(
    linkages.flatMap((link) =>
      link.outputs.filter((index) => tx.outputs[index]?.valueSats === denominationSats),
    ),
  );
  const collapsingGroups = linkages.filter((link) => link.denominatedOutputs >= 2).length;
  const spentCount = outspends.filter(
    (spend, index) => spend.spent && tx.outputs[index]?.valueSats === denominationSats,
  ).length;

  /**
   * Anonymity set is the count of outputs an observer cannot tell apart. Each
   * consolidation collapses its group to a single indistinguishable unit, so
   * the surviving set is the unlinked outputs plus one per consolidated group.
   */
  const effectiveAnonymitySet =
    equalOutputs > 0 ? equalOutputs - linkedDenominated.size + collapsingGroups : 0;
  const degradation =
    equalOutputs > 0 ? 1 - effectiveAnonymitySet / equalOutputs : 0;

  return {
    txid,
    isCoinjoin: looksLikeCoinjoin(tx),
    denominationSats,
    equalOutputs,
    inputCount: tx.inputs.length,
    outputCount: tx.outputs.length,
    participants,
    entropy,
    inputValues: tx.inputs.map((io) => io.valueSats),
    outputValues: tx.outputs.map((io) => io.valueSats),
    anonymitySet: equalOutputs,
    effectiveAnonymitySet,
    degradation,
    spentMixedOutputs: spentCount,
    linkages,
    linkageAvailable,
    blockHeight: tx.blockHeight,
    time: tx.blockTime,
  };
}
