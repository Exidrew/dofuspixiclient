# Dofus Web Client

Browser-based client for Dofus 1.29 built with PixiJS, Vello (WASM), and Bun.

## Architecture

```
TypeScript (game logic) ──> PixiJS (WebGPU renderer)
                                │
Rust/WASM ──> Vello/wgpu ──> GPUTexture (shared with PixiJS)
                                │
Bun server ──> WebSocket ──> PostgreSQL
```

- **PixiJS + WebGPU** — 2D rendering with shared GPU textures from Vello
- **Vello WASM** — Vector `.dofasset` renderer compiled to WebAssembly
- **Electrobun** — Desktop wrapper (optional, also runs in any WebGPU browser)
- **Bun server** — Game server: Hono WebSocket gateway + NestJS core (Kysely/PostgreSQL)
- **Turbo monorepo** — Shared packages for grid math and protocol encoding
- **Shared renderer** — [`vello-dofasset-format`](https://github.com/HetwanDofus/vello-dofasset-format)

## TL;DR — get it running

Three steps. The server (database + game server) runs in Docker; the client
runs on your machine and needs a **WebGPU-capable browser/GPU** (it is *not*
rendered inside Docker).

```bash
# 1. Server: PostgreSQL + migrations + seed (admin account, default server,
#    character, starter map) + game server + WS gateway on :8080
docker compose -f docker-compose.local.yml up -d --build

# 2. Client deps + WASM renderer (needs the sibling vello repo, see below)
bun install
just wasm

# 3. Play: desktop app (WebGPU) — or `just client-hmr` in a WebGPU browser
just client
```

Then log in with:

| Field    | Value   |
|----------|---------|
| Username | `admin` |
| Password | `admin` (any password works — verification is disabled in DEV) |
| Server   | the single default server, already online |

The database is seeded automatically on `docker compose up`: the compose file
runs `tools/seed-dev-account.mjs` (account **admin/admin**, game server id=1
marked ONLINE, character **"Admin"** on map 10300) and `tools/seed-maps-incarnam.mjs`
(the real Incarnam starter map). The map data (geometry, per-cell layers and
background) is **frozen in the repo** at `tools/data/incarnam-maps.json`, so the
seed is self-contained — it needs no external dump. So there is **no empty
server list / no empty character list** on first launch.

## Prerequisites

- [Docker + Docker Compose](https://docs.docker.com/get-docker/) — runs the whole server side (DB, game server, gateway)
- [Bun 1.3+](https://bun.sh/) — packages the client and the seed/migration scripts
- [Rust + wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) — plus a C linker and the `wasm32-unknown-unknown` target (see [Rust/WASM toolchain prerequisites](#rustwasm-toolchain-prerequisites))
- [just](https://github.com/casey/just) (command runner)
- A **WebGPU-capable** GPU/browser: the desktop client needs Vulkan (Linux) / Metal (macOS) / D3D12 (Windows); in a browser, Chrome/Edge 113+ or any Chromium with `chrome://flags/#enable-unsafe-webgpu`
- *(optional, only for a non-Docker server)* [PostgreSQL 15+](https://www.postgresql.org/download/) and [Redis 7+](https://redis.io/download/)

> **Windows note:** the `justfile` recipes use a POSIX shell, so run everything
> below from WSL or Git Bash — not from `cmd.exe`/PowerShell.

## Quick Start

The Vello WASM renderer is **not vendored here**: it lives in the sibling
[`vello-dofasset-format`](https://github.com/HetwanDofus/vello-dofasset-format)
repo (`dofus-vello-custom-format`), which `vite.config.ts` / `tsconfig.json`
and `just wasm` expect next to this project:

```bash
git clone https://github.com/HetwanDofus/vello-dofasset-format.git \
  ../dofus-vello-custom-format
```

If your checkout lives elsewhere, point at it with `VELLO_ROOT`:
`VELLO_ROOT=/path/to/dofus-vello-custom-format just wasm`.

> **Two sibling layouts are supported.** `just wasm` and `VELLO_ROOT` accept
> any folder name, so the repo may be checked out as
> `../vello-dofasset-format` instead of `../dofus-vello-custom-format`.
> `vite.config.ts` / `tsconfig.json`, however, resolve the `vello-wasm` alias
> through the hardcoded `../dofus-vello-custom-format` path, so if you used the
> real repo name, add a symlink next to this project:
>
> ```bash
> ln -s vello-dofasset-format ../dofus-vello-custom-format
> ```

### Rust/WASM toolchain prerequisites

`wasm-pack build` also needs a **C linker** (`cc`) and the
`wasm32-unknown-unknown` Rust target — build scripts are compiled for the host,
so a Rust-only install is not enough. `just wasm` (and therefore `just setup`)
checks this up front and aborts with an actionable message instead of failing
deep into a 10-minute compile:

```bash
# Check manually at any time:
tools/setup/check-vello-build-deps.sh

# Install the toolchain + wasm target + wasm-pack:
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --target wasm32-unknown-unknown
curl -sSfL https://github.com/rustwasm/wasm-pack/releases/latest/download/wasm-pack-$(uname -m)-unknown-linux-musl.tar.gz | tar xz
mv wasm-pack-*/wasm-pack ~/.cargo/bin/
export PATH="$HOME/.cargo/bin:$PATH"
```

On Debian/Ubuntu the linker comes from `build-essential` (`apt install
build-essential`). Note that `just wasm` runs `wasm-pack` from `PATH`: if cargo
was installed via rustup, make sure `~/.cargo/bin` is on the `PATH` of the
shell you run `just` from.

```bash
# 1. Full setup: install deps, create DB (+migrate), build WASM
just setup

# 2. Start the game server. This launches THREE processes (see below):
#    core MODE=game, core MODE=auth, and the WS gateway on :8080.
just server

# 3. In another terminal — start the client
just client
```

`just db` (run by `just setup`) seeds the same dev data as the Docker flow, so
you can log in right away with **`admin` / `admin`** (see
[TL;DR](#tldr--get-it-running)); the default server (id=1) and character
"Admin" are already there.

### What `just server` actually starts

`just server` is **not** just the WebSocket gateway. The gameserver is a
two-process design (`apps/gameserver-ts/README.md`): a stable **gateway** owns
WS connections, and restartable **core** processes own the game logic. The
gateway talks to the cores over Unix domain sockets, so all three must run:

| Process | Socket / port | Started by |
|---------|---------------|------------|
| core `MODE=game` | `/tmp/dofus-gamed.sock` | `just server` (`dev:gamed`) |
| core `MODE=auth` | `/tmp/dofus-authd.sock` | `just server` (`dev:authd`) |
| gateway | `:8080` (HTTP `/health` + WS) | `just server` (`dev:gateway`) |

If you run only the gateway (e.g. `bun run dev:gateway` by hand), it starts and
answers `/health`, but it keeps logging `uds connect failed, retrying` and the
client connects, sees the server list, yet can never log in — that is the usual
"it starts but nothing works" symptom.

Verify a healthy server from another terminal:

```bash
curl -s localhost:8080/health
# {"sessions":0,"upstreams":[{"role":"auth",...},{"role":"game",...}]}
```

`"buffering": false` on both upstreams means both cores are connected. If you
see `"buffering": true` plus `uds connect failed` in the server logs, a core
process died — check that PostgreSQL is reachable with `DATABASE_URL` and that
no stale `/tmp/dofus-{gamed,authd}.sock` is lying around (`just server` removes
them on start; if you start the cores by hand, `rm -f /tmp/dofus-*.sock` first,
otherwise you get `EADDRINUSE`).

To run the pieces manually (equivalent to what `just server` does):

```bash
cd apps/gameserver-ts
MODE=game DATABASE_URL=postgres://dofus:dofus@localhost:5432/dofus bun run dev:gamed
MODE=auth DATABASE_URL=postgres://dofus:dofus@localhost:5432/dofus bun run dev:authd
DATABASE_URL=postgres://dofus:dofus@localhost:5432/dofus bun run dev:gateway
```

## Commands

| Command | Description |
|---------|-------------|
| `just setup` | Install deps + create DB (+migrate +seed) + build WASM |
| `just install` | Install JS/TS dependencies |
| `just db` | Create database, run migrations, then seed (admin account, server, map) |
| `just db-create` | Create PostgreSQL user and database |
| `just db-migrate` | Run database migrations (`DATABASE_URL`) |
| `just db-seed` | Seed dev data: **admin/admin** account, game server id=1, "Admin" character, Incarnam map 10300 |
| `just wasm` | Build Vello WASM renderer (sibling `dofus-vello-custom-format` repo; checks the Rust/WASM toolchain first) |
| `just server` | Start the gameserver: core (game + auth) **and** the WS gateway (`apps/gameserver-ts`) |
| `just client` | Start Electrobun desktop client |
| `just client-hmr` | Start client with HMR (Vite on :5173) |
| `just build` | Production build |

### Asset Pipeline

| Command | Description |
|---------|-------------|
| `just tiles-build` | Extract + compile + publish tile dofassets |
| `just sprites-build` | Extract + compile + publish sprites/chevauchors/accessories |
| `just items-build` | Extract + publish item icon SVGs |
| `just spells-build` | Compile + publish spell dofassets |
| `just tactic-build` | Compile + publish tactic-view dofassets |
| `just pipeline-list` | List every registered asset category |
| `just ui-builder` | Launch UI panel builder |
| `just clean-assets` | Remove generated asset caches/dist |

## Project Structure

```
apps/
  electrobun/         # Desktop client (PixiJS + Electrobun)
    src/
      lib/
        ank/battlefield/  # Map rendering, tile layers, grid, transitions
        render/           # Vello integration, frame atlas, picking
        game/             # Game client, network, state
        hud/              # UI components (banner, chat, inventory)
        ecs/              # Entity Component System (Becsy)
  gameserver-ts/      # Game server: gateway (WS) + core (game/auth) over UDS
    src/
      gateway/        # Stable WS gateway (Bun.serve + Hono, /health)
      core/           # Nest app: features (auth, game), db, events, handoff
    migrations/       # Kysely migrations (DATABASE_URL)

packages/
  grid/               # Shared isometric grid math
  protocol/           # Binary message protocol (encode/decode)

tools/
  assets-exporter/    # SWF tile/sprite extraction (PHP)
  asset-pipeline/     # Unified extract → compile → publish pipeline (frame-direct .dofasset)
  tile-classifier/    # Visual tile review tool
  ui-builder/         # Interactive UI panel designer
```

## Configuration

### Game server (`apps/gameserver-ts`)

The server reads its environment through zod (`src/core/shared/config/env.schema.ts`)
and validates it at boot. The connection string is **`DATABASE_URL`** — the
`PG_HOST`/`PG_PORT`/… variables are not read by the server; they are only the
inputs `just db-create` uses to provision the role/database that
`DATABASE_URL` must then point at.

```bash
export DATABASE_URL=postgres://dofus:dofus@localhost:5432/dofus   # required
export REDIS_URL=redis://localhost:6379                          # optional (see below)
```

Other variables (all with defaults): `MODE` (`game`/`auth`), `NODE_ENV`,
`NODE_ID`, `CORE_SOCK`/`AUTH_SOCK` (Unix socket paths), `CORE_VERSION`,
`GAME_SERVER_ID`, `LANGS_DIR`, `DEFAULT_LOCALE`, `GATEWAY_PORT`.

**Redis** — `REDIS_URL` is optional: without it the core uses an in-process
event bus. Set it (and run a Redis) as soon as you run several core instances,
because `apps/gameserver-ts/src/core/shared/events/events.module.ts` then wires
`ioredis` as the cross-process `CLUSTER_TRANSPORT`.

**`just` overrides** — every variable `just` uses can be overridden on the
command line, e.g. `just DATABASE_URL=postgres://me:pw@db:5432/dofus server`.
`just db-create` builds its `psql` calls from `PG_HOST`, `PG_PORT`, `PG_USER`,
`PG_PASSWORD`, `PG_DATABASE` (defaults `localhost`, `5432`, `dofus`, `dofus`,
`dofus`) — keep them consistent with `DATABASE_URL`.

### Client (`apps/electrobun`)

The client is a Vite build; `apps/electrobun/.env` holds `CACHE=off`. It
connects to the gateway on the WebSocket URL it is configured with (default
`:8080`), so start `just server` first.

## Docker

The whole server side (PostgreSQL + Redis + migrations + seed + core game/auth
+ WS gateway) runs in containers. The client stays on the host because WebGPU
is not exposed inside Docker.

```bash
# Full server stack, then run the client on the host.
docker compose -f docker-compose.local.yml up -d --build
# → postgres on localhost:5432, redis on localhost:6379, WS gateway on localhost:8080

# Or just the database, and run the server with `just server`
docker compose -f docker-compose.local.yml up -d postgres
```

The `up` sequence is ordered and idempotent:

1. `postgres` (healthcheck) and `redis` start;
2. `migrate` runs the Kysely migrations once;
3. `seed` inserts the dev data — account **admin/admin**, game server **id=1**
   (state ONLINE), character **"Admin"**, and the Incarnam map 10300 — then
   exits. Reuse of an existing volume is safe (the seed upserts);
4. `core-game`, `core-auth` and `gameserver` start and share `/tmp` so the
   gateway can reach both cores over their Unix sockets.

To reset the dev data, drop the volume and `up` again:
`docker compose -f docker-compose.local.yml down -v && docker compose -f docker-compose.local.yml up -d --build`.

`docker-compose.yml` at the repo root still targets the removed `apps/server`
layout and **does not work** — use `docker-compose.local.yml`, which builds the
current `apps/gameserver-ts` code.

## Rendering

The client shares a single WebGPU device between Vello and PixiJS:

1. **Vello WASM** creates a `GPUTexture` atlas
2. Frames are rendered into atlas slots via `queueFrame()`
3. **PixiJS** reads the same `GPUTexture` via `ExternalSource` — no CPU copy
4. Frame atlas uses LRU eviction for memory management

This enables 300-400 animated actors at 60fps in the browser.

## Shared Renderer

Both this project and the [Godot desktop client](https://github.com/HetwanDofus/dofusgodotclient) use the same `.dofasset` vector format via the shared [`vello-dofasset-format`](https://github.com/HetwanDofus/vello-dofasset-format) renderer:

- **Web**: compiled to WASM, renders via WebGPU
- **Desktop**: compiled as native Rust GDExtension, renders via Vulkan/Metal
