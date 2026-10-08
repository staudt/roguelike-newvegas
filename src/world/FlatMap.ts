import type { Point, Rect } from '../utils/geometry';
import { tileIdOf, tileIndex } from './Tile';
import type { TileMap } from './TileMap';

/**
 * A fixed-size rectangle of cells in one flat array, placed anywhere in world coordinates via
 * `origin`. Used for small spaces (an extra floor of a building) and as the convenient fixture in
 * tests. Reads outside the rectangle are void; writes outside are ignored.
 */
export class FlatMap implements TileMap {
  readonly width: number;
  readonly height: number;
  readonly origin: Point;
  readonly tiles: Uint8Array;
  readonly heights: Uint8Array;
  readonly bases: Uint8Array;
  readonly explored: Uint8Array;

  constructor(
    width: number,
    height: number,
    origin: Point = { x: 0, y: 0 },
    tiles?: Uint8Array,
    heights?: Uint8Array,
    bases?: Uint8Array,
  ) {
    this.width = width;
    this.height = height;
    this.origin = { ...origin };
    this.tiles = tiles ?? new Uint8Array(width * height);
    this.heights = heights ?? new Uint8Array(width * height);
    this.bases = bases ?? new Uint8Array(width * height);
    this.explored = new Uint8Array(width * height);
  }

  private index(x: number, y: number): number {
    return (y - this.origin.y) * this.width + (x - this.origin.x);
  }

  has(x: number, y: number): boolean {
    const lx = x - this.origin.x;
    const ly = y - this.origin.y;
    return lx >= 0 && ly >= 0 && lx < this.width && ly < this.height;
  }

  bounds(): Rect {
    return { x: this.origin.x, y: this.origin.y, width: this.width, height: this.height };
  }

  getTile(x: number, y: number): number {
    return this.has(x, y) ? this.tiles[this.index(x, y)]! : 0;
  }

  setTile(x: number, y: number, tile: number): void {
    if (this.has(x, y)) this.tiles[this.index(x, y)] = tile;
  }

  getHeight(x: number, y: number): number {
    return this.has(x, y) ? this.heights[this.index(x, y)]! : 0;
  }

  setHeight(x: number, y: number, height: number): void {
    if (this.has(x, y)) this.heights[this.index(x, y)] = height;
  }

  getBase(x: number, y: number): number {
    return this.has(x, y) ? this.bases[this.index(x, y)]! : 0;
  }

  setBase(x: number, y: number, base: number): void {
    if (this.has(x, y)) this.bases[this.index(x, y)] = base;
  }

  isExplored(x: number, y: number): boolean {
    return this.has(x, y) && this.explored[this.index(x, y)] === 1;
  }

  markExplored(x: number, y: number): void {
    if (this.has(x, y)) this.explored[this.index(x, y)] = 1;
  }
}

/** A flat map filled with one tile, handy for fixtures. Same signature the old grid helper had. */
export function createEmptyGrid(
  width: number,
  height: number,
  fillTileId = 'rock',
  origin: Point = { x: 0, y: 0 },
): FlatMap {
  const map = new FlatMap(width, height, origin);
  map.tiles.fill(tileIndex(fillTileId));
  return map;
}

/** A flat space's base layer from its JSON names ('' = none). */
export function decodeBases(names: string[] | undefined, length: number): Uint8Array {
  return names ? Uint8Array.from(names, (n) => (n === '' ? 0 : tileIndex(n))) : new Uint8Array(length);
}

export function encodeBases(bases: Uint8Array): string[] {
  return Array.from(bases, (b) => (b === 0 ? '' : tileIdOf(b)));
}
