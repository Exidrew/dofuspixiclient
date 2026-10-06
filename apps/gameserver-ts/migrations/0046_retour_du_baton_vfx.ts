import { type Kysely, sql } from "kysely";

/**
 * Retour du Bâton (spell 4029, monster spell) has no row in the StarLoco
 * `sorts` mapping, so it fell back to gfx = spell id (4029) and no
 * `4029.dofasset` exists → no VFX. Experimentally point it at gfx 1014.
 * Revert by setting visual_gfx_id back to 0 if 1014 turns out to be wrong.
 */
export async function up(db: Kysely<never>): Promise<void> {
  await sql`
    UPDATE spell_levels SET visual_gfx_id = 1014 WHERE spell_id = 4029
  `.execute(db);
}

export async function down(db: Kysely<never>): Promise<void> {
  await sql`
    UPDATE spell_levels SET visual_gfx_id = 0 WHERE spell_id = 4029
  `.execute(db);
}
