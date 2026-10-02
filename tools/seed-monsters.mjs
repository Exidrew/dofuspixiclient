#!/usr/bin/env node
/**
 * Remplit les tables `monster_templates` + `monster_levels` de
 * `dofuspixiclient` à partir de la fixture figée `tools/data/incarnam-monsters.json`
 * (extraite UNE FOIS du dump StarLoco par `tools/extract-starloco-monsters.mjs`).
 *
 * ── Pourquoi ce seed est nécessaire ─────────────────────────────────────────
 *
 * `tools/seed-maps-incarnam.mjs` écrit déjà `maps.monsters_raw` (et
 * `maps.numgroup`/`mob_size_min`/`mob_size_max`) : c'est le POOL de monstres
 * autorisés par map (format StarLoco `|id,grade|id,grade|…`). Mais le serveur
 * (`MapMonsterService.ensureSpawned`) a besoin de DEUX choses de plus pour
 * matérialiser un groupe :
 *   1. `monster_templates` (nom, gfx, couleurs) — pour le sprite + le tooltip ;
 *   2. `monster_levels` (vie, PA/PM, initiative, XP, sorts) — pour les stats.
 * Aucune migration ne peuplait ces tables → `buildMembers` tombait sur
 * `template` inexistant et ne créait AUCUN membre → aucun groupe affiché.
 *
 * ── Grade StarLoco -> level ─────────────────────────────────────────────────
 *
 * `monsters_raw` porte `id,GRADE` (grade 1..5), pas un level. La fixture
 * `incarnam-monsters.json` donne, pour chaque monstre, le level de chaque grade
 * (`levels`), ce qui permet de résoudre `grade -> level` au seed (et de ne
 * garder que les levels effectivement référencés par les maps).
 *
 * ── Idempotent ──────────────────────────────────────────────────────────────
 *
 * `ON CONFLICT (id) DO UPDATE` sur `monster_templates` et
 * `ON CONFLICT (monster_id, level) DO UPDATE` sur `monster_levels`.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   DATABASE_URL=postgres://dofus:dofus@localhost:5432/dofus \
 *   node tools/seed-monsters.mjs
 *   node tools/seed-monsters.mjs --all        # tous les monstres de la fixture
 *   node tools/seed-monsters.mjs --levels 1,2 # levels explicites (sinon: ceux des maps)
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const MONSTERS_FILE = join(__dirname, "data", "incarnam-monsters.json");
const MAPS_FILE = join(__dirname, "data", "incarnam-maps.json");

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://dofus:dofus@localhost:5432/dofus";

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}
function argValue(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/**
 * Résout, pour chaque monstre, l'ensemble des levels réellement référencés
 * par les pools `monsters_raw` des maps.
 *
 * IMPORTANT : le 2e champ de `monsters_raw` (`|id,N|`) est un LEVEL, pas un
 * index de grade 1..5. Preuve : les maps d'Incarnam référencent des valeurs
 * jusqu'à 14 (ex. `983,10`..`983,14` = Jeune Sanglier niveau 10..14) et ces
 * valeurs correspondent 1:1 aux levels déclarés dans la fixture
 * (`incarnam-monsters.json.levels`), où StarLoco écrit `level@resists`.
 * Renvoie une Map<monsterId, Set<level>>.
 */
function resolveLevelsFromMaps(monsters, maps) {
  const byId = new Map(Object.entries(monsters).map(([id, m]) => [Number(id), m]));
  const wanted = new Map();
  const unresolved = [];

  for (const entry of Object.values(maps)) {
    const raw = entry.monsters || "";
    for (const part of raw.split("|")) {
      if (!part) continue;
      const [idStr, levelStr] = part.split(",");
      const id = Number.parseInt(idStr, 10);
      const level = Number.parseInt(levelStr, 10);
      const monster = byId.get(id);
      if (!monster || !Number.isFinite(level)) continue;
      if (!monster.levels[String(level)]) {
        // The pool references a level the fixture doesn't declare for this
        // template — surface it rather than silently dropping the member.
        unresolved.push(`${id},${level}`);
        continue;
      }

      const set = wanted.get(id) ?? new Set();
      set.add(level);
      wanted.set(id, set);
    }
  }

  if (unresolved.length > 0) {
    console.warn(
      `[seed-monsters] WARNING: ${unresolved.length} pool entrie(s) reference a level absent de la fixture : ${[
        ...new Set(unresolved),
      ].join(", ")}`
    );
  }
  return wanted;
}

/**
 * StarLoco resistances "neutre;terre;feu;eau;air;doAgi;doFor" -> JSON
 * keyed by canonical element names understood by the client.
 */
function parseResistances(raw) {
  const parts = String(raw || "").split(";");
  if (parts.length >= 5) {
    return {
      neutral: Number(parts[0]) || 0,
      earth: Number(parts[1]) || 0,
      fire: Number(parts[2]) || 0,
      water: Number(parts[3]) || 0,
      air: Number(parts[4]) || 0,
      dodgeAp: Number(parts[5]) || 0,
      dodgeMp: Number(parts[6]) || 0,
    };
  }
  return {};
}

/**
 * StarLoco stats "Force,Sagesse,Intelligence,Chance,Agilité" -> JSON.
 */
function parseStats(raw) {
  const p = String(raw || "").split(",");
  return {
    strength: Number(p[0]) || 0,
    wisdom: Number(p[1]) || 0,
    intelligence: Number(p[2]) || 0,
    chance: Number(p[3]) || 0,
    agility: Number(p[4]) || 0,
  };
}

/** "r,g,b" -> [color1, color2, color3] ("-1,-1,-1" = défauts). */
function parseColors(raw) {
  const p = String(raw || "-1,-1,-1").split(",");
  return [
    Number.isFinite(Number(p[0])) ? Number(p[0]) : -1,
    Number.isFinite(Number(p[1])) ? Number(p[1]) : -1,
    Number.isFinite(Number(p[2])) ? Number(p[2]) : -1,
  ];
}

async function main() {
  const all = hasFlag("all");
  const explicitLevels = (argValue("levels", "") || "")
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);

  const monsters = JSON.parse(readFileSync(MONSTERS_FILE, "utf8"));
  const maps = JSON.parse(readFileSync(MAPS_FILE, "utf8"));

  const wantedLevels = resolveLevelsFromMaps(monsters, maps);

  const db = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
  await db.connect();

  try {
    const check = await db.query(
      "SELECT to_regclass('public.monster_templates') AS t"
    );
    if (!check.rows[0]?.t) {
      throw new Error(
        "table monster_templates absente — lancer les migrations d'abord"
      );
    }

    let templates = 0;
    let levels = 0;

    for (const [idStr, monster] of Object.entries(monsters)) {
      const id = Number(idStr);
      const [color1, color2, color3] = parseColors(monster.colors);

      await db.query(
        `INSERT INTO monster_templates
           (id, name, gfx, ai_profile_id, color1, color2, color3)
         VALUES ($1,$2,$3,NULL,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           gfx = EXCLUDED.gfx,
           color1 = EXCLUDED.color1,
           color2 = EXCLUDED.color2,
           color3 = EXCLUDED.color3`,
        [id, monster.name, monster.gfx, color1, color2, color3]
      );
      templates++;

      const fixtureLevels = Object.keys(monster.levels).map(Number);
      let levelsToSeed;
      if (explicitLevels.length > 0) {
        levelsToSeed = explicitLevels.filter((l) => fixtureLevels.includes(l));
      } else if (all) {
        levelsToSeed = fixtureLevels;
      } else {
        levelsToSeed = [...(wantedLevels.get(id) ?? new Set())];
      }

      for (const level of levelsToSeed) {
        const data = monster.levels[String(level)];
        if (!data) continue;
        await db.query(
          `INSERT INTO monster_levels
             (monster_id, level, life, initiative, ap, mp, stats, resistances,
              spells, xp, kamas_min, kamas_max)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,0)
           ON CONFLICT (monster_id, level) DO UPDATE SET
             life = EXCLUDED.life,
             initiative = EXCLUDED.initiative,
             ap = EXCLUDED.ap,
             mp = EXCLUDED.mp,
             stats = EXCLUDED.stats,
             resistances = EXCLUDED.resistances,
             spells = EXCLUDED.spells,
             xp = EXCLUDED.xp`,
          [
            id,
            level,
            data.life,
            data.initiative,
            data.ap,
            data.mp,
            JSON.stringify(parseStats(data.stats)),
            JSON.stringify(parseResistances(data.resists)),
            JSON.stringify(data.spells),
            String(data.xp),
          ]
        );
        levels++;
      }
    }

    console.log(
      `✓ ${templates} monstre(s) / ${levels} niveau(x) insérés dans monster_templates + monster_levels.`
    );
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error("Seed monstres échoué :", err.message);
  process.exit(1);
});
