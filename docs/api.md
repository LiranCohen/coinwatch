# CoinWatch API — Frontend Integration Guide

Everything a frontend needs to consume this backend. No server-code reading required.

## Base URL

Keep the host in one `API` constant; nothing below hardcodes it.

| Environment | URL |
|---|---|
| Local server | `http://127.0.0.1:3100` — the port the demo runs on (`PORT` env); `localhost` resolves the same |
| Anything else | whatever host the operator is serving on — take it from config at build/run time |

- A demo instance is usually fronted by a Cloudflare **quick** tunnel, which mints a new random `*.trycloudflare.com` hostname every time it restarts. Any such URL written into a document is wrong by the next restart, so ask the operator for the live one rather than reading it from here.
- CORS is wide open: any origin, `Authorization` + `Content-Type` headers allowed, `GET/POST/PATCH/OPTIONS`.
- All bodies are JSON. Timestamps are ISO 8601 UTC strings. All amounts are integer **satoshis** (`valueSats`) — except the BTC-denominated thresholds in `GET /api/meta`.

## Conventions

- **Errors:** `{ "error": "<message>" }` with an appropriate status (400 validation, 401 auth, 403 loopback-only injector, 404 missing, 422 self-vote). An unregistered path is the exception — it answers plain-text `404 Not Found`.
- **Optional auth on reads:** any endpoint returning `Label` or `EventDetail` accepts `Authorization: Bearer <token>` and personalizes `myVote`/`mine` for that caller (defaults `0`/`null`). Writes always require auth.
- **Pagination:** `GET /api/events` is newest-first; pass `?before=<eventId>` to page further back.

## Auth flow (enbox DID, one-click)

No passwords, no wallet connect. Identities are DIDs created in-page with `@enbox/dids` (v0.1.8).

```ts
import { DidDht, DidJwk } from '@enbox/dids';

// 1. Create (or restore) — did:dht preferred, did:jwk fallback (works fully offline)
let did;
try {
  did = await DidDht.create();                              // publishes to enbox gateway
} catch {
  did = await DidJwk.create();                              // zero network
}
// persist for reloads: localStorage.setItem('cw:id', JSON.stringify(await did.export()))
// restore: await DidDht.import({ portableDid }) / DidJwk.import({ portableDid }) by prefix

// 2. Challenge
const { nonce } = await fetch(`${API}/api/auth/challenge`, { method: 'POST' }).then(r => r.json());

// 3. Sign + verify
const signer = await did.getSigner();
const signature = await signer.sign({ data: new TextEncoder().encode(nonce) });
const { token, identity } = await fetch(`${API}/api/auth/verify`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    did: did.uri,
    keyId: signer.keyId,
    nonce,
    signature: base64url(signature),
    handle: 'satoshi-sleuth',        // optional, editable later
  }),
}).then(r => r.json());

// 4. Use
fetch(`${API}/api/addresses/${addr}/labels`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ tag: 'otc-desk', note: '…', evidenceUrl: 'https://…' }),
});
```

Sessions last 24h. Nonces are single-use, 5-min TTL. did:dht logins work offline after one successful online verify (server caches the DID document).

## Types

```ts
type Rule = 'whale' | 'dormant-wake' | 'coinjoin' | 'hack';   // 'demo' is a source, never a rule
type EventStatus = 'active' | 'confirmed' | 'evicted';
type AiStatus = 'pending' | 'done' | 'failed';

interface Identity { did: string; handle: string | null; reputation: number; }

interface Label {
  id: string; address: string; tag: string;
  note: string | null; evidenceUrl: string | null;
  author: { did: string; handle: string | null } | null; // null = seed label
  source: 'crowd' | 'seed';
  score: number; myVote: -1 | 0 | 1;
  createdAt: string;
}

interface CoinjoinMeta {
  kind: 'wasabi' | 'whirlpool' | 'generic';
  denominationSats: number; equalOutputCount: number; participantCount: number;
}

interface TxEntropy {                 // Boltzmann analysis — see "Event meta" below before rendering
  status: 'ok' | 'skipped' | 'aborted'; // 'skipped'/'aborted' = analysis declined, NOT zero entropy
  reason: string | null;              // why it was declined; null when status is 'ok'
  combinations: number;               // valid input→output interpretations
  entropy: number;                    // log2(combinations), in bits
  maxEntropy: number;                 // entropy of a perfect coinjoin with the same in/out counts
  efficiency: number;                 // share of maxEntropy reached, in [0, 1]
  density: number;                    // entropy per input+output, comparable across tx sizes
  linkProbability: number[][];        // [input][output] = P(that input funded that output)
  deterministicLinks: { input: number; output: number }[]; // links that hold in every interpretation
}

interface EventMeta {
  coinjoin?: CoinjoinMeta;            // only on events the classifier matched
  entropy?: TxEntropy;
  feeSats?: number;                   // omitted when the fee is zero (e.g. coinbase)
}

interface EventSummary {
  id: string; txid: string; detectedAt: string;
  rules: Rule[]; valueSats: number;
  status: EventStatus; source: 'live' | 'demo';
  blockHeight: number | null; blockHash: string | null; blockTime: string | null;
  meta: EventMeta | null;
  aiStatus: AiStatus; aiTag: string | null;
  matchedLabels: Label[];             // top 3 labels on involved addresses
  hackId?: string;                    // contract-only today — nothing sets it, see "Hacks"
}

// Declared in the contract, not served by any route today — see "Hacks".
interface HackHop {
  txid: string; eventId: string | null;
  inputs: { address: string | null; valueSats: number }[];
  outputs: { address: string | null; valueSats: number }[];
  carrySats: number;                  // value carried into the next hop (0 on the terminal hop)
}
interface Hack {
  id: string; title: string; summary: string; detectedAt: string;
  status: EventStatus; totalSats: number; hops: HackHop[];
}

interface EventDetail extends EventSummary {
  aiSummary: string | null;
  inputs: { address: string | null; valueSats: number }[];
  outputs: { address: string | null; valueSats: number }[];
  labels: Label[];                    // all labels on involved addresses
  aiFeedback: { confirms: number; refutes: number; mine: 'confirm' | 'refute' | null };
}

interface AddressHistoryEntry {
  txid: string; time: string;
  deltaSats: number;                  // signed from the address's perspective: negative = outflow
  eventId: string | null;
}

interface AddressInfo {
  address: string;                    // canonical form, not necessarily what you asked for
  balanceSats: number | null; txCount: number | null; // null = lookup unavailable
  labels: Label[]; recentEvents: EventSummary[];
  history: AddressHistoryEntry[];     // from tracked events only, newest first
}

interface BlockSummary {
  height: number; hash: string; time: string | null;
  txCount: number; sizeBytes: number; weight: number;
  miner: string | null;               // null = upstream could not attribute the pool
  medianFeeRate: number | null;       // sat/vB
}

interface LeaderboardEntry { did: string; handle: string | null; reputation: number; labelCount: number; netVotes: number; }
interface AnalystProfile { identity: Identity; labels: Label[]; votesReceived: { up: number; down: number }; aiFeedbackGiven: number; }
interface EntitySummary { tag: string; addressCount: number; eventCount: number; }
interface EntityDetail { tag: string; addresses: { address: string; labels: Label[] }[]; recentEvents: EventSummary[]; }

interface BatchSummary {
  id: string; kind: 'coinjoin-round' | 'curated'; title: string; description: string | null;
  txCount: number; totalValueSats: number; latestBlockTime: string | null; topLabels: Label[];
}
interface BatchTx {
  txid: string; blockHeight: number | null; blockHash: string | null; blockTime: string | null;
  valueSats: number; linkReason: string; labels: Label[]; eventId: string | null;
}
interface BatchDetail extends BatchSummary { txs: BatchTx[]; }

interface DetectionConfig {           // BTC, blocks and counts — not satoshis
  whaleThresholdBtc: number; dormantBlocks: number; dormantMinValueBtc: number;
  coinjoinMinEqualOutputs: number; coinjoinMinDenominationBtc: number;
}
interface ServerMeta { detection: DetectionConfig; chainSource: string; }
```

## Endpoints

### Server metadata

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/meta` | no | → `ServerMeta` |

The thresholds this server is actually running with, read from its environment at boot. Copy them into rule explanations instead of hardcoding numbers: an operator who raises `WHALE_THRESHOLD_BTC` leaves a UI that says "≥10 BTC" describing rules that are not the ones firing.

```json
{"detection":{"whaleThresholdBtc":10,"dormantBlocks":4320,"dormantMinValueBtc":1,
 "coinjoinMinEqualOutputs":5,"coinjoinMinDenominationBtc":0.001},"chainSource":"esplora"}
```

- `detection` values are **not** satoshis: the `*Btc` fields are BTC, `dormantBlocks` is a block count (4320 ≈ 30 days), `coinjoinMinEqualOutputs` is an output count.
- `chainSource` names the ingestion source that actually answered (`esplora`, `bitcoind`). An operator can configure `auto`, but `auto` is a selection policy, not a source, so `/api/meta` reports whatever the pipeline settled on rather than the literal setting — safe to show as provenance next to `BlocksResponse.source`.

### Auth & identity

| Method | Path | Auth | Body → Response |
|---|---|---|---|
| POST | `/api/auth/challenge` | no | `{}` → `{ nonce, expiresAt }` |
| POST | `/api/auth/verify` | no | `{ did, keyId, nonce, signature, handle? }` → `{ token, identity }` |
| GET | `/api/auth/me` | yes | → `Identity` |
| PATCH | `/api/identities/me` | yes | `{ handle }` → `Identity` |
| GET | `/api/analysts/:did` | no | → `AnalystProfile` (404 unknown) |

### Events

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/events` | no | Query: `rule`, `status`, `source`, `limit` (default 50, clamped to 200), `before` → `{ events: EventSummary[] }` |
| GET | `/api/events/:id` | no | → `EventDetail` (404 `unknown event`) |
| GET | `/api/events/by-txid/:txid` | no | → `EventDetail`, same body as `/api/events/:id`. 400 if `:txid` is not 64 hex chars, 404 `unknown transaction` if no event tracks it |
| POST | `/api/events/:id/ai-feedback` | yes | `{ value: 'confirm' \| 'refute' }` → updated `aiFeedback`; same value again removes |
| GET | `/api/coinjoins` | no | `?limit` (default 50, clamped to 200) → `{ coinjoins: (EventSummary & { batchId: string \| null })[] }` — coinjoin events with classification in `meta.coinjoin` |

`by-txid` takes an upper- or lower-case txid; lookup is on the lower-case form. Use it to answer "is this transaction in the feed?" from a txid pasted into search, without first resolving an event id.

Both `limit`s behave the same way, and not like `/api/blocks`: a value above 200 is silently clamped to 200 rather than rejected, while anything that is not a positive integer (`0`, `2.5`, `abc`) is **400** `limit must be a positive integer` rather than falling back to the default. `?limit=500` on a feed holding more than 500 events returns 200 of them, so treat 200 as the page size and keep paging with `?before=<last event id>`.

#### Event meta

`meta` is `EventMeta | null`. On live-detected events `entropy` and `feeSats` are effectively always present, `coinjoin` only when the classifier matched — of the newest 200 events on the demo server, 195 carried `{entropy, feeSats}` and 5 also carried `coinjoin`.

`meta.entropy` needs a branch on `status` before anything is rendered, because a declined analysis is not a low-entropy transaction:

- `status: 'ok'` — the numbers mean what they say. `entropy: 0` here is a real result: one interpretation, every input→output link deterministic, the transaction leaks its full structure.
- `status: 'skipped'` or `'aborted'` — the engine declined. `combinations`, `entropy`, `maxEntropy`, `efficiency` and `density` are all filler `0`, `linkProbability` is `[]` and `deterministicLinks` is `[]`. Rendering that as "0 bits" tells the analyst the opposite of the truth; show "not analysed" and the `reason`. Live reasons are shaped `transaction too large to analyze (100 in, 1 out)` for `'skipped'` and `search exceeded <n> steps` for `'aborted'`.

`meta.feeSats` is the only field here in satoshis; it is omitted, not zero, when the transaction pays no fee.

#### Hacks

`Rule` includes `'hack'` and the contract declares `EventSummary.hackId`, `Hack` and `HackHop`, but nothing serves them: **no `/api/hacks` route is registered**, no detector emits the `hack` rule, and the server never sets `hackId`. `GET /api/hacks/<id>` falls through to the framework's plain-text `404 Not Found` — note that this is not the JSON `{ "error": … }` shape every real endpoint returns, so a client that blindly parses error bodies will throw on it. Treat `hackId` as always absent; do not build a hack pane against it yet.

### Labels & addresses

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/addresses/:address` | no | → `AddressInfo` (400 on an invalid address — see below; balance/txCount via mempool.space, cached 5 min) |
| POST | `/api/addresses/:address/labels` | yes | `{ tag, note?, evidenceUrl? }` → `Label` (201). tag 2–32 chars, note ≤280, evidenceUrl absolute http(s), else 400. Re-labelling with an existing `(address, tag)` returns the existing crowd label with 200 instead of creating a duplicate |
| POST | `/api/labels/:id/vote` | yes | `{ value: 1 \| -1 }` → updated `Label`. Same value removes vote, opposite flips; self-vote → 422 |
| GET | `/api/labels/trending` | no | → `{ labels: Label[] }` — top 20 by score with vote activity in last 24h |

#### Address validation and normalization

**Breaking:** `GET /api/addresses/:address` used to accept any string and answer 200. It now checksum-verifies `:address` first — base58check against its double-SHA256 checksum, segwit against BIP-173 (bech32, witness v0) or BIP-350 (bech32m, witness v1+) — and answers **400** `{ "error": "<reason>" }` when verification fails. A client that previously rendered an empty address page for a typo now has to handle 400. Reasons are short and safe to surface verbatim: `base58 checksum does not match`, `checksum does not match`, `contains a character that is not valid base58`, `mixes upper and lower case`, `unknown address version byte`, `witness version 0 must use bech32, not bech32m`, `too long to be a bitcoin address`.

**Breaking:** the address is also normalized before anything is looked up, and `AddressInfo.address` echoes the canonical form rather than the input — bech32/bech32m lower-cased (`BC1QW5…F3T4` → `bc1qw5…f3t4`), base58 unchanged (it is case-sensitive), surrounding whitespace trimmed. `labels`, `recentEvents` and `history` all key off the canonical form, so either casing resolves to the same data. Key client-side caches and URLs off `AddressInfo.address`, not off what you sent.

**Breaking:** `POST /api/addresses/:address/labels` used to store the path segment as given, with no validation. It now runs `:address` through the same validator and normalizer as the read path, before the request body is even parsed, so a write client sees three changes:

- a `:address` that fails verification is **400** `{ "error": "<reason>" }` (same reason strings as above) instead of a 201 for a label nobody can ever read back;
- a label that passes is stored under the canonical form, and `Label.address` echoes that form rather than the input — `BC1QW5…F3T4` and `bc1qw5…f3t4` are one address, so posting the same `tag` in the other casing now returns **200** with the existing label instead of creating a second one;
- there is no longer any reason to canonicalize client-side before posting (`classifySearchInput` from `@chainwatch/shared` still helps for search input, not for this).

Auth runs ahead of validation, so an unauthenticated request with a bad address answers 401, not 400 — fix the token before reading the error as an address problem.

Testnet, signet and regtest addresses validate and return 200, but `balanceSats`/`txCount` are `null` for them: the upstream lookup is mainnet-only. `null` there always means "unavailable", never zero.

### Batches (related-tx groups for tracing)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/batches` | no | → `{ batches: BatchSummary[] }` |
| GET | `/api/batches/:id` | no | → `BatchDetail` (404 unknown). `txs[].linkReason` explains each link; `eventId` non-null when the tx is also a detected event |

Seeded batches include "Binance.com hot wallet — 2018 cold-storage consolidations" (incl. the 109,735 BTC consolidation) and "OKX proof-of-reserves wallets". Auto batches are created when coinjoin rounds chain.

### Leaderboard & entities

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/leaderboard` | no | → `{ analysts: LeaderboardEntry[] }` top 20 by reputation |
| GET | `/api/entities` | no | → `{ entities: EntitySummary[] }` sorted by addressCount desc |
| GET | `/api/entities/:tag` | no | → `EntityDetail` (404 unknown; URL-encode the tag) |

### Chain

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/blocks` | no | `?limit` 1–12 (default 6) → `{ tipHeight, source, blocks: BlockSummary[] }`, newest first. 503 `chain data unavailable` when the upstream lookup fails |

This reads the chain's actual head, not the subset of it CoinWatch has indexed, so `blocks` will contain heights with no events. `source` names the upstream that answered (`esplora`, `bitcoind`) — show it as provenance. A fractional `limit` is truncated and an out-of-range one is clamped rather than rejected; a non-numeric one falls back to the default. On 503 show the ticker as unavailable rather than the last known tip.

## SSE live feed

`GET /api/stream` — Server-Sent Events. Connect with `EventSource`; refetch `GET /api/events` on reconnect to fill gaps (no replay).

| Message | Payload | When |
|---|---|---|
| `event:new` | `EventSummary` | new detection (AI may still be `pending`) |
| `event:update` | `EventSummary` | AI result attached, or status flipped (`confirmed`/`evicted`) — refetch `GET /api/events/:id` if this event is open in a detail pane |
| `label:new` | `Label` | crowd label created |
| `health` | `{ lastPollAt: string }` | after each successful node poll — if these stop, show "node connection stale" |

## Demo injector (presenter only)

- `GET /api/dev/inject` → `{ enabled: true }` when enabled, 404 `{ "error": "not found" }` otherwise (use it to toggle an inject button).
- `POST /api/dev/inject` `{ rule?, valueSats?, address? }` → `EventDetail` (201). **Loopback-only** — works on the host machine, 403 `injector is loopback-only` from anywhere else, so never through a tunnel. Runs through the real persist→broadcast→AI path.
- The injected event is marked by `source: 'demo'` only. Its `rules` hold the requested `rule` — one of `whale`, `dormant-wake`, `coinjoin`, `hack`, defaulting to `whale` — and never contain `'demo'`, which is not a rule at all. Badge injected events off `source`, and a rule filter will never single them out.

## Demo data

The demo DB is pre-seeded so every endpoint returns content: 7 confirmed events (3,000 BTC OKX sweeps, the 109,735 BTC Binance consolidation, the 2010 "pizza-era" dormant wake, three chained Wasabi rounds), 3 analysts with reputation, crowd labels with votes, ai_feedback tallies, and 3 batches. Seed labels (280 exchange/pool/service addresses) power `matchedLabels`, entities, and batch context.
