import { MAX_STEP_HEIGHT_DELTA } from '../config/constants';
import { MAX_GROUND_HEIGHT } from '../config/palette';
import type { Point } from '../utils/geometry';
import { tileDef } from './Tile';

/**
 * The map grid for one space (the outdoor world, or one building interior), in that space's own
 * local coordinates. Plain POJO + typed arrays, no behavior — every function below is pure and
 * takes the grid as a parameter, which is what keeps this testable without a DOM or a Game.
 */
export interface MapGrid {
  width: number;
  height: number;
  /** Row-major tile ids, length width*height. */
  tiles: string[];
  /** Row-major terrain height 0..MAX_GROUND_HEIGHT, meaningful only where the tile is 'ground'. */
  heights: Uint8Array;
}

export function createEmptyGrid(width: number, height: number, fillTileId = 'rock'): MapGrid {
  return {
    width,
    height,
    tiles: new Array(width * height).fill(fillTileId),
    heights: new Uint8Array(width * height),
  };
}

export function inBounds(map: MapGrid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

function index(map: MapGrid, x: number, y: number): number {
  return y * map.width + x;
}

/** Out-of-bounds reads as impassable rock, not floor — nothing should ever walk off the edge. */
export function getTileId(map: MapGrid, x: number, y: number): string {
  if (!inBounds(map, x, y)) return 'rock';
  return map.tiles[index(map, x, y)]!;
}

export function setTileId(map: MapGrid, x: number, y: number, id: string): void {
  if (!inBounds(map, x, y)) return;
  map.tiles[index(map, x, y)] = id;
}

export function getHeight(map: MapGrid, x: number, y: number): number {
  if (!inBounds(map, x, y)) return 0;
  return map.heights[index(map, x, y)] ?? 0;
}

export function setHeight(map: MapGrid, x: number, y: number, h: number): void {
  if (!inBounds(map, x, y)) return;
  map.heights[index(map, x, y)] = Math.max(0, Math.min(MAX_GROUND_HEIGHT, h));
}

export function isWalkable(map: MapGrid, x: number, y: number): boolean {
  if (!inBounds(map, x, y)) return false;
  return tileDef(getTileId(map, x, y)).walkable;
}

export function isOpaque(map: MapGrid, x: number, y: number): boolean {
  if (!inBounds(map, x, y)) return true;
  return tileDef(getTileId(map, x, y)).opaque;
}

/**
 * Can an actor standing at `from` step onto the adjacent `to`?
 *
 * The destination must be walkable, and — the terrain-height rule — if both cells are open ground
 * the step can climb or descend at most `MAX_STEP_HEIGHT_DELTA` rungs of the `. ░ ▒ ▓ █` ladder.
 * You cross the slope to get up the ridge, you don't step from flat ground straight onto the top.
 * Hard barriers (`rock`/`wall`) are never passable regardless of height. Tiles that aren't ground
 * (floor, door) don't carry a meaningful height, so the delta check only applies ground-to-ground.
 */
export function canStep(map: MapGrid, from: Point, to: Point): boolean {
  if (!isWalkable(map, to.x, to.y)) return false;

  const fromIsGround = getTileId(map, from.x, from.y) === 'ground';
  const toIsGround = getTileId(map, to.x, to.y) === 'ground';
  if (fromIsGround && toIsGround) {
    const delta = Math.abs(getHeight(map, to.x, to.y) - getHeight(map, from.x, from.y));
    if (delta > MAX_STEP_HEIGHT_DELTA) return false;
  }

  return true;
}
