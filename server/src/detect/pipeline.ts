import { EventEmitter } from 'node:events';
import type { Database } from 'bun:sqlite';
import type { Config } from '../config';
import type { Rule } from '@chainwatch/shared';
import type { BitcoinRpc, VerboseTx } from '../rpc/client';
import type { AddressInfoClient } from '../external/addressinfo';
import { coinjoin, dormantWake, whale, type NormalizedTx } from './rules';
import { insertEvent } from '../store/db';
import { listSweepableEvents, setEventStatus } from '../store/pipelineQueries';
import { errMessage } from '../util';

const SATS_PER_BTC = 100_000_000;
const FETCH_CONCURRENCY = 8;

export function btcToSats(btc: number): number {
  return Math.round(btc * SATS_PER_BTC);
}

export function normalizeTx(raw: VerboseTx): NormalizedTx {
  const inputs = raw.vin.map((input) => ({
    address: scriptAddress(input.prevout?.scriptPubKey),
    valueSats: btcToSats(input.prevout?.value ?? 0),
  }));
  const outputs = raw.vout.map((output) => ({
    address: scriptAddress(output.scriptPubKey),
    valueSats: btcToSats(output.value),
  }));
  return {
    txid: raw.txid,
    inputs,
    outputs,
    totalOutputSats: outputs.reduce((sum, output) => sum + output.valueSats, 0),
  };
}

function scriptAddress(
  scriptPubKey: { address?: string; addresses?: string[] } | undefined | null,
): string | null {
  if (!scriptPubKey) return null;
  if (typeof scriptPubKey.address === 'string') return scriptPubKey.address;
  if (Array.isArray(scriptPubKey.addresses) && typeof scriptPubKey.addresses[0] === 'string') {
    return scriptPubKey.addresses[0];
  }
  return null;
}

export interface PipelineDeps {
  db: Database;
  rpc: BitcoinRpc;
  config: Config;
  addressInfo?: AddressInfoClient | null;
  emitter?: EventEmitter;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}

export interface Pipeline {
  emitter: EventEmitter;
  poll(): Promise<void>;
  lastPollAt(): string | null;
}

export function createPipeline(deps: PipelineDeps): Pipeline {
  const { db, rpc, config } = deps;
  const emitter = deps.emitter ?? new EventEmitter();
  const log = deps.log ?? ((message: string) => console.log(message));
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  const whaleThresholdSats = btcToSats(config.whaleThresholdBtc);
  const dormantMinValueSats = btcToSats(config.dormantMinValueBtc);

  let prevMempool: Set<string> | null = null;
  let lastPoll: string | null = null;
  let polling = false;

  async function evaluateRules(tx: NormalizedTx, tipHeight: number): Promise<Rule[]> {
    const rules: Rule[] = [];
    if (whale(tx, whaleThresholdSats)) rules.push('whale');
    if (coinjoin(tx, config.coinjoinMinEqualOutputs)) rules.push('coinjoin');
    if (deps.addressInfo && tx.totalOutputSats >= dormantMinValueSats) {
      const hit = await dormantWake(tx, {
        minValueSats: dormantMinValueSats,
        dormantBlocks: config.dormantBlocks,
        tipHeight,
        getAddressActivity: (address) => deps.addressInfo!.getAddressActivity(address),
      });
      if (hit) rules.push('dormant-wake');
    }
    return rules;
  }

  async function processNewcomer(txid: string, tipHeight: number): Promise<void> {
    let raw: VerboseTx;
    try {
      raw = await rpc.getrawtransaction(txid);
    } catch (err) {
      warn(`pipeline: getrawtransaction(${txid}) failed: ${errMessage(err)}`);
      return;
    }
    const tx = normalizeTx(raw);
    const rules = await evaluateRules(tx, tipHeight);
    if (rules.length === 0) return;
    const { row, inserted } = insertEvent(db, {
      txid,
      rules,
      valueSats: tx.totalOutputSats,
      inputs: tx.inputs,
      outputs: tx.outputs,
    });
    if (inserted && row) {
      log(`pipeline: event detected txid=${txid} rules=${rules.join(',')}`);
      emitter.emit('event:new', row);
    }
  }

  async function processNewcomers(newcomers: string[], tipHeight: number): Promise<void> {
    for (let i = 0; i < newcomers.length; i += FETCH_CONCURRENCY) {
      await Promise.all(
        newcomers.slice(i, i + FETCH_CONCURRENCY).map((txid) => processNewcomer(txid, tipHeight)),
      );
    }
  }

  async function sweepEvent(row: { id: string; txid: string }, mempool: Set<string>): Promise<void> {
    if (mempool.has(row.txid)) return;
    let confirmed = false;
    try {
      const tx = await rpc.getrawtransaction(row.txid);
      confirmed = typeof tx.blockhash === 'string' && tx.blockhash.length > 0;
    } catch {
      confirmed = false;
    }
    const status = confirmed ? 'confirmed' : 'evicted';
    const updated = setEventStatus(db, row.id, status);
    if (updated) {
      log(`pipeline: event ${row.txid} -> ${status}`);
      emitter.emit('event:update', updated);
    }
  }

  async function evictionSweep(mempool: Set<string>): Promise<void> {
    const rows = listSweepableEvents(db);
    for (let i = 0; i < rows.length; i += FETCH_CONCURRENCY) {
      await Promise.all(rows.slice(i, i + FETCH_CONCURRENCY).map((row) => sweepEvent(row, mempool)));
    }
  }

  async function poll(): Promise<void> {
    if (polling) return;
    polling = true;
    try {
      const [info, txids] = await Promise.all([rpc.getblockchaininfo(), rpc.getrawmempool()]);
      const mempool = new Set(txids);
      if (prevMempool === null) {
        prevMempool = mempool;
        lastPoll = new Date().toISOString();
        log(`pipeline: baseline snapshot (${mempool.size} txs)`);
        return;
      }
      const newcomers = [...mempool].filter((txid) => !prevMempool!.has(txid));
      await processNewcomers(newcomers, info.blocks);
      await evictionSweep(mempool);
      prevMempool = mempool;
      lastPoll = new Date().toISOString();
    } catch (err) {
      warn(`pipeline: poll failed, will retry next interval: ${errMessage(err)}`);
    } finally {
      polling = false;
    }
  }

  return {
    emitter,
    poll,
    lastPollAt: () => lastPoll,
  };
}
