---
title: ChainWatch Backend - Execution Brief
type: feat
date: 2026-08-06
topic: chainwatch-backend
---

# ChainWatch Backend - Execution Brief

Companion to `docs/plans/2026-08-06-001-feat-chainwatch-mvp-plan.md` (canonical: requirements, KTDs, API contract, test scenarios). This brief is the backend agent's working doc: it owns units **U2, U3, U4, U5, U6**, plus the `server/` half of U1.

## Scope

Build the `server/` workspace: Bun + Hono + better-sqlite3 (KTD-2). One process runs the ingest pipeline and the HTTP/SSE API together.

## Configuration (env)

Real values live only in an untracked `.env`; the committed `.env.example` (U1) documents every variable below with placeholders.

| Var | Default | Purpose |
|---|---|---|
| `BITCOIND_RPC_URL` | `http://127.0.0.1:8332` | node RPC endpoint |
| `BITCOIND_RPC_USER` / `BITCOIND_RPC_PASSWORD` | — | RPC credentials |
| `POLL_INTERVAL_MS` | `5000` | mempool diff cadence (KTD-4) |
| `WHALE_THRESHOLD_BTC` | `10` | whale rule threshold |
| `DORMANT_BLOCKS` | `4320` | dormant window (~30 days) |
| `DORMANT_MIN_VALUE_BTC` | `1` | value gate for dormant checks (KTD-5) |
| `COINJOIN_MIN_EQUAL_OUTPUTS` | `5` | coinjoin heuristic |
| `MEMPOOL_API` | `https://mempool.space/api` | address lookups, primary |
| `BLOCKSTREAM_API` | `https://blockstream.info/api` | address lookups, fallback |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | unset | unset → mock provider (KTD-6) |
| `INJECTOR_ENABLED` | `false` | enables `POST /api/dev/inject` |
| `PORT` | `3001` | HTTP listen port |
| `SEED_FILE` | `server/fixtures/seed-labels.json` | TagPacks subset (KTD-8) |

## File layout

```text
server/
  package.json  tsconfig.json
  fixtures/seed-labels.json        # curated GraphSense TagPacks subset
  src/
    index.ts                       # entry: starts pipeline + Hono app
    config.ts                      # env parsing
    rpc/client.ts                  # getrawmempool / getrawtransaction / getblock / getblockhash
    external/addressinfo.ts        # mempool.space + blockstream fallback + 5-min cache
    detect/rules.ts                # pure rule functions
    detect/pipeline.ts             # poll→diff→fetch→rules→persist→emit; eviction sweep
    ai/provider.ts                 # summarizeEvent: OpenAI-compatible client + mock
    store/db.ts  store/schema.sql  store/seed.ts
    identity/verify.ts             # UniversalResolver + Ed25519 verify
    api/auth.ts  api/routes.ts  api/sse.ts  api/inject.ts
  test/                            # store, rules, pipeline, ai, auth, api
```

## Build order

1. **U2** store + seed. Then immediately smoke-test node RPC connectivity: `getblockchaininfo`, plus one real `getrawtransaction` with verbosity=2 on a live mempool tx asserting `vin[].prevout` fields are present (requires Bitcoin Core v24+; txindex alone does not enrich inputs). Report to the user immediately if either fails — this is the plan's biggest external dependency.
2. **U3** ingest + detection; **U4** AI provider can proceed in parallel with U3 (both feed U6).
3. **U5** auth (fully testable offline via did:jwk round-trips).
4. **U6** routes + SSE + injector, wiring U2–U5 together.

## Implementation notes

- **Schema** (`schema.sql`): `identities(did PK, handle, reputation, created_at)`; `challenges(nonce PK, expires_at)`; `sessions(token PK, did FK, expires_at)`; `events(id PK, txid UNIQUE, detected_at, rules JSON, value_sats, inputs JSON, outputs JSON, ai_status, ai_summary, ai_tag, source, status)` — event inserts use `INSERT OR IGNORE` so re-seen transactions never duplicate; `labels(id PK, address, tag, note, evidence_url, author_did NULL=seed, source, created_at)`; `votes(label_id, voter_did, value, UNIQUE(label_id, voter_did))`; `ai_feedback(event_id, voter_did, value, UNIQUE(event_id, voter_did))`.
- **Seed curation:** fetch TagPack YAMLs from `github.com/graphsense/graphsense-tagpacks` (exchanges/services/pools packs), convert to `seed-labels.json` entries `{ address, tag, evidenceUrl }`, cap ~100–300 well-known entries. Commit the JSON; never fetch at runtime.
- **Normalized tx shape** for rules: `{ txid, inputs: [{address, valueSats}], outputs: [{address, valueSats}], totalOutputSats }`. Verbose `getrawtransaction` provides `vin[].prevout` (requires txindex) and `vout[].scriptPubKey.address`.
- **Dormant check:** for txs ≥ `DORMANT_MIN_VALUE_BTC`, take top input addresses by value and query `GET /address/:addr/txs` on mempool.space. Semantics: exclude the in-flight transaction from the history; among prior entries find the newest transaction whose vin spends **from** the address; if one exists, the rule hits when it is older than `DORMANT_BLOCKS`; if no prior spend exists, hit only when the address's oldest known activity is older than `DORMANT_BLOCKS` (a genuinely new address does not count as dormant). Cache every address response 5 minutes; on rate-limit (429) fall back to blockstream.info, then skip the check for that poll cycle and log a warning — full internet loss silently disables dormant checks otherwise.
- **Eviction sweep:** each poll, for events with `status='active'`: if txid still in mempool → nothing; else try `getrawtransaction` (txindex) — if it returns a blockhash → `confirmed`, else → `evicted`; broadcast `event:update` either way.
- **AI:** `summarizeEvent(eventContext) → { summary, tag }`; tag from fixed list (`whale-move`, `dormant-wake`, `coinjoin`, `exchange-flow`, `unknown`). 10s timeout; any failure → `ai_status='failed'` and broadcast anyway (AE5).
- **Auth verify:** resolve DID with `UniversalResolver({ didResolvers: [DidDht, DidJwk] })`; find `verificationMethod` by `keyId`; `EdDsaAlgorithm.verify({ key: vm.publicKeyJwk, signature, data: nonce })`. On first successful verify, persist the resolved DID document keyed by DID; when gateway resolution later fails, fall back to the cached document so did:dht logins survive venue internet loss (KTD-7). See the plan's Sources / Research for enbox file pointers. did:dht resolution needs gateway access; did:jwk is offline.
- **Votes:** upsert on `(label_id, voter_did)`; same value deletes the row, opposite value updates it (R12/AE4). Self-vote → 422. Recompute label `score` and author's `reputation` in the same transaction (KTD-9). Seed labels (`author_did` NULL) accept votes but grant no reputation.
- **SSE:** one hub, replay nothing; clients fetch `GET /api/events` for history. Broadcast `event:new`, `event:update`, `label:new` per the contract, plus a `health` message (`{ lastPollAt }`) after each successful node poll so the UI can detect a stale node connection.
- **Injector:** builds a synthetic normalized tx (fake txid, configured value/rule, optional address), persists with `source='demo'` and `'demo'` in `rules`, then runs the identical persist→broadcast→AI path (AE6). The route 404s unless `INJECTOR_ENABLED=true`, and when enabled it rejects non-loopback callers; `GET` on the same path returns 200/404 as the frontend's availability probe.
- **Label validation:** reject tag outside 2–32 chars, note over 280 chars, or evidenceUrl that isn't an absolute http(s) URL, with 400.

## Done when

- `bun test` green across `server/test/`.
- Every endpoint in the plan's API Contract table has a shape assertion against `shared` types.
- Against the real node: injected event appears on `/api/stream` within one poll interval; a real whale/dormant/coinjoin tx seen in logs when one occurs.
- did:jwk auth round-trip passes with network disabled.
