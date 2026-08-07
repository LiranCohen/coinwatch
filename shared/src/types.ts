/**
 * CoinWatch API contract types (R15/R16).
 * The fixed interface both lanes (server/ and web/) compile against.
 * Types only: no runtime code except the RULES/STATUSES/SOURCES consts.
 */

export type Rule = 'whale' | 'dormant-wake' | 'coinjoin' | 'hack';

export type EventStatus = 'active' | 'confirmed' | 'evicted';

export type AiStatus = 'pending' | 'done' | 'failed';

export const RULES = ['whale', 'dormant-wake', 'coinjoin', 'hack'] as const satisfies readonly Rule[];
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

/**
 * Boltzmann transaction entropy: how many distinct ways an observer could map
 * this transaction's inputs onto its outputs, and what that implies about which
 * links are certain. Entropy of 0 means the transaction leaks its full
 * structure; higher values mean more plausible interpretations.
 */
export interface TxEntropy {
  /** 'skipped'/'aborted' mean the analysis was declined, not that entropy is zero */
  status: 'ok' | 'skipped' | 'aborted';
  reason: string | null;
  /** number of valid input-to-output interpretations */
  combinations: number;
  /** log2(combinations), in bits */
  entropy: number;
  /** entropy of a perfect coinjoin with the same input/output counts */
  maxEntropy: number;
  /** share of the achievable entropy this transaction reaches, in [0, 1] */
  efficiency: number;
  /** entropy per input+output, comparable across transaction sizes */
  density: number;
  /** linkProbability[input][output] = P(that input funded that output) */
  linkProbability: number[][];
  /** links that hold in every interpretation */
  deterministicLinks: { input: number; output: number }[];
}

export interface EventMeta {
  coinjoin?: CoinjoinMeta;
  entropy?: TxEntropy;
  feeSats?: number;
}

/** A mined block, as shown in the chain ticker. */
export interface BlockSummary {
  height: number;
  hash: string;
  /** ISO 8601 */
  time: string | null;
  txCount: number;
  sizeBytes: number;
  weight: number;
  /** mining pool, when the upstream source can attribute it */
  miner: string | null;
  /** sat/vB */
  medianFeeRate: number | null;
}

export interface BlocksResponse {
  tipHeight: number;
  blocks: BlockSummary[];
  /** which upstream produced this: the operator's node or public explorers */
  source: string;
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
  /** set when the event is one hop of a multi-transaction hack */
  hackId?: string;
}

/** Multi-transaction exploit: an ordered chain of hops linked by carried value. */
export interface HackHop {
  txid: string;
  /** the feed event for this hop, when one exists */
  eventId: string | null;
  inputs: { address: string | null; valueSats: number }[];
  outputs: { address: string | null; valueSats: number }[];
  /** value carried into the next hop (0 on the terminal hop) */
  carrySats: number;
}

export interface Hack {
  id: string;
  title: string;
  summary: string;
  detectedAt: string;
  status: EventStatus;
  /** total value that left the origin addresses */
  totalSats: number;
  hops: HackHop[];
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

export interface AddressHistoryEntry {
  txid: string;
  time: string;
  /** signed from the address's perspective: negative = outflow */
  deltaSats: number;
  /** set when the transaction is tracked as an event */
  eventId: string | null;
}

export interface AddressInfo {
  address: string;
  balanceSats: number | null;
  txCount: number | null;
  /** total detections for this address, independent of how many are returned below */
  eventCount: number;
  labels: Label[];
  /** most recent detections, capped by the server */
  recentEvents: EventSummary[];
  /** history observed by the operator's own node, newest first */
  history: AddressHistoryEntry[];
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
 * votes. Derived client-side from existing endpoints; no backend change.
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

/**
 * Detection thresholds the server is actually running with. Operators change
 * these through the environment, so a client that hardcodes them will quietly
 * describe rules that are not the ones firing.
 */
export interface DetectionConfig {
  whaleThresholdBtc: number;
  dormantBlocks: number;
  dormantMinValueBtc: number;
  coinjoinMinEqualOutputs: number;
  coinjoinMinDenominationBtc: number;
}

export interface ServerMeta {
  detection: DetectionConfig;
  /** name of the active chain ingestion source */
  chainSource: string;
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

export * from './address';
