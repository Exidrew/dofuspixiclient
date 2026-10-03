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
 *   node tools/seed-maps-incarnam.mjs --map 10300 --background 438
 *   node tools/seed-maps-incarnam.mjs --map 10300 --no-background
 *
 * Idempotent : ON CONFLICT (id) DO UPDATE.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  decodeHashCells,
  edgeCellsByDirection,
  encodeHashCells,
  extractMapGeometry,
  forceWalkable,
  gatewayCellsForDirection,
  oppositeEdgeCell,
  parsePlacementCells,
  splitFightPlaces,
} from "./dofus-maps.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const MAPS_FILE = join(__dirname, "data", "incarnam-maps.json");

// Cellules-portails `onMovementEnd` (jaunes, sprite objects_4088) extraites
// UNE FOIS des scripts StarLoco figés (scripts/data/maps/incarnam/*.lua,
// `map.onMovementEnd[cellId] = moveEndTeleport(map, cell)`). Inserees dans
// `scripted_cells` en verb `TP` : le `ScriptedCellsService` du serveur les
// consomme au move-ack, court-circuitant le bord géométrique — fidèle
// dynamique Dofus 1.29 : le "jaune" est une téléportation porte-à-porte
// EXPLICITE, pas une transition de bord.
const PORTALS_FILE = join(__dirname, "data", "incarnam-portals.json");
const MAP_DATA_FILE = join(
  ROOT,
  "apps/electrobun/public/assets/data/map-data.json"
);

/** Cellule de spawn par défaut du projet (players.cell_id default = 319). */
const SPAWN_CELL = 319;

/**
 * Background (image de fond SWF) des maps d'Incarnam — zone de départ 103xx.
 *
 * Incarnam est une zone EXTÉRIEURE : son fond par défaut est le SOL d'Incarnam
 * (tile `ground/438`, 747x437 — valeur de référence des fixtures
 * `assets/maps/10302.json` -> `backgroundNum: 438`). Il est chargé par le
 * client via `MapHandler.renderBackground(backgroundNum)` et peint derrière
 * les tuiles de sol. Le fond « ciel / vue d'Astrub du dessus » (bords de
 * carte, Incarnam étant dans les airs) n'a pas encore de tile d'asset : à
 * ajouter plus tard côté assets puis via `--background <n>`.
 *
 * Surchargeable via `--background N` / `--no-background`.
 */
/**
 * Background PAR DÉFAUT des maps d'Incarnam sans fond plein-écran connu :
 * le SOL d'Incarnam (herbe/route beige), tile `ground/438.dofasset` (747x437).
 * C'est la valeur de référence confirmée par les fixtures du projet
 * `assets/maps/10302.json` -> `backgroundNum: 438`. (NB : 438 est déjà un
 * fond plein-écran ; le ciel « vue d'Astrub du dessus » pour les bords de
 * cartes n'a pas encore de tile — à ajouter côté assets plus tard.)
 *
 * Surchargeable via `--background N` / `--no-background`.
 */
const INCARNAM_BACKGROUND = 438;

/**
 * Choisit le background d'une map.
 *
 * ── Piege corrige : `mappos[2]` n'est PAS le background ─────────────────────
 *
 * Le 3e champ de `mappos` (`<x>,<y>,<N>`) est un id de tile `ground/<N>` —
 * verifie : ses dimensions sont celles d'un ELEMENT DE DECOR pose sur la map
 * (ex. 440 = 366x180, 444 = 86x34), pas d'un fond plein-ecran (une map 15x17
 * fait ~747x437). L'utiliser comme `background` faisait (a) disparaitre le fond
 * ciel et (b) apparaitre l'element de decor au coin (0,0) — le "pont bizarre"
 * en haut de la 10300.
 *
 * StarLoco ne stocke PAS le background dans `maps` (pas de colonne ; le client
 * retro 1.29 derivait ce rendu de ses .swf). MAIS son dump `mappos` vaut
 * `x,y,BG` et le 3e champ correspond 1:1 aux ids de tiles `ground/<N>` du
 * pack d'assets du projet (40x maps d'Incarnam dont 60 % partagent 444 ; les
 * exterieurs Ny ilgingleton auch atagora zones le "canevas" 440/444).
 *
 * Toutefois ce n'est PAS un fond plein-ecran pour TOUTES les maps : quelques
 * quelques fiches du dump deviennent des elements de DECOR (443 162x61,
 * 450 57x32, 444 86x34, 12, 32, 37, 180, 182...). Or `MapHandler.renderBackground`
 * ATTEND un fond PLEIN-ECRAN (`computeMapScale` le cale en 0,0 avec pivot map)
 * — poser la 443 162x61 en fond = element de decor fige au coin (0,0)
 * ("pont bizarre" en haut de la 10300, exactement ce que les fixtures
 * `assets/maps/10302.json` refusent aussi : leur unique `backgroundNum`
 * plein-ecran est 438).
 *
 * REGLE :
 *   1. si `mappos[2]` existe ET que le tile `ground/<N>/atlas.svg` est un
 *      fond plein-écran (largeur >= 700 px, ≈ 747x437 d'une map 15x17 ;
 *      vérifié sur le dataset : seul 441 (761x459) et 445 (753x446)
 *      qualifient) -> on l'UTILISE (fidélité StarLoco) ;
 *   2. si `mappos[2]` est un petit décor (440 366x180, 444 86x34, 443, 446,
 *      447-450, 12, 32, 37, 180, 182...) -> IGNORED (ce n'est PAS un fond) et
 *      on retombe sur le fallback : le SOL d'Incarnam 438 par défaut, PAS 0.
 *      (Régression corrigée : retourner 0 pour un petit décor supprimait le
 *      fond de TOUT Incarnam.)
 *   3. sinon -> fallback CLI (438 par défaut, ou `--background N` /
 *      `--no-background`).
 *
 * NB : le tile 438 (fond plein-écran sol Incarnam des fixtures 10302.json)
 * n'apparaît JAMAIS dans mappos du dump — c'est le fallback par défaut, et il
 * est directement affichable via `--background 438`.
 */
const BACKGROUND_MIN_FULLSCREEN_PX = 700;

function resolveMapBackground(entry, fallback) {
  const mappos = typeof entry?.mappos === "string" ? entry.mappos : "";
  const raw = mappos.split(",")[2];
  const tile = raw !== undefined && raw !== "" ? Number.parseInt(raw, 10) : NaN;

  if (Number.isFinite(tile) && tile > 0) {
    const manifest = join(
      ROOT,
      "apps",
      "electrobun",
      "public",
      "assets",
      "spritesheets",
      "tiles",
      "ground",
      String(tile),
      "manifest.json"
    );
    try {
      const meta = JSON.parse(readFileSync(manifest, "utf8"));
      const w =
        meta?.animations?.tile?.width ?? meta?.width ?? meta?.size?.width ?? 0;
      if (w >= BACKGROUND_MIN_FULLSCREEN_PX) {
        return tile;
      }
      // petit decor : on IGNORE (pas un fond) et on retombe sur le fallback
      // (SOL Incarnam par défaut) — PAS 0, sinon tout Incarnam perd son fond.
      console.warn(
        `    · bg ${tile} (mappos) = decor ${w}px < ${BACKGROUND_MIN_FULLSCREEN_PX}px — fond ignoré`
      );
    } catch {
      // manifest/pas de tile : fallback en dessous
    }
  }
  return fallback;
}

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

// ── Voisinage (changement de map) ───────────────────────────────────────────
//
// Le serveur resout une transition de bord avec `map_neighbors` :
// MoveAckHandler -> detectExitDirection(cellule d'arrivee) -> pour chaque
// direction candidate, MapsRepository.findNeighborInDirection(mapId, direction).
// La table est VIDE au départ (aucune migration ne la peuple) : sans elle,
// atteindre un bord ne mene nulle part.
//
// On la remplit a partir des coordonnees monde (x, y) de map-data.json :
// deux maps sont voisines «en ligne» quand |dx| <= 1 et |dy| <= 1 (pas les
// deux nuls). Direction protocolaire depuis (x,y) : 0=E, 2=S, 4=W, 6=N, et les
// diagonales 1=SE, 3=SW, 5=NW, 7=NE.
//
// L'axe «x croit vers l'EST» et «y croit vers le SUD» est la convention Dofus
// 1.29 (cf. getMapTransitionDirection cote client). On peut surcharger/forcer
// un lien avec `--neighbor <from>:<dir>:<to>` (repete pour plusieurs liens),
// utile quand les coordonnees du depot divergent de la demande de jeu.

const DIRECTION_DELTAS = {
  0: [1, 0], // E
  1: [1, 1], // SE
  2: [0, 1], // S
  3: [-1, 1], // SW
  4: [-1, 0], // W
  5: [-1, -1], // NW
  6: [0, -1], // N
  7: [1, -1], // NE
};

const OPPOSITE_DIRECTION = { 0: 4, 1: 5, 2: 6, 3: 7, 4: 0, 5: 1, 6: 2, 7: 3 };

/**
 * Deduit les liens de voisinage a partir des coordonnees monde des maps.
 * Retourne un tableau de { mapId, direction, neighborMapId }.
 *
 * ── Piege des coordonnees dupliquees ────────────────────────────────────────
 *
 * Plusieurs maps d'Incarnam partagent la MEME position monde (x,y) : ce sont
 * des interieurs / variantes d'une meme case de la carte (ex. a (-2,2) on a
 * 10321, 10322, 10326, 10328, 10329, 10330 ; a (6,5) on a 10335 + 7 autres).
 * Un parcours naif « pour chaque direction, cherche une map a (x+dx, y+dy) »
 * tombe alors TOUJOURS sur la premiere de la liste -> il fabrique des liens
 * arbitraires (ex. 10300 -> 10301 alors que 10301 est a x=2) au lieu du vrai
 * voisin de plein air (10300 -> 10305, x=-3).
 *
 * On corrige en designant un REPRESENTANT CANONIQUE par case : parmi toutes les
 * maps a une coordonnee donnee, on ne relie que la plus petite par ordre
 * (id numerique) — choix deterministe. Les autres maps de la case restent
 * seedees mais ne participent pas au maillage exterieur.
 *
 * La position monde provient en priorite du champ `mappos` des donnees figees
 * (`<x>,<y>,<bg>`, source interne exacte) ; on retombe sur map-data.json si
 * absent. Les deux sources ont ete verifiees identiques pour les 62 maps.
 */
function deriveNeighbors(maps, positions, mapIds) {
  const wanted = new Set(mapIds.map(Number));

  // position monde par map : mappos (fige) sinon map-data.json.
  const worldPos = new Map(); // mapId -> { x, y }
  for (const id of wanted) {
    const entry = maps[String(id)];
    const mappos = entry?.mappos;
    if (typeof mappos === "string" && mappos.includes(",")) {
      const [x, y] = mappos.split(",").map(Number);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        worldPos.set(id, { x, y });
        continue;
      }
    }
    const p = positions[String(id)];
    if (p) {
      worldPos.set(id, { x: p.x ?? 0, y: p.y ?? 0 });
    }
  }

  // Une case -> liste d'ids. Le representant est le plus petit id.
  const idsByCoord = new Map();
  for (const [id, { x, y }] of worldPos) {
    const key = `${x},${y}`;
    const arr = idsByCoord.get(key) ?? [];
    arr.push(id);
    idsByCoord.set(key, arr);
  }
  const representativeByCoord = new Map(); // "x,y" -> mapId
  for (const [key, ids] of idsByCoord) {
    representativeByCoord.set(key, Math.min(...ids));
  }

  const links = [];
  for (const [key, repId] of representativeByCoord) {
    const [x, y] = key.split(",").map(Number);
    for (const [dirStr, [dx, dy]] of Object.entries(DIRECTION_DELTAS)) {
      const neighborRep = representativeByCoord.get(`${x + dx},${y + dy}`);
      if (neighborRep === undefined) {
        continue;
      }
      links.push({
        mapId: repId,
        direction: Number(dirStr),
        neighborMapId: neighborRep,
      });
    }
  }
  return links;
}

// Sur une map, les portes utilisables pour chaque direction reliee. Alimente
// map_triggers ? Non : le serveur deduit la direction depuis la cellule, donc
// il suffit que la cellule de bord soit marchable.
function parseForcedNeighbors() {
  const out = [];
  for (const spec of argList("neighbor")) {
    const parts = spec.split(":");
    if (parts.length !== 3) {
      console.warn(`  • --neighbor "${spec}" invalide (attendu from:dir:to)`);
      continue;
    }
    const [from, dir, to] = parts.map(Number);
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(dir) ||
      !Number.isFinite(to)
    ) {
      console.warn(`  • --neighbor "${spec}" invalide (nombres attendus)`);
      continue;
    }
    if (!(dir in DIRECTION_DELTAS)) {
      console.warn(`  • --neighbor "${spec}" : direction ${dir} hors 0..7`);
      continue;
    }
    out.push({ mapId: from, direction: dir, neighborMapId: to });
    // Lien reciproque, pour permettr\e l'aller-retour.
    out.push({
      mapId: to,
      direction: OPPOSITE_DIRECTION[dir],
      neighborMapId: from,
    });
  }
  return out;
}

async function main() {
  const forceSpawn = !hasFlag("no-force-spawn");
  const backgroundOverride = argList("background")[0];
  const background = hasFlag("no-background")
    ? 0
    : backgroundOverride !== undefined
      ? Number.parseInt(backgroundOverride, 10)
      : INCARNAM_BACKGROUND;
  // Voisinage : par défaut, on déduit les liens des coordonnées de map-data.json.
  // `--no-neighbors` désactive ; `--neighbor from:dir:to` ajoute des liens forcés.
  const wantNeighbors = !hasFlag("no-neighbors");

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

    // Liens de voisinage : liens automatiques déduits des coordonnées monde
    // (map-data.json) + liens forcés via --neighbor. On indexe par map source.
    const forcedNeighbors = parseForcedNeighbors();
    const autoNeighbors = wantNeighbors
      ? deriveNeighbors(maps, positions, targets)
      : [];
    const allLinks = [...autoNeighbors, ...forcedNeighbors];
    const linksByMap = new Map();
    for (const link of allLinks) {
      const key = link.mapId;
      const arr = linksByMap.get(key) ?? [];
      arr.push(link);
      linksByMap.set(key, arr);
    }
    const linksForMap = (id) => linksByMap.get(id) ?? [];

    if (wantNeighbors) {
      console.log(
        `Voisinage : ${autoNeighbors.length} lien(s) déduit(s) des coordonnées` +
          (forcedNeighbors.length > 0
            ? ` + ${forcedNeighbors.length} lien(s) forcé(s) via --neighbor`
            : "")
      );
    }

    let done = 0;
    const neighborLinks = [];

    // ── map_fight_places ──────────────────────────────────────────────────
    // Aucune migration ne peuple `map_fight_places`, or c'est LA table que
    // `MapsRepository.findFightPlaces` lit pour alimenter `createFightMap`
    // (FightStartService.startPvM / startChallenge). Sans elle, `places0` /
    // `places1` sont vides -> `parsePlacementCells` renvoie [] ->
    // `createFightMap` retourne null -> AUCUN combat ne démarre (ni PvM ni
    // PvP). Le dump figé porte ces places (`entry.places` = "places0|places1",
    // codec HASH_CHARS : paires de caractères -> (hi<<6)|lo). On les copie
    // telles quelles. Idempotent (ON CONFLICT (map_id) DO UPDATE).
    let fightPlacesDone = 0;

    // ── Phase 1 : préparer les maps à insérer (décodage + spawn) ───────────
    // On garde les plans en mémoire pour pouvoir appliquer les portes APRÈS
    // avoir tout préparé (les portes d'une map dépendent des portes des maps
    // voisines via les cellules d'atterrissage).
    const prepared = new Map(); // mapId -> { entry, geometry, plans, info }
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

      const plans = decodeHashCells(entry.mapData);
      if (forceSpawn) {
        forceWalkable(plans, [SPAWN_CELL]);
      }

      prepared.set(mapId, {
        entry,
        geometry,
        plans,
        info: positions[String(mapId)] ?? {},
      });
    }

    // ── Phase 2 : portes de sortie + cellules d'atterrissage ───────────────
    // Pour chaque lien A -dir-> B :
    //   (a) rendre marchables les cellules de bord de A dans `dir` (portes) ;
    //   (b) rendre marchables les cellules de B où le joueur ATTERRIT en
    //       venant de A (oppositeEdgeCell), sinon le joueur apparaîtrait
    //       bloqué sur une case non praticable.
    // (a) et (b) sont calculés sur les plans AVANT forçage, pour rester
    // déterministes et éviter d'ouvrir des portes en cascade.
    const gatewaysByMap = new Map(); // mapId -> Map(dir -> cells[])
    const addGateway = (mapId, direction, cells) => {
      const byDir = gatewaysByMap.get(mapId) ?? new Map();
      const arr = byDir.get(direction) ?? [];
      byDir.set(direction, arr.concat(cells));
      gatewaysByMap.set(mapId, byDir);
    };

    for (const link of allLinks) {
      const a = prepared.get(link.mapId);
      const b = prepared.get(link.neighborMapId);
      if (!a || !b) {
        continue;
      }

      // (a) portes de sortie sur A.
      // ── Porte MINIMALE (fidèle Dofus 1.29 / StarLoco) ─────────────────────
      // On n'ouvre pas tout le bord : le seul passager est la cellule de bord
      // dont l'ORTHOGONALE correspond au voisin (définition Dofus : la porte
      // Est d'une map = zone du bord Est la plus proche de la sortie visible).
      // En pratique : la cellule du bord `direction` la plus PROCHE d'une
      // cellule intérieure praticable (BFS local), limitée à une fenêtre de
      // quelques cellules — le reste du bord reste infranchissable.
      let exits = gatewayCellsForDirection(
        a.plans,
        a.geometry.width,
        a.geometry.height,
        link.direction
      );
      if (exits.length === 0) {
        // Aucune cellule ACTIVE sur ce bord (falaise de décor sur toute la
        // lisière) : la gatewayCellsForDirection retombe sur son fallback
        // « bords actifs » ; si toujours vide, on force le bord entier.
        // Sans ça, le joueur atteint le bord, detectExitDirection renvoie la
        // bonne direction… mais $gatewayCellsForDirection n'a rien ouvert =>
        // bord non marchable => transition impossible sur ce lien.
        console.warn(
          `  ⚠ bord ${link.direction} de ${link.mapId} entièrement non praticable → portals forcés`
        );
        const edges =
          edgeCellsByDirection(a.geometry.width, a.geometry.height)[
            link.direction
          ] ?? [];
        exits = edges;
      }
      if (exits.length > 0) {
        addGateway(link.mapId, link.direction, exits);
        for (const cellId of exits) {
          // (b) atterrissage correspondant sur B.
          const landing = oppositeEdgeCell(
            cellId,
            link.direction,
            a.geometry.width,
            b.geometry.width,
            b.geometry.height
          );
          if (landing !== undefined) {
            forceWalkable(b.plans, [landing]);
          }
        }
      }
    }

    // ── Phase 3 : forcer les cellules puis insérer ─────────────────────────
    for (const [mapId, prep] of prepared) {
      const { entry, geometry, plans, info } = prep;

      const byDir = gatewaysByMap.get(mapId);
      if (byDir) {
        for (const cells of byDir.values()) {
          forceWalkable(plans, cells);
        }
      }

      const cells = Buffer.from(encodeHashCells(plans), "ascii");
      const x = info.x ?? 0;
      const y = info.y ?? 0;
      const sua = info.sua ?? 0;

      // Background : on prefere celui declare par la map dans `mappos`
      // (`<x>,<y>,<bg>`, source interne = vrai ground SWF de la map), a
      // condition que le tile existe et qu'aucune surcharge CLI ne soit active.
      // Sinon on retombe sur `background` (defaut/--background/--no-background).
      const mapBackground = resolveMapBackground(entry, background);

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
          entry.capabilities === "" || entry.capabilities == null
            ? 0
            : Number(entry.capabilities) || 0,
          entry.numgroup === "" || entry.numgroup == null
            ? 0
            : Number(entry.numgroup) || 0,
          entry.minSize === "" || entry.minSize == null
            ? 1
            : Number(entry.minSize) || 1,
          entry.maxSize === "" || entry.maxSize == null
            ? 1
            : Number(entry.maxSize) || 1,
          entry.fixSize === "" || entry.fixSize == null
            ? -1
            : Number(entry.fixSize) || -1,
          entry.forbidden ?? "0;0;0;0;0;0;0",
          entry.monsters ?? "",
          mapBackground,
        ]
      );

      console.log(
        `  • map ${mapId} (date ${entry.date}) seedée : ${geometry.width}x${geometry.height}, ${geometry.count} cellules, bg=${mapBackground}` +
          (forceSpawn ? `, spawn ${SPAWN_CELL} forcé marchable` : "")
      );

      if (byDir && byDir.size > 0) {
        const summary = [...byDir.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([dir, c]) => `d${dir}=${c.length}`)
          .join(" ");
        console.log(`      portes marchables forcées : ${summary}`);
      }

      // Mémorise les liens sortants (insérés après, la FK neighbor_map_id exige
      // que toutes les maps cibles existent déjà).
      for (const link of linksForMap(mapId)) {
        neighborLinks.push(link);
      }
      done++;
    }

    // ── map_neighbors ─────────────────────────────────────────────────────
    // Insertion APRÈS avoir seedé toutes les maps : neighbor_map_id référence
    // maps(id), donc la map voisine doit déjà exister.
    let linksDone = 0;
    for (const link of neighborLinks) {
      const { rowCount } = await db.query(
        `INSERT INTO map_neighbors (map_id, direction, neighbor_map_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (map_id, direction) DO UPDATE
             SET neighbor_map_id = EXCLUDED.neighbor_map_id`,
        [link.mapId, link.direction, link.neighborMapId]
      );
      if (rowCount > 0) {
        linksDone++;
      }
    }

    if (neighborLinks.length > 0) {
      console.log("");
      console.log(
        `✓ ${linksDone} lien(s) de voisinage (map_neighbors) posés : ` +
          `${neighborLinks.filter((l) => l.mapId <= l.neighborMapId).length} aller(s)`
      );
    }

    // ── map_fight_places ──────────────────────────────────────────────────
    // (inséré APRÈS les maps : FK map_id -> maps(id)). On ne pose une ligne
    // que si le dump fournit des places décodables pour la map.
    for (const [mapId, prep] of prepared) {
      const parsed = splitFightPlaces(prep.entry?.places);
      if (!parsed) {
        continue;
      }
      // Both teams must resolve to a non-empty cell list, otherwise
      // `createFightMap` would reject the map (needs team0 AND team1) and the
      // row would be dead weight. A few frozen maps declare a malformed
      // `places` (one side empty) — skip those.
      if (
        parsePlacementCells(parsed.places0).length === 0 ||
        parsePlacementCells(parsed.places1).length === 0
      ) {
        console.warn(
          `    · map ${mapId} : places de combat incomplètes → ignorées`
        );
        continue;
      }
      const { rowCount } = await db.query(
        `INSERT INTO map_fight_places (map_id, places0, places1)
           VALUES ($1, $2, $3)
           ON CONFLICT (map_id) DO UPDATE SET
             places0 = EXCLUDED.places0,
             places1 = EXCLUDED.places1`,
        [mapId, parsed.places0, parsed.places1]
      );
      if (rowCount > 0) {
        fightPlacesDone++;
      }
    }
    console.log(
      `✓ ${fightPlacesDone} map(s) avec cellules de placement de combat (map_fight_places)`
    );

    // ── scripted_cells (portails jaunes onMovementEnd) ────────────────────
    // Chaque entrée {cellId, toMapId, toCellId} d'une map cible seedée devient
    // une cellule scriptée `TP`. On n'insère un portail QUE si :
    //  - les DEUX maps (source et destination) font partie des maps seedées
    //    (sinon teleport aboutirait sur une map absente → enter-game rejette);
    //  - aucune ligne (map_id, cell_id) n'écrase un TP déjà en base
    //    (ON CONFLICT DO NOTHING : les TPs de la migration 0032 non Incarnam
    //    ne sont pas touchés).
    const seededIds = new Set([...prepared.keys()]);
    let portalsDone = 0;
    if (existsSync(PORTALS_FILE)) {
      const portals = JSON.parse(readFileSync(PORTALS_FILE, "utf8"));
      const tableExists = await db.query(
        "SELECT to_regclass('public.scripted_cells') AS t"
      );
      if (tableExists.rows[0].t) {
        for (const [mapIdStr, entries] of Object.entries(portals)) {
          const srcMap = Number(mapIdStr);
          if (!seededIds.has(srcMap)) {
            continue;
          }
          for (const { cellId, toMapId, toCellId } of entries) {
            if (!seededIds.has(toMapId)) {
              continue;
            }
            const { rowCount } = await db.query(
              `INSERT INTO scripted_cells
                 (map_id, cell_id, action_id, event_id, verb, actions_args, conditions)
               VALUES ($1, $2, 0, 0, 'TP', $3, '')
               ON CONFLICT (map_id, cell_id) DO NOTHING`,
              [srcMap, cellId, `${toMapId},${toCellId}`]
            );
            if (rowCount > 0) {
              portalsDone++;
            }
          }
        }
        console.log(
          `✓ ${portalsDone} cellule(s) TP (portails jaunes onMovementEnd) posées dans scripted_cells`
        );
      } else {
        console.warn(
          "  ⚠ table scripted_cells absente (migration 0032 non passée ?) → portails ignorés"
        );
      }
    } else {
      console.warn(`  ⚠ ${PORTALS_FILE} introuvable → aucun portail TP inséré`);
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
