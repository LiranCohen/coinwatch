import type { Database } from 'bun:sqlite';
import type { AiFeedback, AiStatus, EventStatus, Rule } from '@chainwatch/shared';
import { getEventById, placeholders, type EventRow, type LabelRow } from './db';

export interface EventListFilters {
  rule?: Rule;
  status?: EventStatus;
  source?: 'live' | 'demo';
  limit: number;
  before?: string;
}

export function listEvents(db: Database, filters: EventListFilters): EventRow[] {
  const where: string[] = [];
  const params: (string | number | null)[] = [];
  if (filters.rule) {
    where.push('EXISTS (SELECT 1 FROM json_each(events.rules) r WHERE r.value = ?)');
    params.push(filters.rule);
  }
  if (filters.status) {
    where.push('status = ?');
    params.push(filters.status);
  }
  if (filters.source) {
    where.push('source = ?');
    params.push(filters.source);
  }
  if (filters.before) {
    const cursor = db
      .query('SELECT detected_at, id FROM events WHERE id = ?')
      .get(filters.before) as { detected_at: string; id: string } | null;
    if (!cursor) return [];
    where.push('(detected_at < ? OR (detected_at = ? AND id < ?))');
    params.push(cursor.detected_at, cursor.detected_at, cursor.id);
  }
  const sql = `SELECT * FROM events ${where.length > 0 ? `WHERE ${where.join(' AND ')} ` : ''}ORDER BY detected_at DESC, id DESC LIMIT ?`;
  params.push(filters.limit);
  return db.query(sql).all(...params) as EventRow[];
}

export function listEventsForAddress(db: Database, address: string, limit = 10): EventRow[] {
  return db
    .query(
      `SELECT * FROM events
       WHERE EXISTS (SELECT 1 FROM json_each(events.inputs) i WHERE json_extract(i.value, '$.address') = ?)
          OR EXISTS (SELECT 1 FROM json_each(events.outputs) o WHERE json_extract(o.value, '$.address') = ?)
       ORDER BY detected_at DESC, id DESC LIMIT ?`,
    )
    .all(address, address, limit) as EventRow[];
}

export interface ScoredLabelRow extends LabelRow {
  score: number;
  author_handle: string | null;
  my_vote: number | null;
}

const LABEL_SELECT = `
  SELECT labels.*,
    (SELECT COALESCE(SUM(v.value), 0) FROM votes v WHERE v.label_id = labels.id) AS score,
    identities.handle AS author_handle,
    (SELECT v2.value FROM votes v2 WHERE v2.label_id = labels.id AND v2.voter_did = ?) AS my_vote
  FROM labels
  LEFT JOIN identities ON identities.did = labels.author_did
`;

export function getLabelWithScore(
  db: Database,
  id: string,
  viewerDid: string | null,
): ScoredLabelRow | null {
  return db.query(`${LABEL_SELECT} WHERE labels.id = ?`).get(viewerDid, id) as
    | ScoredLabelRow
    | null;
}

export function getLabelsForAddressScored(
  db: Database,
  address: string,
  viewerDid: string | null,
): ScoredLabelRow[] {
  return db
    .query(`${LABEL_SELECT} WHERE labels.address = ? ORDER BY score DESC, labels.created_at ASC, labels.tag ASC`)
    .all(viewerDid, address) as ScoredLabelRow[];
}

export function getLabelsForAddressesScored(
  db: Database,
  addresses: string[],
  viewerDid: string | null,
): ScoredLabelRow[] {
  if (addresses.length === 0) return [];
  return db
    .query(
      `${LABEL_SELECT} WHERE labels.address IN (${placeholders(addresses.length)}) ORDER BY score DESC, labels.created_at ASC, labels.tag ASC`,
    )
    .all(viewerDid, ...addresses) as ScoredLabelRow[];
}

export function getTopLabelsForAddresses(
  db: Database,
  addresses: string[],
  limit: number,
  viewerDid: string | null,
): ScoredLabelRow[] {
  if (addresses.length === 0) return [];
  return db
    .query(
      `${LABEL_SELECT} WHERE labels.address IN (${placeholders(addresses.length)}) ORDER BY score DESC, labels.created_at ASC, labels.tag ASC LIMIT ?`,
    )
    .all(viewerDid, ...addresses, limit) as ScoredLabelRow[];
}

export function listTrendingLabels(
  db: Database,
  sinceIso: string,
  viewerDid: string | null,
  limit = 20,
): ScoredLabelRow[] {
  return db
    .query(
      `${LABEL_SELECT}
       WHERE EXISTS (SELECT 1 FROM votes v WHERE v.label_id = labels.id AND v.created_at >= ?)
       ORDER BY score DESC, labels.created_at ASC LIMIT ?`,
    )
    .all(viewerDid, sinceIso, limit) as ScoredLabelRow[];
}

export interface LeaderboardRow {
  did: string;
  handle: string | null;
  reputation: number;
  label_count: number;
  net_votes: number;
}

export function listLeaderboard(db: Database, limit = 20): LeaderboardRow[] {
  return db
    .query(
      `SELECT i.did, i.handle, i.reputation,
        (SELECT COUNT(*) FROM labels l WHERE l.author_did = i.did) AS label_count,
        (SELECT COALESCE(SUM(v.value), 0) FROM votes v
          JOIN labels l ON l.id = v.label_id WHERE l.author_did = i.did) AS net_votes
       FROM identities i
       ORDER BY i.reputation DESC, i.did ASC LIMIT ?`,
    )
    .all(limit) as LeaderboardRow[];
}

export function applyLabelVote(
  db: Database,
  labelId: string,
  voterDid: string,
  value: 1 | -1,
): -1 | 0 | 1 {
  const tx = db.transaction(
    (labelIdArg: string, voterDidArg: string, valueArg: 1 | -1): -1 | 0 | 1 => {
      const existing = db
        .query('SELECT value FROM votes WHERE label_id = ? AND voter_did = ?')
        .get(labelIdArg, voterDidArg) as { value: 1 | -1 } | null;
      let myVote: -1 | 0 | 1;
      if (existing && existing.value === valueArg) {
        db.query('DELETE FROM votes WHERE label_id = ? AND voter_did = ?').run(
          labelIdArg,
          voterDidArg,
        );
        myVote = 0;
      } else {
        db.query(
          `INSERT INTO votes (label_id, voter_did, value, created_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (label_id, voter_did)
           DO UPDATE SET value = excluded.value, created_at = excluded.created_at`,
        ).run(labelIdArg, voterDidArg, valueArg, new Date().toISOString());
        myVote = valueArg;
      }
      const label = db
        .query('SELECT author_did FROM labels WHERE id = ?')
        .get(labelIdArg) as { author_did: string | null } | null;
      if (label?.author_did) {
        db.query(
          `UPDATE identities SET reputation = (
            SELECT COALESCE(SUM(v.value), 0) FROM votes v
            JOIN labels l ON l.id = v.label_id WHERE l.author_did = ?
          ) WHERE did = ?`,
        ).run(label.author_did, label.author_did);
      }
      return myVote;
    },
  );
  return tx(labelId, voterDid, value);
}

function getMyAiFeedback(
  db: Database,
  eventId: string,
  viewerDid: string | null,
): 'confirm' | 'refute' | null {
  if (!viewerDid) return null;
  const row = db
    .query('SELECT value FROM ai_feedback WHERE event_id = ? AND voter_did = ?')
    .get(eventId, viewerDid) as { value: 'confirm' | 'refute' } | null;
  return row?.value ?? null;
}

export function getAiFeedback(
  db: Database,
  eventId: string,
  viewerDid: string | null,
): AiFeedback {
  const tallies = db
    .query(
      `SELECT
        COALESCE(SUM(CASE WHEN value = 'confirm' THEN 1 ELSE 0 END), 0) AS confirms,
        COALESCE(SUM(CASE WHEN value = 'refute' THEN 1 ELSE 0 END), 0) AS refutes
       FROM ai_feedback WHERE event_id = ?`,
    )
    .get(eventId) as { confirms: number; refutes: number };
  return {
    confirms: tallies.confirms,
    refutes: tallies.refutes,
    mine: getMyAiFeedback(db, eventId, viewerDid),
  };
}

export function toggleAiFeedback(
  db: Database,
  eventId: string,
  voterDid: string,
  value: 'confirm' | 'refute',
): void {
  const existing = getMyAiFeedback(db, eventId, voterDid);
  if (existing === value) {
    db.query('DELETE FROM ai_feedback WHERE event_id = ? AND voter_did = ?').run(
      eventId,
      voterDid,
    );
    return;
  }
  db.query(
    `INSERT INTO ai_feedback (event_id, voter_did, value) VALUES (?, ?, ?)
     ON CONFLICT (event_id, voter_did) DO UPDATE SET value = excluded.value`,
  ).run(eventId, voterDid, value);
}

export function setEventAiResult(
  db: Database,
  id: string,
  status: Extract<AiStatus, 'done' | 'failed'>,
  summary: string | null,
  tag: string | null,
): EventRow | null {
  db.query('UPDATE events SET ai_status = ?, ai_summary = ?, ai_tag = ? WHERE id = ?').run(
    status,
    summary,
    tag,
    id,
  );
  return getEventById(db, id);
}
