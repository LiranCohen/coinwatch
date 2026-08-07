import type { Database } from 'bun:sqlite';
import {
  getEventByTxid,
  listBatchTxs,
  type BatchRow,
  type BatchTxRow,
  type EventRow,
} from './db';
import {
  getLabelsForAddressesScored,
  getTopLabelsForAddresses,
  type ScoredLabelRow,
} from './apiQueries';

interface EventIo {
  address: string | null;
  valueSats: number;
}

function eventAddresses(row: EventRow): string[] {
  const addresses = new Set<string>();
  const ios = [...(JSON.parse(row.inputs) as EventIo[]), ...(JSON.parse(row.outputs) as EventIo[])];
  for (const io of ios) {
    if (io.address !== null) addresses.add(io.address);
  }
  return [...addresses];
}

export interface BatchSummaryData {
  batch: BatchRow;
  txCount: number;
  totalValueSats: number;
  latestBlockTime: string | null;
  topLabels: ScoredLabelRow[];
}

export interface BatchTxData {
  tx: BatchTxRow;
  eventId: string | null;
  labels: ScoredLabelRow[];
}

export interface BatchDetailData extends BatchSummaryData {
  txs: BatchTxData[];
}

export function assembleBatchSummary(
  db: Database,
  batch: BatchRow,
  viewerDid: string | null = null,
): BatchSummaryData {
  const txs = listBatchTxs(db, batch.id);
  let totalValueSats = 0;
  let latestBlockTime: string | null = null;
  const addresses = new Set<string>();
  for (const tx of txs) {
    totalValueSats += tx.value_sats;
    if (tx.block_time !== null && (latestBlockTime === null || tx.block_time > latestBlockTime)) {
      latestBlockTime = tx.block_time;
    }
    const event = getEventByTxid(db, tx.txid);
    if (event !== null) {
      for (const address of eventAddresses(event)) addresses.add(address);
    }
  }
  return {
    batch,
    txCount: txs.length,
    totalValueSats,
    latestBlockTime,
    topLabels: getTopLabelsForAddresses(db, [...addresses], 3, viewerDid),
  };
}

export function assembleBatchDetail(
  db: Database,
  batch: BatchRow,
  viewerDid: string | null = null,
): BatchDetailData {
  const summary = assembleBatchSummary(db, batch, viewerDid);
  const txs: BatchTxData[] = listBatchTxs(db, batch.id).map((tx) => {
    const event = getEventByTxid(db, tx.txid);
    const addresses = event !== null ? eventAddresses(event) : [];
    return {
      tx,
      eventId: event?.id ?? null,
      labels: getLabelsForAddressesScored(db, addresses, viewerDid),
    };
  });
  return { ...summary, txs };
}
