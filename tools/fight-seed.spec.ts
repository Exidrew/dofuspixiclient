import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parsePlacementCells, splitFightPlaces } from "./dofus-maps.mjs";

const MAPS_FILE = join(import.meta.dir, "data", "incarnam-maps.json");
const maps: Record<string, { places?: string; count?: number }> = JSON.parse(
  readFileSync(MAPS_FILE, "utf8")
);

describe("fight placement cells (map_fight_places seed)", () => {
  test("le codec de placement décode la map de départ 10300", () => {
    const cells = parsePlacementCells("exeLeMe0ftfHfIfW");
    expect(cells).toEqual([279, 293, 294, 308, 339, 353, 354, 368]);
  });

  test("une chaîne vide/impaire/invalide renvoie []", () => {
    expect(parsePlacementCells("")).toEqual([]);
    expect(parsePlacementCells("abc")).toEqual([]);
    expect(parsePlacementCells("!!!!")).toEqual([]);
  });

  test("splitFightPlaces segmente 'places0|places1'", () => {
    expect(splitFightPlaces("aa|bb")).toEqual({ places0: "aa", places1: "bb" });
    expect(splitFightPlaces("no-separator")).toBeNull();
    expect(splitFightPlaces(undefined)).toBeNull();
  });

  test("chaque map figée à places valides a 2 équipes non vides", () => {
    let withPlaces = 0;
    let skipped = 0;
    for (const row of Object.values(maps)) {
      const split = splitFightPlaces(row.places);
      if (!split) {
        continue;
      }
      const t0 = parsePlacementCells(split.places0);
      const t1 = parsePlacementCells(split.places1);
      if (t0.length > 0 && t1.length > 0) {
        withPlaces++;
      } else {
        // A handful of frozen maps declare a malformed `places` (one side
        // empty) — the seed skips them, so they must not count.
        skipped++;
      }
    }
    // Most Incarnam maps are duel-ready; only a few are malformed.
    expect(withPlaces).toBeGreaterThan(50);
    expect(skipped).toBeLessThan(10);
  });

  test("aucune cellule de placement n'est hors des bornes de la map", () => {
    for (const [id, row] of Object.entries(maps)) {
      const split = splitFightPlaces(row.places);
      if (!split) {
        continue;
      }
      // `count` is the number of cells of the map; a placement cell id must
      // be within [0, count).
      const max = row.count ?? Number.POSITIVE_INFINITY;
      for (const cell of [
        ...parsePlacementCells(split.places0),
        ...parsePlacementCells(split.places1),
      ]) {
        expect(`${id}:${cell < max}`).toBe(`${id}:true`);
      }
    }
  });
});
