import type { Database } from 'bun:sqlite';
import type { EventMeta } from '@chainwatch/shared';
import { getEventById, placeholders, type EventRow } from './db';

export function setEventMeta(db: Database, id: string, meta: EventMeta): EventRow | null {
  db.query('UPDATE events SET meta = ? WHERE id = ?').run(JSON.stringify(meta), id);
  return getEventById(db, id);
}

export function findCoinjoinEventByOutputAddress(
  db: Database,
  addresses: string[],
  excludeTxid: string,
): EventRow | null {
  if (addresses.length === 0) return null;
  return db
    .query(
      `SELECT * FROM events
       WHERE txid != ?
         AND EXISTS (SELECT 1 FROM json_each(events.rules) r WHERE r.value = 'coinjoin')
         AND EXISTS (
           SELECT 1 FROM json_each(events.outputs) o
           WHERE json_extract(o.value, '$.address') IN (${placeholders(addresses.length)})
         )
       ORDER BY detected_at DESC, id DESC
       LIMIT 1`,
    )
    .get(excludeTxid, ...addresses) as EventRow | null;
}

export interface CoinjoinEventRow extends EventRow {
  batch_id: string | null;
}

export function listCoinjoinEvents(db: Database, limit: number): CoinjoinEventRow[] {
  return db
    .query(
      `SELECT events.*,
         (SELECT bt.batch_id FROM batch_txs bt WHERE bt.txid = events.txid LIMIT 1) AS batch_id
       FROM events
       WHERE EXISTS (SELECT 1 FROM json_each(events.rules) r WHERE r.value = 'coinjoin')
       ORDER BY events.detected_at DESC, events.id DESC
       LIMIT ?`,
    )
    .all(limit) as CoinjoinEventRow[];
}
