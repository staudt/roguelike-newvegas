import { MAX_STEP_HEIGHT_DELTA } from '../config/constants';
import { MAX_GROUND_HEIGHT } from '../config/palette';
import type { Point } from '../utils/geometry';
import { createEmptyGrid } from './FlatMap';
import { GROUND_TILE, tileIdOf, tileIndex, tileOpaque, tileWalkable } from './Tile';
import type { TileMap } from './TileMap';

/**
 * Helpers over a TileMap in WORLD coordinates (which may be negative), keeping the string tile-id
 * API the game and tests use. Hot paths (line of sight, pathfinding) use the per-index lookups
 * instead of string ids. Cells that don't exist are void: unwalkable and opaque, the hard stop
 * where the map ends.
 */
export type MapGrid = TileMap;
export { createEmptyGrid };

export function inBounds(map: MapGrid, x: number, y: number): boolean {
  return map.has(x, y);
}

/** Cells outside the map read as 'void', never as walkable ground. */
export function getTileId(map: MapGrid, x: number, y: number): string {
  return tileIdOf(map.getTile(x, y));
}

export function setTileId(map: MapGrid, x: number, y: number, id: string): void {
  map.setTile(x, y, tileIndex(id));
}

export function getHeight(map: MapGrid, x: number, y: number): number {
  return map.getHeight(x, y);
}

export function setHeight(map: MapGrid, x: number, y: number, h: number): void {
  map.setHeight(x, y, Math.max(0, Math.min(MAX_GROUND_HEIGHT, h)));
}

export function isWalkable(map: MapGrid, x: number, y: number): boolean {
  return tileWalkable(map.getTile(x, y));
}

export function isOpaque(map: MapGrid, x: number, y: number): boolean {
  return tileOpaque(map.getTile(x, y));
}

/**
 * Can an actor standing at `from` step onto the adjacent `to`?
 *
 * The destination must be walkable, and — the terrain-height rule — if both cells are open ground
 * the step can climb or descend at most `MAX_STEP_HEIGHT_DELTA` rungs of the `. ░ ▒ ▓ █` ladder.
 * Hard barriers (`rock`/`wall`/void) are never passable regardless of height. Tiles that aren't
 * ground (floor, door) carry no meaningful height, so the delta check only applies ground-to-ground.
 */
export function canStep(map: MapGrid, from: Point, to: Point): boolean {
  const toTile = map.getTile(to.x, to.y);
  if (!tileWalkable(toTile)) return false;

  if (toTile === GROUND_TILE && map.getTile(from.x, from.y) === GROUND_TILE) {
    const delta = Math.abs(map.getHeight(to.x, to.y) - map.getHeight(from.x, from.y));
    if (delta > MAX_STEP_HEIGHT_DELTA) return false;
  }

  return true;
}
