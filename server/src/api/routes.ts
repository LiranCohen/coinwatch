import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Database } from 'bun:sqlite';
import type {
  AddressInfo,
  AiFeedbackRequest,
  CreateLabelRequest,
  EventDetail,
  EventStatus,
  EventSummary,
  EventsListResponse,
  Identity,
  Label,
  LeaderboardEntry,
  LeaderboardResponse,
  Rule,
  TrendingResponse,
  VoteRequest,
} from '@chainwatch/shared';
import { getEventById, getLabelById, insertLabel, type EventRow } from '../store/db';
import { getIdentity, getSession } from '../store/authQueries';
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
import type { SseHub } from './sse';
import type { AddressInfoClient } from '../external/addressinfo';

const RULES: readonly string[] = ['whale', 'dormant-wake', 'coinjoin', 'demo'];
const STATUSES: readonly string[] = ['active', 'confirmed', 'evicted'];
const SOURCES: readonly string[] = ['live', 'demo'];
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
    const header = c.req.header('Authorization');
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;
    let viewer: Identity | null = null;
    if (token) {
      const session = getSession(db, token);
      viewer = session ? getIdentity(db, session.did) : null;
    }
    c.set('viewer', viewer);
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

export function involvedAddresses(row: EventRow): string[] {
  const inputs = JSON.parse(row.inputs) as EventIo[];
  const outputs = JSON.parse(row.outputs) as EventIo[];
  const addresses = new Set<string>();
  for (const io of [...inputs, ...outputs]) {
    if (io.address !== null) addresses.add(io.address);
  }
  return [...addresses];
}

export function serializeEventSummary(
  db: Database,
  row: EventRow,
  viewerDid: string | null = null,
): EventSummary {
  const matchedLabels = getTopLabelsForAddresses(db, involvedAddresses(row), 3, viewerDid).map(
    toLabel,
  );
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
    matchedLabels,
  };
}

export function serializeEventDetail(
  db: Database,
  row: EventRow,
  viewerDid: string | null = null,
): EventDetail {
  return {
    ...serializeEventSummary(db, row, viewerDid),
    aiSummary: row.ai_summary,
    inputs: JSON.parse(row.inputs) as EventIo[],
    outputs: JSON.parse(row.outputs) as EventIo[],
    labels: getLabelsForAddressesScored(db, involvedAddresses(row), viewerDid).map(toLabel),
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
    const rule = query.rule;
    if (rule !== undefined && !RULES.includes(rule)) {
      return c.json({ error: `rule must be one of ${RULES.join(', ')}` }, 400);
    }
    const status = query.status;
    if (status !== undefined && !STATUSES.includes(status)) {
      return c.json({ error: `status must be one of ${STATUSES.join(', ')}` }, 400);
    }
    const source = query.source;
    if (source !== undefined && !SOURCES.includes(source)) {
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
      rule: rule as Rule | undefined,
      status: status as EventStatus | undefined,
      source: source as 'live' | 'demo' | undefined,
      limit,
      before: query.before,
    });
    const body: EventsListResponse = {
      events: rows.map((row) => serializeEventSummary(db, row, viewerDid)),
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
    let body: AiFeedbackRequest;
    try {
      body = await c.req.json<AiFeedbackRequest>();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (body?.value !== 'confirm' && body?.value !== 'refute') {
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
    const body: AddressInfo = {
      address,
      balanceSats,
      txCount,
      labels: getLabelsForAddressScored(db, address, viewerDid).map(toLabel),
      recentEvents: listEventsForAddress(db, address, 10).map((row) =>
        serializeEventSummary(db, row, viewerDid),
      ),
      externalUrl: `https://mempool.space/address/${address}`,
    };
    return c.json(body);
  });

  app.post('/api/addresses/:address/labels', auth, async (c) => {
    const address = c.req.param('address');
    let body: CreateLabelRequest;
    try {
      body = await c.req.json<CreateLabelRequest>();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const tag = typeof body?.tag === 'string' ? body.tag.trim() : '';
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
    const existing = db
      .query('SELECT id FROM labels WHERE address = ? AND tag = ? AND source = ?')
      .get(address, tag, 'crowd') as { id: string } | null;
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
    let body: VoteRequest;
    try {
      body = await c.req.json<VoteRequest>();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (body?.value !== 1 && body?.value !== -1) {
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
    const analysts: LeaderboardEntry[] = listLeaderboard(db, 20).map((row) => ({
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
    const since = new Date(Date.now() - TRENDING_WINDOW_MS).toISOString();
    const viewerDid = c.get('viewer')?.did ?? null;
    const body: TrendingResponse = {
      labels: listTrendingLabels(db, since, viewerDid, 20).map(toLabel),
    };
    return c.json(body);
  });

  return app;
}
