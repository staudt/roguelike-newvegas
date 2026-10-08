import type { Rect } from '../utils/geometry';

/**
 * What every map looks like to the rest of the game: cells addressed by WORLD coordinates (which
 * may be negative), each with a tile id (one byte), a terrain height and an explored flag.
 *
 * Nothing outside src/world is allowed to know how cells are stored. A small flat array (a
 * building's extra floor, a test fixture) and a sparse set of 64x64 chunks (the world) both
 * implement this, so the world can grow to the whole Mojave without any game code changing —
 * line of sight, pathfinding, the renderer and the AI only ever call these methods.
 */
export interface TileMap {
  /** True if the cell belongs to the map (inside the array / inside an existing chunk). */
  has(x: number, y: number): boolean;
  /** Smallest rectangle containing every existing cell. Empty map -> width/height 0. */
  bounds(): Rect;

  /** Tile index (see Tile.ts TILE_ORDER). Cells that don't exist read as 0 (void). */
  getTile(x: number, y: number): number;
  /** Creates the cell's chunk if the map is sparse; ignored by fixed-size maps. */
  setTile(x: number, y: number, tile: number): void;

  /** Terrain height 0..MAX_GROUND_HEIGHT; 0 for cells that don't exist. */
  getHeight(x: number, y: number): number;
  setHeight(x: number, y: number, height: number): void;

  /**
   * What an object (an overlay tile: rock, wall) stands on, as a tile index: ground, road, floor.
   * 0 (void) means none: plain cells have no base, and an object without one stands on bare ground.
   */
  getBase(x: number, y: number): number;
  setBase(x: number, y: number, base: number): void;

  isExplored(x: number, y: number): boolean;
  markExplored(x: number, y: number): void;
}
