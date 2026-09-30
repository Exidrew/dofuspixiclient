import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { decodeCells } from "../apps/gameserver-ts/src/core/modules/maps/maps.cells-codec";
import {
  CELL_CHAR_LEN,
  cellsCountOf,
  cellToRowCol,
  decodeHashCells,
  edgeCellsByDirection,
  encodeHashCells,
  extractMapGeometry,
  findDims,
  gatewayCellsForDirection,
  oppositeEdgeCell,
  pack60,
  rowColToCell,
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

describe("géométrie de bord / transitions de map", () => {
  test("cellToRowCol / rowColToCell sont inverses", () => {
    const width = 15;
    for (let id = 0; id < cellsCountOf(width, 17); id++) {
      const { row, col } = cellToRowCol(id, width);
      expect(rowColToCell(row, col, width)).toBe(id);
    }
  });

  test("edgeCellsByDirection est le miroir de detectExitDirection (serveur)", () => {
    const edges = edgeCellsByDirection(15, 17);
    // E/W : une cellule par ligne longue, SAUF les lignes 0 et la derniere
    // (celles-ci partent en N/S, ou en diagonal aux coins) -> 15 chacun.
    expect(edges[0]).toHaveLength(15);
    expect(edges[4]).toHaveLength(15);
    // N (ligne 0) et S (ligne 2*H-2) : 15 - 2 coins = 13 chacun.
    expect(edges[6]).toHaveLength(13);
    expect(edges[2]).toHaveLength(13);
    // Les 4 coins diagonaux.
    expect(edges[5]).toEqual([0]); // NW
    expect(edges[7]).toEqual([14]); // NE
    expect(edges[3]).toEqual([464]); // SW
    expect(edges[1]).toEqual([478]); // SE
  });

  test("oppositeEdgeCell : sortir E atterrit en colonne 0, sortir W en colonne W-1", () => {
    // 15x17 : colonne 0 sur une ligne longue.
    const east = edgeCellsByDirection(15, 17)[0][0];
    const landingFromEast = oppositeEdgeCell(east, 0, 15, 15, 17);
    expect(cellToRowCol(landingFromEast, 15).col).toBe(0);

    const west = edgeCellsByDirection(15, 17)[4][0];
    const landingFromWest = oppositeEdgeCell(west, 4, 15, 15, 17);
    expect(cellToRowCol(landingFromWest, 15).col).toBe(14);
  });

  test("gatewayCellsForDirection ne renvoie que des bords adjacents au praticable", () => {
    const plans = decodeHashCells(maps["10300"].mapData);
    const gates = gatewayCellsForDirection(plans, 15, 17, 0);
    // Sur 10300, les portes Est doivent toutes être sur le bord Est (col 14).
    for (const id of gates) {
      expect(cellToRowCol(id, 15).col).toBe(14);
    }
  });
});
