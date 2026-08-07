import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Database } from 'bun:sqlite';
import {
  RULES,
  SOURCES,
  STATUSES,
  type AddressInfo,
  type AiFeedbackRequest,
  type CreateLabelRequest,
  type EventDetail,
  type EventSummary,
  type EventsListResponse,
  type Identity,
  type Label,
  type LeaderboardEntry,
  type LeaderboardResponse,
  type Rule,
  type TrendingResponse,
  type VoteRequest,
} from '@chainwatch/shared';
import { findLabelByUnique, getEventById, getLabelById, insertLabel, parseEventMeta, type EventRow } from '../store/db';
import { isoFromNow } from '../store/authQueries';
import {
  applyLabelVote,
  getAiFeedback,
  getLabelsForAddressScored,
  getLabelsForAddressesScored,
  getLabelWithScore,
  getTopLabelsForAddresses,
  listEvents,
  listEventsForAddress,
  listLeaderboard,
  listTrendingLabels,
  toggleAiFeedback,
  type ScoredLabelRow,
} from '../store/apiQueries';
import { createAuthMiddleware } from './auth';
import { parseJsonBody, resolveBearerIdentity } from './http';
import type { SseHub } from './sse';
import type { AddressInfoClient } from '../external/addressinfo';

const MAX_LIMIT = 200;
const TRENDING_WINDOW_MS = 24 * 60 * 60 * 1000;

type ApiEnv = {
  Variables: {
    viewer: Identity | null;
    identity: Identity;
  };
};

function optionalAuth(db: Database) {
  return createMiddleware<ApiEnv>(async (c, next) => {
    c.set('viewer', resolveBearerIdentity(db, c.req.header('Authorization')));
    await next();
  });
}

export function toLabel(row: ScoredLabelRow): Label {
  return {
    id: row.id,
    address: row.address,
    tag: row.tag,
    note: row.note,
    evidenceUrl: row.evidence_url,
    author: row.author_did ? { did: row.author_did, handle: row.author_handle } : null,
    source: row.source,
    score: row.score,
    myVote: (row.my_vote ?? 0) as -1 | 0 | 1,
    createdAt: row.created_at,
  };
}

interface EventIo {
  address: string | null;
  valueSats: number;
}

function addressesFromIo(inputs: EventIo[], outputs: EventIo[]): string[] {
  const addresses = new Set<string>();
  for (const io of [...inputs, ...outputs]) {
    if (io.address !== null) addresses.add(io.address);
  }
  return [...addresses];
}

export function involvedAddresses(row: EventRow): string[] {
  return addressesFromIo(
    JSON.parse(row.inputs) as EventIo[],
    JSON.parse(row.outputs) as EventIo[],
  );
}

function compareScoredLabels(a: ScoredLabelRow, b: ScoredLabelRow): number {
  return (
    b.score - a.score ||
    (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0) ||
    (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0)
  );
}

function fetchLabelsPool(db: Database, rows: EventRow[], viewerDid: string | null): ScoredLabelRow[] {
  const union = [...new Set(rows.flatMap(involvedAddresses))];
  return getLabelsForAddressesScored(db, union, viewerDid);
}

function topMatchedLabels(
  db: Database,
  row: EventRow,
  viewerDid: string | null,
  pool?: ScoredLabelRow[],
): ScoredLabelRow[] {
  const addresses = involvedAddresses(row);
  if (pool === undefined) {
    return getTopLabelsForAddresses(db, addresses, 3, viewerDid);
  }
  const inEvent = new Set(addresses);
  return pool
    .filter((label) => inEvent.has(label.address))
    .sort(compareScoredLabels)
    .slice(0, 3);
}

export function serializeEventSummary(
  db: Database,
  row: EventRow,
  viewerDid: string | null = null,
  labelsPool?: ScoredLabelRow[],
): EventSummary {
  const matchedLabels = topMatchedLabels(db, row, viewerDid, labelsPool).map(toLabel);
  return {
    id: row.id,
    txid: row.txid,
    detectedAt: row.detected_at,
    rules: JSON.parse(row.rules) as Rule[],
    valueSats: row.value_sats,
    status: row.status,
    source: row.source,
    aiStatus: row.ai_status,
    aiTag: row.ai_tag,
    blockHeight: row.block_height,
    blockHash: row.block_hash,
    blockTime: row.block_time,
    meta: parseEventMeta(row),
    matchedLabels,
  };
}

export function serializeEventDetail(
  db: Database,
  row: EventRow,
  viewerDid: string | null = null,
): EventDetail {
  const inputs = JSON.parse(row.inputs) as EventIo[];
  const outputs = JSON.parse(row.outputs) as EventIo[];
  const labels = getLabelsForAddressesScored(db, addressesFromIo(inputs, outputs), viewerDid);
  return {
    id: row.id,
    txid: row.txid,
    detectedAt: row.detected_at,
    rules: JSON.parse(row.rules) as Rule[],
    valueSats: row.value_sats,
    status: row.status,
    source: row.source,
    aiStatus: row.ai_status,
    aiTag: row.ai_tag,
    blockHeight: row.block_height,
    blockHash: row.block_hash,
    blockTime: row.block_time,
    meta: parseEventMeta(row),
    matchedLabels: labels.slice(0, 3).map(toLabel),
    aiSummary: row.ai_summary,
    inputs,
    outputs,
    labels: labels.map(toLabel),
    aiFeedback: getAiFeedback(db, row.id, viewerDid),
  };
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export interface ApiRoutesDeps {
  db: Database;
  hub: SseHub;
  addressInfo: AddressInfoClient | null;
}

export function createApiRoutes(deps: ApiRoutesDeps): Hono<ApiEnv> {
  const { db, hub } = deps;
  const app = new Hono<ApiEnv>();
  const opt = optionalAuth(db);
  const auth = createAuthMiddleware(db);

  app.get('/api/events', opt, (c) => {
    const query = c.req.query();
    const rule = RULES.find((r) => r === query.rule);
    if (query.rule !== undefined && rule === undefined) {
      return c.json({ error: `rule must be one of ${RULES.join(', ')}` }, 400);
    }
    const status = STATUSES.find((s) => s === query.status);
    if (query.status !== undefined && status === undefined) {
      return c.json({ error: `status must be one of ${STATUSES.join(', ')}` }, 400);
    }
    const source = SOURCES.find((s) => s === query.source);
    if (query.source !== undefined && source === undefined) {
      return c.json({ error: `source must be one of ${SOURCES.join(', ')}` }, 400);
    }
    let limit = 50;
    if (query.limit !== undefined) {
      const parsed = Number(query.limit);
      if (!Number.isInteger(parsed) || parsed < 1) {
        return c.json({ error: 'limit must be a positive integer' }, 400);
      }
      limit = Math.min(parsed, MAX_LIMIT);
    }
    const viewerDid = c.get('viewer')?.did ?? null;
    const rows = listEvents(db, {
      rule,
      status,
      source,
      limit,
      before: query.before,
    });
    const labelsPool = fetchLabelsPool(db, rows, viewerDid);
    const body: EventsListResponse = {
      events: rows.map((row) => serializeEventSummary(db, row, viewerDid, labelsPool)),
    };
    return c.json(body);
  });

  app.get('/api/events/:id', opt, (c) => {
    const row = getEventById(db, c.req.param('id'));
    if (!row) return c.json({ error: 'unknown event' }, 404);
    return c.json(serializeEventDetail(db, row, c.get('viewer')?.did ?? null));
  });

  app.post('/api/events/:id/ai-feedback', auth, async (c) => {
    const row = getEventById(db, c.req.param('id'));
    if (!row) return c.json({ error: 'unknown event' }, 404);
    const body = await parseJsonBody<AiFeedbackRequest>(c);
    if (body === null) {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (body.value !== 'confirm' && body.value !== 'refute') {
      return c.json({ error: "value must be 'confirm' or 'refute'" }, 400);
    }
    const identity = c.get('identity');
    toggleAiFeedback(db, row.id, identity.did, body.value);
    return c.json(getAiFeedback(db, row.id, identity.did));
  });

  app.get('/api/addresses/:address', opt, async (c) => {
    const address = c.req.param('address');
    const viewerDid = c.get('viewer')?.did ?? null;
    let balanceSats: number | null = null;
    let txCount: number | null = null;
    if (deps.addressInfo) {
      const stats = await deps.addressInfo.getAddressStats(address);
      if (stats) {
        balanceSats =
          (stats.chain_stats?.funded_txo_sum ?? 0) +
          (stats.mempool_stats?.funded_txo_sum ?? 0) -
          (stats.chain_stats?.spent_txo_sum ?? 0) -
          (stats.mempool_stats?.spent_txo_sum ?? 0);
        txCount = (stats.chain_stats?.tx_count ?? 0) + (stats.mempool_stats?.tx_count ?? 0);
      }
    }
    const recentEvents = listEventsForAddress(db, address);
    const labelsPool = fetchLabelsPool(db, recentEvents, viewerDid);
    const body: AddressInfo = {
      address,
      balanceSats,
      txCount,
      labels: getLabelsForAddressScored(db, address, viewerDid).map(toLabel),
      recentEvents: recentEvents.map((row) =>
        serializeEventSummary(db, row, viewerDid, labelsPool),
      ),
      externalUrl: `https://mempool.space/address/${address}`,
    };
    return c.json(body);
  });

  app.post('/api/addresses/:address/labels', auth, async (c) => {
    const address = c.req.param('address');
    const body = await parseJsonBody<CreateLabelRequest>(c);
    if (body === null) {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const tag = typeof body.tag === 'string' ? body.tag.trim() : '';
    if (tag.length < 2 || tag.length > 32) {
      return c.json({ error: 'tag must be 2-32 characters' }, 400);
    }
    let note: string | null = null;
    if (body.note !== undefined) {
      if (typeof body.note !== 'string') {
        return c.json({ error: 'note must be a string' }, 400);
      }
      if (body.note.length > 280) {
        return c.json({ error: 'note must be at most 280 characters' }, 400);
      }
      note = body.note;
    }
    let evidenceUrl: string | null = null;
    if (body.evidenceUrl !== undefined) {
      if (typeof body.evidenceUrl !== 'string' || !isAbsoluteHttpUrl(body.evidenceUrl)) {
        return c.json({ error: 'evidenceUrl must be an absolute http(s) URL' }, 400);
      }
      evidenceUrl = body.evidenceUrl;
    }
    const identity = c.get('identity');
    const existing = findLabelByUnique(db, address, tag, 'crowd');
    if (existing) {
      return c.json(toLabel(getLabelWithScore(db, existing.id, identity.did)!));
    }
    const created = insertLabel(db, {
      address,
      tag,
      note,
      evidenceUrl,
      authorDid: identity.did,
      source: 'crowd',
    });
    if (!created) return c.json({ error: 'label creation failed' }, 500);
    const label = toLabel(getLabelWithScore(db, created.id, identity.did)!);
    hub.broadcastLabel(label);
    return c.json(label, 201);
  });

  app.post('/api/labels/:id/vote', auth, async (c) => {
    const label = getLabelById(db, c.req.param('id'));
    if (!label) return c.json({ error: 'unknown label' }, 404);
    const body = await parseJsonBody<VoteRequest>(c);
    if (body === null) {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (body.value !== 1 && body.value !== -1) {
      return c.json({ error: 'value must be 1 or -1' }, 400);
    }
    const identity = c.get('identity');
    if (label.author_did === identity.did) {
      return c.json({ error: 'cannot vote on your own label' }, 422);
    }
    applyLabelVote(db, label.id, identity.did, body.value);
    return c.json(toLabel(getLabelWithScore(db, label.id, identity.did)!));
  });

  app.get('/api/leaderboard', (c) => {
    const analysts: LeaderboardEntry[] = listLeaderboard(db).map((row) => ({
      did: row.did,
      handle: row.handle,
      reputation: row.reputation,
      labelCount: row.label_count,
      netVotes: row.net_votes,
    }));
    const body: LeaderboardResponse = { analysts };
    return c.json(body);
  });

  app.get('/api/labels/trending', opt, (c) => {
    const since = isoFromNow(-TRENDING_WINDOW_MS);
    const viewerDid = c.get('viewer')?.did ?? null;
    const body: TrendingResponse = {
      labels: listTrendingLabels(db, since, viewerDid).map(toLabel),
    };
    return c.json(body);
  });

  return app;
}
