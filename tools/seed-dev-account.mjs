#!/usr/bin/env node
/**
 * Seed de développement — crée (ou répare) un compte jouable + un serveur de
 * jeu + un personnage, de façon cohérente avec le schéma attendu par
 * apps/gameserver-ts (Kysely + CamelCasePlugin).
 *
 * POURQUOI CE SCRIPT
 * ------------------
 * Le flux de connexion (authd puis pivot vers gamed) exige 6 conditions. Si
 * UNE seule manque, on tombe sur les logs fautifs du genre :
 *
 *   [SelectCharacterHandler] select-character: not found id=1 account=1
 *   accountCharacterSelected { success: false }
 *
 *   1. accounts.id                     ← le compte existe
 *   2. game_servers.id = $GAME_SERVER_ID (1 par défaut), state = 1 (ONLINE)
 *   3. account_servers(account_id, server_id)  ← nécessaire pour que la liste
 *      des serveurs (ServerListHandler) renvoie une entrée « sélectionnable »
 *   4. players.account_id  = accounts.id   (type bigint)
 *   5. players.server_id   = game_servers.id  ET  players.id = characterId
 *      sélectionné côté client  (SelectCharacterRepository.load filtre les 3)
 *   6. players.deleted_at  IS NULL
 *        + une ligne player_stats (INNER JOIN obligatoire dans load())
 *        + une ligne player_colors (LEFT JOIN, mais requise par le client)
 *
 * ⚠️  mismatch classique : `players.account_id` (ou `server_id`) créé « à la
 * main » ne correspond pas au compte/au serveur réellement en session, donc le
 * JOIN par account_id échoue silencieusement → success:false.
 *
 * Le serveur Accepte NB'IMPORTE QUEL mot de passe (LoginHandler : vérification
 * désactivée, « DEV ONLY »), donc pwd_hash peut rester vide.
 *
 * USAGE
 * -----
 *   DATABASE_URL=postgres://dofus:dofus@localhost:5432/dofus \
 *   node tools/seed-dev-account.mjs [--username admin] [--password admin] \
 *      [--server-id 1] [--character-name Admin] [--class 1] [--sex 0] [--gfx 10]
 *
 *   # valeurs par défaut : user=admin pass=admin serveur=1 perso="Admin" classe=1
 *
 * Le script est idempotent : relance-le autant de fois que nécessaire.
 */

import { randomUUID } from "node:crypto";
import process from "node:process";
import pg from "pg";

// ── Arguments ──────────────────────────────────────────────────────────────
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith("--") ? fallback : v;
}

const USERNAME = arg("username", "admin");
const PASSWORD = arg("password", "admin");
const PSEUDO = arg("pseudo", USERNAME);
const SERVER_ID = Number(arg("server-id", "1"));
const CHARACTER_NAME = arg("character-name", "Admin");
const CLASS_ID = Number(arg("class", "1")); // 1 = Féca, etc. (1..12)
const SEX = Number(arg("sex", "0"));
const GFX = Number(arg("gfx", "10"));
// Map/cell de départ : 10300/319 = valeurs par défaut du schéma (village).
const MAP_ID = Number(arg("map-id", "10300"));
const CELL_ID = Number(arg("cell", "319"));

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://dofus:dofus@localhost:5432/dofus";

if (!Number.isInteger(SERVER_ID) || SERVER_ID <= 0) {
  console.error(`server-id invalide: ${SERVER_ID}`);
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const log = (msg) => console.log(`  • ${msg}`);

async function upsertAccount(db, username) {
  const existing = await db.query(
    "SELECT id FROM accounts WHERE username = $1",
    [username]
  );
  if (existing.rows.length > 0) {
    const id = existing.rows[0].id;
    log(`account ${username} existe déjà (id=${id})`);
    return String(id);
  }
  const inserted = await db.query(
    `INSERT INTO accounts (username, pwd_hash, pseudo, community, is_admin, is_banned)
     VALUES ($1, '', $2, 0, false, false)
     RETURNING id`,
    [username, PSEUDO]
  );
  const id = inserted.rows[0].id;
  log(`account créé ${username} (id=${id})`);
  return String(id);
}

async function upsertGameServer(db, serverId) {
  const existing = await db.query("SELECT id FROM game_servers WHERE id = $1", [
    serverId,
  ]);
  if (existing.rows.length > 0) {
    // On force state=1 (ONLINE) + des places dispo : sans ça
    // SelectServerHandler refuse (SelectServerError.DOWN / FULL).
    await db.query(
      `UPDATE game_servers
         SET state = 1,
             online_players = 0,
             max_players = GREATEST(max_players, 2000)
       WHERE id = $1`,
      [serverId]
    );
    log(`game_servers id=${serverId} présent → state=1 (ONLINE)`);
    return;
  }
  await db.query(
    `INSERT INTO game_servers
       (id, name, address, port, state, community, max_players, online_players)
     VALUES ($1, $2, 'localhost', 8080, 1, 0, 2000, 0)`,
    [serverId, `Dev server ${serverId}`]
  );
  log(`game_servers créé id=${serverId} (address=localhost:8080, state=ONLINE)`);
}

async function upsertAccountServer(db, accountId, serverId) {
  await db.query(
    `INSERT INTO account_servers (account_id, server_id, character_count)
     VALUES ($1, $2, 0)
     ON CONFLICT (account_id, server_id) DO NOTHING`,
    [accountId, serverId]
  );
  log(`account_servers(${accountId}, ${serverId}) OK`);
}

/**
 * Crée — ou RÉPARE — le personnage. La réparation est le cœur du script :
 * si un perso homonyme existe déjà avec un mauvais account_id/server_id
 * (ou supprimé), on le recale au lieu d'entrer en conflit sur
 * uq_players_server_name.
 */
async function upsertCharacter(db, accountId, serverId) {
  const existing = await db.query(
    `SELECT id, account_id, server_id, deleted_at
       FROM players
      WHERE name = $1 AND server_id = $2`,
    [CHARACTER_NAME, serverId]
  );

  let playerId;
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    playerId = String(row.id);
    await db.query(
      `UPDATE players
          SET account_id = $1,
              deleted_at = NULL,
              gfx = $2,
              class = $3,
              sex = $4,
              map_id = $5,
              cell_id = $6,
              savepoint_map_id = $5,
              savepoint_cell_id = $6
        WHERE id = $7`,
      [
        accountId,
        GFX,
        CLASS_ID,
        SEX,
        MAP_ID,
        CELL_ID,
        playerId,
      ]
    );
    log(
      `player "${CHARACTER_NAME}" (id=${playerId}) réparé ` +
        `(account_id=${accountId}, server_id=${serverId}, deleted_at=NULL)`
    );
  } else {
    const inserted = await db.query(
      `INSERT INTO players
         (account_id, server_id, name, sex, class, gfx, level,
          experience, kamas, stats_points, spell_points, life, energy,
          map_id, cell_id, direction, savepoint_map_id, savepoint_cell_id)
       VALUES ($1, $2, $3, $4, $5, $6, 1, 0, 0, 0, 0, 55, 10000,
               $7, $8, 3, $7, $8)
       RETURNING id`,
      [accountId, serverId, CHARACTER_NAME, SEX, CLASS_ID, GFX, MAP_ID, CELL_ID]
    );
    playerId = String(inserted.rows[0].id);
    log(`player créé "${CHARACTER_NAME}" (id=${playerId})`);
  }

  // player_stats : INNER JOIN dans SelectCharacterRepository.load → OBLIGATOIRE.
  // Stats de départ minimales (6 partout) pour que les sorts infligent des
  // dégâts dès le niveau 1 ; les PA (6) / PM (3) de base sont hardcodés côté
  // serveur (Fighter.fromPlayer / Runner.refreshFighter), pas en base.
  await db.query(
    `INSERT INTO player_stats
       (player_id, strength, vitality, wisdom, intelligence, chance, agility)
     VALUES ($1, 6, 6, 6, 6, 6, 6)
     ON CONFLICT (player_id) DO NOTHING`,
    [playerId]
  );
  // player_colors : LEFT JOIN, mais le client attend color1..3 (sinon -1).
  await db.query(
    `INSERT INTO player_colors (player_id, color1, color2, color3)
     VALUES ($1, -1, -1, -1)
     ON CONFLICT (player_id) DO NOTHING`,
    [playerId]
  );

  // character_count sur account_servers (purement informatif côté UI).
  await db.query(
    `UPDATE account_servers
        SET character_count = (
          SELECT COUNT(*) FROM players
           WHERE account_id = $1 AND server_id = $2 AND deleted_at IS NULL
        )
      WHERE account_id = $1 AND server_id = $2`,
    [accountId, serverId]
  );

  // Spells de départ (facultatif) : si la table class_starter_spells est seedée.
  const starters = await db.query(
    "SELECT spell_id, level, position FROM class_starter_spells WHERE class_id = $1",
    [CLASS_ID]
  );
  for (const s of starters.rows) {
    await db.query(
      `INSERT INTO player_spells (player_id, spell_id, level, position)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (player_id, spell_id) DO NOTHING`,
      [playerId, s.spell_id, s.level ?? 1, s.position ?? -1]
    );
  }
  if (starters.rows.length > 0) {
    log(`${starters.rows.length} sort(s) de départ ajouté(s)`);
  }

  return playerId;
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Seed dev — ${DATABASE_URL}`);
  const db = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: false,
  });
  await db.connect();
  try {
    // Garde-fou : tables présentes (migrations jouées) ?
    const check = await db.query(
      "SELECT to_regclass('public.players') AS t, to_regclass('public.game_servers') AS g"
    );
    if (!check.rows[0].t || !check.rows[0].g) {
      console.error(
        "Tables manquantes : lance d'abord les migrations " +
          "(just db-migrate / bun run db:migrate)."
      );
      process.exit(1);
    }

    const accountId = await upsertAccount(db, USERNAME);
    await upsertGameServer(db, SERVER_ID);
    await upsertAccountServer(db, accountId, SERVER_ID);
    const playerId = await upsertCharacter(db, accountId, SERVER_ID);

    console.log("");
    console.log("✓ Prêt. Connect-toi avec :");
    console.log(`    username : ${USERNAME}`);
    console.log(
      `    password : ${PASSWORD} (n'importe quoi en fait — vérif désactivée en DEV)`
    );
    console.log(`    serveur  : id=${SERVER_ID}`);
    console.log(`    perso    : "${CHARACTER_NAME}" (id=${playerId})`);
    console.log("");
    console.log(
      "Rappel : GAME_SERVER_ID du core doit valoir " +
        `${SERVER_ID} (env GAME_SERVER_ID).`
    );
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error("Seed échoué :", err.message);
  process.exit(1);
});
