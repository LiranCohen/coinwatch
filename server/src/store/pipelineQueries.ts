import type { Database } from 'bun:sqlite';
import type { EventStatus } from '@chainwatch/shared';
import { getEventById, type EventRow } from './db';

export interface SweepableEventRow {
  id: string;
  txid: string;
}

export function listSweepableEvents(db: Database): SweepableEventRow[] {
  return db
    .query(
      "SELECT id, txid FROM events WHERE status = 'active' AND source = 'live' ORDER BY detected_at",
    )
    .all() as SweepableEventRow[];
}

export function setEventStatus(db: Database, id: string, status: EventStatus): EventRow | null {
  db.query('UPDATE events SET status = ? WHERE id = ?').run(status, id);
  return getEventById(db, id);
}

export interface EventBlockInfo {
  blockHeight: number | null;
  blockHash: string;
  blockTime: string | null;
}

export function setEventConfirmed(
  db: Database,
  id: string,
  block: EventBlockInfo,
): EventRow | null {
  db.query(
    "UPDATE events SET status = 'confirmed', block_height = ?, block_hash = ?, block_time = ? WHERE id = ?",
  ).run(block.blockHeight, block.blockHash, block.blockTime, id);
  return getEventById(db, id);
}
