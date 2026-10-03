import { type Kysely, sql } from "kysely";

/**
 * Repairs breed spells on databases that applied 0037 / 0042 BEFORE those
 * migrations were corrected in place (Feca 401-411 -> 1-20, ...). Kysely never
 * re-runs an applied migration, so those databases kept:
 *   - `class_starter_spells` rows pointing at the legacy speculative ids
 *     (Feca 410/411, Iop 101-111 = Ecaflip spells, ...), so new characters were
 *     created without their real breed spells (no "Attaque Naturelle");
 *   - characters owning those legacy ids instead of their breed spells.
 *
 * This migration:
 *   1. rebuilds `class_starter_spells` from the corrected breed ranges (starter
 *      attack pinned to position 1), dropping every out-of-range row;
 *   2. for every character, removes the legacy-range spells granted by the old
 *      seed (only ids outside the character's real breed range), grants the
 *      missing breed spells, and slots unslotted breed spells into the free
 *      hotbar cells 1..HOTBAR_SLOTS (starter attack first). Existing slots are
 *      kept.
 *
 * Idempotent: safe on fresh databases (0042 already correct) and re-runs.
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

/** Speculative ranges shipped by the original 0037 / 0042. */
const LEGACY_RANGES: ReadonlyArray<{ cls: number; lo: number; hi: number }> = [
  { cls: 1, lo: 401, hi: 411 },
  { cls: 2, lo: 201, hi: 211 },
  { cls: 3, lo: 301, hi: 311 },
  { cls: 4, lo: 501, hi: 511 },
  { cls: 5, lo: 701, hi: 711 },
  { cls: 6, lo: 601, hi: 611 },
  { cls: 7, lo: 901, hi: 911 },
  { cls: 8, lo: 101, hi: 111 },
  { cls: 9, lo: 1001, hi: 1011 },
  { cls: 10, lo: 1101, hi: 1111 },
  { cls: 11, lo: 1201, hi: 1211 },
  { cls: 12, lo: 2001, hi: 2011 },
];

const BREED_STARTER_ATTACK: ReadonlyArray<{ cls: number; spellId: number }> = [
  { cls: 1, spellId: 3 },
  { cls: 2, spellId: 21 },
  { cls: 3, spellId: 43 },
  { cls: 4, spellId: 61 },
  { cls: 5, spellId: 81 },
  { cls: 6, spellId: 101 },
  { cls: 7, spellId: 121 },
  { cls: 8, spellId: 141 },
  { cls: 9, spellId: 161 },
  { cls: 10, spellId: 181 },
  { cls: 11, spellId: 201 },
  { cls: 12, spellId: 221 },
];

/** Hotbar cells shown by the client banner (positions are 1-based). */
const HOTBAR_SLOTS = 14;

export async function up(db: Kysely<never>): Promise<void> {
  for (const { cls, lo, hi } of BREED_RANGES) {
    const attack =
      BREED_STARTER_ATTACK.find((a) => a.cls === cls)?.spellId ?? -1;

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
  }

  for (const legacy of LEGACY_RANGES) {
    const breed = BREED_RANGES.find((b) => b.cls === legacy.cls);
    if (!breed) {
      continue;
    }
    await sql`
      DELETE FROM player_spells ps
      USING players p
      WHERE p.id = ps.player_id
        AND p.class = ${legacy.cls}
        AND ps.spell_id BETWEEN ${legacy.lo} AND ${legacy.hi}
        AND ps.spell_id NOT BETWEEN ${breed.lo} AND ${breed.hi}
    `.execute(db);
  }

  // Grant every missing breed spell (unslotted for now).
  await sql`
    INSERT INTO player_spells (player_id, spell_id, level, position)
    SELECT p.id, css.spell_id, css.level, -1
    FROM players p
    JOIN class_starter_spells css ON css.class_id = p.class
    ON CONFLICT (player_id, spell_id) DO NOTHING
  `.execute(db);

  // Slot unslotted breed spells into the free hotbar cells, starter attack
  // first, keeping whatever the player already arranged.
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
  // Data repair only — the legacy rows pointed at wrong spells and are not
  // worth restoring.
}
