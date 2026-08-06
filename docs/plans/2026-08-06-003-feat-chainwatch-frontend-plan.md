---
title: ChainWatch Frontend - Execution Brief
type: feat
date: 2026-08-06
topic: chainwatch-frontend
---

# ChainWatch Frontend - Execution Brief

Companion to `docs/plans/2026-08-06-001-feat-chainwatch-mvp-plan.md` (canonical: requirements, KTDs, API contract, test scenarios). This brief is the frontend agent's working doc: it owns units **U7, U8, U9, U10, U11**, plus the `web/` half of U1.

## Scope

Build the `web/` workspace: Vite + React + TypeScript + Tailwind (KTD-3). Dark-mode dashboard. No state library, no query library — plain fetch hooks plus one `EventSource` hook.

## Configuration (env)

| Var | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3001` | backend base URL |
| `VITE_USE_FIXTURES` | `false` | serve all reads from `web/fixtures/` (R16) |

## File layout

```text
web/
  package.json  tsconfig.json  vite.config.ts  index.html
  fixtures/                      # one example response per contract endpoint
    events.json  event-detail.json  address.json  leaderboard.json  trending.json
  src/
    main.tsx  App.tsx  index.css
    api/client.ts                # typed fetch for every endpoint; fixtures toggle
    api/sse.ts                   # EventSource hook with backoff reconnect
    identity/enbox.ts            # DID create/import/export, signer
    identity/session.ts          # token storage, login/logout
    pages/FeedPage.tsx  AddressPage.tsx  LeaderboardPage.tsx
    components/
      AccountButton.tsx  FeedItem.tsx  EventDetail.tsx  AiCard.tsx
      LabelBadge.tsx  LabelList.tsx  LabelForm.tsx  VoteButton.tsx
      ReputationBadge.tsx  TrendingLabels.tsx  DemoBadge.tsx
```

## Build order

1. **U7** scaffold + client + fixtures mode — the whole UI is buildable against fixtures before the backend exists.
2. **U8** identity (validate DID creation in a real browser first — see pitfall below) and **U9** feed + detail pane can run in parallel.
3. **U10** address page + labels + votes. **U11** leaderboard + polish + README last.

## Implementation notes

- **Fixtures mode:** when `VITE_USE_FIXTURES=true`, `api/client.ts` returns fixture JSON matching the contract types exactly, and `api/sse.ts` replays fixture events on a timer. This is the R16 mechanism that lets this lane finish without the backend.
- **Identity (`identity/enbox.ts`):** use `@enbox/dids` only.
  - Create: `DidDht.create()` with a ~5s timeout; on failure `DidJwk.create()` (KTD-7).
  - Persist: `did.export()` → localStorage key `chainwatch:identity`; restore via `DidDht.import({ portableDid })` or `DidJwk.import(...)` chosen by the DID prefix.
  - Login: `POST /api/auth/challenge` → `signer = await did.getSigner()` → sign the UTF-8 nonce → `POST /api/auth/verify { did, keyId: signer.keyId, nonce, signature: base64url(sig), handle? }` → store bearer token.
  - Pitfall: `DidDht.create()` publishes to the enbox gateway by default — that network call is expected; the did:jwk fallback covers offline/venue failure. Verify the happy path in a real browser before building login UI on top of it.
- **Feed:** initial `GET /api/events` then merge SSE: `event:new` prepends, `event:update` patches by id, `label:new` refreshes affected visible events lazily. Cap the list at 50.
- **AI states:** `aiStatus: 'pending'|'failed'` renders an "analysis pending" card (AE5); `'done'` renders summary + tag with a "machine-generated" marker and confirm/refute buttons (authenticated only).
- **Demo marker:** any event with `source: 'demo'` or `'demo'` in `rules` gets an unmistakable badge (AE6). The inject button shows only after a successful OPTIONS/probe of `/api/dev/inject` (404 = hidden).
- **Votes:** `VoteButton` mirrors `myVote`; clicking the active vote removes it, clicking the other flips it (R12/AE4). Unauthenticated clicks route to the account-creation prompt (AE3 UI half).
- **Address page:** balance/txCount from `AddressInfo`; deep history links out to `externalUrl` (mempool.space) — do not build explorer pages.
- **Leaderboard:** table of handle-or-truncated-did, reputation, label count, net votes; friendly zero-state.

## Done when

- `npm run build` + `tsc --noEmit` pass in `web/`.
- Fixtures mode renders every page with zero network.
- Against the live backend: one-click account → login → label → vote → leaderboard tick, all without refresh; SSE events appear within a poll interval of injection.
