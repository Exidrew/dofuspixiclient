import { type Kysely, sql } from "kysely";

/**
 * The player-facing "Retour du bâton" is spell 8 (sorts.sprite = -1, so it
 * kept visual_gfx_id = spell id = 8 and no 8.dofasset exists → no VFX).
 * Experimentally point it at gfx 1014. Spell 4029 (monster variant, set in
 * 0046) is kept in sync.
 */
export async function up(db: Kysely<never>): Promise<void> {
  await sql`
    UPDATE spell_levels SET visual_gfx_id = 1014 WHERE spell_id IN (8, 4029)
  `.execute(db);
}

export async function down(db: Kysely<never>): Promise<void> {
  await sql`
    UPDATE spell_levels SET visual_gfx_id = 0 WHERE spell_id IN (8, 4029)
  `.execute(db);
}
