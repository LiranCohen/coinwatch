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
chain source ──► detection rules ──► entropy engine ──► SQLite ──► REST + SSE ──► frontend
   │                                                        ▲
   ├─ bitcoind RPC (your own node)                          │ labels / votes / signed challenges
   └─ Esplora explorers (mempool.space, blockstream)    crowd via enbox DIDs
```

Stack: Bun + Hono + SQLite (bun:sqlite), `@enbox/dids` for identity, Vite + React frontend (separate workspace).

**Chain sources.** The pipeline reads through a `ChainSource` interface (`server/src/ingest/source.ts`), so the same detection rules run against either your own node or public Esplora explorers. `CHAIN_SOURCE=auto` (the default) prefers your node and falls back to explorers when it is unreachable, so a misconfigured node degrades to working-with-real-data rather than to silence. A node exposes the whole mempool, so arrivals are found by diffing snapshots; explorers only expose a recent sample, so the pipeline additionally walks confirmed blocks page by page with a resumable cursor.

---

### Transaction entropy

Every detected transaction is scored with a Boltzmann analysis (`server/src/analytics/boltzmann.ts`), the measure LaurentMT developed and OXT / kycp.org were built on.

An *interpretation* is one way of partitioning a transaction's inputs and outputs into matched groups where each group's inputs could have funded its outputs. Counting them yields:

| Metric | Meaning |
| --- | --- |
| **entropy** | `log2(interpretations)` — bits of ambiguity. Zero means the transaction reveals exactly who paid whom. |
| **link probability** | `P(input i funded output j)` across all interpretations. |
| **deterministic links** | Links that hold in *every* interpretation, and are therefore provable from the chain alone. |
| **efficiency** | How much of the entropy achievable for this input/output shape the transaction actually reaches. |

A perfect coinjoin of a given shape is the ceiling, computed in closed form from a one-dimensional recurrence; efficiency is measured against it. Canonical cases are pinned in `server/test/boltzmann.test.ts` (a 2×2 equal-value coinjoin has exactly 3 interpretations, 1.58 bits, and no certain links).

**Numeric mappings.** Counting by enumerating coin subsets is exponential in the number of coins, which puts real coinjoins out of reach — exactly the transactions worth analyzing. Following Kajaba et al., *[Analysis of Input-Output Mappings in Coinjoin Transactions with Arbitrary Values](https://arxiv.org/abs/2510.17284)*, the search instead runs over **value classes**: coins of equal value are interchangeable, so mappings are enumerated only up to a permutation of same-valued coins. Each numeric mapping is then weighted by how many labelled arrangements it stands for, so the counts are identical to coin-level enumeration — only the cost changes.

The effect is large where it matters. An 85-input/85-output equal-value round needs 85 states instead of 2⁸⁵ coin subsets, and resolves in ~10 ms. Backfilling the engine over an existing index turned 181 previously-undecidable transactions into exact analyses. Cost now tracks *distinct values* rather than coin count, so a 40-input join drawn from four denominations is cheap while a 20-input transaction of all-distinct amounts is not — the opposite of what a coin-count limit assumes.

Bounds are on reachable states and search steps rather than transaction size. When the engine cannot finish it says so; it never publishes a guessed entropy.

Also implemented from that paper: **p(I, o)** — for each output, the strongest link probability to any single input. It is the conservative read of how well an output is mixed, and it is what the bar under each column of the mapping matrix shows.

**Detection honesty.** Equal outputs alone do not make a coinjoin — exchange payout batches and inscription sprays look identical by that test. A transaction is classified as a coinjoin only if it also carries enough separate inputs to plausibly represent the participants claiming those equal outputs, at a denomination worth mixing (`COINJOIN_MIN_DENOMINATION_BTC`). On live mainnet blocks this is the difference between 16 dust false positives and 3 genuine Wasabi rounds.

**Demo data is opt-in.** `DEMO_SEED=false` by default: a real deployment shows real chain activity, not invented history. The curated GraphSense TagPacks address labels always load — those are real reference data.

---

### Running

See **docs/development.md** for the live demo tunnel URL and local run instructions. **docs/api.md** is the frontend integration guide (every endpoint, shapes, auth flow, SSE catalog).

```bash
bun install
cd server && bun test        # 159 tests
# no node required: reads real chain data from public explorers
CHAIN_SOURCE=esplora PORT=3100 bun run src/index.ts
```

---

### Demo Script
1. **Hook:** Land on the dashboard — a 3,000 BTC sweep from an OKX reserves wallet just hit the feed, AI-flagged, with the "okx reserves wallets" label inline.
2. **Crowd layer:** An analyst tags the destination address; votes tick their reputation up on the leaderboard.
3. **Forensics:** Open the coinjoin index — three Wasabi rounds chained into one batch, traced txid by txid with block info.
4. **Insight:** Filter by entity to see every seeded exchange wallet and the events touching them.

**Bottom line:** CoinWatch isn't just a dashboard. It's crowdsourced Bitcoin forensics — our node sees the chain, AI interprets it, and the crowd validates it.
