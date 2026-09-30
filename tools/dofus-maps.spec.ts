import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { decodeCells } from "../apps/gameserver-ts/src/core/modules/maps/maps.cells-codec";
import {
  CELL_CHAR_LEN,
  cellsCountOf,
  decodeHashCells,
  encodeHashCells,
  extractMapGeometry,
  findDims,
  pack60,
  unpack60,
} from "./dofus-maps.mjs";

const MAPS_FILE = join(import.meta.dir, "data", "incarnam-maps.json");
const maps: Record<string, { mapData: string; width: number; height: number }> =
  JSON.parse(readFileSync(MAPS_FILE, "utf8"));

describe("incarnam-maps.json (données figées du projet)", () => {
  test("contient la map de départ 10300", () => {
    expect(maps["10300"]).toBeDefined();
  });

  test("la map 10300 a 479 cellules et une date", () => {
    const row = maps["10300"];
    expect(row?.mapData.length).toBe(4790);
    expect(row?.mapData.length / CELL_CHAR_LEN).toBe(479);
  });

  test("toutes les géométries déclarées expliquent le compte de cellules", () => {
    for (const [id, row] of Object.entries(maps)) {
      const count = row.mapData.length / CELL_CHAR_LEN;
      expect(`${id}:${cellsCountOf(row.width, row.height)}`).toBe(
        `${id}:${count}`
      );
    }
  });
});

describe("codec HASH_CELL (round-trip)", () => {
  test("pack60 est l'inverse exact de unpack60", () => {
    const payload = maps["10300"].mapData;
    const raw = Buffer.from(payload, "ascii");
    const count = raw.length / CELL_CHAR_LEN;
    for (let i = 0; i < count; i++) {
      const plan = unpack60(raw, i * CELL_CHAR_LEN);
      const chunk = encodeHashCells([plan]);
      expect(chunk).toBe(
        payload.slice(i * CELL_CHAR_LEN, (i + 1) * CELL_CHAR_LEN)
      );
    }
  });

  test("decode → encode restitue le payload d'origine", () => {
    const payload = maps["10300"].mapData;
    expect(encodeHashCells(decodeHashCells(payload))).toBe(payload);
  });

  test("pack60(unpack60(x)) === x sur tout le payload", () => {
    const raw = Buffer.from(maps["10300"].mapData, "ascii");
    const count = raw.length / CELL_CHAR_LEN;
    for (let i = 0; i < count; i++) {
      expect(pack60(unpack60(raw, i * CELL_CHAR_LEN))).toBe(
        maps["10300"].mapData.slice(i * CELL_CHAR_LEN, (i + 1) * CELL_CHAR_LEN)
      );
    }
  });
});

describe("findDims", () => {
  // Convention CANONIQUE : cells = width*height + (width-1)*(height-1), où
  // height = nombre de PAIRES de lignes (pas de lignes alternées 2h-1).
  test("retrouve la géométrie 15x17 pour 479 cellules (map 10300)", () => {
    expect(findDims(479, 15)).toEqual({ width: 15, height: 17 });
  });

  test("privilégie la largeur du défaut client (15)", () => {
    expect(findDims(479, 15)?.width).toBe(15);
  });

  // NON-RÉGRESSION du décalage vertical : une map Dofus standard 15x17 doit
  // rendre height=17 (pas 33). Un height double faisait déborder
  // computeMapScale() avec un offsetY négatif -> carte décalée vers le haut.
  test("ne renvoie jamais 15x33 pour 479 cellules (bug du décalage)", () => {
    expect(findDims(479, 15)).not.toEqual({ width: 15, height: 33 });
  });
});

describe("extractMapGeometry", () => {
  test("donne 15x17 pour la map 10300", () => {
    const geo = extractMapGeometry(maps["10300"]);
    expect(geo).toEqual({ width: 15, height: 17, count: 479 });
  });

  test("rejette un payload anormal (958 cellules) au lieu d'une géométrie absurde", () => {
    // 958 = 2x479 : seule décomposition 3x192, invalide. On doit refuser.
    expect(() =>
      extractMapGeometry({ width: 15, height: 17, mapData: "a".repeat(9580) })
    ).toThrow();
  });
});

describe("cells → codec serveur", () => {
  test("le payload 10300 est décodable par maps.cells-codec.ts (479 cellules)", () => {
    const buf = Buffer.from(maps["10300"].mapData, "ascii");
    const cells = decodeCells(new Uint8Array(buf));
    expect(cells).toHaveLength(479);
  });
});
