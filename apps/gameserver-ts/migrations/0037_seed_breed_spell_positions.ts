import { type Kysely, sql } from "kysely";

/**
 * 0036_seed_all_spells gave every player every spell_template row at
 * `position = -1`, which makes the client's fight HUD fall back to a
 * broken "all 283 spells in insertion order" view full of internal
 * ids (0 = weapon attack, 1..99 = server-only). The original client
 * only ever slots a breed's own spells (11 per breed) into the bar.
 *
 * This migration walks every player and assigns `position = 1..N` to
 * the spells within their breed's id range, preserving spell-id
 * order. Non-breed spells stay at -1 (known-but-unslotted). Idempotent
 * via ROW_NUMBER(), safe to re-run.
 *
 * Breed → spell-id range mapping is the Dofus 1.29 convention (see
 * original ActionScript dofus.datacenter.Breed).
 */

// Dofus 1.29 class -> starting spell id range. Inclusive bounds.
// The 12 breed spell sets are laid out CONSECUTIVELY in blocks of 20
// (Feca 1-20, Osamodas 21-40, ...). The previous speculative ranges
// (Feca 401-411, ...) pointed at ids that do not exist in
// `spell_templates`, so no player ever got a slotted spell.
const BREED_RANGES: ReadonlyArray<{ cls: number; lo: number; hi: number }> = [
  { cls: 1, lo: 1, hi: 20 }, // Feca
  { cls: 2, lo: 21, hi: 40 }, // Osamodas
  { cls: 3, lo: 41, hi: 60 }, // Enutrof
  { cls: 4, lo: 61, hi: 80 }, // Sram
  { cls: 5, lo: 81, hi: 100 }, // Xelor
  { cls: 6, lo: 101, hi: 120 }, // Ecaflip
  { cls: 7, lo: 121, hi: 140 }, // Eniripsa
  { cls: 8, lo: 141, hi: 160 }, // Iop
  { cls: 9, lo: 161, hi: 180 }, // Cra
  { cls: 10, lo: 181, hi: 200 }, // Sadida
  { cls: 11, lo: 201, hi: 220 }, // Sacrieur
  { cls: 12, lo: 221, hi: 240 }, // Pandawa
];

export async function up(db: Kysely<never>): Promise<void> {
  for (const { cls, lo, hi } of BREED_RANGES) {
    await sql`
      WITH ranked AS (
        SELECT
          ps.player_id,
          ps.spell_id,
          ROW_NUMBER() OVER (
            PARTITION BY ps.player_id
            ORDER BY ps.spell_id
          ) AS row_pos
        FROM player_spells ps
        JOIN players p ON p.id = ps.player_id
        WHERE p.class = ${cls}
          AND ps.spell_id BETWEEN ${lo} AND ${hi}
      )
      UPDATE player_spells
      SET position = ranked.row_pos
      FROM ranked
      WHERE player_spells.player_id = ranked.player_id
        AND player_spells.spell_id = ranked.spell_id
    `.execute(db);
  }
}

export async function down(db: Kysely<never>): Promise<void> {
  // Revert any positive positions we set back to -1. Only touches
  // breed spells — manually re-slotted spells outside the breed
  // range are unaffected.
  for (const { cls, lo, hi } of BREED_RANGES) {
    await sql`
      UPDATE player_spells
      SET position = -1
      FROM players p
      WHERE p.id = player_spells.player_id
        AND p.class = ${cls}
        AND player_spells.spell_id BETWEEN ${lo} AND ${hi}
    `.execute(db);
  }
}
