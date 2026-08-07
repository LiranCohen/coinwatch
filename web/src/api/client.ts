import type {
  AddressInfo,
  ChallengeResponse,
  EventDetail,
  EventSummary,
  EventsResponse,
  Identity,
  Label,
  LeaderboardResponse,
  TrendingResponse,
  VerifyRequest,
  VerifyResponse,
} from '@chainwatch/shared';

import addressFixture from '../../fixtures/address.json';
import eventDetailFixture from '../../fixtures/event-detail.json';
import eventsFixture from '../../fixtures/events.json';
import leaderboardFixture from '../../fixtures/leaderboard.json';
import trendingFixture from '../../fixtures/trending.json';
import { emitMockEvent } from './sse';

export const USE_FIXTURES = import.meta.env.VITE_USE_FIXTURES === 'true';

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
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(res.status, body || res.statusText);
  }
  return (await res.json()) as T;
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
  events: structuredClone(eventsFixture.events) as EventSummary[],
  details: new Map<string, EventDetail>([
    ['evt_001', structuredClone(eventDetailFixture) as EventDetail],
  ]),
  addresses: new Map<string, AddressInfo>([
    [addressFixture.address, structuredClone(addressFixture) as AddressInfo],
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
        ? `A ${(summary.valueSats / 1e8).toFixed(2)} BTC transaction matched the ${summary.rules.join(', ')} rule${summary.rules.length > 1 ? 's' : ''}. Destination profile is consistent with routine movement; no seeded labels are involved.`
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
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return request<EventsResponse>(`/api/events${qs ? `?${qs}` : ''}`);
}

export async function getEvent(id: string, token?: string | null): Promise<EventDetail> {
  if (USE_FIXTURES) {
    ensureMock();
    await mockLatency();
    const summary = mock.events.find((e) => e.id === id);
    if (!summary) throw new ApiError(404, `unknown event: ${id}`);
    return clone(detailFromSummary(summary));
  }
  return request<EventDetail>(`/api/events/${encodeURIComponent(id)}`, undefined, token);
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
      externalUrl: `https://mempool.space/address/${address}`,
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
    const res = await fetch('/api/dev/inject', { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
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
      rules: ['demo', 'whale'],
      valueSats: body.valueSats ?? 50_000_000_000,
      status: 'active',
      source: 'demo',
      aiStatus: 'pending',
      aiTag: null,
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
