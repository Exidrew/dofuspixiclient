#!/usr/bin/env node
/**
 * Remplit la table `maps` de `dofuspixiclient` avec les VRAIES maps d'Incarnam
 * (zone 103xx), SANS aucune dépendance externe : les données sont figées dans le
 * dépôt, sous `tools/data/incarnam-maps.json` (payload cellules + métadonnées).
 *
 * ── Pourquoi un fichier figé plutôt qu'une source externe ───────────────────
 *
 * Le dépôt ne contient plus le pipeline d'import SWF qui produisait les maps
 * complètes. `tools/active-cells.json` ne porte QUE le masque d'activité (maps
 * jouables mais SANS couches graphiques). Les vrais ground/layer1/layer2 (décor,
 * arbres, relief) n'étaient disponibles que via un dump d'émulateur externe.
 *
 * Pour que le seed soit auto-suffisant et reproductible, on a extrait UNE FOIS
 * ces données et on les a committées dans `tools/data/incarnam-maps.json` :
 * c'est désormais la source de vérité du projet. Le seed lit ce fichier, rien
 * d'autre.
 *
 * ── Format ──────────────────────────────────────────────────────────────────
 *
 * `incarnam-maps.json` = { "<mapId>": { width, height, mapData, mappos, ... } }
 * où `mapData` est le payload `HASH_CELL` (10 chars/cellule) — exactement le
 * codec de `apps/gameserver-ts/src/core/modules/maps/maps.cells-codec.ts`, donc
 * une simple copie d'octets vers la colonne `cells`.
 *
 * Les positions (x, y) et la superarea sont lues dans les assets du projet
 * (`apps/electrobun/public/assets/data/map-data.json`), et non dans le fichier
 * figé : c'est la source de vérité côté client.
 *
 * ── Limite honnête ──────────────────────────────────────────────────────────
 * Ces données portent la géométrie et les couches de cellules (donc s'affichent
 * correctement), mais pas les entités dynamiques (monstres/npcs vivants) ni les
 * interactions — c'est un déblocage dev/QA, pas un import de production.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   DATABASE_URL=postgres://dofus:dofus@localhost:5432/dofus \
 *   node tools/seed-maps-incarnam.mjs --map 10300
 *   node tools/seed-maps-incarnam.mjs --all-incarnam
 *   node tools/seed-maps-incarnam.mjs --map 10300 --no-force-spawn
 *   node tools/seed-maps-incarnam.mjs --map 10300 --background 56
 *   node tools/seed-maps-incarnam.mjs --map 10300 --no-background
 *
 * Idempotent : ON CONFLICT (id) DO UPDATE.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  decodeHashCells,
  encodeHashCells,
  extractMapGeometry,
  forceWalkable,
} from "./dofus-maps.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const MAPS_FILE = join(__dirname, "data", "incarnam-maps.json");
const MAP_DATA_FILE = join(
  ROOT,
  "apps/electrobun/public/assets/data/map-data.json"
);

/** Cellule de spawn par défaut du projet (players.cell_id default = 319). */
const SPAWN_CELL = 319;

/**
 * Background (image de fond SWF) des maps d'Incarnam — zone de départ 103xx.
 *
 * Incarnam est une zone EXTÉRIEURE : on y voit un CIEL au-dessus du décor. Le
 * tile de fond correspondant est `ground/<INCARNAM_BACKGROUND>.dofasset` ; il
 * est chargé par le client via `MapHandler.renderBackground(backgroundNum)` et
 * peint derrière les tuiles de sol.
 *
 * La valeur a été déterminée empiriquement à partir des assets du projet : le
 * tile 56 (990x618) est le seul fond plein qui soit un CIEL bleu uniforme
 * (moyenne RGB ≈ 54,122,231). Les autres fonds de taille map sont des sols
 * (beige/vert/brun) ou de l'eau, pas un ciel.
 *
 * Surchargeable via `--background N` / `--no-background`.
 */
const INCARNAM_BACKGROUND = 56;

// ── Arguments ──────────────────────────────────────────────────────────────
function argList(name) {
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

async function main() {
  const forceSpawn = !hasFlag("no-force-spawn");
  const backgroundOverride = argList("background")[0];
  const background = hasFlag("no-background")
    ? 0
    : backgroundOverride !== undefined
      ? Number.parseInt(backgroundOverride, 10)
      : INCARNAM_BACKGROUND;

  const maps = JSON.parse(readFileSync(MAPS_FILE, "utf8"));
  const mapDataFile = JSON.parse(readFileSync(MAP_DATA_FILE, "utf8"));
  const positions = mapDataFile.maps ?? {};
  const superareas = mapDataFile.superareas ?? {};

  console.log(`Maps figées : ${MAPS_FILE}`);
  console.log(`  ${Object.keys(maps).length} maps d'Incarnam indexées`);

  let targets = argList("map").map(Number);
  if (hasFlag("all-incarnam")) {
    for (const id of Object.keys(maps)) {
      targets.push(Number(id));
    }
  }
  if (targets.length === 0) {
    targets = [10300];
  }
  targets = [...new Set(targets)].sort((a, b) => a - b);

  const db = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
  await db.connect();
  try {
    const check = await db.query("SELECT to_regclass('public.maps') AS t");
    if (!check.rows[0].t) {
      console.error(
        "Table `maps` absente : lance d'abord les migrations (just db-migrate)."
      );
      process.exit(1);
    }

    let done = 0;
    for (const mapId of targets) {
      const entry = maps[String(mapId)];
      if (!entry) {
        console.warn(
          `  • map ${mapId} absente de incarnam-maps.json → ignorée`
        );
        continue;
      }

      let geometry;
      try {
        geometry = extractMapGeometry(entry);
      } catch (err) {
        console.warn(`  • map ${mapId}: ${err.message} → ignorée`);
        continue;
      }

      // Décodage → forçage de la cellule de spawn → réencodage.
      const plans = decodeHashCells(entry.mapData);
      if (forceSpawn) {
        forceWalkable(plans, [SPAWN_CELL]);
      }
      const cells = Buffer.from(encodeHashCells(plans), "ascii");

      // Position (x, y) et sous-zone : source = assets du projet.
      const info = positions[String(mapId)] ?? {};
      const x = info.x ?? 0;
      const y = info.y ?? 0;
      const sua = info.sua ?? 0;

      // `maps.subarea_id` référence subareas(id) — aucune migration ne seed les
      // subareas. On garantit la FK si le `sua` est connu.
      const subareaId = sua > 0 ? sua : null;
      if (subareaId !== null) {
        await db.query(
          `INSERT INTO subareas (id, area_id, name)
             VALUES ($1, 0, $2)
             ON CONFLICT (id) DO NOTHING`,
          [subareaId, superareas[String(subareaId)] ?? `subarea ${subareaId}`]
        );
      }

      await db.query(
        `INSERT INTO maps
           (id, date, key, width, height, cells, subarea_id, x, y,
            superarea, background, map_data, capabilities, numgroup,
            mob_size_min, mob_size_max, mob_fix_size, forbidden, monsters_raw)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$17,'',$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (id) DO UPDATE SET
           date = EXCLUDED.date,
           key = EXCLUDED.key,
           width = EXCLUDED.width,
           height = EXCLUDED.height,
           cells = EXCLUDED.cells,
           subarea_id = EXCLUDED.subarea_id,
           x = EXCLUDED.x,
           y = EXCLUDED.y,
           background = EXCLUDED.background,
           capabilities = EXCLUDED.capabilities,
           numgroup = EXCLUDED.numgroup,
           mob_size_min = EXCLUDED.mob_size_min,
           mob_size_max = EXCLUDED.mob_size_max,
           mob_fix_size = EXCLUDED.mob_fix_size,
           forbidden = EXCLUDED.forbidden,
           monsters_raw = EXCLUDED.monsters_raw`,
        [
          mapId,
          entry.date ?? "",
          // Schéma dofuspixiclient : key VARCHAR(64). La clé source (debug /
          // version de la map) n'est pas exploitée par le client, on la tronque.
          (entry.key ?? "").slice(0, 64),
          geometry.width,
          geometry.height,
          cells,
          subareaId,
          x,
          y,
          entry.capabilities ?? 0,
          entry.numgroup ?? 0,
          entry.minSize ?? 1,
          entry.maxSize ?? 1,
          entry.fixSize ?? -1,
          entry.forbidden ?? "0;0;0;0;0;0;0",
          entry.monsters ?? "",
          background,
        ]
      );

      console.log(
        `  • map ${mapId} (date ${entry.date}) seedée : ${geometry.width}x${geometry.height}, ${geometry.count} cellules, bg=${background}` +
          (forceSpawn ? `, spawn ${SPAWN_CELL} forcé marchable` : "")
      );
      done++;
    }

    console.log("");
    console.log(
      `✓ ${done} map(s) d'Incarnam insérée(s). \`enter-game\` peut résoudre la map.`
    );
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error("Seed Incarnam échoué :", err.message);
  process.exit(1);
});
