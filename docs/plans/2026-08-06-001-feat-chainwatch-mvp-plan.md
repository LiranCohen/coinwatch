---
title: ChainWatch MVP - Plan
type: feat
date: 2026-08-06
topic: chainwatch-mvp
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# ChainWatch MVP - Plan

## Goal Capsule

- **Objective:** Ship a demoable Bitcoin chain-intelligence MVP in ~3 hours of parallel agent build time: live event feed from the user's own node, AI first-pass analysis, crowdsourced address labels, enbox-DID identity with reputation.
- **Authority hierarchy:** This plan (Product Contract) > companion execution briefs (`docs/plans/2026-08-06-002-feat-chainwatch-backend-plan.md`, `docs/plans/2026-08-06-003-feat-chainwatch-frontend-plan.md`) > README.md sponsor framing.
- **Execution profile:** Two parallel agents after U1 lands — one backend (`server/`), one frontend (`web/`) — integrating only through the API contract in the Planning Contract.
- **Stop conditions:** Any launch-blocking open question appears; the demo script in Definition of Done cannot run end-to-end; external dependency (node RPC, mempool.space, AI provider, did gateway) unreachable with no fallback path.
- **Tail ownership:** User verifies the demo script manually; agents own unit-level verification.

---

## Product Contract

### Summary

ChainWatch MVP is a Bitcoin-only, live chain-analysis app. The user's full node streams transactions; detection rules surface interesting events; a pluggable cloud-AI gives each event a first-pass summary; the crowd attaches labels to addresses that flow back into event context. One-click enbox DID accounts give every contribution a portable identity and a reputation leaderboard. The pitch: production stands up on QuickNode endpoints and OKX.AI.

### Problem Frame

On-chain intelligence is either expensive (Nansen, Arkham) or unstructured (Twitter, Discord). For Bitcoin specifically, label knowledge lives in closed databases (Chainalysis) or scattered community posts. The hackathon judges are the immediate audience; the product hypothesis is that a live feed plus crowd labels plus reputation is a credible middle ground. The README (README.md) contains the original pitch and remains the source for sponsor framing.

### Key Decisions

- **Bitcoin-only.** EVM chains are out; the README's Base/Ethereum framing is superseded for this build.
- **RPC-first data strategy.** Blocks, mempool, and tx-by-txid come from the user's node (txindex). Address-based lookups (history, balance, UTXOs) come from mempool.space, with blockstream.info as fallback — bitcoind has no address index, and Electrum servers add protocol friction for no gain.
- **Fully live feed.** No seeded replay. A dev-only event injector (R17) is the rehearsal/emergency valve.
- **Hybrid crowd model.** Labels attach to addresses/entities; labels on involved addresses surface inside event context. Both are core, not layered phases.
- **Pluggable AI provider.** A thin interface fronts the user's existing cloud AI accounts, pitched as OKX.AI-compatible. Local GPU models are a fallback, not the demo path.
- **Enbox identity, in-page.** Only `@enbox/dids` + `@enbox/crypto`. Default `did:dht` (published to the enbox gateway, matching the enbox web-wallet's method); `did:jwk` as zero-network fallback. No vault, no DWN, no wallet-connect. Portable identity persists client-side; login is a signed server challenge verified by DID resolution.
- **Split frontend + backend with contract-first API.** The API shape (R15, R16) is fixed in the Planning Contract before parallel build starts so the frontend agent builds against fixtures.
- **Seed label bootstrap.** A curated subset of GraphSense TagPacks (MIT-licensed, `label + address + source URL` entries, including WalletExplorer-derived exchange packs) imports at startup, so neither crowd nor AI cold-starts from zero. TagPack source URLs populate the label evidence field.

### Actors

- A1. **Analyst** — a human participant (judge, audience member, presenter) who creates an account, labels addresses, and votes.
- A2. **Ingest service** — the backend pipeline that streams the node, runs detection, and stores events.
- A3. **AI provider** — the external LLM API producing first-pass analysis.
- A4. **Viewer** — an unauthenticated visitor who can read everything but not contribute.

```mermaid
flowchart TB
  NODE[Bitcoin node RPC] --> INGEST[Backend ingest + detection]
  MSPACE[mempool.space API] --> INGEST
  INGEST --> DB[(SQLite: events, labels, votes, identities)]
  INGEST --> AI[Pluggable AI provider]
  AI --> DB
  DB --> SSE[SSE live feed]
  SSE --> FE[Frontend dashboard]
  FE -->|labels, votes, signed challenges| API[REST API]
  API --> DB
  FE -->|create DID, sign| ENBOX[@enbox/dids in-page]
```

### Requirements

**Ingestion and detection**

- R1. The backend streams new mempool transactions and blocks from the user's node via RPC polling (ZMQ is a stretch goal, not required).
- R2. Detection surfaces at minimum: transfers above a configurable BTC threshold; dormant-wallet wakes (an input address with no outgoing spend within a configurable block window); coinjoin-pattern transactions (heuristic such as ≥5 equal-value outputs).
- R3. Each event stores txid, detection time, matched rules, involved addresses, and total value.
- R4. Address detail lookups resolve via mempool.space with blockstream.info as fallback, with caching to respect rate limits.

**AI analysis**

- R5. Every event receives an AI first pass: a 1–2 sentence natural-language summary plus a risk/behavior tag, produced through the pluggable provider interface.
- R6. AI output is visibly marked machine-generated and can be confirmed or refuted by crowd votes.
- R7. If the AI provider fails or is unconfigured, events still appear, marked "analysis pending."

**Identity and reputation**

- R8. Account creation is one click, in-page: generate an enbox DID (`did:dht`, falling back to `did:jwk`), persist the portable identity in browser storage, no password or external wallet.
- R9. Authentication is a server-issued challenge signed with the DID key, verified backend-side via DID resolution.
- R10. Each identity accrues a reputation score when the crowd confirms its contributions; a leaderboard ranks analysts.

**Crowd layer**

- R11. An authenticated identity can attach a label — tag, optional note, optional evidence link — to any Bitcoin address.
- R12. Labels accept one up- or down-vote per identity; voting the same value again removes the vote, voting the opposite value flips it.
- R13. When a surfaced event involves a labeled address, the label appears inline in the event's context.
- R14. The app exposes trending views: top labels by votes and top analysts by reputation.

**API and realtime**

- R15. The backend exposes a REST API covering events, event detail, address labels, votes, identities/auth, and leaderboard, plus a server-pushed live feed (SSE) of new events.
- R16. The API contract is fixed before the parallel build and provided to the frontend agent as fixtures, so frontend and backend agents build simultaneously without integration drift.

**Demo and delivery**

- R17. A dev-only injector enqueues a synthetic, clearly-marked demo event through the same detection-to-UI pipeline.
- R18. Startup seeds labels from a curated GraphSense TagPacks subset (exchanges, services, mining pools), preserving each tag's source URL as label evidence.
- R19. The UI is a dark-mode dashboard: live feed, event detail pane showing AI plus crowd context, address page with labels, and leaderboard.
- R20. The full stack runs locally against the user's node plus public APIs; README.md is updated to the Bitcoin scope.

### Key Flows

- F1. Event surfacing
  - **Trigger:** Node reports a new mempool transaction or block.
  - **Actors:** A2, A3, A4
  - **Steps:** Ingest fetches the transaction; detection rules evaluate; matching events persist; AI first pass attaches; the event pushes to all connected clients.
  - **Outcome:** Viewers see the event with AI context within seconds of on-chain appearance.
  - **Covers:** R1, R2, R3, R5, R15
- F2. One-click account and login
  - **Trigger:** Analyst clicks "create account."
  - **Actors:** A1
  - **Steps:** Browser generates an enbox DID; portable identity persists locally; backend issues a challenge; the client signs it; the backend verifies and returns a session.
  - **Outcome:** The analyst can label and vote under a persistent pseudonymous identity.
  - **Covers:** R8, R9
- F3. Label an address
  - **Trigger:** Analyst submits a label from an event or address page.
  - **Actors:** A1
  - **Steps:** Label persists with authorship; other identities vote on it; the label appears in future events touching that address; reputation updates on consensus.
  - **Outcome:** Crowd knowledge compounds into the feed.
  - **Covers:** R10, R11, R12, R13
- F4. Demo injector
  - **Trigger:** Presenter fires the dev-only injector.
  - **Actors:** A2
  - **Steps:** A synthetic, marked event flows through detection, AI, and live push.
  - **Outcome:** The demo never stalls on a quiet mempool.
  - **Covers:** R17

### Acceptance Examples

- AE1. **Covers R2.** Given a mempool transaction below the value threshold with no other rule hits, when detection runs, then no event is surfaced.
- AE2. **Covers R2.** Given an input address whose last outgoing spend is older than the dormant-window, when detection runs, then a dormant-wake event is surfaced naming that address.
- AE3. **Covers R11, A4.** Given no session, when a visitor attempts to label or vote, then the API rejects the write while all reads still succeed.
- AE4. **Covers R12.** Given an identity that already voted on a label, when it votes again with the same value, then the vote is removed; when it votes with the opposite value, then the vote flips.
- AE5. **Covers R7.** Given the AI provider errors, when an event surfaces, then it displays "analysis pending" and the feed is uninterrupted.
- AE6. **Covers R17.** Given the injector fires, when the event appears in the feed, then it carries a visible demo marker distinguishing it from real events.

### Success Criteria

- Two agents build backend and frontend in parallel against the R16 contract and integrate without rework.
- The demo script (live event → AI take → crowd label → reputation tick → trending view) runs end-to-end in under 5 minutes.
- Sponsor story is honest: QuickNode and OKX.AI appear as the production architecture, with free-tier QuickNode (10M credits, 15 req/s) verified as real.

### Scope Boundaries

**Deferred for later**

- Real QuickNode endpoint/Streams integration and direct OKX.AI API usage.
- Address-clustering heuristics (e.g., multi-input co-spend grouping) beyond R2's rules.
- Anti-sybil, moderation tooling, and vote-weighting beyond the simple reputation score.
- Enbox vault, recovery phrases, DWN sync, and cross-device identity portability.
- Data durability beyond the hackathon (migrations, backups, hosted deployment).

**Outside this product's identity**

- EVM chains and contract-level analytics.
- Wallet-connect onboarding of any kind.
- Being a block explorer — deep block/tx pages link out to mempool.space rather than re-implementing it.

**Deferred to Follow-Up Work**

- ZMQ subscriptions replacing RPC polling (polling is the MVP path).
- Local GPU model provider for the AI interface.
- Self-hosted mempool.space/electrs for a fully sovereign address-index stack.

### Dependencies / Assumptions

- The user's Bitcoin node is reachable with RPC credentials and txindex enabled (user-stated, not yet verified).
- The venue has internet access for the AI API, mempool.space, and the enbox did:dht gateway.
- `@enbox/dids` and `@enbox/crypto` are published on npm (verified, v0.1.8) with browser bundles and no WASM.
- A cloud AI account and API key from the user's existing providers will be available at build time.
- QuickNode free tier confirmed at $0 with 10M API credits, 15 req/s, 1 Stream — supports the production-architecture pitch.

### Sources / Research

- README.md — original sponsor-facing pitch (EVM framing superseded by this plan).
- QuickNode pricing page — free tier details verified 2026-08-06.
- Enbox monorepo (sibling checkout at `~/src/enboxorg/enbox`): identity creation via `DidDht.create` / `DidJwk.create` in `packages/dids/src/methods/`; challenge signing via `BearerDid.getSigner` in `packages/dids/src/bearer-did.ts`; backend verification via `UniversalResolver` (`packages/dids/src/resolver/universal-resolver.ts`) plus Ed25519 verify (`packages/crypto/src/algorithms/eddsa.ts`); the web-wallet onboarding flow at `examples/web-wallet/src/contexts/IdentitiesContext.tsx` is the reference UX.
- GraphSense TagPacks (`github.com/graphsense/graphsense-tagpacks`, MIT) — curated public attribution tags, including WalletExplorer-derived exchange packs; entries are `label + address + source URL`.
- bitcoind has no address index; mempool.space/blockstream.info fill the address-lookup gap and both are open source, reinforcing the self-hostable narrative.

---

## Planning Contract

Product Contract preservation: changed R12 and AE4 (vote-toggle rule fixed), R18 (seed source named as GraphSense TagPacks), and the brainstorm's deferred questions are resolved here as KTDs; all other Product Contract content unchanged.

### Key Technical Decisions

- **KTD-1. One repo, two workspaces plus a shared types package.** `server/`, `web/`, and `shared/` under npm workspaces. The split-backend/frontend decision holds without two-repo friction; `shared/` carries only the TypeScript types from the API contract so both sides compile against identical shapes.
- **KTD-2. Backend: Bun + Hono + better-sqlite3.** Bun gives native TypeScript and fast installs; Hono is a thin HTTP layer with first-class SSE support; better-sqlite3 gives synchronous, zero-ORM storage. Swap any piece at build time if it fights the agent.
- **KTD-3. Frontend: Vite + React + TypeScript + Tailwind.** Plain fetch hooks and `EventSource` for the stream — no state library, no query library. Dark mode is a Tailwind default palette, not a theme system.
- **KTD-4. RPC polling with diff, not ZMQ.** Every `POLL_INTERVAL_MS` (default 5000), diff `getrawmempool` against the previous snapshot, and fetch `getrawtransaction` (verbose) for newcomers. Eviction sweep: an active event whose txid leaves the mempool is marked `confirmed` if it appears in the latest block, else `evicted`. ZMQ is deferred (Scope Boundaries).
- **KTD-5. Dormant-wake checks are gated by value.** Address-history lookups cost an external API call, so dormant checks run only for transactions above a lower value gate (`DORMANT_MIN_VALUE_BTC`, default 1) and only against the highest-value input addresses. This keeps mempool.space rate limits safe.
- **KTD-6. AI provider is an OpenAI-compatible chat-completions client.** Configured by `AI_BASE_URL` + `AI_API_KEY` + `AI_MODEL`, which covers most hosted providers and local GPU servers (vLLM/Ollama) with one code path. A mock provider returns templated text when no key is configured, satisfying R7 offline.
- **KTD-7. did:dht with timed fallback to did:jwk.** Account creation tries `DidDht.create` (default publish) with a ~5s timeout; on failure it falls back to `DidJwk.create`. Backend verification resolves via `UniversalResolver` with both methods registered, so mixed-method identities coexist.
- **KTD-8. Seed import is a build-time artifact, not a runtime fetch.** A curated TagPacks subset is committed as `server/fixtures/seed-labels.json` and imported on first startup as `source: 'seed'` labels with the TagPack source URL as evidence. Deterministic, offline-friendly, no YAML parsing at runtime.
- **KTD-9. Reputation is a stored counter, updated synchronously on votes.** Upvote on a label = +1 to its author's reputation; downvote = -1; self-votes rejected; seed labels have no author and earn nothing. No batch jobs, no accuracy oracle.

### High-Level Technical Design

**Detection pipeline stages** (runs inside `server/`, one process):

```text
poll loop ──► diff mempool ──► fetch new txs (verbose) ──► evaluate rules
     │                                                        │
     │                                              whale ≥ WHALE_THRESHOLD_BTC (default 10)
     │                                              dormant: input addr quiet ≥ DORMANT_BLOCKS (default 4320)
     │                                              coinjoin: ≥ COINJOIN_MIN_EQUAL_OUTPUTS (default 5) equal outputs
     │                                                        │
     ▼                                                        ▼
eviction sweep (active event left mempool?)        persist event ──► AI first pass ──► SSE broadcast
```

**Auth sequence** (F2):

```mermaid
sequenceDiagram
  participant B as Browser (web/)
  participant S as Backend (server/)
  participant G as did:dht gateway
  B->>B: DidDht.create() (fallback DidJwk.create); persist portable DID
  B->>G: publish DID document (did:dht only)
  B->>S: POST /api/auth/challenge
  S-->>B: { nonce, expiresAt }
  B->>B: sign nonce with DID signer
  B->>S: POST /api/auth/verify { did, keyId, nonce, signature, handle? }
  S->>S: UniversalResolver.resolve(did); Ed25519 verify(nonce, signature)
  S-->>B: { token, identity }
```

### API Contract (R15, R16) — the fixed interface both agents build against

Base URL `http://localhost:3001`. All writes require `Authorization: Bearer <token>` unless noted. JSON everywhere; timestamps ISO 8601; amounts integer sats.

**Types** (live in `shared/src/types.ts`; pseudo-types shown for design review):

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

interface EventSummary {
  id: string; txid: string; detectedAt: string;
  rules: Rule[]; valueSats: number;
  status: EventStatus; source: 'live' | 'demo';
  aiStatus: AiStatus; aiTag: string | null;
  matchedLabels: Label[]; // labels on involved addresses, top 3 by score
}

interface EventDetail extends EventSummary {
  aiSummary: string | null;
  inputs: { address: string | null; valueSats: number }[];
  outputs: { address: string | null; valueSats: number }[];
  labels: Label[]; // all labels on involved addresses
  aiFeedback: { confirms: number; refutes: number; mine: 'confirm' | 'refute' | null };
}

interface AddressInfo {
  address: string; balanceSats: number | null; txCount: number | null;
  labels: Label[]; recentEvents: EventSummary[];
  externalUrl: string; // mempool.space link-out
}

interface LeaderboardEntry {
  did: string; handle: string | null;
  reputation: number; labelCount: number; netVotes: number;
}
```

**Endpoints:**

| Method + path | Auth | Body → Response | Notes |
|---|---|---|---|
| `POST /api/auth/challenge` | no | `{}` → `{ nonce, expiresAt }` | nonce single-use, 5-min TTL |
| `POST /api/auth/verify` | no | `{ did, keyId, nonce, signature, handle? }` → `{ token, identity: Identity }` | creates identity on first verify |
| `GET /api/auth/me` | yes | → `Identity` | |
| `PATCH /api/identities/me` | yes | `{ handle }` → `Identity` | display name only |
| `GET /api/events` | no | query `rule?, status?, source?, limit?, before?` → `{ events: EventSummary[] }` | newest first, default limit 50 |
| `GET /api/events/:id` | no | → `EventDetail` | |
| `POST /api/events/:id/ai-feedback` | yes | `{ value: 'confirm' \| 'refute' }` → `EventDetail['aiFeedback']` | toggle semantics like votes |
| `GET /api/addresses/:address` | no | → `AddressInfo` | balance/txCount via mempool.space, cached 5 min |
| `POST /api/addresses/:address/labels` | yes | `{ tag, note?, evidenceUrl? }` → `Label` | tag 2–32 chars |
| `POST /api/labels/:id/vote` | yes | `{ value: 1 \| -1 }` → `Label` | toggle per R12; self-vote → 422 |
| `GET /api/leaderboard` | no | → `{ analysts: LeaderboardEntry[] }` | top 20 by reputation |
| `GET /api/labels/trending` | no | → `{ labels: Label[] }` | top 20 by score, last 24h |
| `GET /api/stream` | no | SSE | events below |
| `POST /api/dev/inject` | env-guarded | `{ rule?, valueSats?, address? }` → `EventDetail` | 404 unless `INJECTOR_ENABLED=true` |

**SSE messages on `/api/stream`:** `event:new` (EventSummary), `event:update` (EventSummary — AI attached, status changes), `label:new` (Label).

**Frontend fixtures:** `web/fixtures/` mirrors one example response per endpoint above, so the frontend agent builds with `VITE_USE_FIXTURES=true` before the backend exists.

### Sequencing

U1 (scaffold + shared contract) lands first and alone. Then two parallel lanes: backend lane U2 → U3/U4 → U5 → U6; frontend lane U7 → U8/U9 → U10 → U11. The lanes meet only at `shared/` types and the integration check in Definition of Done.

### Risks and Dependencies

- **Venue internet failure** — mitigated by mock AI provider (KTD-6), did:jwk fallback (KTD-7), committed seed file (KTD-8); node RPC is local.
- **mempool.space rate limiting** — mitigated by value-gated dormant checks (KTD-5) and 5-min address cache; blockstream.info fallback.
- **Quiet mempool during judging** — mitigated by the injector (R17) exercised identically to live events.
- **Node RPC unreachable at build start** — first backend task after U2 is an RPC connectivity smoke check; surface to user immediately if it fails.
- **`@enbox/dids` browser bundling surprises** — packages ship `dist/browser.mjs` and are browser-tested upstream; Vite handles them, but the frontend agent validates DID creation in-browser before building login UI on top.

---

## Implementation Units

| Unit | Title | Lane | Depends on |
|---|---|---|---|
| U1 | Repo scaffold + shared API contract types | both | — |
| U2 | SQLite store + TagPack seed importer | backend | U1 |
| U3 | Node ingest + detection pipeline | backend | U2 |
| U4 | AI provider interface + mock | backend | U1 |
| U5 | Enbox challenge-auth backend | backend | U2 |
| U6 | REST API + SSE + dev injector | backend | U3, U4, U5 |
| U7 | Web scaffold + typed API client + fixtures mode | frontend | U1 |
| U8 | One-click enbox identity + login | frontend | U7 |
| U9 | Live feed dashboard + event detail pane | frontend | U7 |
| U10 | Address page + labels + votes | frontend | U8, U9 |
| U11 | Leaderboard, trending, demo polish, README | frontend | U9 |

### U1. Repo scaffold + shared API contract types

- **Goal:** Workspaces monorepo with `server/`, `web/`, `shared/`; the API contract types compile and are importable from both lanes.
- **Requirements:** R16
- **Dependencies:** none
- **Files:** `package.json`, `shared/package.json`, `shared/src/types.ts`, `server/package.json`, `server/tsconfig.json`, `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`, `.gitignore`
- **Approach:** npm workspaces; `shared/` exports exactly the types in the API Contract section — no runtime code. Proxy config in Vite forwards `/api` to `localhost:3001`.
- **Test scenarios:**
  - Happy: `shared/src/types.ts` compiles standalone; a trivial import from both `server/` and `web/` typechecks.
- **Verification:** Both workspaces install and typecheck; `shared` types importable from each.

### U2. SQLite store + TagPack seed importer

- **Goal:** Schema, connection module, and first-startup seed import from the committed TagPacks subset.
- **Requirements:** R3, R18, R10 (schema), R12 (schema)
- **Dependencies:** U1
- **Files:** `server/src/store/db.ts`, `server/src/store/schema.sql`, `server/src/store/seed.ts`, `server/fixtures/seed-labels.json`, `server/test/store.test.ts`
- **Approach:** Tables: `identities`, `challenges`, `sessions`, `events`, `labels`, `votes` (unique `(label_id, voter_did)`), `ai_feedback` (unique `(event_id, voter_did)`). Seed file curated from GraphSense TagPacks (exchanges, services, pools; ~100–300 entries); import is idempotent (`INSERT OR IGNORE` on `(address, tag, source)`).
- **Test scenarios:**
  - Happy: fresh DB applies schema and imports seed rows with evidence URLs preserved.
  - Edge: seed import run twice produces no duplicates.
  - Error: malformed seed entry is skipped with a warning, import continues.
- **Verification:** Store tests pass; a query for a well-known exchange address returns its seeded label.

### U3. Node ingest + detection pipeline

- **Goal:** Poll the node, diff the mempool, evaluate the three detection rules, persist events, run the eviction sweep.
- **Requirements:** R1, R2, R3, AE1, AE2
- **Dependencies:** U2
- **Files:** `server/src/rpc/client.ts`, `server/src/detect/rules.ts`, `server/src/detect/pipeline.ts`, `server/src/external/addressinfo.ts`, `server/src/config.ts`, `server/test/rules.test.ts`, `server/test/pipeline.test.ts`
- **Approach:** RPC client wraps `getrawmempool`, `getrawtransaction` (verbose), `getblock`, `getblockhash`. Rules are pure functions over a normalized tx shape. Dormant checks value-gated per KTD-5, using `external/addressinfo.ts` (mempool.space, blockstream fallback, in-process cache). Pipeline emits persisted events to an in-process emitter consumed by U6's SSE and U4's AI pass. Covers AE1 (below-threshold tx produces nothing), AE2 (stale-input tx produces dormant event).
- **Test scenarios:**
  - Happy: synthetic whale tx (value ≥ threshold) yields one event with rule `whale`, correct sats and addresses.
  - Happy: tx with ≥5 equal outputs yields `coinjoin`.
  - Edge: tx matching multiple rules yields one event with all rules listed.
  - Edge: tx disappearing from mempool without block inclusion is marked `evicted`; one included in the next block is marked `confirmed`.
  - Error: RPC failure logs and retries next poll without crashing. Covers AE1, AE2 with crafted inputs (address history stubbed).
- **Verification:** Rule tests pass on crafted transactions; pipeline test drives a fake-RPC through detect→persist→evict.

### U4. AI provider interface + mock

- **Goal:** One async `summarizeEvent` function backed by an OpenAI-compatible chat endpoint, with a templated mock when unconfigured.
- **Requirements:** R5, R7, AE5
- **Dependencies:** U1
- **Files:** `server/src/ai/provider.ts`, `server/test/ai.test.ts`
- **Approach:** Prompt carries rule hits, value, and matched seed labels; response constrained to a summary sentence + one tag from a fixed list. Timeout (~10s) and any error → `aiStatus: 'failed'`, event still broadcasts. Mock returns deterministic templated text per rule. Covers AE5.
- **Test scenarios:**
  - Happy: mocked HTTP 200 yields summary + tag, event updated to `done`.
  - Error: HTTP 500/timeout yields `failed`, pipeline uninterrupted.
  - Edge: missing API key selects mock provider and marks output as demo-grade.
- **Verification:** AI tests pass with a stubbed transport; no real API calls in tests.

### U5. Enbox challenge-auth backend

- **Goal:** Challenge issuance, DID signature verification, session tokens.
- **Requirements:** R9, AE3 (write rejection)
- **Dependencies:** U2
- **Files:** `server/src/api/auth.ts`, `server/src/identity/verify.ts`, `server/test/auth.test.ts`
- **Approach:** `POST /api/auth/challenge` stores a single-use nonce (5-min TTL). `verify.ts` resolves the DID via `UniversalResolver` (`DidDht`, `DidJwk`), extracts the verification method matching `keyId`, and Ed25519-verifies the signature over the nonce (per enbox `EdDsaAlgorithm.verify`). First successful verify upserts the identity and returns a random bearer token (24h). Unauthenticated writes rejected with 401. Covers AE3's API half.
- **Test scenarios:**
  - Happy: end-to-end — create a real `did:jwk` in the test, sign the nonce, verify succeeds, token works on `GET /api/auth/me`.
  - Edge: reused nonce rejected; expired nonce rejected.
  - Error: bad signature → 401; write without token → 401 while reads pass.
- **Verification:** Auth tests pass using a real did:jwk round-trip, no network (did:jwk resolves offline).

### U6. REST API + SSE + dev injector

- **Goal:** All contract endpoints served, SSE broadcasting pipeline events, env-guarded injector.
- **Requirements:** R15, R17, R13, R14, R6, AE6
- **Dependencies:** U3, U4, U5
- **Files:** `server/src/index.ts`, `server/src/api/routes.ts`, `server/src/api/sse.ts`, `server/src/api/inject.ts`, `server/test/api.test.ts`
- **Approach:** Hono app mounting auth (U5), routes per the contract table, SSE hub subscribed to the pipeline emitter. Event serialization resolves `matchedLabels`/`labels` by joining involved addresses (R13). Injector constructs a synthetic tx shape, marks `source: 'demo'`, rule includes `'demo'`, and pushes it through the same persist→AI→broadcast path. Covers AE6 at the API level. Vote endpoint implements toggle/flip per R12 and updates reputation per KTD-9.
- **Test scenarios:**
  - Happy: each endpoint returns contract-shaped JSON (schema-assert against `shared` types).
  - Integration: injected event appears on `/api/stream` as `event:new` with `source: 'demo'`. Covers AE6.
  - Edge: vote toggle (same value removes, opposite flips, self-vote 422).
  - Error: unknown event id → 404; malformed label → 400.
- **Verification:** API integration tests pass against an in-memory pipeline; every contract endpoint has at least one assertion.

### U7. Web scaffold + typed API client + fixtures mode

- **Goal:** Vite React app with routing, Tailwind dark base, a typed client for every contract endpoint, and a fixtures toggle.
- **Requirements:** R16, R19 (base)
- **Dependencies:** U1
- **Files:** `web/src/main.tsx`, `web/src/App.tsx`, `web/src/api/client.ts`, `web/src/api/sse.ts`, `web/fixtures/events.json`, `web/fixtures/event-detail.json`, `web/fixtures/address.json`, `web/fixtures/leaderboard.json`, `web/src/index.css`
- **Approach:** Client functions typed with `shared` types; when `VITE_USE_FIXTURES=true` the client returns fixture JSON instead of fetching. `EventSource` wrapped in a small hook. Routes: `/` (feed), `/events/:id` (or feed+detail pane), `/address/:address`, `/leaderboard`.
- **Test scenarios:**
  - Happy: fixtures mode renders the feed from `events.json` with zero network.
  - Error: SSE disconnect retries with backoff without duplicate events.
- **Verification:** App builds; fixtures mode renders without a backend.

### U8. One-click enbox identity + login

- **Goal:** Single-button account creation, portable-DID persistence, challenge-sign login, session reuse.
- **Requirements:** R8, R9, AE3 (UI half)
- **Dependencies:** U7
- **Files:** `web/src/identity/enbox.ts`, `web/src/identity/session.ts`, `web/src/components/AccountButton.tsx`
- **Approach:** `DidDht.create()` with ~5s timeout, fallback `DidJwk.create()` (KTD-7); `did.export()` persisted to localStorage; restore via `DidDht.import`/`DidJwk.import` by DID prefix. Login: challenge → `getSigner().sign(nonce)` → verify → token stored. Reference the enbox API shapes in Sources / Research. Logged-out state keeps all reads; write UI hidden or disabled with a one-line explainer (AE3's UI half).
- **Test scenarios:**
  - Happy: click → identity exists, session active, handle editable.
  - Edge: reload restores identity and session without re-creation.
  - Error: did:dht gateway unreachable → did:jwk fallback still yields a working account.
- **Verification:** Manual + unit: identity module round-trips export/import; login flow completes against the real backend.

### U9. Live feed dashboard + event detail pane

- **Goal:** Dark-mode feed streaming new events, with a detail pane combining AI take and matched labels.
- **Requirements:** R19, R13, R6, AE5, AE6 (UI marker)
- **Dependencies:** U7
- **Files:** `web/src/pages/FeedPage.tsx`, `web/src/components/FeedItem.tsx`, `web/src/components/EventDetail.tsx`, `web/src/components/AiCard.tsx`, `web/src/components/LabelBadge.tsx`, `web/src/components/DemoBadge.tsx`
- **Approach:** Feed merges initial `GET /api/events` with SSE `event:new`/`event:update`. AI card shows summary/tag with a machine-generated marker and confirm/refute buttons (authenticated). Demo events carry an unmistakable badge (AE6). `aiStatus: 'failed'` renders "analysis pending" per AE5.
- **Test scenarios:**
  - Happy: SSE `event:new` prepends to feed without reload; `event:update` patches in place.
  - Edge: 50-item feed cap drops oldest without flicker.
  - Covers AE5, AE6 rendering states.
- **Verification:** Against fixtures + a live backend, the feed updates in real time; all AI states render distinctly.

### U10. Address page + labels + votes

- **Goal:** Address view with balance, labels, recent events; label submission and vote controls.
- **Requirements:** R11, R12, R4, AE4
- **Dependencies:** U8, U9
- **Files:** `web/src/pages/AddressPage.tsx`, `web/src/components/LabelForm.tsx`, `web/src/components/VoteButton.tsx`, `web/src/components/LabelList.tsx`
- **Approach:** Label form (tag, note, evidence URL) posts and optimistically inserts. VoteButton reflects `myVote` and applies toggle/flip client-side per R12. Deep transaction exploration links out to `externalUrl` (mempool.space) per scope boundaries.
- **Test scenarios:**
  - Happy: submit label → appears with score 0; vote → score and `myVote` update.
  - Edge: re-clicking the same vote removes it; clicking the opposite flips it. Covers AE4's UI half.
  - Error: unauthenticated submit prompts account creation instead of failing silently.
- **Verification:** Label and vote round-trips work against the live backend; AE4 behaviors confirmed in UI.

### U11. Leaderboard, trending, demo polish, README

- **Goal:** Reputation leaderboard, trending labels, final demo pass, README updated to Bitcoin scope.
- **Requirements:** R10, R14, R20
- **Dependencies:** U9
- **Files:** `web/src/pages/LeaderboardPage.tsx`, `web/src/components/TrendingLabels.tsx`, `web/src/components/ReputationBadge.tsx`, `README.md`
- **Approach:** Leaderboard table (handle/did, reputation, labels, net votes). Trending strip on the feed page. Demo polish: inject button visible only when the backend reports `INJECTOR_ENABLED`. README rewritten to the Bitcoin architecture with the sponsor framing preserved.
- **Test scenarios:**
  - Happy: leaderboard ordering matches reputation after seeded votes.
  - Edge: empty leaderboard renders a friendly zero-state.
- **Verification:** Demo script in Definition of Done runs end-to-end; README matches the built system.

---

## Verification Contract

- Backend: `bun test` from `server/` covers store, rules, pipeline, AI, auth, and API integration suites.
- Frontend: `npm run build` plus `tsc --noEmit` from `web/` must pass; component-level tests where units specify them.
- Contract conformance: every endpoint in the API Contract table has at least one test asserting response shape against `shared` types.
- Integration gate: with the backend running against the real node and `INJECTOR_ENABLED=true`, `POST /api/dev/inject` produces a visible demo event in the UI within one poll interval, and a crowd label added in the UI appears on the event detail without refresh.
- No unit is complete on green tests alone — each unit's Verification line must hold.

---

## Definition of Done

**Global**

- The demo script runs end-to-end in under 5 minutes: live or injected event surfaces → AI take visible → account created in one click → label submitted → vote cast → reputation ticks on the leaderboard → trending view reflects it.
- All Verification Contract gates pass.
- The app runs from a clean checkout with only env config: node RPC credentials, optional AI key.
- README.md describes the Bitcoin system as built, with the QuickNode/OKX.AI production framing.
- Cleanup: abandoned-attempt code, dead fixtures, and unused dependencies are removed, not left in the diff.

**Per-unit**

- Each unit's own Verification line is satisfied; feature-bearing units have their test scenarios implemented and passing.
