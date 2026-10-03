import { type Kysely, sql } from "kysely";

/**
 * Ensures every EXISTING character has their breed's starter attack in
 * the action bar.
 *
 * 0036 gives every player every spell at position = -1, and 0037 slots
 * the breed spells 1..N by ascending spell id. For a Feca that means the
 * starter attack (id 3, "Attaque Naturelle") ends up in slot 3 rather
 * than slot 1 — and characters created before class_starter_spells was
 * seeded (0042) never got the spell at all. Either way the player could
 * not find their basic attack in the bar.
 *
 * This migration:
 *   1. inserts any missing starter attack into player_spells, and
 *   2. pins it to position 1 (slot 0), moving whatever occupied slot 0
 *      to the attack's previous position so nothing is lost.
 *
 * Idempotent: re-running it is a no-op once the attack is already at
 * position 1 (or the slots are already consistent).
 */
const BREED_STARTER_ATTACK: ReadonlyArray<{ cls: number; spellId: number }> = [
  { cls: 1, spellId: 3 }, // Feca — Attaque Naturelle
  { cls: 2, spellId: 21 }, // Osamodas — Griffe Spectrale
  { cls: 3, spellId: 43 }, // Enutrof — Lancer de Pelle
  { cls: 4, spellId: 61 }, // Sram — Sournoiserie
  { cls: 5, spellId: 81 }, // Xelor — Ralentissement
  { cls: 6, spellId: 101 }, // Ecaflip — Roulette
  { cls: 7, spellId: 121 }, // Eniripsa — Mot Curatif
  { cls: 8, spellId: 141 }, // Iop — Pression
  { cls: 9, spellId: 161 }, // Cra — Flèche Magique
  { cls: 10, spellId: 181 }, // Sadida — Tremblement
  { cls: 11, spellId: 201 }, // Sacrieur — Béco du Tofu
  { cls: 12, spellId: 221 }, // Pandawa — Pince
];

export async function up(db: Kysely<never>): Promise<void> {
  for (const { cls, spellId } of BREED_STARTER_ATTACK) {
    // Only if the spell template actually exists (avoid FK failures on a
    // partially-seeded database).
    const exists = await sql<{ ok: boolean }>`
      SELECT EXISTS(
        SELECT 1 FROM spell_templates WHERE id = ${spellId}
      ) AS ok
    `.execute(db);
    if (!exists.rows[0]?.ok) {
      continue;
    }

    // 1. Insert the starter attack for every character of this breed that
    //    doesn't have it yet, unslotted for now.
    await sql`
      INSERT INTO player_spells (player_id, spell_id, level, position)
      SELECT p.id, ${spellId}, 1, -1
      FROM players p
      WHERE p.class = ${cls}
        AND p.deleted_at IS NULL
      ON CONFLICT (player_id, spell_id) DO NOTHING
    `.execute(db);

    // 2. Free slot 0 for the attack: whatever spell currently sits there
    //    moves to the attack's old position (swap). Done in two steps so
    //    we never momentarily collide on the same position within one
    //    breed. Only touch rows that are actually out of place.
    await sql`
      WITH target AS (
        SELECT ps.player_id, ps.spell_id, ps.position AS old_pos
        FROM player_spells ps
        JOIN players p ON p.id = ps.player_id
        WHERE p.class = ${cls}
          AND p.deleted_at IS NULL
          AND ps.spell_id = ${spellId}
          AND ps.position <> 1
      ),
      occupant AS (
        SELECT ps.player_id, ps.spell_id
        FROM player_spells ps
        JOIN target t ON t.player_id = ps.player_id
        WHERE ps.position = 1
          AND ps.spell_id <> ${spellId}
      )
      UPDATE player_spells ps
      SET position = t.old_pos
      FROM target t
      WHERE ps.player_id = t.player_id
        AND ps.spell_id IN (SELECT spell_id FROM occupant o
                            WHERE o.player_id = t.player_id)
    `.execute(db);

    await sql`
      UPDATE player_spells ps
      SET position = 1
      FROM players p
      WHERE p.id = ps.player_id
        AND p.class = ${cls}
        AND p.deleted_at IS NULL
        AND ps.spell_id = ${spellId}
    `.execute(db);
  }
}

export async function down(_db: Kysely<never>): Promise<void> {
  // Data-only repair; nothing to roll back.
}
