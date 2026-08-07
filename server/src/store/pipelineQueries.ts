import type { Database } from 'bun:sqlite';
import type { EventStatus } from '@chainwatch/shared';
import type { EventRow } from './db';

export function listSweepableEvents(db: Database): EventRow[] {
  return db
    .query("SELECT * FROM events WHERE status = 'active' AND source = 'live' ORDER BY detected_at")
    .all() as EventRow[];
}

export function setEventStatus(db: Database, id: string, status: EventStatus): EventRow | null {
  db.query('UPDATE events SET status = ? WHERE id = ?').run(status, id);
  return db.query('SELECT * FROM events WHERE id = ?').get(id) as EventRow | null;
}
