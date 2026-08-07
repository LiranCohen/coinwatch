/**
 * CoinWatch API contract types (R15/R16).
 * The fixed interface both lanes (server/ and web/) compile against.
 * Types only: no runtime code except the RULES/STATUSES/SOURCES consts.
 */

export type Rule = 'whale' | 'dormant-wake' | 'coinjoin' | 'demo';

export type EventStatus = 'active' | 'confirmed' | 'evicted';

export type AiStatus = 'pending' | 'done' | 'failed';

export const RULES = ['whale', 'dormant-wake', 'coinjoin', 'demo'] as const satisfies readonly Rule[];
export const STATUSES = ['active', 'confirmed', 'evicted'] as const satisfies readonly EventStatus[];
export const SOURCES = ['live', 'demo'] as const satisfies readonly ('live' | 'demo')[];

export interface Identity {
  did: string;
  handle: string | null;
  reputation: number;
}

export interface Label {
  id: string;
  address: string;
  tag: string;
  note: string | null;
  evidenceUrl: string | null;
  /** null = seed label */
  author: { did: string; handle: string | null } | null;
  source: 'crowd' | 'seed';
  score: number;
  myVote: -1 | 0 | 1;
  createdAt: string;
}

export interface CoinjoinMeta {
  kind: 'wasabi' | 'whirlpool' | 'generic';
  denominationSats: number;
  equalOutputCount: number;
  participantCount: number;
}

export interface EventMeta {
  coinjoin?: CoinjoinMeta;
}

export interface EventSummary {
  id: string;
  txid: string;
  detectedAt: string;
  rules: Rule[];
  valueSats: number;
  status: EventStatus;
  source: 'live' | 'demo';
  aiStatus: AiStatus;
  aiTag: string | null;
  blockHeight: number | null;
  blockHash: string | null;
  blockTime: string | null;
  meta: EventMeta | null;
  /** labels on involved addresses, top 3 by score */
  matchedLabels: Label[];
}

export interface AiFeedback {
  confirms: number;
  refutes: number;
  mine: 'confirm' | 'refute' | null;
}

export interface EventDetail extends EventSummary {
  aiSummary: string | null;
  inputs: { address: string | null; valueSats: number }[];
  outputs: { address: string | null; valueSats: number }[];
  /** all labels on involved addresses */
  labels: Label[];
  aiFeedback: AiFeedback;
}

export interface AddressInfo {
  address: string;
  balanceSats: number | null;
  txCount: number | null;
  labels: Label[];
  recentEvents: EventSummary[];
  /** mempool.space link-out */
  externalUrl: string;
}

export interface LeaderboardEntry {
  did: string;
  handle: string | null;
  reputation: number;
  labelCount: number;
  netVotes: number;
}

/**
 * Web-of-trust graph (web/-derived, U11+). Nodes are crowd analysts, seeded
 * knowledge bases, and labeled addresses; edges are attestations (labels) and
 * votes. Derived client-side from existing endpoints — no backend change.
 */
export interface TrustGraphNode {
  id: string;
  kind: 'analyst' | 'seed' | 'address';
  label: string;
  did?: string;
  address?: string;
  reputation?: number;
  score?: number;
}

export interface TrustGraphEdge {
  source: string;
  target: string;
  kind: 'attestation' | 'vote';
  weight: number;
}

export interface TrustGraphData {
  nodes: TrustGraphNode[];
  edges: TrustGraphEdge[];
}

/** SSE message payloads on /api/stream */
export interface StreamMessages {
  'event:new': EventSummary;
  'event:update': EventSummary;
  'label:new': Label;
  health: { lastPollAt: string };
}

/** Endpoint request/response shapes */
export interface ChallengeResponse {
  nonce: string;
  expiresAt: string;
}

export interface VerifyRequest {
  did: string;
  keyId: string;
  nonce: string;
  /** base64url */
  signature: string;
  handle?: string;
}

export interface VerifyResponse {
  token: string;
  identity: Identity;
}

/** Backend-lane aliases kept so server/ compiles unchanged. */
export type AuthChallengeResponse = ChallengeResponse;
export type AuthVerifyRequest = VerifyRequest;
export type AuthVerifyResponse = VerifyResponse;

export interface CreateLabelRequest {
  tag: string;
  note?: string;
  evidenceUrl?: string;
}

export interface VoteRequest {
  value: 1 | -1;
}

export interface AiFeedbackRequest {
  value: 'confirm' | 'refute';
}

export interface EventsResponse {
  events: EventSummary[];
}

export type EventsListResponse = EventsResponse;

export type BatchKind = 'coinjoin-round' | 'curated';

export interface BatchSummary {
  id: string;
  kind: BatchKind;
  title: string;
  description: string | null;
  txCount: number;
  totalValueSats: number;
  latestBlockTime: string | null;
  topLabels: Label[];
}

export interface BatchTx {
  txid: string;
  blockHeight: number | null;
  blockHash: string | null;
  blockTime: string | null;
  valueSats: number;
  linkReason: string;
  labels: Label[];
  eventId: string | null;
}

export interface BatchDetail extends BatchSummary {
  txs: BatchTx[];
}

export interface AnalystProfile {
  identity: Identity;
  labels: Label[];
  votesReceived: { up: number; down: number };
  aiFeedbackGiven: number;
}

export interface EntitySummary {
  tag: string;
  addressCount: number;
  eventCount: number;
}

export interface EntityDetail {
  tag: string;
  addresses: { address: string; labels: Label[] }[];
  recentEvents: EventSummary[];
}

export interface BatchesResponse {
  batches: BatchSummary[];
}

export interface CoinjoinsResponse {
  coinjoins: (EventSummary & { batchId: string | null })[];
}

export interface TrendingResponse {
  labels: Label[];
}

export interface LeaderboardResponse {
  analysts: LeaderboardEntry[];
}

export interface InjectRequest {
  rule?: Rule;
  valueSats?: number;
  address?: string;
}

export interface HealthMessage {
  lastPollAt: string;
}

export type SseMessageName = 'event:new' | 'event:update' | 'label:new' | 'health';
