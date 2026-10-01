import { describe, expect, test } from "bun:test";

import {
  cellsCountOf,
  cellToRowCol,
  detectExitDirection,
  nearestWalkableEdgeCell,
  oppositeEdgeCell,
  rowColToCell,
} from "@modules/maps/maps.edge";

describe("cellToRowCol / rowColToCell", () => {
  test("round-trips cell id on a long row", () => {
    const coord = cellToRowCol(5, 10);

    expect(coord).toMatchObject({ row: 0, col: 5, isLong: true });
    expect(rowColToCell(coord.row, coord.col, 10)).toBe(5);
  });

  test("round-trips cell id on a short row", () => {
    const coord = cellToRowCol(10, 10);

    expect(coord).toMatchObject({ row: 1, col: 0, isLong: false });
    expect(rowColToCell(coord.row, coord.col, 10)).toBe(10);
  });

  test("last cell of short row 1 on width-10 map is cell 18", () => {
    const coord = cellToRowCol(18, 10);

    expect(coord).toMatchObject({ row: 1, col: 8, isLong: false });
  });

  test("cell 19 starts pair 1 (row 2, long)", () => {
    const coord = cellToRowCol(19, 10);

    expect(coord).toMatchObject({ row: 2, col: 0, isLong: true });
  });
});

describe("oppositeEdgeCell — cardinals", () => {
  test("E → W edge, same row", () => {
    expect(oppositeEdgeCell(9, 0, 10, 10, 10)).toBe(rowColToCell(0, 0, 10));
  });

  test("W → E edge, same row", () => {
    expect(oppositeEdgeCell(0, 4, 10, 10, 10)).toBe(rowColToCell(0, 9, 10));
  });

  test("S → N edge, same col", () => {
    expect(oppositeEdgeCell(3, 2, 10, 10, 10)).toBe(rowColToCell(0, 3, 10));
  });

  test("N → S edge, same col", () => {
    expect(oppositeEdgeCell(3, 6, 10, 10, 10)).toBe(rowColToCell(18, 3, 10));
  });
});

describe("oppositeEdgeCell — diagonals", () => {
  test("SE → NW corner of target", () => {
    expect(oppositeEdgeCell(9, 1, 10, 10, 10)).toBe(rowColToCell(0, 0, 10));
  });

  test("SW → NE corner", () => {
    expect(oppositeEdgeCell(0, 3, 10, 10, 10)).toBe(rowColToCell(0, 9, 10));
  });

  test("NW → SE corner", () => {
    expect(oppositeEdgeCell(0, 5, 10, 10, 10)).toBe(rowColToCell(18, 9, 10));
  });

  test("NE → SW corner", () => {
    expect(oppositeEdgeCell(9, 7, 10, 10, 10)).toBe(rowColToCell(18, 0, 10));
  });
});

describe("oppositeEdgeCell — differing target size", () => {
  test("clamps col when target is narrower", () => {
    const target = oppositeEdgeCell(8, 2, 10, 5, 5);

    expect(target).toBe(rowColToCell(0, 4, 5));
  });
});

describe("nearestWalkableEdgeCell", () => {
  const width = 15;
  const height = 17;
  const total = cellsCountOf(width, height);
  const allBlocked = () => false;

  test("returns the ideal cell when it is already walkable", () => {
    const ideal = oppositeEdgeCell(0, 4, width, width, height)!;

    expect(
      nearestWalkableEdgeCell(ideal, 4, width, height, (c) => c === ideal)
    ).toBe(ideal);
  });

  test("slides along the same edge when the ideal cell is blocked", () => {
    // Exit E (0) from a left-edge cell → lands on the W edge (col 0).
    const ideal = oppositeEdgeCell(0, 0, width, width, height)!;
    const walkable = new Set([rowColToCell(2, 0, width)]); // W-edge cell lower

    const landed = nearestWalkableEdgeCell(ideal, 0, width, height, (c) =>
      walkable.has(c)
    );

    expect(landed).toBeDefined();
    const coord = cellToRowCol(landed!, width);
    expect(coord.isLong).toBe(true);
    expect(coord.col).toBe(0); // still on the W border
  });

  test("handles a diagonal exit by sliding along the adjacent vertical edge", () => {
    // Exit NE (7) → ideal lands on the SW corner (lastLongRow, 0).
    const ideal = oppositeEdgeCell(9, 7, width, width, height)!;
    const target = rowColToCell(2, 0, width); // a W-edge cell a bit above

    const landed = nearestWalkableEdgeCell(
      ideal,
      7,
      width,
      height,
      (c) => c === target
    );

    expect(landed).toBe(target);
    expect(cellToRowCol(landed!, width).col).toBe(0);
  });

  test("returns undefined when the whole landing edge is blocked", () => {
    expect(
      nearestWalkableEdgeCell(0, 4, width, height, allBlocked)
    ).toBeUndefined();
  });

  test("stays in bounds for every exit direction", () => {
    for (let dir = 0; dir < 8; dir++) {
      const ideal = oppositeEdgeCell(0, dir, width, width, height)!;
      const landed = nearestWalkableEdgeCell(
        ideal,
        dir,
        width,
        height,
        () => true
      );
      expect(landed).toBeDefined();
      expect(landed!).toBeGreaterThanOrEqual(0);
      expect(landed!).toBeLessThan(total);
    }
  });
});

describe("detectExitDirection", () => {
  test("cell 0 is NW corner", () => {
    expect(detectExitDirection(0, 10, 10)).toBe(5);
  });

  test("cell 9 is NE corner", () => {
    expect(detectExitDirection(9, 10, 10)).toBe(7);
  });

  test("row 2 col 0 (cell 19) returns W", () => {
    expect(detectExitDirection(19, 10, 10)).toBe(4);
  });

  test("interior cell returns undefined", () => {
    const cell = rowColToCell(4, 5, 10);

    expect(detectExitDirection(cell, 10, 10)).toBeUndefined();
  });

  test("last long row col 0 is SW corner", () => {
    const cell = rowColToCell(18, 0, 10);

    expect(detectExitDirection(cell, 10, 10)).toBe(3);
  });

  test("last long row col 9 is SE corner", () => {
    const cell = rowColToCell(18, 9, 10);

    expect(detectExitDirection(cell, 10, 10)).toBe(1);
  });
});

describe("detectExitDirection — geometric (StarLoco OrthogonalProj) edges", () => {
  test("north edge covers ALL rows of the top band (not only long rows)", () => {
    // 10x10: top band = row 0 (long) + row 1 (short, cells 10..18).
    // StarLoco's x - y == 0 border applies to both.
    for (const cell of [rowColToCell(0, 0, 10), rowColToCell(0, 4, 10)]) {
      expect(detectExitDirection(cell, 10, 10)).toBe(6);
    }
  });

  test("south edge covers the bottom band short row too", () => {
    // last row is a SHORT row (row 2*h-1): a 10x10 map's bottom short row
    // cells 171..180? — the geometric S border (x - y == 2*(h-1)) includes
    // every cell of that diagonal band, long rows side only per cellToRowCol.
    const cell = rowColToCell(18, 0, 10);

    expect(detectExitDirection(cell, 10, 10)).toBe(3); // SW corner
  });

  test("15x17 map: every cardinal side has its geometric cells", () => {
    const sides = {
      0: 0, // E
      2: 0, // S
      4: 0, // W
      6: 0, // N
    } as Record<number, number>;
    const total = 15 * 17 + 14 * 16;

    for (let cell = 0; cell < total; cell++) {
      const dir = detectExitDirection(cell, 15, 17);
      if (dir === undefined) {
        continue;
      }
      if (dir in sides) {
        sides[dir]! += 1;
      }
    }

    // 15x17: EAST (sum == 28) 17 cells; SOUTH (diff == 32) 14 cells; WEST
    // (sum == 0) 15 cells; NORTH (diff == 0) 13 cells — short rows included
    // on N/S (the historical row/col test classified ONLY long rows on W/E
    // and missed the short-row band of S). Corners counted diagonally.
    expect(sides[0]).toBeGreaterThanOrEqual(15);
    expect(sides[2]).toBeGreaterThanOrEqual(13);
    expect(sides[4]).toBeGreaterThanOrEqual(15);
    expect(sides[6]).toBeGreaterThanOrEqual(13);
  });
});
