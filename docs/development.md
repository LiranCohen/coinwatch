# ChainWatch — Running the Backend

## Live demo backend

**Base URL: https://camp-prophet-duties-fairly.trycloudflare.com**

A Cloudflare quick tunnel exposing the backend on this machine. Frontend apps can point straight at it — CORS is wide open (`Access-Control-Allow-Origin: *`, `Authorization` and `Content-Type` headers allowed).

Try it:

```bash
curl https://camp-prophet-duties-fairly.trycloudflare.com/api/events
curl https://camp-prophet-duties-fairly.trycloudflare.com/api/entities
curl -N https://camp-prophet-duties-fairly.trycloudflare.com/api/stream   # SSE live feed
```

Caveats:

- Quick-tunnel URLs are **ephemeral** — a new random `*.trycloudflare.com` URL is minted every time cloudflared restarts. Update this doc when it changes. For a stable URL, use a named tunnel (`cloudflared tunnel create`) with a free Cloudflare account.
- The demo injector (`POST /api/dev/inject`) is loopback-only — it can only be fired on the host machine, never through the tunnel.
- Writes (labels, votes, auth) work through the tunnel; unauthenticated reads are open to anyone with the URL.

## Local run

```bash
bun install
cd server
cp ../.env.example .env   # fill in BITCOIND_RPC_USER / BITCOIND_RPC_PASSWORD for live chain data
PORT=3100 INJECTOR_ENABLED=true bun run src/index.ts
```

Port note: this machine already has an unrelated service on 3001, so the demo instance runs on **3100** (`PORT` env). Without RPC credentials the server still runs — seed labels, entities, batches, auth, and the injector all work; the poll loop logs `rpc … 401` retries until credentials are provided.

## Tunnel run

```bash
setsid cloudflared tunnel --url http://127.0.0.1:3100 --no-autoupdate &
# grab the URL from the log output ("https://<random>.trycloudflare.com")
```

Current processes: server log at `/tmp/chainwatch-server.log`, tunnel log at `/tmp/chainwatch-tunnel.log`.
