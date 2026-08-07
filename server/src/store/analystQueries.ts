import type { Database } from 'bun:sqlite';
import type { EventRow } from './db';
import type { ScoredLabelRow } from './apiQueries';

export function listLabelsByAuthor(db: Database, authorDid: string): ScoredLabelRow[] {
  return db
    .query(
      `SELECT labels.*,
        (SELECT COALESCE(SUM(v.value), 0) FROM votes v WHERE v.label_id = labels.id) AS score,
        identities.handle AS author_handle,
        NULL AS my_vote
       FROM labels
       LEFT JOIN identities ON identities.did = labels.author_did
       WHERE labels.author_did = ?
       ORDER BY score DESC, labels.created_at ASC, labels.tag ASC`,
    )
    .all(authorDid) as ScoredLabelRow[];
}

export function getVoteTalliesForAuthor(
  db: Database,
  authorDid: string,
): { up: number; down: number } {
  return db
    .query(
      `SELECT
        COALESCE(SUM(CASE WHEN v.value = 1 THEN 1 ELSE 0 END), 0) AS up,
        COALESCE(SUM(CASE WHEN v.value = -1 THEN 1 ELSE 0 END), 0) AS down
       FROM votes v
       JOIN labels l ON l.id = v.label_id
       WHERE l.author_did = ?`,
    )
    .get(authorDid) as { up: number; down: number };
}

export function countAiFeedbackByVoter(db: Database, voterDid: string): number {
  const row = db
    .query('SELECT COUNT(*) AS n FROM ai_feedback WHERE voter_did = ?')
    .get(voterDid) as { n: number };
  return row.n;
}

export interface EntitySummaryRow {
  tag: string;
  address_count: number;
}

export function listEntitySummaryRows(db: Database): EntitySummaryRow[] {
  return db
    .query(
      `SELECT tag, COUNT(DISTINCT address) AS address_count
       FROM labels
       GROUP BY tag
       ORDER BY address_count DESC, tag ASC`,
    )
    .all() as EntitySummaryRow[];
}

const EVENT_TOUCHES_TAG = `
  EXISTS (
    SELECT 1 FROM labels l
    WHERE l.tag = ?
      AND (
        EXISTS (SELECT 1 FROM json_each(events.inputs) i
                WHERE json_extract(i.value, '$.address') = l.address)
        OR EXISTS (SELECT 1 FROM json_each(events.outputs) o
                WHERE json_extract(o.value, '$.address') = l.address)
      )
  )`;

export function countEventsForTag(db: Database, tag: string): number {
  const row = db
    .query(`SELECT COUNT(*) AS n FROM events WHERE ${EVENT_TOUCHES_TAG}`)
    .get(tag) as { n: number };
  return row.n;
}

export function listEventsForTag(db: Database, tag: string, limit = 10): EventRow[] {
  return db
    .query(
      `SELECT * FROM events WHERE ${EVENT_TOUCHES_TAG}
       ORDER BY detected_at DESC, id DESC LIMIT ?`,
    )
    .all(tag, limit) as EventRow[];
}

export function listAddressesForTag(db: Database, tag: string): string[] {
  const rows = db
    .query('SELECT DISTINCT address FROM labels WHERE tag = ? ORDER BY address ASC')
    .all(tag) as { address: string }[];
  return rows.map((row) => row.address);
}
