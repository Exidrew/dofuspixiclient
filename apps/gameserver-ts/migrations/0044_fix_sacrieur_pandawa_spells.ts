import { type Kysely, sql } from "kysely";

/**
 * Sacrieur / Pandawa spell repair. Migrations 0037 / 0042 / 0043 assumed the
 * twelve breeds used consecutive 20-spell blocks, which only holds for the ten
 * original breeds. Ids 201-240 are monster spells ("Béco du Tofu", "Pince"…);
 * the canonical `classes.json` lang bundle places the Sacrieur at 431-450 and
 * the Pandawa at 686-705.
 *
 * For both classes this:
 *   1. rebuilds `class_starter_spells` (starter attack pinned to position 1);
 *   2. removes the wrongly granted 201-240 spells from existing characters,
 *      grants the real breed spells and slots them into the free hotbar
 *      cells 1..HOTBAR_SLOTS (starter attack first), keeping existing slots.
 *
 * Idempotent.
 */
const FIXES: ReadonlyArray<{
  cls: number;
  lo: number;
  hi: number;
  attack: number;
  wrongLo: number;
  wrongHi: number;
}> = [
  // Sacrieur — Pied du Sacrieur
  { cls: 11, lo: 431, hi: 450, attack: 432, wrongLo: 201, wrongHi: 220 },
  // Pandawa — Poing Enflammé
  { cls: 12, lo: 686, hi: 705, attack: 687, wrongLo: 221, wrongHi: 240 },
];

const HOTBAR_SLOTS = 14;

export async function up(db: Kysely<never>): Promise<void> {
  for (const { cls, lo, hi, attack, wrongLo, wrongHi } of FIXES) {
    await sql`
      DELETE FROM class_starter_spells
      WHERE class_id = ${cls}
        AND spell_id NOT BETWEEN ${lo} AND ${hi}
    `.execute(db);

    await sql`
      INSERT INTO class_starter_spells (class_id, spell_id, level, position)
      SELECT
        ${cls},
        st.id,
        1,
        ROW_NUMBER() OVER (ORDER BY (st.id = ${attack}) DESC, st.id ASC)
      FROM spell_templates st
      WHERE st.id BETWEEN ${lo} AND ${hi}
      ON CONFLICT (class_id, spell_id) DO UPDATE
        SET level = EXCLUDED.level,
            position = EXCLUDED.position
    `.execute(db);

    await sql`
      DELETE FROM player_spells ps
      USING players p
      WHERE p.id = ps.player_id
        AND p.class = ${cls}
        AND ps.spell_id BETWEEN ${wrongLo} AND ${wrongHi}
    `.execute(db);

    await sql`
      INSERT INTO player_spells (player_id, spell_id, level, position)
      SELECT p.id, css.spell_id, css.level, -1
      FROM players p
      JOIN class_starter_spells css ON css.class_id = p.class
      WHERE p.class = ${cls}
      ON CONFLICT (player_id, spell_id) DO NOTHING
    `.execute(db);
  }

  const { rows } = await sql<{
    playerId: string;
    spellId: number;
    position: number;
    starterOrder: number | null;
  }>`
    SELECT
      ps.player_id AS "playerId",
      ps.spell_id AS "spellId",
      ps.position AS "position",
      css.position AS "starterOrder"
    FROM player_spells ps
    JOIN players p ON p.id = ps.player_id
    LEFT JOIN class_starter_spells css
      ON css.class_id = p.class AND css.spell_id = ps.spell_id
    WHERE p.class IN (11, 12)
    ORDER BY ps.player_id, css.position NULLS LAST, ps.spell_id
  `.execute(db);

  const byPlayer = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byPlayer.get(row.playerId) ?? [];
    list.push(row);
    byPlayer.set(row.playerId, list);
  }

  for (const [playerId, spells] of byPlayer) {
    const used = new Set(
      spells
        .filter((s) => s.position >= 1 && s.position <= HOTBAR_SLOTS)
        .map((s) => s.position)
    );
    for (const spell of spells) {
      if (spell.starterOrder === null) {
        continue;
      }
      if (spell.position >= 1 && spell.position <= HOTBAR_SLOTS) {
        continue;
      }
      let slot = 1;
      while (slot <= HOTBAR_SLOTS && used.has(slot)) {
        slot++;
      }
      if (slot > HOTBAR_SLOTS) {
        break;
      }
      used.add(slot);
      await sql`
        UPDATE player_spells SET position = ${slot}
        WHERE player_id = ${playerId} AND spell_id = ${spell.spellId}
      `.execute(db);
    }
  }
}

export async function down(_db: Kysely<never>): Promise<void> {
  // Data repair only — the previous rows were monster spells.
}
