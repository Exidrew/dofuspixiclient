import { match, P } from "ts-pattern";

// Dofus 1.29 alternating-row grid: long rows have `width` cells, short rows
// have `width - 1`. Stride (one long + one short) = 2*width - 1.
//
// Direction codes match the protocol: 0=E, 1=SE, 2=S, 3=SW, 4=W, 5=NW, 6=N,
// 7=NE. Exploration allows all 8; fights restrict to cardinals but that's a
// fight concern — every edge transition is 8-way.

export interface CellCoord {
  row: number;
  col: number;
  isLong: boolean;
}

// Cell-id delta for each of the 8 directions on an alternating-row grid of
// the given width. Index matches the protocol direction (0=E..7=NE).
export function directionOffsets(mapWidth: number): readonly number[] {
  const stride = 2 * mapWidth - 1;

  return [
    1,
    mapWidth,
    stride,
    mapWidth - 1,
    -1,
    -mapWidth,
    -stride,
    -(mapWidth - 1),
  ];
}

export function cellToRowCol(cellId: number, mapWidth: number): CellCoord {
  const stride = 2 * mapWidth - 1;
  const pair = Math.floor(cellId / stride);
  const offset = cellId - pair * stride;
  const isLong = offset < mapWidth;

  return {
    row: isLong ? pair * 2 : pair * 2 + 1,
    col: isLong ? offset : offset - mapWidth,
    isLong,
  };
}

export function rowColToCell(
  row: number,
  col: number,
  mapWidth: number
): number {
  const stride = 2 * mapWidth - 1;
  const pair = Math.floor(row / 2);
  const isLong = row % 2 === 0;

  return pair * stride + (isLong ? col : mapWidth + col);
}

// Returns the mirror cell on the target map's opposite edge for a player
// exiting through `direction`. Cardinals (E/S/W/N) preserve the
// perpendicular axis; diagonals (SE/SW/NW/NE) land at the opposite corner
// — retail Dofus doesn't interpolate across diagonal transitions.
export function oppositeEdgeCell(
  fromCellId: number,
  exitDirection: number,
  sourceWidth: number,
  targetWidth: number,
  targetHeight: number
): number | undefined {
  const { row, col } = cellToRowCol(fromCellId, sourceWidth);
  const lastLongRow = 2 * targetHeight - 2;
  const rightCol = targetWidth - 1;
  const clampCol = Math.min(Math.max(col, 0), rightCol);
  const clampRow = Math.min(Math.max(row, 0), lastLongRow);

  switch (exitDirection) {
    case 0:
      return rowColToCell(clampRow, 0, targetWidth);
    case 1:
      return rowColToCell(0, 0, targetWidth);
    case 2:
      return rowColToCell(0, clampCol, targetWidth);
    case 3:
      return rowColToCell(0, rightCol, targetWidth);
    case 4:
      return rowColToCell(clampRow, rightCol, targetWidth);
    case 5:
      return rowColToCell(lastLongRow, rightCol, targetWidth);
    case 6:
      return rowColToCell(lastLongRow, clampCol, targetWidth);
    case 7:
      return rowColToCell(lastLongRow, 0, targetWidth);
    default:
      return undefined;
  }
}

// ── StarLoco-faithful geometric border detection ────────────────────────────
// Port of StarLoco's OrthogonalProj (getOrthY / getOrthXFromY / isEdgeCell):
// the alternate-row grid is a parallelogram in orthogonal (x, y) coordinates:
//   x + y == 0        → WEST edge (exit dir 4)
//   x + y == 2*(w-1)  → EAST edge (exit dir 0)
//   x - y == 0        → NORTH edge (exit dir 6)
//   x - y == 2*(h-1)  → SOUTH edge (exit dir 2)
// Tests on row/col only classify LONG rows correctly: the EAST edge also
// contains every SHORT row's last cell (col = w-2), and the WEST edge every
// short row's first cell (col 0) — one full alternating band of border cells
// half-missed by the historical row/col test. Retail Dofus 1.29's map
// transition uses this geometric rule.
export function getOrthY(mapWidth: number, cellId: number): number {
  const stride = 2 * mapWidth - 1;
  const lineNb = Math.floor(cellId / stride);
  const lineOff = (cellId % stride) % mapWidth;

  return lineOff - lineNb;
}

export function getOrthXFromY(
  mapWidth: number,
  cellId: number,
  y: number
): number {
  return (cellId + y * (mapWidth - 1)) / mapWidth;
}

/** Cardinal exit direction for a geometric border cell (0(E)/2(S)/4(W)/6(N)). */
export function starEdgeSide(
  width: number,
  height: number,
  cellId: number
): number | undefined {
  if (sumOf(cellId, width) === (width - 1) * 2) {
    return 0; // E
  }
  if (diffOf(cellId, width) === (height - 1) * 2) {
    return 2; // S
  }
  if (sumOf(cellId, width) === 0) {
    return 4; // W
  }
  if (diffOf(cellId, width) === 0) {
    return 6; // N
  }

  return undefined;
}

export function isEdgeCell(
  width: number,
  height: number,
  cellId: number
): boolean {
  return starEdgeSide(width, height, cellId) !== undefined;
}

// Derives exit direction from a cell's position on an HxW grid — port of
// StarLoco's OrthogonalProj.isEdgeCellOrth. The four border equations are:
//   x + y == 0 → W edge, x + y == 2*(w-1) → E edge,
//   x - y == 0 → N edge, x - y == 2*(h-1) → S edge.
// Corners satisfy TWO equations; they take priority and map to the diagonal
// exit (NW=5, NE=7, SW=3, SE=1), as in retail Dofus: cell (0, W-1) exits NE.
// Unlike the historical row/col test, this covers EVERY row of the
// alternating grid (long AND short) — the short rows' last cell (col = w-2)
// is an eastern border cell too, and their first cell (col 0) a western one.
export function detectExitDirection(
  cellId: number,
  mapWidth: number,
  mapHeight: number
): number | undefined {
  const maxSum = (mapWidth - 1) * 2;
  const maxDiff = (mapHeight - 1) * 2;

  const edge = {
    cornerNW: sumOf(cellId, mapWidth) === 0 && diffOf(cellId, mapWidth) === 0,
    cornerNE:
      sumOf(cellId, mapWidth) === maxSum && diffOf(cellId, mapWidth) === 0,
    cornerSW:
      sumOf(cellId, mapWidth) === 0 && diffOf(cellId, mapWidth) === maxDiff,
    cornerSE:
      sumOf(cellId, mapWidth) === maxSum &&
      diffOf(cellId, mapWidth) === maxDiff,
    top: diffOf(cellId, mapWidth) === 0,
    bottom: diffOf(cellId, mapWidth) === maxDiff,
    left: sumOf(cellId, mapWidth) === 0,
    right: sumOf(cellId, mapWidth) === maxSum,
  } as const;

  return match(edge)
    .with({ cornerNW: true }, () => 5)
    .with({ cornerNE: true }, () => 7)
    .with({ cornerSW: true }, () => 3)
    .with({ cornerSE: true }, () => 1)
    .with({ top: true }, () => 6)
    .with({ bottom: true }, () => 2)
    .with({ left: true }, () => 4)
    .with({ right: true }, () => 0)
    .with(P._, () => undefined)
    .exhaustive();
}

function sumOf(cellId: number, mapWidth: number): number {
  const y = getOrthY(mapWidth, cellId);
  const x = getOrthXFromY(mapWidth, cellId, y);

  return x + y;
}

function diffOf(cellId: number, mapWidth: number): number {
  const y = getOrthY(mapWidth, cellId);
  const x = getOrthXFromY(mapWidth, cellId, y);

  return x - y;
}

// Total number of cells of an alternating-row grid (canonical Dofus 1.29
// formula, same as in @dofus/grid and tools/dofus-maps.mjs).
export function cellsCountOf(width: number, height: number): number {
  return width * height + (width - 1) * (height - 1);
}

// Given an ideal landing cell on a target map's border, returns a walkable
// cell to actually land on when the ideal one is blocked. The search stays
// on the SAME geometric border side as the ideal cell (nearest-first), so
// the player keeps entering from the direction they left. Uses
// starEdgeSide to classify border cells — geometric, short rows included.
export function nearestWalkableEdgeCell(
  idealCellId: number,
  exitDirection: number,
  targetWidth: number,
  targetHeight: number,
  isWalkable: (cellId: number) => boolean
): number | undefined {
  if (isWalkable(idealCellId)) {
    return idealCellId;
  }

  const total = cellsCountOf(targetWidth, targetHeight);

  const opposite = (exitDirection + 4) % 8;
  const landingEdgeDirection =
    opposite % 2 === 0 ? opposite : horizontalOpposite(exitDirection);

  const idealY = getOrthY(targetWidth, idealCellId);

  const candidates: { cell: number; dist: number }[] = [];
  for (let cell = 0; cell < total; cell++) {
    if (
      starEdgeSide(targetWidth, targetHeight, cell) !== landingEdgeDirection
    ) {
      continue;
    }
    const y = getOrthY(targetWidth, cell);
    const dist = Math.abs(y - idealY);
    candidates.push({ cell, dist });
  }

  candidates.sort((a, b) => a.dist - b.dist);

  for (const { cell } of candidates) {
    if (isWalkable(cell)) {
      return cell;
    }
  }

  return undefined;
}

// For a diagonal exit whose landing corner is blocked, slide along the
// horizontal cardinal side the corner touches (keeps the player on the
// vertical edge they were heading towards).
function horizontalOpposite(exitDirection: number): number {
  switch (exitDirection) {
    case 1: // SE / NE → land on the W edge
    case 7:
      return 4;
    case 3: // SW / NW → land on the E edge
    case 5:
      return 0;
    default:
      return exitDirection;
  }
}
