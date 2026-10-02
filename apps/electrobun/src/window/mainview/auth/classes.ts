/**
 * Canonical Dofus 1.29 breed (class) metadata for the pre-game screens.
 *
 * `gfx` follows the base-game convention gfx = classId * 10 (1 = Féca → 10,
 * 12 = Pandawa → 120); the matching `.dofasset` sprite exists for all 12.
 * `accent` is the class identity colour used by the selector cards — pulled
 * from the in-game class emblems so the UI feels native to Dofus.
 */
export interface ClassInfo {
  id: number;
  name: string;
  gfx: number;
  /** Short one-liner shown under the class name. */
  tagline: string;
  /** Primary identity colour (hex). */
  accent: string;
  /** Elemental affinity, drives the small element chip. */
  element: "Terre" | "Feu" | "Eau" | "Air" | "Neutre";
}

export const CLASSES: readonly ClassInfo[] = [
  {
    id: 1,
    name: "Féca",
    gfx: 10,
    tagline: "Protecteur au bâton, bouclier de l'équipe.",
    accent: "#4a90d9",
    element: "Neutre",
  },
  {
    id: 2,
    name: "Osamodas",
    gfx: 20,
    tagline: "Invocateur de créatures, maître des bêtes.",
    accent: "#8e6e3c",
    element: "Terre",
  },
  {
    id: 3,
    name: "Enutrof",
    gfx: 30,
    tagline: "Chercheur d'or, collectionneur de richesses.",
    accent: "#d4a017",
    element: "Eau",
  },
  {
    id: 4,
    name: "Sram",
    gfx: 40,
    tagline: "Assassin des ombres, maître des pièges.",
    accent: "#6b4b8a",
    element: "Air",
  },
  {
    id: 5,
    name: "Xélor",
    gfx: 50,
    tagline: "Maître du temps, manipulateur des horloges.",
    accent: "#3f6f8f",
    element: "Feu",
  },
  {
    id: 6,
    name: "Ecaflip",
    gfx: 60,
    tagline: "Joueur de hasard, chance ou malchance.",
    accent: "#c9762b",
    element: "Terre",
  },
  {
    id: 7,
    name: "Eniripsa",
    gfx: 70,
    tagline: "Guérisseuse infatigable, soutien du groupe.",
    accent: "#c94f8c",
    element: "Eau",
  },
  {
    id: 8,
    name: "Iop",
    gfx: 80,
    tagline: "Guerrier fougueux, force brute et courage.",
    accent: "#c0392b",
    element: "Terre",
  },
  {
    id: 9,
    name: "Cra",
    gfx: 90,
    tagline: "Archère d'élite, reine de la distance.",
    accent: "#4cae4c",
    element: "Air",
  },
  {
    id: 10,
    name: "Sadida",
    gfx: 100,
    tagline: "Semeuse de poupées, amie de la nature.",
    accent: "#3e8e41",
    element: "Terre",
  },
  {
    id: 11,
    name: "Sacrieur",
    gfx: 110,
    tagline: "Berserker qui puise sa force dans ses blessures.",
    accent: "#a03e3e",
    element: "Neutre",
  },
  {
    id: 12,
    name: "Pandawa",
    gfx: 120,
    tagline: "Bon vivant porté sur la boisson et la bagarre.",
    accent: "#e0a030",
    element: "Eau",
  },
] as const;

export function classById(id: number): ClassInfo | undefined {
  return CLASSES.find((c) => c.id === id);
}

/** Reverse the gfx = class * 10 convention (used to label listed characters). */
export function classFromGfx(gfx: number): ClassInfo | undefined {
  return CLASSES.find((c) => c.gfx === gfx);
}

/**
 * Default 3-slot colour palette applied to a new character. `-1` means
 * "use the class default" and is exactly what the legacy client sent when a
 * colour was left untouched.
 */
export const DEFAULT_COLORS = [-1, -1, -1] as const;

/**
 * Colour choices offered per slot. The legacy client exposes a large palette
 * editing view; for the creation screen we surface a curated, on-brand set of
 * 12 that covers skin, cloth and hair zones convincingly.
 */
export const COLOR_PALETTE: readonly number[] = [
  0xffffff, 0xf5d6b0, 0xe0ac69, 0xc68642, 0x8d5524, 0x5a3825, 0xd94141,
  0xe07b39, 0xf2c14e, 0x4cae4c, 0x4a90d9, 0x6b4b8a,
] as const;

/** Render a packed-int colour as a CSS #rrggbb string. */
export function colorToCss(value: number): string {
  return `#${(value & 0xffffff).toString(16).padStart(6, "0")}`;
}
