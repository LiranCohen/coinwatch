/**
 * Forensic address analysis: value-flow tracing and wallet clustering.
 *
 * Both views are built from one primitive — an address's transaction list — so
 * a trace costs one upstream request per address visited, and clustering the
 * focus address costs nothing extra.
 *
 * Tracing is address-centric rather than transaction-centric. A transaction
 * graph shows join/split structure faithfully but turns into a hairball within
 * a couple of hops; investigators actually ask "which addresses funded this,
 * and where did it go from here", which is an address-level question.
 *
 * Everything here is bounded. Chain data is unbounded and public explorers are
 * rate-limited, so every expansion carries an explicit budget and reports when
 * it stopped early rather than presenting a sample as the whole trail.
 */

import type {
  AddressCluster,
  AddressFlow,
  ClusterMember,
  FlowEdge,
  FlowNode,
} from '@chainwatch/shared';
import type { EsploraClient, EsploraTx } from '../ingest/esplora';

export interface FlowOptions {
  /** how far back through funding transactions to walk */
  upstreamHops?: number;
  /** how far forward through spends to walk */
  downstreamHops?: number;
  /** hard cap on addresses fetched, the real cost driver */
  maxAddresses?: number;
  /** ignore flows below this, so dust spam does not crowd out the story */
  minEdgeSats?: number;
}

const FLOW_DEFAULTS = {
  upstreamHops: 2,
  downstreamHops: 2,
  maxAddresses: 16,
  minEdgeSats: 100_000,
} as const;

/**
 * Balance is only needed to say whether an address still holds what it was
 * traced receiving, which is a claim worth making about the significant nodes
 * and not worth a request each for the long tail of small contributors.
 */
const STATS_MIN_SATS = 10_000_000;

/** counterparties per transaction beyond which a payout is treated as fan-out, not a trail */
const FANOUT_LIMIT = 12;

interface Movement {
  counterparty: string;
  valueSats: number;
  txid: string;
}

/** Net effect of a transaction on an address, and who it moved value with. */
function readTx(tx: EsploraTx, address: string): { delta: number; sources: Movement[]; sinks: Movement[] } {
  const received = tx.outputs.reduce((t, o) => (o.address === address ? t + o.valueSats : t), 0);
  const spent = tx.inputs.reduce((t, i) => (i.address === address ? t + i.valueSats : t), 0);
  const delta = received - spent;

  const sources: Movement[] = [];
  const sinks: Movement[] = [];
  if (delta > 0) {
    // funded here: every other input is a candidate source, credited in proportion
    const inputs = tx.inputs.filter((i) => i.address !== null && i.address !== address);
    const total = inputs.reduce((t, i) => t + i.valueSats, 0);
    for (const input of inputs) {
      const share = total > 0 ? input.valueSats / total : 1 / Math.max(1, inputs.length);
      sources.push({ counterparty: input.address!, valueSats: Math.round(delta * share), txid: tx.txid });
    }
  } else if (delta < 0) {
    const outputs = tx.outputs.filter((o) => o.address !== null && o.address !== address);
    if (outputs.length <= FANOUT_LIMIT) {
      for (const output of outputs) {
        sinks.push({ counterparty: output.address!, valueSats: output.valueSats, txid: tx.txid });
      }
    }
  }
  return { delta, sources, sinks };
}

export async function traceAddressFlow(
  client: EsploraClient,
  focus: string,
  options: FlowOptions = {},
): Promise<AddressFlow> {
  const upstreamHops = options.upstreamHops ?? FLOW_DEFAULTS.upstreamHops;
  const downstreamHops = options.downstreamHops ?? FLOW_DEFAULTS.downstreamHops;
  const maxAddresses = options.maxAddresses ?? FLOW_DEFAULTS.maxAddresses;
  const minEdgeSats = options.minEdgeSats ?? FLOW_DEFAULTS.minEdgeSats;

  const nodes = new Map<string, FlowNode>();
  const edges = new Map<string, FlowEdge>();
  const visited = new Set<string>();
  let truncated = false;
  let fetches = 0;
  let lookupFailures = 0;
  let focusReadable = false;

  const node = (address: string, hop: number): FlowNode => {
    const existing = nodes.get(address);
    if (existing) {
      // keep the shortest path to the focus, so layout stays meaningful
      if (Math.abs(hop) < Math.abs(existing.hop)) existing.hop = hop;
      return existing;
    }
    const created: FlowNode = {
      address,
      hop,
      balanceSats: null,
      txCount: null,
      tracedSats: 0,
      labels: [],
      unmoved: false,
      frontier: false,
    };
    nodes.set(address, created);
    return created;
  };

  const link = (from: string, to: string, valueSats: number, txid: string): void => {
    const key = `${from}>${to}`;
    const existing = edges.get(key);
    if (existing) {
      existing.valueSats += valueSats;
      if (!existing.txids.includes(txid)) existing.txids.unshift(txid);
      return;
    }
    edges.set(key, { from, to, valueSats, txids: [txid], share: 0 });
  };

  node(focus, 0);
  // walk outward one hop at a time so the budget is spent nearest the focus first
  let frontier: { address: string; hop: number; weightSats: number }[] = [
    { address: focus, hop: 0, weightSats: Number.MAX_SAFE_INTEGER },
  ];

  while (frontier.length > 0) {
    const next: { address: string; hop: number; weightSats: number }[] = [];
    // a limited budget should follow the money, not whatever was discovered first
    frontier.sort((a, b) => b.weightSats - a.weightSats);
    for (const { address, hop } of frontier) {
      if (visited.has(address)) continue;
      // a node at the depth limit has nothing left to expand into, so fetching
      // its history would spend budget to learn nothing
      const canExpandUp = hop <= 0 && -hop < upstreamHops;
      const canExpandDown = hop >= 0 && hop < downstreamHops;
      if (!canExpandUp && !canExpandDown) continue;
      if (fetches >= maxAddresses) {
        truncated = true;
        const stalled = nodes.get(address);
        if (stalled) stalled.frontier = true;
        continue;
      }
      visited.add(address);

      const self = node(address, hop);
      let txs: EsploraTx[];
      try {
        txs = await client.addressTxs(address);
        fetches++;
        // the balance claim is only made where it carries weight
        if (address === focus || self.tracedSats >= STATS_MIN_SATS) {
          const stats = await client.address(address);
          if (stats) {
            self.balanceSats = stats.balanceSats;
            self.txCount = stats.txCount;
          }
        }
      } catch {
        self.frontier = true;
        truncated = true;
        lookupFailures++;
        continue;
      }
      if (address === focus) focusReadable = true;

      for (const tx of txs) {
        const { sources, sinks } = readTx(tx, address);
        // upstream: who funded this address
        if (hop <= 0 && -hop < upstreamHops) {
          for (const move of sources) {
            if (move.valueSats < minEdgeSats) continue;
            node(move.counterparty, hop - 1).tracedSats += move.valueSats;
            link(move.counterparty, address, move.valueSats, move.txid);
            next.push({ address: move.counterparty, hop: hop - 1, weightSats: move.valueSats });
          }
        }
        // downstream: where this address sent value
        if (hop >= 0 && hop < downstreamHops) {
          for (const move of sinks) {
            if (move.valueSats < minEdgeSats) continue;
            node(move.counterparty, hop + 1).tracedSats += move.valueSats;
            link(address, move.counterparty, move.valueSats, move.txid);
            next.push({ address: move.counterparty, hop: hop + 1, weightSats: move.valueSats });
          }
        }
      }
    }
    frontier = next;
  }

  // share is measured against everything traced into the destination
  const inflow = new Map<string, number>();
  const outflow = new Map<string, number>();
  for (const edge of edges.values()) {
    inflow.set(edge.to, (inflow.get(edge.to) ?? 0) + edge.valueSats);
    outflow.set(edge.from, (outflow.get(edge.from) ?? 0) + edge.valueSats);
  }
  for (const edge of edges.values()) {
    const total = inflow.get(edge.to) ?? 0;
    edge.share = total > 0 ? edge.valueSats / total : 0;
  }
  // an address holding at least what we traced into it has not moved those funds on
  for (const flowNode of nodes.values()) {
    const received = inflow.get(flowNode.address) ?? 0;
    const sent = outflow.get(flowNode.address) ?? 0;
    // the headline figure is whatever value this address handled on the traced path
    flowNode.tracedSats = Math.max(received, sent);
    // "unmoved" is a claim about the money stopping here, so it requires both a
    // held balance and no onward flow: an address that forwarded value has moved
    // it on however much it happens to still hold
    flowNode.unmoved =
      flowNode.balanceSats !== null &&
      received > 0 &&
      sent === 0 &&
      flowNode.balanceSats >= received;
  }

  // a trace that could not read its own starting point has found nothing, which
  // is not the same as there being nothing to find
  const budgetBound = fetches >= maxAddresses;
  const note = !focusReadable
    ? 'The chain source did not answer for this address, so nothing could be traced.'
    : lookupFailures > 0
      ? `${lookupFailures} address lookup${lookupFailures === 1 ? '' : 's'} failed, so parts of the trail are missing.`
      : budgetBound
        ? `Expansion stopped at ${maxAddresses} addresses; the trail continues past the marked nodes.`
        : null;

  return {
    focus,
    nodes: [...nodes.values()].sort((a, b) => a.hop - b.hop || b.tracedSats - a.tracedSats),
    edges: [...edges.values()].sort((a, b) => b.valueSats - a.valueSats),
    truncated,
    note,
    available: focusReadable,
  };
}

export interface ClusterOptions {
  /** hard cap on cluster members returned */
  maxMembers?: number;
}

const CLUSTER_DEFAULTS = { maxMembers: 60 } as const;

/**
 * Wallet clustering by common input ownership.
 *
 * When a transaction spends several inputs, one party held every one of those
 * keys at signing time, so their addresses belong to the same wallet. This is
 * a proof from the chain rather than a guess — unlike change-address
 * heuristics, which coinjoins and payment batching routinely defeat.
 */
export async function clusterAddress(
  client: EsploraClient,
  focus: string,
  options: ClusterOptions = {},
): Promise<AddressCluster> {
  const maxMembers = options.maxMembers ?? CLUSTER_DEFAULTS.maxMembers;

  let txs: EsploraTx[];
  try {
    txs = await client.addressTxs(focus);
  } catch {
    return {
      focus,
      members: [],
      bindingTxids: [],
      patterns: [],
      truncated: false,
      note: null,
      available: false,
    };
  }

  const cospends = new Map<string, number>();
  const bindingTxids: string[] = [];
  let sweepInputs = 0;
  let reuseSpends = 0;
  let peelLike = 0;

  for (const tx of txs) {
    const spendsHere = tx.inputs.some((input) => input.address === focus);
    if (!spendsHere) continue;

    const inputAddresses = tx.inputs
      .map((input) => input.address)
      .filter((address): address is string => address !== null);
    const distinct = new Set(inputAddresses);

    if (distinct.size > 1) {
      bindingTxids.push(tx.txid);
      for (const address of distinct) {
        if (address === focus) continue;
        cospends.set(address, (cospends.get(address) ?? 0) + 1);
      }
    }
    // a large input count with a single destination is a sweep
    if (tx.inputs.length >= 20 && tx.outputs.length <= 2) sweepInputs = Math.max(sweepInputs, tx.inputs.length);
    // the same address supplying many inputs is address reuse, not a multi-party wallet
    if (distinct.size === 1 && tx.inputs.length > 1) reuseSpends++;
    // one payment plus one change output, repeatedly, is a peel chain
    if (tx.inputs.length === 1 && tx.outputs.length === 2) peelLike++;
  }

  const patterns: string[] = [];
  if (sweepInputs > 0) {
    patterns.push(`Sweep: a transaction consolidated ${sweepInputs} inputs into a single destination.`);
  }
  if (reuseSpends >= 3) {
    patterns.push(
      `Address reuse: ${reuseSpends} transactions spent multiple inputs that all sat on this one address.`,
    );
  }
  if (peelLike >= 5) {
    patterns.push(`Peel chain: ${peelLike} one-in/two-out spends, the shape of repeated peeling to fresh change.`);
  }
  if (bindingTxids.length === 0) {
    patterns.push('No co-spend found: nothing in the sampled history proves shared control with another address.');
  }

  const ranked = [...cospends.entries()].sort((a, b) => b[1] - a[1]);
  const truncated = ranked.length > maxMembers;
  const members: ClusterMember[] = ranked.slice(0, maxMembers).map(([address, count]) => ({
    address,
    cospends: count,
    balanceSats: null,
    labels: [],
  }));

  return {
    focus,
    members,
    bindingTxids: bindingTxids.slice(0, 20),
    patterns,
    truncated,
    note: truncated
      ? `Showing the ${maxMembers} most strongly linked of ${ranked.length} co-spending addresses.`
      : `Derived from the ${txs.length} most recent transactions the chain source returned, not the full history.`,
    available: true,
  };
}
