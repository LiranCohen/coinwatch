**CoinWatch: Crowdsourced On-Chain Intelligence**

---

### Overview
CoinWatch is a real-time, community-validated layer for blockchain transaction analysis. We combine QuickNode’s low-latency infrastructure with OKX.AI’s pattern recognition to surface high-signal on-chain events, then let the community annotate, verify, and rank them—turning scattered Discord alpha into structured, reusable intelligence.

---

### The Problem
On-chain analysis is either **prohibitively expensive** (Nansen, Arkham enterprise tiers) or **unstructured** (Twitter threads, Discord DMs). Retail users, small funds, and security researchers lack a middle ground: a place to see *why* a transaction matters, who validated that insight, and how reliable the source is. Existing tools are read-only black boxes.

---

### The Solution
A lightweight feed where:
1. **QuickNode streams real-time transactions** (mempool + confirmed) for high-signal wallets or contract categories.
2. **OKX.AI generates an initial risk/behavior summary** for each transaction.
3. **The crowd annotates, confirms, or refutes** the AI’s take via upvotes, tags, and threaded comments.
4. **Reputation accrues to accurate analysts**, creating a meritocratic layer of human validation on top of machine inference.

---

### MVP Features (4-Hour Build)

| Feature | Description | Sponsor Tie-In |
|---|---|---|
| **Live Transaction Feed** | Stream Base/Ethereum txs via QuickNode Streams/Filter API, filtered by high-value thresholds or known contract interactions. | QuickNode provides the RPC + webhook infra we’d otherwise spend weeks configuring. |
| **AI-Generated First Pass** | Every surfaced tx gets an instant natural-language summary and risk flag from OKX.AI. | OKX.AI handles the LLM heavy lifting; we focus on UX, not model hosting. |
| **Crowdsourced Annotation** | Users add tags (e.g., “accumulating,” “exploit,” “OTC”), vote on accuracy, and reply with context. | Pure frontend + DB; no external dependency. |
| **Analyst Reputation Score** | Simple karma system: correct predictions (validated by community consensus) increase weight. | Startup moat: reputation data becomes the asset. |
| **Demo Dashboard** | Clean, dark-mode UI showing the feed, a detail pane with AI + human insights, and a live “Trending Wallets” leaderboard. | Cursor helps us ship the UI fast. |

---

### Technical Architecture (Hackathon Night)

```
Frontend (Next.js + Tailwind)
    │
    ├── QuickNode Streams API ──► Real-time tx feed
    │   └── Filter: >$10k transfers, new contract deployments,
    │       or interactions with flagged addresses
    │
    ├── OKX.AI API ──► Per-tx summary + risk score
    │
    └── Supabase (or local SQLite for demo)
        └── Annotations, votes, user reputation
```

**Why this stack wins in 4 hours:**
- QuickNode’s Filter API means we don’t index the chain ourselves.
- OKX.AI gives us “AI features” without managing prompts or GPUs.
- Next.js API routes act as a thin caching/aggregation layer.

---

### User Flow (Demo Script)
1. **Hook:** Land on dashboard. A $2.3M USDC transfer just hit the feed, auto-flagged by OKX.AI as “Unusual: dormant wallet activated after 400 days.”
2. **Crowd Layer:** Top comment from user “0xAnon” says “This is the Wintermute hot wallet rebalance—false alarm.” 14 upvotes. AI flag overridden.
3. **Reputation:** 0xAnon’s score ticks up. They’ve correctly tagged 12 of the last 15 high-value txs.
4. **Insight:** Viewer filters by “Accumulation” tags and sees three fresh wallets funded from the same source, annotated 6 minutes ago.

**Bottom Line:** CoinWatch isn’t just a dashboard. It’s a *protocol for trust*—using QuickNode to see the chain, OKX.AI to interpret it, and the crowd to validate it. Four hours gets us a feed. The model gets us a company.
