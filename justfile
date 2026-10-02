# Dofus Web Client

set shell := ["bash", "-cu"]

# Project paths
root := justfile_directory()
pipeline := "cd " + root + "/tools/asset-pipeline && bun run src/cli.ts"

# Shared Vello renderer (`.dofasset`) — the `vello-dofasset-format` repo,
# NOT vendored here. It is resolved in this order:
#   1. $VELLO_ROOT when set;
#   2. a sibling checkout: <repo>/../dofus-vello-custom-format (historical
#      canonical location, also what `git clone` below defaults to);
#   3. the same repo checked out next to this one under its real repo name,
#      <repo>/../vello-dofasset-format.
# Both layouts must keep the crate at <root>/packages/vello-wasm, which has to
# stay in sync with the `vello-wasm` alias in
# apps/electrobun/{vite.config.ts,tsconfig.json}.
# Override with `just vello_root=/path/to/dofus-vello-custom-format wasm`.
_sibling_vello := root + "/../dofus-vello-custom-format"
_fallback_vello := root + "/../vello-dofasset-format"
vello_root := env_var_or_default("VELLO_ROOT", if path_exists(_sibling_vello) == "true" { _sibling_vello } else { _fallback_vello })
vello_wasm := vello_root + "/packages/vello-wasm"

db_user := env_var_or_default("PG_USER", "dofus")
db_pass := env_var_or_default("PG_PASSWORD", "dofus")
db_name := env_var_or_default("PG_DATABASE", "dofus")
db_host := env_var_or_default("PG_HOST", "localhost")
db_port := env_var_or_default("PG_PORT", "5432")

# Connection string used by the game server (core) and by `just db-migrate`
# (kysely.config.ts). The server reads DATABASE_URL and nothing else, so
# `just db-create` must provision the same role/database this points at.
db_url := env_var_or_default("DATABASE_URL", "postgres://" + db_user + ":" + db_pass + "@" + db_host + ":" + db_port + "/" + db_name)

# Redis is optional (the core falls back to an in-process event bus when
# REDIS_URL is unset) but required as soon as you run more than one core
# instance — set it to the URL of a local Redis, e.g. redis://localhost:6379.
redis_url := env_var_or_default("REDIS_URL", "redis://" + db_host + ":6379")

# WebSocket port the gateway listens on (browser/Electrobun clients connect here).
gateway_port := env_var_or_default("GATEWAY_PORT", "8080")

# Show available commands
default:
    @just --list

# =============================================================================
# Setup & Development
# =============================================================================

# Full setup: install deps, create DB, run migrations, build WASM
setup: install db wasm
    @echo "Setup complete."

# Install all JS/TS dependencies
install:
    bun install

# Create database and run migrations
db: db-create db-migrate db-seed

# Create PostgreSQL database and user
db-create:
    @echo "Creating database {{db_name}} (owner {{db_user}}) on {{db_host}}:{{db_port}}..."
    @psql -h {{db_host}} -p {{db_port}} -U postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='{{db_user}}'" | grep -q 1 || \
        psql -h {{db_host}} -p {{db_port}} -U postgres -c "CREATE ROLE {{db_user}} WITH LOGIN PASSWORD '{{db_pass}}';"
    @psql -h {{db_host}} -p {{db_port}} -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='{{db_name}}'" | grep -q 1 || \
        psql -h {{db_host}} -p {{db_port}} -U postgres -c "CREATE DATABASE {{db_name}} OWNER {{db_user}};"
    @echo "Database ready (DATABASE_URL={{db_url}})."

# Run database migrations
db-migrate:
    cd {{root}}/apps/gameserver-ts && DATABASE_URL="{{db_url}}" bun run db:migrate

# Seed dev data: playable account (admin/admin), a default game server (id=1)
# and a character ("Admin"), plus ALL connected Incarnam maps.
# Without the maps, EnterGameHandler rejects with "map not found id=10300"
# (no migration inserts maps).
#
# Credentials created: admin / admin (password check is disabled in DEV, so any
# password works — but the UI shows admin/admin).
#
# The map data (geometry + per-cell layers + background) is FROZEN in the repo
# at tools/data/incarnam-maps.json, so the seed is self-contained. The background
# is the full-screen SKY tile 56 for every Incarnam map: the `mappos` 3rd field
# (`<x>,<y>,<N>`) is a decor tile id (e.g. 440 = 366x180, too small for a
# 15x17 map), NOT a background — using it painted a stray "bridge" at the map
# origin and left no sky. Pass extra maps e.g. `just db-seed --map 10303`, drop
# `--all-incarnam` to seed only the starter map, or add `--background N`.
#
# `--all-incarnam` seeds the 62 zone-103xx maps AND builds the `map_neighbors`
# mesh from the REAL world coordinates (`mappos`): 10300 (x=-4) real east
# neighbour is 10305 (x=-3), not 10301 (x=2). Shared coordinates (interiors /
# variants of a same cell) are de-duplicated so no arbitrary link is created.
# No `--neighbor` override is needed — every link comes from the coordinates,
# which connects the whole starter region (37 maps reachable from 10300) instead
# of a lone 10300<->10301 pair (map_neighbors was empty before — no migration).
db-seed:
    DATABASE_URL="{{db_url}}" bun {{root}}/tools/seed-dev-account.mjs
    DATABASE_URL="{{db_url}}" bun {{root}}/tools/seed-maps-incarnam.mjs \
        --all-incarnam
    DATABASE_URL="{{db_url}}" bun {{root}}/tools/seed-monsters.mjs

# Start the game server: gateway + both core processes (game and auth).
# The gateway only proxies; without the MODE=game and MODE=auth cores talking to
# it over their Unix sockets (/tmp/dofus-gamed.sock, /tmp/dofus-authd.sock) the
# client connects but cannot log in or play.
# NOTE: relies on a POSIX shell (`set shell` above); on Windows use WSL/Git Bash.
server:
    @rm -f /tmp/dofus-gamed.sock /tmp/dofus-authd.sock
    @echo "starting core (game)..." ; \
    MODE=game DATABASE_URL="{{db_url}}" REDIS_URL="{{redis_url}}" bun --legacy-decorators run {{root}}/apps/gameserver-ts/src/core/main.ts & \
    echo "starting core (auth)..." ; \
    MODE=auth DATABASE_URL="{{db_url}}" REDIS_URL="{{redis_url}}" bun --legacy-decorators run {{root}}/apps/gameserver-ts/src/core/main.ts & \
    echo "starting gateway on :{{gateway_port}}..." ; \
    cd {{root}}/apps/gameserver-ts && \
    DATABASE_URL="{{db_url}}" REDIS_URL="{{redis_url}}" GATEWAY_PORT={{gateway_port}} bun run dev:gateway

# Build the Vello WASM renderer (shared dofus-vello-custom-format sibling repo)
wasm:
    @if ! command -v wasm-pack >/dev/null 2>&1; then \
        echo "error: wasm-pack not found on PATH."; \
        echo "       Install it: https://rustwasm.github.io/wasm-pack/installer/"; \
        exit 1; \
    fi
    @# Host toolchain guard: a missing C linker or wasm32 target makes
    @# `wasm-pack build` fail with 'linker `cc` not found' / missing target,
    @# well into the compile. Report it up front instead.
    @bash "{{root}}/tools/setup/check-vello-build-deps.sh"
    @if [ ! -f "{{vello_wasm}}/Cargo.toml" ]; then \
        echo "error: Vello WASM crate not found at {{vello_wasm}}"; \
        echo "       The shared renderer lives in its own repo and is not vendored here."; \
        echo "       Clone it next to this project (any folder name works — it is"; \
        echo "       auto-detected as ../dofus-vello-custom-format or ../vello-dofasset-format):"; \
        echo "         git clone https://github.com/HetwanDofus/vello-dofasset-format.git \\"; \
        echo "           \"{{vello_root}}\""; \
        echo "       Or point at an existing checkout with VELLO_ROOT=/path/to/dofus-vello-custom-format"; \
        exit 1; \
    fi
    cd "{{vello_wasm}}" && wasm-pack build --target web --release

# Start the client (Electrobun dev mode)
client:
    cd {{root}}/apps/electrobun && bun run dev

# Start client with HMR
client-hmr:
    cd {{root}}/apps/electrobun && bun run dev:hmr

# Build everything for production
build:
    bun run build

# =============================================================================
# Asset pipeline — unified entrypoint for every asset category.
# Replaces the old combination of (just sprites-spritesheet | tiles-spritesheet
# | tools/compile-for-web.sh | tools/compile-accessories.sh).
# =============================================================================

# List every registered category + its traits.
pipeline-list:
    @{{pipeline}} list

# Run extract + atlas (when applicable) + compile + publish for a single category.
pipeline-build category='' id='':
    @just _pipeline-build "{{category}}" "{{id}}"

_pipeline-build category id:
    @test -n "{{category}}" || (echo "usage: just pipeline-build <category> [id]"; exit 1)
    @{{pipeline}} run {{category}} {{ if id != "" { "--id " + id } else { "" } }}
    @if [ "{{category}}" = "sprites" ] || [ "{{category}}" = "sprites.chevauchors" ]; then \
        {{pipeline}} atlas {{category}} {{ if id != "" { "--id " + id } else { "" } }} ; \
    fi
    @{{pipeline}} compile {{category}} {{ if id != "" { "--id " + id } else { "" } }}
    @{{pipeline}} publish {{category}}

# Extract all lang SWFs (every namespace × locale).
pipeline-langs:
    @{{pipeline}} langs

# Show or update a single stage.
pipeline-run category id='':
    @{{pipeline}} run {{category}} {{ if id != "" { "--id " + id } else { "" } }}
pipeline-atlas category id='':
    @{{pipeline}} atlas {{category}} {{ if id != "" { "--id " + id } else { "" } }}
pipeline-compile category id='':
    @{{pipeline}} compile {{category}} {{ if id != "" { "--id " + id } else { "" } }}
pipeline-publish category:
    @{{pipeline}} publish {{category}}

# Item icon extraction (items stay as SVGs; no dofasset consumption on runtime).
items-build:
    @{{pipeline}} run items
    @{{pipeline}} publish items

# Tile dofassets — frame-direct compile reads per-frame SVGs from
# `extract-tiles` output; no atlas stage.
tiles-build:
    @{{pipeline}} run tiles.ground
    @{{pipeline}} run tiles.objects
    @{{pipeline}} compile tiles.ground
    @{{pipeline}} compile tiles.objects
    @{{pipeline}} publish tiles.ground
    @{{pipeline}} publish tiles.objects

# Spell dofassets (assumes combat-exporter produced assets/spritesheets/spells/<id>/).
spells-build:
    @{{pipeline}} compile spells
    @{{pipeline}} publish spells

# Tactic-view dofassets (gfx.tactic + gfx.cell) — single-frame SVGs repackaged
# as tile-shaped dofassets so the client's atlas loader can pull them.
tactic-build:
    @{{pipeline}} run gfx.tactic
    @{{pipeline}} run gfx.cell
    @{{pipeline}} compile gfx.tactic
    @{{pipeline}} compile gfx.cell
    @{{pipeline}} publish gfx.tactic
    @{{pipeline}} publish gfx.cell

# Sprites + chevauchors + accessories together — end-to-end from raw SWF
# via frame-direct compile (no atlas intermediary).
sprites-build:
    @{{pipeline}} run sprites
    @{{pipeline}} compile sprites
    @{{pipeline}} publish sprites
    @{{pipeline}} run sprites.chevauchors
    @{{pipeline}} compile sprites.chevauchors
    @{{pipeline}} publish sprites.chevauchors
    @{{pipeline}} run sprites.accessories
    @{{pipeline}} compile sprites.accessories
    @{{pipeline}} publish sprites.accessories

# Wipe every cache + dist + public/assets spritesheets artifact.
clean-assets:
    rm -rf assets/cache assets/dist
    @echo "✓ Cleaned asset-pipeline caches (assets/cache, assets/dist)"

# =============================================================================
# UI Builder
# =============================================================================

# Launch the interactive UI panel builder (http://localhost:4200)
ui-builder:
    @echo "Starting UI Builder on http://localhost:4200..."
    cd "{{root}}/tools/ui-builder" && bun run dev

# Show current configuration
info:
    @echo "Configuration:"
    @echo "  Root:       {{root}}"
    @echo "  Pipeline:   {{pipeline}}"
    @echo "  Vello root: {{vello_root}}"
    @echo "  Vello WASM: {{vello_wasm}}"
