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
