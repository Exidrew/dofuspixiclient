#!/usr/bin/env node
/**
 * One-shot extractor: pulls monster templates + per-grade data referenced by
 * the frozen Incarnam maps (`tools/data/incarnam-maps.json`) out of the
 * historical StarLoco MySQL dump and writes a self-contained JSON fixture
 * (`tools/data/incarnam-monsters.json`).
 *
 * The repo no longer ships / depends on the StarLoco dump at runtime: this
 * script is the only place that reads it, exactly like the one-shot that
 * produced `incarnam-maps.json`. Re-run it only if the dump changes.
 *
 * StarLoco `monsters` row layout (columns are positional):
 *   0 id, 1 name, 2 gfxID, 3 align,
 *   4 grades   "level@resistsNeutre;Terre;Feu;Eau;Air;doAgi;doFor" per grade |
 *   5 colors   "r,g,b" (usually "-1,-1,-1")
 *   6 stats    "Force,Sagesse,Intelligence,Chance,Agilité" per grade |
 *   7 statsInfos "dmg;%dmg;soins;créa"  (single, not per grade)
 *   8 spells   "spellId@level;spellId@level" per grade |
 *   9 pdvs     lifeMax per grade |
 *  10 points   "PA;PM" per grade |
 *  11 inits    initiative per grade |
 *  12 minKamas, 13 maxKamas,
 *  14 exps     xp per grade |
 *  15 AI_Type, 16 capturable, 17 type, 18 aggroDistance, 19 isBoss, 20 isArchmonster
 *
 * Output shape (per monster id):
 *   { id, name, gfx, align, colors, ai, aggroDistance, isBoss, isArchmonster,
 *     levels: { <level>: { life, ap, mp, initiative, xp, resists, stats,
 *                          statsInfos, spells: [{spellId, level}] } } }
 *
 * Usage:
 *   node tools/extract-starloco-monsters.mjs [--dump <path-to-04-game.sql>]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const DUMP_PATH = resolve(
  argValue(
    "--dump",
    resolve(ROOT, "..", "StarLoco-Game-master", "db-init", "04-game.sql")
  )
);
const MAPS_FIXTURE = resolve(ROOT, "tools", "data", "incarnam-maps.json");
const OUT_PATH = resolve(ROOT, "tools", "data", "incarnam-monsters.json");

/**
 * Split a SQL VALUES tuple body on top-level commas, honouring single-quoted
 * strings (with '' / \' escapes) so embedded commas inside names/spells are
 * not treated as separators.
 */
function splitTopLevel(body) {
  const out = [];
  let cur = "";
  let inStr = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (ch === "\\") {
        cur += ch + (body[i + 1] ?? "");
        i++;
        continue;
      }
      if (ch === "'") {
        if (body[i + 1] === "'") {
          cur += "''";
          i++;
          continue;
        }
        inStr = false;
        cur += ch;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === "'") {
      inStr = true;
      cur += ch;
      continue;
    }
    if (ch === ",") {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function unquote(v) {
  const t = v.trim();
  if (t.startsWith("'") && t.endsWith("'")) {
    return t
      .slice(1, -1)
      .replace(/\\'/g, "'")
      .replace(/''/g, "'")
      .replace(/\\r/g, "")
      .replace(/\\n/g, "");
  }
  return t;
}

function toInt(v, fallback = 0) {
  const n = Number.parseInt(unquote(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

/** "spellId@level;spellId@level" -> [{spellId, level}] (skips "-1"). */
function parseSpells(raw) {
  const s = unquote(raw);
  if (!s || s === "-1") return [];
  const out = [];
  for (const part of s.split(";")) {
    if (!part || part === "-1") continue;
    const [idStr, lvlStr] = part.split("@");
    const spellId = Number.parseInt(idStr, 10);
    if (!Number.isFinite(spellId) || spellId <= 0) continue;
    out.push({ spellId, level: Number.parseInt(lvlStr ?? "1", 10) || 1 });
  }
  return out;
}

/** "a|b|c" -> ["a","b","c"]. */
function pipe(raw) {
  return unquote(raw).split("|");
}

function parseMonsterRow(body) {
  const cols = splitTopLevel(body);
  const id = toInt(cols[0]);
  const name = unquote(cols[1]);
  const gfx = toInt(cols[2]);
  const align = toInt(cols[3], -1);
  const gradesRaw = pipe(cols[4]);
  const statsRaw = pipe(cols[6]);
  const statsInfos = unquote(cols[7]);
  const spellsRaw = pipe(cols[8]);
  const pdvs = pipe(cols[9]);
  const points = pipe(cols[10]);
  const inits = pipe(cols[11]);
  const exps = pipe(cols[14]);
  const ai = toInt(cols[15], 1);
  const aggroDistance = toInt(cols[18], 0);
  const isBoss = toInt(cols[19], 0);
  const isArchmonster = toInt(cols[20], 0);

  const levels = {};
  for (let g = 0; g < gradesRaw.length; g++) {
    const grade = gradesRaw[g];
    if (!grade) continue;
    const at = grade.indexOf("@");
    const level = Number.parseInt(
      at >= 0 ? grade.slice(0, at) : grade,
      10
    );
    if (!Number.isFinite(level) || level <= 0) continue;
    const resists = at >= 0 ? grade.slice(at + 1) : "0;0;0;0;0;0;0";

    // "PA;PM" -> ap/mp. Some rows carry trailing filler ("4;2|...|1;1").
    const pts = (points[g] ?? "").split(";");
    const ap = Number.parseInt(pts[0] ?? "3", 10) || 3;
    const mp = Number.parseInt(pts[1] ?? "3", 10) || 3;

    levels[level] = {
      life: Number.parseInt(pdvs[g] ?? "1", 10) || 1,
      ap,
      mp,
      initiative: Number.parseInt(inits[g] ?? "1", 10) || 1,
      xp: Number.parseInt(exps[g] ?? "0", 10) || 0,
      resists, // "neutre;terre;feu;eau;air;doAgi;doFor" (as-is, StarLoco order)
      stats: statsRaw[g] ?? "0,0,0,0,0", // "For,Sag,Int,Cha,Agi"
      statsInfos,
      spells: parseSpells(spellsRaw[g] ?? ""),
    };
  }

  return {
    id,
    name,
    gfx,
    align,
    colors: unquote(cols[5]) || "-1,-1,-1",
    ai,
    aggroDistance,
    isBoss: isBoss === 1,
    isArchmonster: isArchmonster === 1,
    levels,
  };
}

function main() {
  console.log(`[extract-monsters] dump    = ${DUMP_PATH}`);
  console.log(`[extract-monsters] maps    = ${MAPS_FIXTURE}`);

  const maps = JSON.parse(readFileSync(MAPS_FIXTURE, "utf8"));

  // Collect every monster id referenced by the frozen Incarnam maps.
  const wanted = new Set();
  for (const entry of Object.values(maps)) {
    const raw = entry.monsters || "";
    for (const part of raw.split("|")) {
      if (!part) continue;
      const id = Number.parseInt(part.split(",")[0], 10);
      if (Number.isFinite(id) && id > 0) wanted.add(id);
    }
  }
  console.log(`[extract-monsters] ${wanted.size} monster ids referenced`);

  const sql = readFileSync(DUMP_PATH, "utf8");
  const marker = "INSERT INTO `monsters` VALUES (";
  const found = new Map();

  let cursor = 0;
  while (true) {
    const start = sql.indexOf(marker, cursor);
    if (start < 0) break;
    const bodyStart = start + marker.length;
    const end = sql.indexOf(");", bodyStart);
    if (end < 0) break;
    const body = sql.slice(bodyStart, end);
    cursor = end + 2;

    const idMatch = /^\s*(\d+)\s*,/.exec(body);
    if (!idMatch) continue;
    const id = Number.parseInt(idMatch[1], 10);
    if (!wanted.has(id)) continue;

    const monster = parseMonsterRow(body);
    found.set(id, monster);
  }

  const missing = [...wanted].filter((id) => !found.has(id));
  if (missing.length > 0) {
    console.warn(
      `[extract-monsters] WARNING: ${missing.length} ids not found in dump: ${missing.join(", ")}`
    );
  }

  const out = {};
  for (const id of [...found.keys()].sort((a, b) => a - b)) {
    out[String(id)] = found.get(id);
  }

  writeFileSync(OUT_PATH, `${JSON.stringify(out, null, 2)}\n`, "utf8");

  const gradeCount = Object.values(out).reduce(
    (n, m) => n + Object.keys(m.levels).length,
    0
  );
  console.log(
    `[extract-monsters] wrote ${Object.keys(out).length} monsters / ${gradeCount} grades -> ${OUT_PATH}`
  );
}

main();
