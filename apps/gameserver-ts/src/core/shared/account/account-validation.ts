/**
 * Validation primitives shared by the signup + character-creation flows.
 *
 * Kept dependency-free (no logger, no DB) so both the authd and gamed
 * handlers can use it and unit tests stay trivial. Rules mirror the legacy
 * Dofus 1.29 client constraints closely enough to feel familiar:
 *
 *   - account username : 3..32 chars, [a-z0-9_-], case-insensitive
 *   - pseudo (nick)    : 2..32 chars, letters/digits/space/hyphen
 *   - character name   : 3..20 chars, letters only (canonical 1.29 rule),
 *                        no leading/trailing space, starts with a letter
 */

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,32}$/;
const PSEUDO_RE = /^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,31}$/;
const CHARACTER_NAME_RE = /^[A-Za-z][A-Za-z-]{2,19}$/;
const MIN_PASSWORD_KEY_LENGTH = 8;

export function isValidUsername(username: string): boolean {
  return USERNAME_RE.test(username);
}

export function isValidPseudo(pseudo: string): boolean {
  return PSEUDO_RE.test(pseudo);
}

export function isValidCharacterName(name: string): boolean {
  return CHARACTER_NAME_RE.test(name);
}

/**
 * The client submits a base64 PBKDF2 key (44 chars for 32 bytes). We only
 * sanity-check presence + a floor on length: the actual cryptography lives
 * client-side, the server treats the value as an opaque credential.
 */
export function isAcceptablePasswordKey(key: string): boolean {
  return typeof key === "string" && key.length >= MIN_PASSWORD_KEY_LENGTH;
}

/** Canonical Dofus 1.29 class ids (1..12). */
export const CLASS_IDS: ReadonlySet<number> = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
]);

export function isValidClassId(classId: number): boolean {
  return CLASS_IDS.has(classId);
}

export function isValidSex(sex: number): boolean {
  return sex === 0 || sex === 1;
}

/**
 * `players.gfx` = class * 10 is the base Dofus 1.29 convention
 * (1 = Feca → 10 ... 12 = Pandawa → 120).
 */
export function gfxForClass(classId: number): number {
  return classId * 10;
}

/**
 * Class → spell-id range (inclusive). The ten original breeds use consecutive
 * blocks of 20: Feca 1-20, Osamodas 21-40, Enutrof 41-60, Sram 61-80, Xelor
 * 81-100, Ecaflip 101-120, Eniripsa 121-140, Iop 141-160, Cra 161-180, Sadida
 * 181-200. The later breeds live elsewhere: Sacrieur 431-450, Pandawa 686-705
 * (201-240 are monster spells such as "Béco du Tofu"). Verified against the
 * canonical `classes.json` lang bundle (`G[class].s`).
 *
 * NOTE: earlier revisions of this table used speculative ranges (Feca 401-411
 * etc.) whose ids do NOT exist in `spell_templates`, so new characters were
 * granted ZERO spells. This is the corrected source of truth, mirrored by
 * migrations 0037 + 0042 (Sacrieur / Pandawa repaired by 0044).
 */
export const BREED_SPELL_RANGES: ReadonlyArray<{
  cls: number;
  lo: number;
  hi: number;
}> = [
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
  { cls: 11, lo: 431, hi: 450 }, // Sacrieur
  { cls: 12, lo: 686, hi: 705 }, // Pandawa
];

/**
 * Canonical level-1 attack spell per breed — the single spell a fresh
 * character MUST own so it can deal damage in its first fight. These are the
 * `l1[2] === 1` (minLevel 1) offensive spells from the canonical lang bundle
 * (Feca → 3 "Attaque Naturelle", 5 AP, 1d5+1 neutral, range 1-6).
 */
export const BREED_STARTER_ATTACK: ReadonlyArray<{
  cls: number;
  spellId: number;
}> = [
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
  { cls: 11, spellId: 432 }, // Sacrieur — Pied du Sacrieur
  { cls: 12, spellId: 687 }, // Pandawa — Poing Enflammé
];

export function breedSpellRange(
  classId: number
): { lo: number; hi: number } | null {
  const entry = BREED_SPELL_RANGES.find((r) => r.cls === classId);
  return entry ? { lo: entry.lo, hi: entry.hi } : null;
}

/** Canonical level-1 attack spell id for a breed (see BREED_STARTER_ATTACK). */
export function breedStarterAttack(classId: number): number | null {
  const entry = BREED_STARTER_ATTACK.find((r) => r.cls === classId);
  return entry ? entry.spellId : null;
}
