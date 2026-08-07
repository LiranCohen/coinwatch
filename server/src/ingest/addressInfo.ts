/**
 * Address lookups served through the shared Esplora client.
 *
 * Ingestion and address queries hit the same public explorers, so they must
 * share one paced, cached, failover-aware queue — otherwise two independent
 * clients race each other into rate limits.
 */

import type { AddressActivity } from '../detect/rules';
import type { AddressInfoClient, AddressStats, ExternalAddressTx } from '../external/addressinfo';
import { errMessage } from '../util';
import type { EsploraClient } from './esplora';

export interface EsploraAddressInfoOptions {
  warn?: (message: string) => void;
}

export function createEsploraAddressInfo(
  client: EsploraClient,
  options: EsploraAddressInfoOptions = {},
): AddressInfoClient {
  const warn = options.warn ?? ((message: string) => console.warn(message));

  /** callers treat null as "unknown, skip this check" rather than "no activity" */
  async function guard<T>(what: string, run: () => Promise<T>): Promise<T | null> {
    try {
      return await run();
    } catch (err) {
      warn(`addressinfo: ${what} failed: ${errMessage(err)}`);
      return null;
    }
  }

  return {
    async getAddressTxs(address: string): Promise<ExternalAddressTx[] | null> {
      return guard(`txs(${address})`, async () => {
        const txs = await client.addressTxs(address);
        return txs.map((tx) => ({
          txid: tx.txid,
          vin: tx.inputs.map((input) => ({
            prevout: input.address === null ? null : { scriptpubkey_address: input.address },
          })),
          status: {
            confirmed: tx.confirmed,
            block_height: tx.blockHeight ?? undefined,
          },
        }));
      });
    },

    async getAddressStats(address: string): Promise<AddressStats | null> {
      return guard(`stats(${address})`, async () => {
        const info = await client.address(address);
        if (info === null) return null;
        // re-express as the raw Esplora shape the API layer already reads
        return {
          address: info.address,
          chain_stats: {
            tx_count: info.txCount,
            funded_txo_sum: info.totalReceivedSats,
            spent_txo_sum: info.totalSentSats,
          },
          mempool_stats: { tx_count: info.unconfirmedTxCount, funded_txo_sum: 0, spent_txo_sum: 0 },
        } satisfies AddressStats;
      }).then((value) => value ?? null);
    },

    async getAddressActivity(address: string): Promise<AddressActivity[] | null> {
      return guard(`activity(${address})`, async () => {
        const txs = await client.addressTxs(address);
        return txs.map((tx) => ({
          txid: tx.txid,
          spendsFromAddress: tx.inputs.some((input) => input.address === address),
          blockHeight: tx.confirmed ? tx.blockHeight : null,
        }));
      });
    },
  };
}
