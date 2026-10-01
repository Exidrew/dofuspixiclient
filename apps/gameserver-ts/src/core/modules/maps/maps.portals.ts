import type { DecodedCell } from "@modules/maps/maps.cells-codec";

/**
 * Sprite `objects_<n>` used by Incarnam maps to mark an interactive
 * map-exchange passage (the yellow "portal" tile the player can step on to
 * switch maps). Maps that render this sprite must ONLY transition when the
 * player arrives on one of its cells — the plain geometric border is a
 * cliff/decor and must not auto-teleport.
 */
export const PORTAL_TILE_GFX = 4088;

export function isPortalCell(cell: DecodedCell | undefined): boolean {
  if (!cell) {
    return false;
  }

  return cell.layer1 === PORTAL_TILE_GFX || cell.layer2 === PORTAL_TILE_GFX;
}

export function mapHasPortal(cells: DecodedCell[] | undefined): boolean {
  return cells?.some(isPortalCell) ?? false;
}
