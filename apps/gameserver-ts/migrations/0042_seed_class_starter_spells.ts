import { type Kysely, sql } from "kysely";

/**
 * Seeds `class_starter_spells` so a freshly-created character always has a
 * usable spell bar (see CharacterCreateRepository.resolveStarterSpells).
 *
 * ── Corrected breed spell ranges ────────────────────────────────────────────
 * Dofus 1.29 lays out the 12 breed spell sets CONSECUTIVELY in blocks of 20:
 * Feca 1-20, Osamodas 21-40, Enutrof 41-60, Sram 61-80, Xelor 81-100,
 * Ecaflip 101-120, Eniripsa 121-140, Iop 141-160, Cra 161-180, Sadida 181-200,
 * Sacrieur 201-220, Pandawa 221-240. (Verified against the canonical lang
 * bundle: every id in 1..240 resolves to a spell whose `l1[9]` classId matches
 * its block.) The previous speculative ranges (Feca 401-411, ...) referenced
 * ids that DO NOT exist in `spell_templates` — so new characters ended up with
 * ZERO spells and could not attack. This is the fix.
 *
 * ── Starter attack ──────────────────────────────────────────────────────────
 * Each breed's canonical level-1 attack spell is forced to POSITION 1 so the
 * character can deal damage in its very first fight without opening the spell
 * book. (Feca → 3 "Attaque Naturelle", 5 AP, 1d5+1 neutral, range 1-6.)
 *
 * Only ids that actually exist in `spell_templates` are kept, and positions
 * are assigned 1..N in id order (with the starter attack pinned first).
 *
 * Idempotent: ON CONFLICT (class_id, spell_id) DO UPDATE.
 */
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

/** Canonical level-1 attack spell per breed (pinned to position 1). */
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
  for (const { cls, lo, hi } of BREED_RANGES) {
    const attack = BREED_STARTER_ATTACK.find((a) => a.cls === cls)?.spellId;

    // Position: the starter attack is pinned first (ORDER BY puts it at rank
    // 1), then the remaining breed spells in id order. Only spells that exist
    // in `spell_templates` are considered.
    await sql`
      INSERT INTO class_starter_spells (class_id, spell_id, level, position)
      SELECT
        ${cls},
        st.id,
        1,
        ROW_NUMBER() OVER (
          ORDER BY (st.id = ${attack}) DESC, st.id ASC
        )
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
