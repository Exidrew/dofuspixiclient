# gameserver-ts

Two-process TypeScript gameserver targeting zero-downtime deploys.

## Layout

```
gateway (stable)    ◄──UDS──►    core (Nest, restartable)
  Bun.serve + WS                   FightActors, MapTickLoops
  Session registry                 Slices, sagas, domain
  Handoff buffer                   HandoffCoordinator
```

- **gateway** owns WS connections. Never restarts on deploys.
- **core** owns all game logic. Restarts via blue/green state handoff.
- **transport** between them: length-prefixed frames over Unix domain socket.

## Running (dev)

The core runs in one of two modes (`MODE=game` or `MODE=auth`), each listening
on its own Unix socket; the gateway proxies to both.

```bash
bun run dev:gamed     # terminal 1 — MODE=game, watches, /tmp/dofus-gamed.sock
bun run dev:authd     # terminal 2 — MODE=auth, watches, /tmp/dofus-authd.sock
bun run dev:gateway   # terminal 3 — :8080, proxies to both sockets
```

All three read `DATABASE_URL` (required) and `REDIS_URL` (optional). From the
repo root, `just server` starts these three processes for you.

`bun run dev:core` (single core, no modes) is **not** a valid entrypoint: the
env schema requires `MODE`, and `AppModule` selects `AuthModule` vs
`GameModule`/`LangsModule` from it.

Editing a slice in `core/` restarts that core only. Gateway buffers client
messages during the ~hundreds-of-ms gap, then flushes. WS clients never
disconnect.

## Dev account / character seed

A fresh database has no account, no game server and no character, so the first
connection fails at `select-character` with `not found id=… account=…`. The
seed script creates (or repairs) the whole chain expected by the login flow:

```bash
DATABASE_URL=postgres://dofus:dofus@localhost:5432/dofus \
  node tools/seed-dev-account.mjs
# defaults: --username admin --password admin --server-id 1 --character-name Admin
```

It provisions `accounts` → `game_servers` (state ONLINE) → `account_servers`
→ `players` (+ `player_stats`, + `player_colors`, + starter spells when
`class_starter_spells` is seeded). It is idempotent and *repairs* a character
whose `account_id`/`server_id` don't match, or that is soft-deleted — the
classic cause of `success: false` on character selection. Password verification
is disabled in dev, so any password works. `--server-id` must equal the core's
`GAME_SERVER_ID` (default 1).

## Deploy (prod, zero-downtime)

```
1. Start core v2 (standby, binds /tmp/core-v2.sock)
2. Supervisor → gateway: "handoff to v2"
3. Gateway: drain → snapshot v1 → restore v2 → flip → shutdown v1
4. Client-visible stall ≈ 200–400ms on in-flight actions. No disconnects.
```

See `src/core/handoff/handoff.coordinator.ts` for the snapshot/restore flow and
`src/gateway/core-router.ts` for the gateway orchestration.
