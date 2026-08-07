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
| `VITE_USE_FIXTURES` | `false` | serve all reads from `web/fixtures/` (R16) |

The client calls relative `/api` paths through the Vite dev proxy — no absolute base URL in dev, so no CORS. An absolute base URL is only needed if the app is ever served separately from the proxy, and then the backend must enable CORS with the `Authorization` header allowed.

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
    pages/FeedPage.tsx  AddressPage.tsx  LeaderboardPage.tsx  GraphPage.tsx
    components/
      AccountButton.tsx  FeedItem.tsx  EventDetail.tsx  AiCard.tsx
      LabelBadge.tsx  LabelList.tsx  LabelForm.tsx  VoteButton.tsx
      ReputationBadge.tsx  TrendingLabels.tsx  DemoBadge.tsx
      TxGraph.tsx  GraphNode.tsx
```

## Build order

1. **U7** scaffold + client + fixtures mode — the whole UI is buildable against fixtures before the backend exists.
2. **U8** identity (validate DID creation in a real browser first — see pitfall below) and **U9** feed + detail pane can run in parallel.
3. **U10** address page + labels + votes, then the graph/trace view (it reuses the event-detail and address endpoints). **U11** leaderboard + polish + README last.

## Implementation notes

- **Fixtures mode:** when `VITE_USE_FIXTURES=true`, `api/client.ts` returns fixture JSON matching the contract types exactly, and `api/sse.ts` replays fixture events on a timer. This is the R16 mechanism that lets this lane finish without the backend.
- **Identity (`identity/enbox.ts`):** use `@enbox/dids` only.
  - Create: `DidDht.create()` with a ~5s timeout; on failure `DidJwk.create()` (KTD-7).
  - Persist: `did.export()` → localStorage key `chainwatch:identity`; restore via `DidDht.import({ portableDid })` or `DidJwk.import(...)` chosen by the DID prefix.
  - Login: `POST /api/auth/challenge` → `signer = await did.getSigner()` → sign the UTF-8 nonce → `POST /api/auth/verify { did, keyId: signer.keyId, nonce, signature: base64url(sig), handle? }` → store bearer token.
  - Pitfall: `DidDht.create()` publishes to the enbox gateway by default — that network call is expected; the did:jwk fallback covers offline/venue failure. Verify the happy path in a real browser before building login UI on top of it.
- **Feed:** initial `GET /api/events` then merge SSE: `event:new` prepends, `event:update` patches by id — and when the update is for the currently open event, refetch `GET /api/events/:id` so the detail pane picks up `aiSummary` and the full label list — and `label:new` refreshes affected visible events lazily. Cap the list at 50.
- **Specified states:** initial load shows a skeleton; empty feed renders "Listening to your node — no matching events yet" with the active detection thresholds and a pointer to the injector when enabled; a header pill shows connection status (live / reconnecting / offline) from the SSE hook; a "node connection stale" banner appears when `health` messages stop.
- **Event status rendering:** `active` pulses subtly, `confirmed` shows a check badge, `evicted` renders dimmed — updates arrive via `event:update`.
- **Demo-legibility direction:** BTC value is the largest element per card; distinct accent colors per rule (whale / dormant-wake / coinjoin / demo); tabular-numeral monospace for figures; type sizes verified on a projector or large display during U11.
- **AI states:** `aiStatus: 'pending'|'failed'` renders an "analysis pending" card (AE5); `'done'` renders summary + tag with a "machine-generated" marker and confirm/refute buttons (authenticated only).
- **Demo marker:** any event with `source: 'demo'` or `'demo'` in `rules` gets an unmistakable badge (AE6). The inject button shows only when `GET /api/dev/inject` returns 200.
- **Votes:** `VoteButton` mirrors `myVote`; clicking the active vote removes it, clicking the other flips it (R12/AE4). Unauthenticated clicks route to the account-creation prompt (AE3 UI half).
- **Address page:** balance/txCount from `AddressInfo`, rendering "—" with a "lookup unavailable" hint when null; tag and note render as escaped plain text and evidenceUrl only as a scheme-checked http(s) link; deep history links out to `externalUrl` (mempool.space) — do not build explorer pages.
- **Routes:** `/` (feed with detail pane — event detail is pane-only, not a route), `/address/:address`, `/leaderboard`, `/graph/:txid`.
- **Leaderboard:** table of handle-or-truncated-did, reputation, label count, net votes; friendly zero-state.
- **Graph view (`/graph/:txid`):** a traceable transaction graph, entered from a "Trace" button in `EventDetail` and from each row of the address page's `recentEvents`.
  - Data: hop 0 is the event's own `EventDetail.inputs`/`outputs` (no extra endpoint). Clicking an address node expands one more hop lazily: `GET /api/addresses/:address` → `recentEvents` → `GET /api/events/:id` per event. Cap at 2 hops and ~100 nodes; render a "depth limit reached" hint on truncated nodes.
  - Rendering: hand-rolled SVG with a deterministic layered layout (inputs left → tx center → outputs right) — no graph library, consistent with the no-extra-dependencies stance. Pan/zoom via a `viewBox` transform. Node area ∝ value; edges carry the sats amount in tabular-numeral monospace; tx nodes take the rule accent color; addresses with labels get a distinct ring plus `LabelBadge`; the currently focused txid is highlighted.
  - Interaction: clicking a tx node re-centers the graph on that txid (updates the route); clicking an address offers expand-in-place or navigate to `/address/:address`. Unknown/null-address outputs (OP_RETURN, coinbase) render as a muted "script" node.
  - Scope boundary: the graph traces across *detected events* only — anything deeper still links out to mempool.space. This is not a general explorer.
  - Fixtures mode: composed entirely from `event-detail.json` + `address.json`; every expansion reuses the same fixtures so the view is fully exercisable offline.

## Done when

- `npm run build` + `tsc --noEmit` pass in `web/`.
- Fixtures mode renders every page with zero network — including a two-hop graph trace.
- Against the live backend: one-click account → login → label → vote → leaderboard tick, all without refresh; SSE events appear within a poll interval of injection.
