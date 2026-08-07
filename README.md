# CoinWatch: Crowdsourced On-Chain Intelligence

Real-time, community-validated Bitcoin transaction analysis. Your own node streams the mempool; detection rules surface high-signal events; a pluggable AI gives each event a first-pass summary; the crowd attaches labels to addresses, with reputation accruing to accurate analysts.

> Hackathon MVP. Production pitch: the same architecture on QuickNode endpoints + OKX.AI as the AI provider.

---

## What it does

- **Live event feed.** Polls your Bitcoin node's mempool (5s cadence), diffs snapshots, and surfaces whale transfers (≥ 10 BTC, configurable), dormant-wallet wakes (input quiet ≥ ~30 days, value-gated at 1 BTC), and coinjoin-pattern transactions (≥ 5 equal outputs).
- **AI first pass.** Every event gets a 1–2 sentence summary + risk/behavior tag from an OpenAI-compatible provider (OKX.AI-compatible pitch). Unconfigured or failed → the event still appears, marked "analysis pending."
- **Crowd labels.** Authenticated analysts attach tag/note/evidence labels to any address; labels on involved addresses appear inline in event context. One up/down vote per identity, toggle semantics.
- **One-click identity.** In-page enbox DID creation (`did:dht`, offline fallback `did:jwk`), no password or wallet. Login is a signed server challenge. Reputation leaderboard + trending labels.
- **Demo injector.** A dev-only, loopback-only endpoint fires a synthetic, unmistakably badged DEMO event through the identical pipeline, so the demo never stalls on a quiet mempool.

## Architecture

```
Bitcoin node RPC ──► server/ ingest + detection ──► SQLite
                            │                          │
mempool.space/blockstream ──┘ (address lookups)        ▼
                            └──► AI provider ──► SSE ──► web/ dashboard
```

- `server/`: Bun + Hono + better-sqlite3. One process runs the ingest pipeline, REST API, SSE hub, and dev injector. _(Built by the backend lane; see `docs/plans/2026-08-06-002-feat-chainwatch-backend-plan.md`.)_
- `web/`: Vite + React + TypeScript + Tailwind. Dark-mode dashboard: feed + detail pane, address pages, leaderboard.
- `shared/`: the API contract types both lanes compile against. The contract is fixed in `docs/plans/2026-08-06-001-feat-chainwatch-mvp-plan.md`.

## Quickstart

```bash
npm install
cp .env.example .env   # fill in node RPC credentials; AI key optional
```

Frontend only, zero backend, fully clickable demo data:

```bash
cd web && VITE_USE_FIXTURES=true npm run dev
```

Full stack (once the backend lane lands):

```bash
# terminal 1
cd server && bun run dev
# terminal 2
cd web && npm run dev   # proxies /api to localhost:3001
```

Demo rehearsal: set `INJECTOR_ENABLED=true` in `.env`; an "Inject demo event" button appears in the UI when the probe returns 200.

## The pitch

On-chain intelligence is either prohibitively expensive (Chainalysis, Nansen) or unstructured (Discord alpha). CoinWatch is the middle ground: see the chain from your own node, get an AI first take, and let a reputation-weighted crowd annotate it. Production stands up on QuickNode (free tier: 10M credits, 15 req/s) and OKX.AI.

## Scope honesty

Bitcoin-only for the MVP (the original EVM framing is superseded). Labels and votes are naive counters; anti-sybil and moderation are explicitly deferred. AI output is always marked machine-generated; the crowd can confirm or refute it, and both signals stay visible.
