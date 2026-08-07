import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import {
  validateBitcoinAddress,
  type AddressChainTx,
  type AddressChainTxsResponse,
} from '@chainwatch/shared';
import type { EsploraClient, EsploraTx } from '../ingest/esplora';
import { getEventByTxid } from '../store/db';
import { entropyFor } from '../detect/pipeline';
import { errMessage } from '../util';

/**
 * The detection index only holds transactions that tripped a rule, in blocks
 * this deployment happened to scan. An address can be busy on chain and absent
 * from it entirely, which makes an index-only address page look broken. This
 * serves what the address has actually done, read from the chain.
 */
const LOOKUP_TIMEOUT_MS = 8000;

export interface AddressTxRoutesDeps {
  db: Database;
  esplora: EsploraClient;
  warn?: (message: string) => void;
}

export function createAddressTxRoutes(deps: AddressTxRoutesDeps): Hono {
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  const app = new Hono();

  app.get('/api/addresses/:address/transactions', async (c) => {
    const validation = validateBitcoinAddress(c.req.param('address'));
    if (!validation.valid || validation.normalized === null) {
      return c.json({ error: validation.reason ?? 'not a bitcoin address' }, 400);
    }
    const address = validation.normalized;

    let txs: EsploraTx[];
    try {
      txs = await withTimeout(deps.esplora.addressTxs(address), LOOKUP_TIMEOUT_MS);
    } catch (err) {
      warn(`address txs: ${address} unavailable: ${errMessage(err)}`);
      const body: AddressChainTxsResponse = { address, transactions: [], available: false };
      return c.json(body);
    }

    const body: AddressChainTxsResponse = {
      address,
      available: true,
      transactions: txs.map((tx) => toChainTx(deps.db, tx, address)),
    };
    return c.json(body);
  });

  return app;
}

function toChainTx(db: Database, tx: EsploraTx, address: string): AddressChainTx {
  // an address can appear on both sides; the net movement is what it actually did
  const received = tx.outputs.reduce(
    (total, output) => (output.address === address ? total + output.valueSats : total),
    0,
  );
  const spent = tx.inputs.reduce(
    (total, input) => (input.address === address ? total + input.valueSats : total),
    0,
  );
  const event = getEventByTxid(db, tx.txid);
  return {
    txid: tx.txid,
    time: tx.blockTime,
    blockHeight: tx.blockHeight,
    confirmed: tx.confirmed,
    deltaSats: received - spent,
    feeSats: tx.feeSats,
    inputCount: tx.inputs.length,
    outputCount: tx.outputs.length,
    // coinbase inputs carry no prevout value, so the entropy arithmetic cannot close
    entropy: tx.isCoinbase
      ? null
      : entropyFor({
          txid: tx.txid,
          inputs: tx.inputs.map((input) => ({ address: input.address, valueSats: input.valueSats })),
          outputs: tx.outputs.map((output) => ({
            address: output.address,
            valueSats: output.valueSats,
          })),
          feeSats: tx.feeSats,
          confirmed: tx.confirmed,
          blockHeight: tx.blockHeight,
          blockHash: tx.blockHash,
          blockTime: tx.blockTime,
          isCoinbase: tx.isCoinbase,
        }),
    eventId: event?.id ?? null,
  };
}

/** Reject once the bound elapses; the upstream promise is left to settle unobserved. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
