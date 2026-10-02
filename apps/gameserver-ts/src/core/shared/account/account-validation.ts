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
 * Class → spell-id range (inclusive), the same convention used by migration
 * 0037 (see BREED_RANGES). Used to grant a new character its starting kit
 * when `class_starter_spells` has no row for the class.
 */
export const BREED_SPELL_RANGES: ReadonlyArray<{
  cls: number;
  lo: number;
  hi: number;
}> = [
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

export function breedSpellRange(
  classId: number
): { lo: number; hi: number } | null {
  const entry = BREED_SPELL_RANGES.find((r) => r.cls === classId);
  return entry ? { lo: entry.lo, hi: entry.hi } : null;
}
