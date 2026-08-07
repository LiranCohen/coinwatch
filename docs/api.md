# CoinWatch API — Frontend Integration Guide

Everything a frontend needs to consume this backend. No server-code reading required.

## Base URLs

| Environment | URL |
|---|---|
| Live demo (Cloudflare tunnel) | `https://camp-prophet-duties-fairly.trycloudflare.com` |
| Local | `http://localhost:3100` |

- CORS is wide open: any origin, `Authorization` + `Content-Type` headers allowed, `GET/POST/PATCH/OPTIONS`.
- All bodies are JSON. Timestamps are ISO 8601 UTC strings. All amounts are integer base units (`valueSats`; one unit = one satoshi on-chain). UIs SHOULD display them with the [Coin Standard](https://coinsymbol.wtf/): ¢ for coins, ₿ for whole bitcoin, symbol first (`₿ 1 = ¢ 100m`).
- The tunnel URL is ephemeral (quick tunnel) — check `docs/development.md` for the current one.

## Conventions

- **Errors:** `{ "error": "<message>" }` with an appropriate status (400 validation, 401 auth, 404 missing, 422 self-vote).
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
type Rule = 'whale' | 'dormant-wake' | 'coinjoin' | 'demo';
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

interface EventSummary {
  id: string; txid: string; detectedAt: string;
  rules: Rule[]; valueSats: number;
  status: EventStatus; source: 'live' | 'demo';
  blockHeight: number | null; blockHash: string | null; blockTime: string | null;
  meta: { coinjoin?: CoinjoinMeta } | null;
  aiStatus: AiStatus; aiTag: string | null;
  matchedLabels: Label[];             // top 3 labels on involved addresses
}

interface EventDetail extends EventSummary {
  aiSummary: string | null;
  inputs: { address: string | null; valueSats: number }[];
  outputs: { address: string | null; valueSats: number }[];
  labels: Label[];                    // all labels on involved addresses
  aiFeedback: { confirms: number; refutes: number; mine: 'confirm' | 'refute' | null };
}

interface AddressInfo {
  address: string; balanceSats: number | null; txCount: number | null; // null = lookup unavailable
  labels: Label[]; recentEvents: EventSummary[];
  externalUrl: string;                // mempool.space link-out
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
```

## Endpoints

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
| GET | `/api/events` | no | Query: `rule`, `status`, `source`, `limit` (≤50 default), `before` → `{ events: EventSummary[] }` |
| GET | `/api/events/:id` | no | → `EventDetail` (404 unknown) |
| POST | `/api/events/:id/ai-feedback` | yes | `{ value: 'confirm' \| 'refute' }` → updated `aiFeedback`; same value again removes |
| GET | `/api/coinjoins` | no | `?limit` → `{ coinjoins: (EventSummary & { batchId: string \| null })[] }` — coinjoin events with classification in `meta.coinjoin` |
| GET | `/api/feed.xml` | no | RSS 2.0 of recent events. Query: `rule`, `limit`. Alias: `/feed.xml`. Item links point at `PUBLIC_SITE_URL/app?event=<id>` |

### Labels & addresses

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/addresses/:address` | no | → `AddressInfo` (balance/txCount via mempool.space, cached 5 min) |
| POST | `/api/addresses/:address/labels` | yes | `{ tag, note?, evidenceUrl? }` → `Label`. tag 2–32 chars, note ≤280, evidenceUrl absolute http(s), else 400 |
| POST | `/api/labels/:id/vote` | yes | `{ value: 1 \| -1 }` → updated `Label`. Same value removes vote, opposite flips; self-vote → 422 |
| GET | `/api/labels/trending` | no | → `{ labels: Label[] }` — top 20 by score with vote activity in last 24h |

### Batches (related-tx groups for tracing)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/batches` | no | → `{ batches: BatchSummary[] }` |
| GET | `/api/batches/:id` | no | → `BatchDetail` (404 unknown). `txs[].linkReason` explains each link; `eventId` non-null when the tx is also a detected event |

Seeded batches include "Binance.com hot wallet — 2018 cold-storage consolidations" (incl. the ₿ 109,735 consolidation) and "OKX proof-of-reserves wallets". Auto batches are created when coinjoin rounds chain.

### Leaderboard & entities

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/leaderboard` | no | → `{ analysts: LeaderboardEntry[] }` top 20 by reputation |
| GET | `/api/entities` | no | → `{ entities: EntitySummary[] }` sorted by addressCount desc |
| GET | `/api/entities/:tag` | no | → `EntityDetail` (404 unknown; URL-encode the tag) |

## SSE live feed

`GET /api/stream` — Server-Sent Events. Connect with `EventSource`; refetch `GET /api/events` on reconnect to fill gaps (no replay).

| Message | Payload | When |
|---|---|---|
| `event:new` | `EventSummary` | new detection (AI may still be `pending`) |
| `event:update` | `EventSummary` | AI result attached, or status flipped (`confirmed`/`evicted`) — refetch `GET /api/events/:id` if this event is open in a detail pane |
| `label:new` | `Label` | crowd label created |
| `health` | `{ lastPollAt: string }` | after each successful node poll — if these stop, show "node connection stale" |

## RSS feed

`GET /api/feed.xml` (also `/feed.xml`) — RSS 2.0 of recent detections for any reader (Feedly, NetNewsWire, etc.).

```bash
curl https://camp-prophet-duties-fairly.trycloudflare.com/api/feed.xml
curl 'http://localhost:3100/api/feed.xml?rule=whale&limit=20'
```

- Titles use Coin Standard amounts (`₿ 42.15`, `¢ 25m`) and include the AI tag when present.
- Each item links to `PUBLIC_SITE_URL/app?event=<id>` (set `PUBLIC_SITE_URL` in `.env`; defaults to `http://localhost:5173`).
- Optional filters: `rule` (`whale` \| `dormant-wake` \| `coinjoin` \| `hack`), `limit` (default 50, max 200).
- The web app advertises the feed via `<link rel="alternate" type="application/rss+xml">` and an RSS link in the app chrome / landing footer.

## Demo injector (presenter only)

- `GET /api/dev/inject` → 200 when enabled, 404 otherwise (use it to toggle an inject button).
- `POST /api/dev/inject` `{ rule?, valueSats?, address? }` → `EventDetail`. **Loopback-only** — works on the host machine, never through the tunnel. Runs through the real persist→broadcast→AI path; the event carries `source: 'demo'` and `'demo'` in `rules` and must be badged as such in the UI.

## Demo data

The demo DB is pre-seeded so every endpoint returns content: 7 confirmed events (₿ 3,000 OKX sweeps, the ₿ 109,735 Binance consolidation, the 2010 "pizza-era" dormant wake, three chained Wasabi rounds), 3 analysts with reputation, crowd labels with votes, ai_feedback tallies, and 3 batches. Seed labels (280 exchange/pool/service addresses) power `matchedLabels`, entities, and batch context.
