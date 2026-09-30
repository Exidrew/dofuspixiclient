#!/usr/bin/env node
/**
 * Seed de développement — table `maps` (aucune migration ne l'insère,
 * `tools/seed-dev-account.mjs` ne pose que `players.map_id = 10300`).
 *
 * Sans maps en base, `EnterGameHandler` log `enter-game: map not found id=10300`
 * et rejette l'entrée en jeu (`gameCreate success:false`).
 *
 * Rôle de CE script (par rapport à `seed-maps-incarnam.mjs`) :
 *   - `seed-maps-incarnam.mjs` seede les maps d'Incarnam avec leurs VRAIES
 *     couches de cellules (données figées dans `tools/data/incarnam-maps.json`) ;
 *   - CE script fabrique des cartes MINIMALES mais VALIDES pour N'IMPORTE QUELLE
 *     map présente dans `tools/active-cells.json`, à partir du seul masque
 *     d'activité. Il ne restaure PAS les vraies couches graphiques (ground=0) :
 *     c'est un déblocage pour tests/QA sur des maps hors Incarnam.
 *
 * Données utilisées :
 *   - tools/active-cells.json : map_id -> [active?] par cellule (index = cellId)
 *     => définit le NOMBRE de cellules de la map et son masque `active`.
 *   - apps/electrobun/public/assets/data/map-data.json : positions x/y, sua.
 *
 * Géométrie (grille Dofus 1.29) :
 *   width  = nombre de cellules d'une "longue" ligne
 *   height = nombre de PAIRES de lignes (PAS 2*height-1 !)
 *   cells.length = W*H + (W-1)*(H-1)
 * Pour 10300 (479 cellules) avec W=15 (défaut client) => H=17.
 *
 * /!\ Ne PAS écrire height = 33 : la formule ceil(H/2)*W+floor(H/2)*(W-1)
 * donne le meme compte pour 17 et 33, mais le client calcule la position et le
 * centrage avec totalCells(width, height) et DEFAULT_MAP_HEIGHT=17. Un height
 * double fait deborder computeMapScale() (offsetY negatif) => carte decalee
 * vers le haut.
 *
 * USAGE
 *   DATABASE_URL=postgres://dofus:dofus@localhost:5432/dofus \
 *   node tools/seed-maps.mjs --map 10300 [--map 10301 ...] [--all-incarnam]
 *
 * Idempotent : ON CONFLICT (id) DO UPDATE.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ── Arguments ──────────────────────────────────────────────────────────────
function args(name) {
  const out = [];
  const flag = `--${name}`;
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === flag) {
      const v = process.argv[i + 1];
      if (v !== undefined && !v.startsWith("--")) {
        out.push(v);
      }
    }
  }
  return out;
}
function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://dofus:dofus@localhost:5432/dofus";

// ── HASH_CELL codec (inverse de maps.cells-codec.ts) ────────────────────────
const HASH_CELL =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";

function packCellChars(c) {
  const b = (v) => BigInt(v ?? 0);
  const active = b(c.active ? 1 : 0);
  const lineOfSight = b(c.lineOfSight === false ? 0 : 1);
  const movement = b(c.movement ?? 0);
  const groundLevel = b(c.groundLevel ?? 0);
  const groundSlope = b(c.groundSlope ?? 0);
  const groundNum = b(c.ground ?? 0);
  const groundFlip = b(c.layerGroundFlip ? 1 : 0);
  const groundRot = b(c.layerGroundRot ?? 0);
  const obj1Num = b(c.layer1 ?? 0);
  const obj1Flip = b(c.layerObject1Flip ? 1 : 0);
  const obj1Rot = b(c.layerObject1Rot ?? 0);
  const obj2Num = b(c.layer2 ?? 0);
  const obj2Flip = b(c.layerObject2Flip ? 1 : 0);
  const obj2Interactive = b(c.layerObject2Interactive ? 1 : 0);

  let r = 0n;
  r = (r << 1n) | obj2Interactive;
  r = (r << 1n) | obj2Flip;
  r = (r << 14n) | obj2Num;
  r = (r << 2n) | obj1Rot;
  r = (r << 1n) | obj1Flip;
  r = (r << 14n) | obj1Num;
  r = (r << 2n) | groundRot;
  r = (r << 1n) | groundFlip;
  r = (r << 11n) | groundNum;
  r = (r << 4n) | groundSlope;
  r = (r << 4n) | groundLevel;
  r = (r << 3n) | movement;
  r = (r << 1n) | lineOfSight;
  r = (r << 1n) | active;

  const active_ = r & 0x1n;
  r >>= 1n;
  const los_ = r & 0x1n;
  r >>= 1n;
  const mv_ = r & 0x7n;
  r >>= 3n;
  const gl_ = r & 0xfn;
  r >>= 4n;
  const gs_ = r & 0xfn;
  r >>= 4n;
  const gn_ = r & 0x7ffn;
  r >>= 11n;
  const gf_ = r & 0x1n;
  r >>= 1n;
  const gr_ = r & 0x3n;
  r >>= 2n;
  const o1_ = r & 0x3fffn;
  r >>= 14n;
  const o1f_ = r & 0x1n;
  r >>= 1n;
  const o1r_ = r & 0x3n;
  r >>= 2n;
  const o2_ = r & 0x3fffn;
  r >>= 14n;
  const o2f_ = r & 0x1n;
  r >>= 1n;
  const o2i_ = r & 0x1n;

  const d = new Array(10);
  d[0] =
    ((gn_ >> 6n) & 0x18n) |
    (active_ << 5n) |
    los_ |
    ((o1_ >> 11n) & 0x4n) |
    ((o2_ >> 12n) & 0x2n);
  d[1] = gl_ | (gr_ << 4n);
  d[2] = (mv_ << 3n) | ((gn_ >> 6n) & 0x7n);
  d[3] = gn_ & 0x3fn;
  d[4] = (gs_ << 2n) | (gf_ << 1n) | ((o1_ >> 12n) & 0x1n);
  d[5] = (o1_ >> 6n) & 0x3fn;
  d[6] = o1_ & 0x3fn;
  d[7] =
    (o1r_ << 4n) |
    (o1f_ << 3n) |
    (o2f_ << 2n) |
    (o2i_ << 1n) |
    ((o2_ >> 12n) & 0x1n);
  d[8] = (o2_ >> 6n) & 0x3fn;
  d[9] = o2_ & 0x3fn;

  return d.map((v) => HASH_CELL[Number(v & 0x3fn)]).join("");
}

function encodeCells(cells) {
  return Buffer.from(cells.map(packCellChars).join(""), "ascii");
}

// ── Géométrie ──────────────────────────────────────────────────────────────
// Convention CANONIQUE Dofus 1.29 (== StarLoco MapData.getMapSize() ==
// @dofus/grid totalCells) : cells = width*height + (width-1)*(height-1), où
// `height` = nombre de PAIRES de lignes (PAS 2*height-1). Voir dofus-maps.mjs.
function _cellsCountOf(width, height) {
  return width * height + (width - 1) * (height - 1);
}

/** Trouve (width, height) produisant `count` cellules, en privilégiant
 *  une largeur proche du défaut client (15). */
function findDims(count, preferredWidth = 15) {
  const candidates = [];
  for (let w = 2; w <= 300; w++) {
    const denom = 2 * w - 1;
    const num = count + w - 1;
    if (num % denom !== 0) {
      continue;
    }
    const h = num / denom;
    if (h >= 2 && Number.isInteger(h)) {
      candidates.push({ w, h });
    }
  }
  if (candidates.length === 0) {
    return undefined;
  }
  candidates.sort((a, b) => {
    const aExact = a.w === preferredWidth ? 0 : 1;
    const bExact = b.w === preferredWidth ? 0 : 1;
    if (aExact !== bExact) {
      return aExact - bExact;
    }
    const sane = (d) => d.w >= 8 && d.h >= 5;
    const aD = sane(a)
      ? Math.abs(a.w - preferredWidth)
      : 1000 + Math.abs(a.w - preferredWidth);
    const bD = sane(b)
      ? Math.abs(b.w - preferredWidth)
      : 1000 + Math.abs(b.w - preferredWidth);
    return aD - bD;
  });
  return candidates[0];
}

// ── Données ────────────────────────────────────────────────────────────────
function loadJson(rel) {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
}

const DEFAULT_WIDTH = 15;

/**
 * Fond des maps d'Incarnam (zone de départ, superarea 3) : un CIEL. Tile
 * `ground/56` — seul fond plein qui soit un ciel bleu uniforme dans les assets
 * du projet. Voir tools/seed-maps-incarnam.mjs pour le détail.
 */
const INCARNAM_BACKGROUND = 56;

async function main() {
  const mapDataFile = loadJson(
    "apps/electrobun/public/assets/data/map-data.json"
  );
  const activeCells = loadJson("tools/active-cells.json");
  const mapData = mapDataFile.maps ?? {};
  const superareas = mapDataFile.superareas ?? {};

  let targets = args("map");
  if (hasFlag("all-incarnam")) {
    // sous-zone 3 = Incarnam (cf. map-data.json superareas)
    for (const [id, info] of Object.entries(mapData)) {
      if (info?.sua === 3) {
        targets.push(id);
      }
    }
  }
  targets = [...new Set(targets)];
  if (targets.length === 0) {
    targets = ["10300"];
  }

  console.log(`Seed maps — ${DATABASE_URL}`);
  console.log(`Maps ciblées : ${targets.join(", ")}`);

  const db = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
  await db.connect();
  try {
    const check = await db.query("SELECT to_regclass('public.maps') AS t");
    if (!check.rows[0].t) {
      console.error(
        "Table `maps` absente : lance d'abord les migrations " +
          "(just db-migrate / bun run db:migrate)."
      );
      process.exit(1);
    }

    for (const rawId of targets) {
      const mapId = Number(rawId);
      const active = activeCells[String(mapId)];
      if (!active) {
        console.warn(`  • map ${mapId} absente de active-cells.json → ignorée`);
        continue;
      }

      const dims = findDims(active.length, DEFAULT_WIDTH);
      if (!dims) {
        console.warn(
          `  • map ${mapId}: ${active.length} cellules, aucune (w,h) cohérente → ignorée`
        );
        continue;
      }

      const cells = active.map((isActive, id) => ({
        id,
        active: isActive,
        // Cellules actives = marchables (movement 1). Les cases "non actives"
        // restent hors-grille (movement 0). Les vrais layers SWF ne sont pas
        // restaurés : ground = 0.
        movement: isActive ? 1 : 0,
        lineOfSight: isActive,
        ground: 0,
      }));

      const info = mapData[String(mapId)] ?? {};
      const buf = encodeCells(cells);

      // maps.subarea_id référence subareas(id) — aucune migration ne seed les
      // subareas. On garantit la FK : si le `sua` (superarea de map-data.json)
      // n'existe pas, on l'insère comme subarea ad hoc.
      const subareaId = info.sua ?? null;
      if (subareaId !== null) {
        await db.query(
          `INSERT INTO subareas (id, area_id, name)
           VALUES ($1, $2, $3)
           ON CONFLICT (id) DO NOTHING`,
          [
            subareaId,
            0,
            superareas[String(subareaId)] ?? `subarea ${subareaId}`,
          ]
        );
      }

      // Incarnam (zone de départ, superarea 3) est une zone EXTÉRIEURE : son
      // fond est un ciel (tile ground/56). Les autres maps n'ont pas de fond
      // connu ici -> 0 (le client n'en peint aucun).
      const background = info.sua === 3 ? INCARNAM_BACKGROUND : 0;

      await db.query(
        `INSERT INTO maps
           (id, date, key, width, height, cells, subarea_id, x, y,
            superarea, background, map_data, capabilities, numgroup,
            mob_size_min, mob_size_max, mob_fix_size, forbidden, monsters_raw)
         VALUES ($1,'','',$2,$3,$4,$5,$6,$7,0,$8,'',0,0,1,1,-1,'0;0;0;0;0;0;0','')
         ON CONFLICT (id) DO UPDATE SET
           width = EXCLUDED.width,
           height = EXCLUDED.height,
           cells = EXCLUDED.cells,
           subarea_id = EXCLUDED.subarea_id,
           x = EXCLUDED.x,
           y = EXCLUDED.y,
           background = EXCLUDED.background`,
        [
          mapId,
          dims.w,
          dims.h,
          buf,
          subareaId,
          info.x ?? 0,
          info.y ?? 0,
          background,
        ]
      );

      console.log(
        `  • map ${mapId} seedée (${dims.w}x${dims.h}, ${cells.length} cellules)`
      );
    }

    console.log("");
    console.log(
      "✓ Maps insérées. `enter-game` devrait maintenant résoudre la map."
    );
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error("Seed maps échoué :", err.message);
  process.exit(1);
});
