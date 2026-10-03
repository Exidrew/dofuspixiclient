# Dofus Web Client

Client Dofus 1.29 (PixiJS + Vello WASM) avec un serveur Bun/NestJS et une BDD
PostgreSQL. Le **serveur tourne dans Docker** ; le **client tourne sur ta
machine** (il fait du rendu WebGPU, impossible à exposer dans un conteneur).

---

## Ce que tu dois installer (une fois)

| Outil | Pourquoi | Installation |
|-------|----------|--------------|
| **Docker** + Compose | Le serveur complet (BDD, migrations, seed, game server, gateway) | https://docs.docker.com/get-docker/ |
| **Bun 1.3+** | Le client + les scripts de seed | `curl -fsSL https://bun.sh/install \| bash` |
| Un **navigateur WebGPU** (Chrome/Edge 113+) **ou** une carte compatible Vulkan/Metal/D3D12 | Le rendu in-game | — |

> **Pas besoin de Rust, wasm-pack, ni d'un dépôt frère.**
> Le renderer Vello est **précompilé et vendu** dans le dépôt
> (`apps/electrobun/wasm/vello`, ~2.5 Mo). Tu n'as rien à compiler.

> **Windows** : les recettes `just` utilisent un shell POSIX. Lance tout depuis
> **WSL** ou **Git Bash**, pas `cmd.exe`/PowerShell. (Ou utilise directement les
> commandes `docker compose` et `bun` ci-dessous, sans `just`.)

`just` est **optionnel** : chaque commande `just` équivaut à une commande
`docker compose`/`bun` que tu peux taper à la main. Installe-le si tu veux les
raccourcis : https://github.com/casey/just

---

## Démarrage (3 commandes)

### 1. Le serveur (Docker)

```bash
docker compose -f docker-compose.local.yml up -d --build
```

Ça démarre, dans l'ordre : `postgres` → `redis` → `migrate` → `seed` →
`core-game` + `core-auth` + `gameserver` (gateway WS sur `:8080`).

Le seed crée automatiquement un compte jouable : **`admin` / `admin`**, un
serveur de jeu (id=1, en ligne) et un personnage **"Admin"** sur la map 10300
(Incarnam). Aucune étape manuelle.

Vérifie que le serveur est sain :

```bash
curl -s localhost:8080/health
# {"sessions":0,"upstreams":[{"role":"auth",...},{"role":"game",...}]}
```

`"buffering": false` sur les deux upstreams = c'est bon.

### 2. Le client (sur ta machine)

```bash
bun install
cd apps/electrobun
bun run hmr        # Vite + HMR sur http://localhost:5173
```

Ouvre **http://localhost:5173** dans un navigateur WebGPU, puis connecte-toi
avec `admin` / `admin`.

> `bun run hmr` lance **juste Vite** (le client dans le navigateur). C'est la
> façon la plus simple de développer.
>
> Pour la **fenêtre desktop native** (Electrobun/CEF) : `bun run dev` (fenêtre
> native). Sur Linux il faut les libs CEF (`libnss3`, `libgtk-3`, …) — voir
> [Fedora / Linux](#fedora--linux).
>
> `bun run dev:hmr` lance les deux (fenêtre native **et** HMR) — pratique mais
> plus lourd à démarrer.

### 3. Arrêter / réinitialiser

```bash
# Arrêter le serveur
docker compose -f docker-compose.local.yml down

# Repartir de zéro (efface la BDD et re-seed)
docker compose -f docker-compose.local.yml down -v
docker compose -f docker-compose.local.yml up -d --build
```

---

## Commandes utiles

### Docker (serveur)

| Commande | Effet |
|----------|-------|
| `docker compose -f docker-compose.local.yml up -d --build` | Démarrer tout le serveur |
| `docker compose -f docker-compose.local.yml logs -f gameserver` | Voir les logs du gateway |
| `docker compose -f docker-compose.local.yml down` | Arrêter |
| `docker compose -f docker-compose.local.yml down -v` | Arrêter **et effacer la BDD** |

### Client (`cd apps/electrobun`)

| Commande | Effet |
|----------|-------|
| `bun run hmr` | **Le plus simple** : Vite + HMR dans le navigateur (`:5173`) |
| `bun run dev` | Fenêtre desktop native (Electrobun) |
| `bun run dev:hmr` | Fenêtre native **+** HMR |
| `bun run build` | Build de production |

### Just (optionnel, même chose en plus court)

| Commande | Équivalent |
|----------|-----------|
| `just setup` | `bun install` + `docker compose … up -d postgres` + migrations + seed |
| `just client-hmr` | `cd apps/electrobun && bun run hmr` |
| `just client` | `cd apps/electrobun && bun run dev` |
| `just wasm` | *(mainteneurs uniquement)* recompiler le WASM depuis les sources |

---

## Dépannage

### "Le client se connecte mais le login ne marche pas"

Le client ne voit que le gateway. Vérifie que les **deux cores** tournent :

```bash
docker compose -f docker-compose.local.yml ps
curl -s localhost:8080/health
```

Si `upstreams` affiche `"buffering": true` ou si un core est `exited`, regarde
ses logs :

```bash
docker compose -f docker-compose.local.yml logs core-game
docker compose -f docker-compose.local.yml logs core-auth
```

La cause la plus fréquente : la BDD n'est pas prête / le seed a échoué. Un
`down -v && up -d --build` règle ça.

### "Écran noir en jeu" (HUD visible mais pas la map)

Le rendu passe par **WebGPU**. Si ton navigateur/GPU ne l'expose pas, le canvas
reste noir. Vérifie `/gpu` dans la console, ou active dans Chrome :
`chrome://flags/#enable-unsafe-webgpu`. Sur Linux, il faut un pilote Vulkan à
jour.

### "Le seed n'a pas créé les maps" / changement de map cassé

Les données de maps sont **figées dans le dépôt**
(`tools/data/incarnam-maps.json`) : le seed est autonome. Réapplique-le :

```bash
docker compose -f docker-compose.local.yml run --rm seed
```

### Ports déjà utilisés

Si `5432`, `6379` ou `8080` sont pris, arrête le service qui les occupe, ou
édite les mappings dans `docker-compose.local.yml`.

---

## Fedora / Linux

Pour la **fenêtre desktop native** (`bun run dev`), Electrobun/CEF a besoin de
bibliothèques système. Sur Fedora :

```bash
sudo dnf install -y nss atk at-spi2-atk cups-libs libXcomposite libXdamage \
  libXrandr libgbm libxkbcommon mesa-libGL alsa-lib
```

Pour WebGPU sous Linux, un pilote Vulkan fonctionnel est nécessaire
(`vulkaninfo` pour vérifier). En navigateur, Chrome/Chromium 113+ suffit.

Si tu utilises **`bun run hmr`** (navigateur), ces libs ne sont **pas**
nécessaires.

---

## Architecture

```
Navigateur / Fenêtre native
  TypeScript (logique) ──> PixiJS (renderer WebGPU)
                                │
  Rust/WASM (vendu) ──> Vello/wgpu ──> GPUTexture (partagée avec PixiJS)
                                │
                          WebSocket (:8080)
                                │
Docker ─────────────────────────┴─────────────────────────
  gateway (WS)  ──UDS──>  core auth  ──>  PostgreSQL
                        core game   ──>  Redis (optionnel)
```

- **Serveur** (`apps/gameserver-ts`) : un **gateway** stable garde les sockets
  WS ; des **cores** redémarrables (auth / game) tiennent la logique, et
  communiquent avec le gateway via des sockets Unix (`/tmp/dofus-*.sock`). Les
  trois tournent dans des conteneurs qui partagent `/tmp`.
- **Client** (`apps/electrobun`) : build Vite + PixiJS + Vello WASM.
- **WASM** : `apps/electrobun/wasm/vello/` (précompilé, vendu). Résolu par
  l'alias `vello-wasm` dans `vite.config.ts` et `tsconfig.json`.

### Structure

```
apps/
  electrobun/            # Client (PixiJS + Electrobun)
    src/                 # code du client
    wasm/vello/          # WASM Vello précompilé (vendu, ne pas éditer)
  gameserver-ts/         # Serveur : gateway (WS) + core (game/auth)
    src/gateway/         # gateway WS + /health
    src/core/            # app Nest : features (auth, game), db, events
    migrations/          # migrations Kysely
packages/
  grid/                  # maths de la grille isométrique
  protocol/              # protocole binaire
tools/
  seed-*.mjs             # seeds (compte dev, maps, monstres)
  data/                  # données figées (maps, monstres, portails)
  asset-pipeline/        # extraction → compilation → publication des assets
```

---

## Configuration

### Serveur (`apps/gameserver-ts`)

Le serveur lit son environnement via zod (`src/core/shared/config/env.schema.ts`)
et le valide au boot.

```bash
export DATABASE_URL=postgres://dofus:dofus@localhost:5432/dofus   # requis
export REDIS_URL=redis://localhost:6379                          # optionnel
```

`REDIS_URL` est optionnel : sans lui, le core utilise un bus d'événements
en processus. Mets-le dès que tu lances plusieurs instances de core.

Autres variables (avec défauts) : `MODE` (`game`/`auth`), `NODE_ENV`, `NODE_ID`,
`CORE_SOCK`/`AUTH_SOCK`, `GATEWAY_PORT`, `GAME_SERVER_ID`, `DEFAULT_LOCALE`, …

Dans le flux Docker, ces variables sont déjà posées par
`docker-compose.local.yml` — tu n'as rien à configurer.

### Client (`apps/electrobun`)

Le client est un build Vite. Il se connecte au gateway sur son URL WebSocket
(défaut `:8080`). Démarre le serveur avant.

---

## Renderer partagé (Vello)

Le client partage un seul device WebGPU entre Vello et PixiJS :

1. **Vello WASM** crée un atlas de `GPUTexture` ;
2. les frames sont rendues dans des slots de l'atlas ;
3. **PixiJS** lit la même `GPUTexture` via `ExternalSource` (zéro copie CPU).

### Recompiler le WASM (mainteneurs uniquement)

Le `.wasm` est **vendu** dans le dépôt — inutile de le recompiler pour
développer. Pour le mettre à jour depuis le renderer partagé
[`vello-dofasset-format`](https://github.com/HetwanDofus/vello-dofasset-format) :

```bash
git clone https://github.com/HetwanDofus/vello-dofasset-format.git ../vello-dofasset-format
just wasm        # recompile puis re-vendore dans apps/electrobun/wasm/vello
git add apps/electrobun/wasm/vello && git commit
```

`just wasm` exige une toolchain Rust (`wasm-pack`, cargo, un linker C, la target
`wasm32-unknown-unknown`). Le script `tools/setup/check-vello-build-deps.sh`
vérifie tout ça et te dit quoi installer. Ce n'est **jamais** nécessaire pour
lancer le projet.

---

## Pipeline d'assets

| Commande | Effet |
|----------|-------|
| `just tiles-build` | Extraire + compiler + publier les dofassets de tuiles |
| `just sprites-build` | Idem pour sprites/chevauchors/accessoires |
| `just items-build` | Icônes d'items (SVG) |
| `just spells-build` | dofassets de sorts |
| `just tactic-build` | dofassets de la vue tactique |
| `just pipeline-list` | Lister les catégories d'assets |
| `just clean-assets` | Nettoyer les caches d'assets générés |

Les assets sont déjà présents dans `apps/electrobun/public/assets` — ces
commandes ne servent qu'aux mainteneurs.
