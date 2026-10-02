import { type Kysely, sql } from "kysely";

/**
 * Seeds `class_starter_spells` so a freshly-created character always has a
 * usable spell bar without depending on the broad "every spell at -1" rows
 * inserted by migration 0036.
 *
 * Nothing populated this table before (grep of the migration folder found only
 * readers), so character creation had to guess the starter kit. We now seed
 * the canonical Dofus 1.29 breed spell ranges (same BREED_RANGES convention as
 * migration 0037), keeping only ids that exist in `spell_templates` and
 * assigning positions 1..N in id order.
 *
 * Idempotent: ON CONFLICT (class_id, spell_id) DO UPDATE.
 */
const BREED_RANGES: ReadonlyArray<{ cls: number; lo: number; hi: number }> = [
  { cls: 1, lo: 401, hi: 411 }, // Feca
  { cls: 2, lo: 201, hi: 211 }, // Osamodas
  { cls: 3, lo: 301, hi: 311 }, // Enutrof
  { cls: 4, lo: 501, hi: 511 }, // Sram
  { cls: 5, lo: 701, hi: 711 }, // Xelor
  { cls: 6, lo: 601, hi: 611 }, // Ecaflip
  { cls: 7, lo: 901, hi: 911 }, // Eniripsa
  { cls: 8, lo: 101, hi: 111 }, // Iop
  { cls: 9, lo: 1001, hi: 1011 }, // Cra
  { cls: 10, lo: 1101, hi: 1111 }, // Sadida
  { cls: 11, lo: 1201, hi: 1211 }, // Sacrieur
  { cls: 12, lo: 2001, hi: 2011 }, // Pandawa
];

export async function up(db: Kysely<never>): Promise<void> {
  for (const { cls, lo, hi } of BREED_RANGES) {
    await sql`
      INSERT INTO class_starter_spells (class_id, spell_id, level, position)
      SELECT
        ${cls},
        st.id,
        1,
        ROW_NUMBER() OVER (ORDER BY st.id)
      FROM spell_templates st
      WHERE st.id BETWEEN ${lo} AND ${hi}
      ON CONFLICT (class_id, spell_id) DO UPDATE
        SET level = EXCLUDED.level,
            position = EXCLUDED.position
    `.execute(db);
  }
}

export async function down(db: Kysely<never>): Promise<void> {
  for (const { cls } of BREED_RANGES) {
    await sql`
      DELETE FROM class_starter_spells WHERE class_id = ${cls}
    `.execute(db);
  }
}
