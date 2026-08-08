import type {
  AddressInfo,
  ChallengeResponse,
  EventDetail,
  EventSummary,
  EventsResponse,
  Hack,
  Identity,
  Label,
  LeaderboardResponse,
  TrustGraphData,
  TrustGraphEdge,
  TrustGraphNode,
  TrendingResponse,
  VerifyRequest,
  VerifyResponse,
} from '@chainwatch/shared';

import addressFixture from '../../fixtures/address.json';
import eventDetailFixture from '../../fixtures/event-detail.json';
import { formatCoins } from '../lib/format';
import eventsFixture from '../../fixtures/events.json';
import hackFixture from '../../fixtures/hack.json';
import leaderboardFixture from '../../fixtures/leaderboard.json';
import trendingFixture from '../../fixtures/trending.json';
import { COLDCARD_HACK, decorateHackEvent } from '../lib/coldcardHack';
import { emitMockEvent } from './sse';

export const USE_FIXTURES = import.meta.env.VITE_USE_FIXTURES === 'true';
export const API_BASE = import.meta.env.VITE_API_BASE ?? '';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit, token?: string | null): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(API_BASE + path, { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(res.status, body || res.statusText);
  }
  return (await res.json()) as T;
}

function withBlockFields<T extends EventSummary>(event: T): T {
  return {
    ...event,
    blockHeight: event.blockHeight ?? null,
    blockHash: event.blockHash ?? null,
    blockTime: event.blockTime ?? null,
    meta: event.meta ?? null,
  };
}

// ---------------------------------------------------------------------------
// Fixtures mode: mutable in-memory store so writes (labels, votes, auth) are
// fully exercisable with zero network (R16).
// ---------------------------------------------------------------------------

interface MockSession {
  token: string;
  identity: Identity;
}

const mock = {
  events: (structuredClone(eventsFixture.events) as unknown as EventSummary[]).map(withBlockFields),
  details: new Map<string, EventDetail>([
    ['evt_001', withBlockFields(structuredClone(eventDetailFixture) as unknown as EventDetail)],
  ]),
  addresses: new Map<string, AddressInfo>([
    [
      addressFixture.address,
      {
        ...(structuredClone(addressFixture) as unknown as AddressInfo),
        recentEvents: (
          structuredClone(addressFixture.recentEvents) as unknown as EventSummary[]
        ).map(withBlockFields),
      },
    ],
  ]),
  labels: new Map<string, Label>(),
  sessions: new Map<string, MockSession>(),
  aiFeedback: new Map<string, EventDetail['aiFeedback']>(),
  counter: 0,
};

function seedMockStore(): void {
  const all: Label[] = [];
  for (const e of mock.events) all.push(...e.matchedLabels);
  const detail = mock.details.get('evt_001');
  if (detail) all.push(...detail.labels);
  const addr = mock.addresses.get(addressFixture.address);
  if (addr) all.push(...addr.labels);
  for (const l of (trendingFixture as TrendingResponse).labels) all.push(l);
  for (const label of all) mock.labels.set(label.id, structuredClone(label));
  mock.aiFeedback.set('evt_001', { confirms: 14, refutes: 1, mine: null });
}

let mockReady = false;
function ensureMock(): void {
  if (!mockReady) {
    seedMockStore();
    mockReady = true;
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function mockLatency(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 120));
}

function syncLabelEverywhere(updated: Label): void {
  mock.labels.set(updated.id, clone(updated));
  for (const event of mock.events) {
    event.matchedLabels = event.matchedLabels.map((l) => (l.id === updated.id ? clone(updated) : l));
  }
  for (const detail of mock.details.values()) {
    detail.matchedLabels = detail.matchedLabels.map((l) => (l.id === updated.id ? clone(updated) : l));
    detail.labels = detail.labels.map((l) => (l.id === updated.id ? clone(updated) : l));
  }
  for (const info of mock.addresses.values()) {
    info.labels = info.labels.map((l) => (l.id === updated.id ? clone(updated) : l));
  }
}

function requireMockSession(token: string | null): MockSession {
  if (!token) throw new ApiError(401, 'authentication required');
  const session = mock.sessions.get(token);
  if (!session) throw new ApiError(401, 'invalid token');
  return session;
}

function detailFromSummary(summary: EventSummary): EventDetail {
  const existing = mock.details.get(summary.id);
  if (existing) return existing;
  const detail: EventDetail = {
    ...summary,
    aiSummary:
      summary.aiStatus === 'done'
        ? `A ${formatCoins(summary.valueSats)} transaction matched the ${summary.rules.join(', ')} rule${summary.rules.length > 1 ? 's' : ''}. Destination profile is consistent with routine movement; no seeded labels are involved.`
        : null,
    inputs: [{ address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', valueSats: summary.valueSats + 50_000 }],
    outputs: [
      { address: 'bc1q9x4k2m8v7n3p5d6f1g0h4j8l2s7a5q9w3e6r1t4y', valueSats: summary.valueSats },
      { address: null, valueSats: 50_000 },
    ],
    labels: summary.matchedLabels,
    aiFeedback: mock.aiFeedback.get(summary.id) ?? { confirms: 0, refutes: 0, mine: null },
  };
  mock.details.set(summary.id, detail);
  return detail;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function postChallenge(): Promise<ChallengeResponse> {
  if (USE_FIXTURES) {
    await mockLatency();
    const nonce = `fixture-nonce-${Date.now()}`;
    return { nonce, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
  }
  return request<ChallengeResponse>('/api/auth/challenge', { method: 'POST', body: '{}' });
}

export async function postVerify(body: VerifyRequest): Promise<VerifyResponse> {
  if (USE_FIXTURES) {
    ensureMock();
    await mockLatency();
    const identity: Identity = { did: body.did, handle: body.handle ?? null, reputation: 0 };
    const token = `fixture.${Math.random().toString(36).slice(2)}`;
    mock.sessions.set(token, { token, identity });
    return { token, identity };
  }
  return request<VerifyResponse>('/api/auth/verify', { method: 'POST', body: JSON.stringify(body) });
}

export async function getMe(token: string): Promise<Identity> {
  if (USE_FIXTURES) {
    ensureMock();
    return clone(requireMockSession(token).identity);
  }
  return request<Identity>('/api/auth/me', undefined, token);
}

export async function patchHandle(handle: string, token: string): Promise<Identity> {
  if (USE_FIXTURES) {
    ensureMock();
    await mockLatency();
    const session = requireMockSession(token);
    session.identity = { ...session.identity, handle };
    return clone(session.identity);
  }
  return request<Identity>('/api/identities/me', { method: 'PATCH', body: JSON.stringify({ handle }) }, token);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface EventsQuery {
  rule?: string;
  status?: string;
  source?: string;
  limit?: number;
  before?: string;
}

export async function getEvents(query: EventsQuery = {}): Promise<EventsResponse> {
  if (USE_FIXTURES) {
    ensureMock();
    await mockLatency();
    let events = mock.events;
    if (query.rule) events = events.filter((e) => e.rules.includes(query.rule as EventSummary['rules'][number]));
    if (query.status) events = events.filter((e) => e.status === query.status);
    if (query.source) events = events.filter((e) => e.source === query.source);
    return { events: clone(events.slice(0, query.limit ?? 50)) };
  }
  // the backend doesn't know the hack rule; it's stamped on client-side
  const hackFilter = query.rule === 'hack';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(hackFilter ? { ...query, rule: undefined } : query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  const res = await request<EventsResponse>(`/api/events${qs ? `?${qs}` : ''}`);
  const events = res.events.map(decorateHackEvent);
  return { ...res, events: hackFilter ? events.filter((e) => e.rules.includes('hack')) : events };
}

export async function getEvent(id: string, token?: string | null): Promise<EventDetail> {
  if (USE_FIXTURES) {
    ensureMock();
    await mockLatency();
    const summary = mock.events.find((e) => e.id === id);
    if (!summary) throw new ApiError(404, `unknown event: ${id}`);
    return clone(detailFromSummary(summary));
  }
  return decorateHackEvent(await request<EventDetail>(`/api/events/${encodeURIComponent(id)}`, undefined, token));
}

export async function postAiFeedback(
  eventId: string,
  value: 'confirm' | 'refute',
  token: string,
): Promise<EventDetail['aiFeedback']> {
  if (USE_FIXTURES) {
    ensureMock();
    await mockLatency();
    requireMockSession(token);
    const current = mock.aiFeedback.get(eventId) ?? { confirms: 0, refutes: 0, mine: null };
    const next = { ...current };
    if (current.mine === value) {
      if (value === 'confirm') next.confirms -= 1;
      else next.refutes -= 1;
      next.mine = null;
    } else {
      if (current.mine === 'confirm') next.confirms -= 1;
      if (current.mine === 'refute') next.refutes -= 1;
      if (value === 'confirm') next.confirms += 1;
      else next.refutes += 1;
      next.mine = value;
    }
    mock.aiFeedback.set(eventId, next);
    const detail = mock.details.get(eventId);
    if (detail) detail.aiFeedback = clone(next);
    return clone(next);
  }
  return request<EventDetail['aiFeedback']>(
    `/api/events/${encodeURIComponent(eventId)}/ai-feedback`,
    { method: 'POST', body: JSON.stringify({ value }) },
    token,
  );
}

// ---------------------------------------------------------------------------
// Addresses, labels, votes
// ---------------------------------------------------------------------------

export async function getAddress(address: string, token?: string | null): Promise<AddressInfo> {
  if (USE_FIXTURES) {
    ensureMock();
    await mockLatency();
    const known = mock.addresses.get(address);
    if (known) return clone(known);
    const labels = [...mock.labels.values()].filter((l) => l.address === address);
    return {
      address,
      balanceSats: null,
      txCount: null,
      labels: clone(labels),
      recentEvents: [],
      history: [],
    };
  }
  return request<AddressInfo>(`/api/addresses/${encodeURIComponent(address)}`, undefined, token);
}

export async function postLabel(
  address: string,
  body: { tag: string; note?: string; evidenceUrl?: string },
  token: string,
): Promise<Label> {
  if (USE_FIXTURES) {
    ensureMock();
    await mockLatency();
    const session = requireMockSession(token);
    const label: Label = {
      id: `lbl_mock_${++mock.counter}`,
      address,
      tag: body.tag,
      note: body.note ?? null,
      evidenceUrl: body.evidenceUrl ?? null,
      author: { did: session.identity.did, handle: session.identity.handle },
      source: 'crowd',
      score: 0,
      myVote: 0,
      createdAt: new Date().toISOString(),
    };
    syncLabelEverywhere(label);
    const info = mock.addresses.get(address);
    if (info) info.labels.push(clone(label));
    return clone(label);
  }
  return request<Label>(
    `/api/addresses/${encodeURIComponent(address)}/labels`,
    { method: 'POST', body: JSON.stringify(body) },
    token,
  );
}

export async function postVote(labelId: string, value: 1 | -1, token: string): Promise<Label> {
  if (USE_FIXTURES) {
    ensureMock();
    await mockLatency();
    const session = requireMockSession(token);
    const label = mock.labels.get(labelId);
    if (!label) throw new ApiError(404, `unknown label: ${labelId}`);
    if (label.author?.did === session.identity.did) throw new ApiError(422, 'cannot vote on your own label');
    const next = clone(label);
    if (next.myVote === value) {
      next.score -= value;
      next.myVote = 0;
    } else if (next.myVote === 0) {
      next.score += value;
      next.myVote = value;
    } else {
      next.score += 2 * value;
      next.myVote = value;
    }
    syncLabelEverywhere(next);
    return clone(next);
  }
  return request<Label>(
    `/api/labels/${encodeURIComponent(labelId)}/vote`,
    { method: 'POST', body: JSON.stringify({ value }) },
    token,
  );
}

// ---------------------------------------------------------------------------
// Leaderboard, trending, injector
// ---------------------------------------------------------------------------

export async function getLeaderboard(): Promise<LeaderboardResponse> {
  if (USE_FIXTURES) {
    ensureMock();
    await mockLatency();
    const base = clone(leaderboardFixture) as LeaderboardResponse;
    for (const session of mock.sessions.values()) {
      const labels = [...mock.labels.values()].filter((l) => l.author?.did === session.identity.did);
      base.analysts.push({
        did: session.identity.did,
        handle: session.identity.handle,
        reputation: labels.reduce((sum, l) => sum + l.score, 0),
        labelCount: labels.length,
        netVotes: labels.reduce((sum, l) => sum + l.score, 0),
      });
    }
    base.analysts.sort((a, b) => b.reputation - a.reputation);
    return base;
  }
  return request<LeaderboardResponse>('/api/leaderboard');
}

export async function getTrending(): Promise<TrendingResponse> {
  if (USE_FIXTURES) {
    ensureMock();
    await mockLatency();
    const labels = [...mock.labels.values()].sort((a, b) => b.score - a.score).slice(0, 20);
    return { labels: clone(labels) };
  }
  return request<TrendingResponse>('/api/labels/trending');
}

export async function probeInject(): Promise<boolean> {
  if (USE_FIXTURES) return true;
  try {
    const res = await fetch(API_BASE + '/api/dev/inject', { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Web of trust graph, derived from leaderboard + label data. No new endpoint.
// Fixture backstory: 0xAnon authored the OTC-desk label and it was upvoted by
// the other fixture analysts; satoshisghost authored "exchange treasury".
// The live backend can adopt the same derivation or serve it directly.
// ---------------------------------------------------------------------------

const FIXTURE_VOTE_EDGES: { voterDid: string; labelId: string; value: 1 | -1 }[] = [
  { voterDid: 'did:jwk:eyJrdHkiOiJPS1AiLCJjcnYiOiJFZDI1NTE5In0', labelId: 'lbl_crowd_otc', value: 1 },
  { voterDid: 'did:dht:8zkq4w1e7r2t5y8u1i3o6p9a0s4d7f2g5h8j1k4l7z', labelId: 'lbl_crowd_otc', value: 1 },
  { voterDid: 'did:dht:h3n6m9q2w5e8r1t4y7u0i3p6a9s2d5f8g1h4j7k0l3', labelId: 'lbl_crowd_otc', value: 1 },
  { voterDid: 'did:dht:kw1b9f3m8x7v2c5z1a4q6w9e8r7t2y5u1i3o6p0s4d7f', labelId: 'lbl_crowd_treasury', value: 1 },
  { voterDid: 'did:dht:8zkq4w1e7r2t5y8u1i3o6p9a0s4d7f2g5h8j1k4l7z', labelId: 'lbl_crowd_treasury', value: 1 },
  { voterDid: 'did:dht:8zkq4w1e7r2t5y8u1i3o6p9a0s4d7f2g5h8j1k4l7z', labelId: 'lbl_seed_binance', value: 1 },
  { voterDid: 'did:dht:h3n6m9q2w5e8r1t4y7u0i3p6a9s2d5f8g1h4j7k0l3', labelId: 'lbl_seed_binance', value: 1 },
  { voterDid: 'did:jwk:eyJrdHkiOiJPS1AiLCJjcnYiOiJWMjU1MTkifQ', labelId: 'lbl_crowd_otc', value: -1 },
];

export async function getTrustGraph(): Promise<TrustGraphData> {
  const [{ analysts }, { labels }] = await Promise.all([getLeaderboard(), getTrending()]);

  const nodes = new Map<string, TrustGraphNode>();
  const edges: TrustGraphEdge[] = [];

  for (const analyst of analysts) {
    nodes.set(`did:${analyst.did}`, {
      id: `did:${analyst.did}`,
      kind: 'analyst',
      label: analyst.handle ?? `${analyst.did.slice(0, 18)}…`,
      did: analyst.did,
      reputation: analyst.reputation,
    });
  }

  for (const label of labels) {
    const addressNodeId = `addr:${label.address}`;
    if (!nodes.has(addressNodeId)) {
      nodes.set(addressNodeId, {
        id: addressNodeId,
        kind: 'address',
        label: label.tag,
        address: label.address,
        score: label.score,
      });
    }
    if (label.author) {
      const authorNodeId = `did:${label.author.did}`;
      if (!nodes.has(authorNodeId)) {
        nodes.set(authorNodeId, {
          id: authorNodeId,
          kind: 'analyst',
          label: label.author.handle ?? `${label.author.did.slice(0, 18)}…`,
          did: label.author.did,
          reputation: 0,
        });
      }
      edges.push({ source: authorNodeId, target: addressNodeId, kind: 'attestation', weight: 1 });
    } else {
      const seedNodeId = 'seed:tagpacks';
      if (!nodes.has(seedNodeId)) {
        nodes.set(seedNodeId, {
          id: seedNodeId,
          kind: 'seed',
          label: 'GraphSense TagPacks',
        });
      }
      edges.push({ source: seedNodeId, target: addressNodeId, kind: 'attestation', weight: 1 });
    }
  }

  if (USE_FIXTURES) {
    for (const vote of FIXTURE_VOTE_EDGES) {
      const label = mockReady ? mock.labels.get(vote.labelId) : undefined;
      const targetAddress = label?.address;
      if (!targetAddress) continue;
      const voterNodeId = `did:${vote.voterDid}`;
      if (!nodes.has(voterNodeId)) continue;
      edges.push({
        source: voterNodeId,
        target: `addr:${targetAddress}`,
        kind: 'vote',
        weight: vote.value,
      });
    }
  }

  return { nodes: [...nodes.values()], edges };
}

export async function getHack(id: string): Promise<Hack> {
  if (id === COLDCARD_HACK.id) return structuredClone(COLDCARD_HACK);
  if (USE_FIXTURES) {
    await mockLatency();
    if (id !== hackFixture.id) throw new ApiError(404, `unknown hack: ${id}`);
    return structuredClone(hackFixture) as Hack;
  }
  return request<Hack>(`/api/hacks/${encodeURIComponent(id)}`);
}

export async function postInject(body: { rule?: string; valueSats?: number; address?: string }): Promise<EventDetail> {
  if (USE_FIXTURES) {
    ensureMock();
    await mockLatency();
    const id = `evt_inject_${++mock.counter}`;
    const txid = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const summary: EventSummary = {
      id,
      txid,
      detectedAt: new Date().toISOString(),
      rules: ['whale'],
      valueSats: body.valueSats ?? 50_000_000_000,
      status: 'active',
      source: 'demo',
      aiStatus: 'pending',
      aiTag: null,
      blockHeight: null,
      blockHash: null,
      blockTime: null,
      meta: null,
      matchedLabels: [],
    };
    mock.events.unshift(summary);
    const detail = detailFromSummary(summary);
    detail.aiSummary = null;
    emitMockEvent(summary);
    return clone(detail);
  }
  return request<EventDetail>('/api/dev/inject', { method: 'POST', body: JSON.stringify(body) });
}
