# CoinWatch: Crowdsourced Bitcoin Chain Analysis

---

### Overview
CoinWatch is a real-time, community-validated layer for **Bitcoin** transaction forensics. Our own full node (txindex-enabled) streams mempool and block data; detection rules surface high-signal events — whale moves, dormant-wallet wakes, and coinjoin rounds (Wasabi/Whirlpool classification included); an AI first pass summarizes each event; and the crowd attaches labels to addresses that flow back into event context. Scattered Discord alpha becomes structured, reusable, Bitcoin-native intelligence.

---

### The Problem
Bitcoin chain analysis is either **prohibitively expensive** (Chainalysis, Arkham enterprise tiers) or **unstructured** (Twitter threads, Discord DMs). Label knowledge lives in closed databases. Retail users, small funds, and security researchers lack a middle ground: a place to see *why* a Bitcoin transaction matters, who validated that insight, and how reliable the source is.

---

### The Solution
A lightweight feed where:
1. **Our own Bitcoin node streams transactions** (mempool polling + blocks) through detection rules: whale transfers, dormant-wallet wakes, coinjoin rounds with implementation classification.
2. **An AI provider generates a first-pass summary and risk tag** per event (pluggable, OpenAI-compatible; mock fallback).
3. **The crowd annotates addresses** with tags, notes, and evidence links — and votes on accuracy.
4. **Reputation accrues to accurate analysts** via one-click enbox DID identities (no wallet connect, no password), producing a meritocratic leaderboard.

---

### What's Built

| Feature | Description |
|---|---|
| **Live event feed** | Node RPC polling with baseline snapshot + txid dedup; events broadcast over SSE; eviction sweep marks `confirmed`/`evicted` with block info. |
| **Detection rules** | Whale (≥ threshold), dormant-wake (value-gated, address-history backed), coinjoin (equal-output heuristic). |
| **Coinjoin forensics** | Wasabi/Whirlpool/generic classification, participant + denomination metadata, automatic round-chain batching, dedicated index endpoint. |
| **Batches** | Related-tx groups with per-tx block info and link reasons — auto-built coinjoin chains plus curated traces (e.g., the 109,735 BTC Binance cold-storage consolidation). |
| **Crowd labels + reputation** | Address labels with evidence URLs, one-vote toggle per identity, transactional reputation recompute, leaderboard + trending. |
| **Entities** | 280 seeded labels from GraphSense TagPacks (exchanges, pools, services) rolled up by tag; address pages resolve history via mempool.space with blockstream fallback. |
| **AI first pass** | Pluggable OpenAI-compatible provider; deterministic mock when unconfigured; broadcast-then-patch over SSE. |
| **Enbox identity** | One-click in-page DID creation (`did:dht` with `did:jwk` fallback); challenge-sign login; server-cached DID documents for offline resilience. |

### Architecture

```
Bitcoin node RPC ──► detection pipeline ──► SQLite ──► REST + SSE API ──► frontend
mempool.space ─────► address lookups              ▲
AI provider ───────► first-pass summaries          │ labels / votes / signed challenges
                                              crowd via enbox DIDs
```

Stack: Bun + Hono + SQLite (bun:sqlite), `@enbox/dids` for identity, Vite + React frontend (separate workspace). Sponsor framing: production deployment stands up on QuickNode Bitcoin endpoints with OKX.AI as the analysis provider.

---

### Running

See **docs/development.md** for the live demo tunnel URL and local run instructions. **docs/api.md** is the frontend integration guide (every endpoint, shapes, auth flow, SSE catalog).

```bash
bun install
cd server && bun test        # 114 tests
PORT=3100 INJECTOR_ENABLED=true bun run src/index.ts
```

---

### Demo Script
1. **Hook:** Land on the dashboard — a 3,000 BTC sweep from an OKX reserves wallet just hit the feed, AI-flagged, with the "okx reserves wallets" label inline.
2. **Crowd layer:** An analyst tags the destination address; votes tick their reputation up on the leaderboard.
3. **Forensics:** Open the coinjoin index — three Wasabi rounds chained into one batch, traced txid by txid with block info.
4. **Insight:** Filter by entity to see every seeded exchange wallet and the events touching them.

**Bottom line:** CoinWatch isn't just a dashboard. It's crowdsourced Bitcoin forensics — our node sees the chain, AI interprets it, and the crowd validates it.
