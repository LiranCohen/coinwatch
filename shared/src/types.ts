export type Rule = 'whale' | 'dormant-wake' | 'coinjoin' | 'demo';

export type EventStatus = 'active' | 'confirmed' | 'evicted';

export type AiStatus = 'pending' | 'done' | 'failed';

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
  author: { did: string; handle: string | null } | null;
  source: 'crowd' | 'seed';
  score: number;
  myVote: -1 | 0 | 1;
  createdAt: string;
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
  labels: Label[];
  aiFeedback: AiFeedback;
}

export interface AddressInfo {
  address: string;
  balanceSats: number | null;
  txCount: number | null;
  labels: Label[];
  recentEvents: EventSummary[];
  externalUrl: string;
}

export interface LeaderboardEntry {
  did: string;
  handle: string | null;
  reputation: number;
  labelCount: number;
  netVotes: number;
}

export interface AuthChallengeResponse {
  nonce: string;
  expiresAt: string;
}

export interface AuthVerifyRequest {
  did: string;
  keyId: string;
  nonce: string;
  signature: string;
  handle?: string;
}

export interface AuthVerifyResponse {
  token: string;
  identity: Identity;
}

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

export interface EventsListResponse {
  events: EventSummary[];
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
