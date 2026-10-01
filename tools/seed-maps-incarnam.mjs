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
  edgeCellsByDirection,
  encodeHashCells,
  extractMapGeometry,
  forceWalkable,
  gatewayCellsForDirection,
  oppositeEdgeCell,
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
 * Le background des maps d'Incarnam est donc le CIEL plein-ecran
 * `INCARNAM_BACKGROUND` (56), sauf surcharge CLI `--background N` / `--no-background`.
 */
function resolveMapBackground(entry, fallback) {
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
