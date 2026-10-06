import type { Rect } from '../utils/geometry';
import { VOID_TILE } from './Tile';
import type { TileMap } from './TileMap';

/** Chunks are 64x64 cells: small enough to load in a blink, big enough that the world is few files. */
export const CHUNK_SIZE = 64;
export const CHUNK_SHIFT = 6;
const CHUNK_MASK = CHUNK_SIZE - 1;
const CHUNK_CELLS = CHUNK_SIZE * CHUNK_SIZE;

export interface Chunk {
  cx: number;
  cy: number;
  tiles: Uint8Array;
  heights: Uint8Array;
  explored: Uint8Array;
  /**
   * Changed since it was loaded or saved (editor edits, a door opened in play). A dirty chunk must
   * never be unloaded without being saved, or the change is lost.
   */
  dirty: boolean;
}

/** Chunk coordinates can be negative; the key packs them into one number (|c| < 32768). */
export function chunkKey(cx: number, cy: number): number {
  return (cy + 32768) * 65536 + (cx + 32768);
}

export function createChunk(cx: number, cy: number, fillTile = VOID_TILE, fillHeight = 0): Chunk {
  const tiles = new Uint8Array(CHUNK_CELLS);
  const heights = new Uint8Array(CHUNK_CELLS);
  if (fillTile !== 0) tiles.fill(fillTile);
  if (fillHeight !== 0) heights.fill(fillHeight);
  return { cx, cy, tiles, heights, explored: new Uint8Array(CHUNK_CELLS), dirty: false };
}

/**
 * The world: a sparse set of 64x64 chunks addressed by world coordinates. Negative coordinates
 * work (`x >> 6` floors, `x & 63` wraps), so the map can grow in every direction without shifting
 * anything. A cell in a chunk that doesn't exist is void — the hard stop where the map ends.
 */
export class ChunkedMap implements TileMap {
  private readonly chunks = new Map<number, Chunk>();

  getChunk(cx: number, cy: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cy));
  }

  addChunk(chunk: Chunk): void {
    this.chunks.set(chunkKey(chunk.cx, chunk.cy), chunk);
  }

  /** The chunk at (cx, cy), creating an all-void one if it doesn't exist yet. */
  ensureChunk(cx: number, cy: number): Chunk {
    let chunk = this.getChunk(cx, cy);
    if (!chunk) {
      chunk = createChunk(cx, cy);
      this.addChunk(chunk);
    }
    return chunk;
  }

  removeChunk(cx: number, cy: number): Chunk | undefined {
    const chunk = this.getChunk(cx, cy);
    this.chunks.delete(chunkKey(cx, cy));
    return chunk;
  }

  chunkList(): Chunk[] {
    return [...this.chunks.values()];
  }

  private static localIndex(x: number, y: number): number {
    return (y & CHUNK_MASK) * CHUNK_SIZE + (x & CHUNK_MASK);
  }

  private chunkAt(x: number, y: number): Chunk | undefined {
    return this.chunks.get(chunkKey(x >> CHUNK_SHIFT, y >> CHUNK_SHIFT));
  }

  has(x: number, y: number): boolean {
    return this.chunkAt(x, y) !== undefined;
  }

  bounds(): Rect {
    if (this.chunks.size === 0) return { x: 0, y: 0, width: 0, height: 0 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of this.chunks.values()) {
      minX = Math.min(minX, c.cx);
      minY = Math.min(minY, c.cy);
      maxX = Math.max(maxX, c.cx);
      maxY = Math.max(maxY, c.cy);
    }
    return {
      x: minX * CHUNK_SIZE,
      y: minY * CHUNK_SIZE,
      width: (maxX - minX + 1) * CHUNK_SIZE,
      height: (maxY - minY + 1) * CHUNK_SIZE,
    };
  }

  getTile(x: number, y: number): number {
    const chunk = this.chunkAt(x, y);
    return chunk ? chunk.tiles[ChunkedMap.localIndex(x, y)]! : VOID_TILE;
  }

  setTile(x: number, y: number, tile: number): void {
    const chunk = this.ensureChunk(x >> CHUNK_SHIFT, y >> CHUNK_SHIFT);
    const i = ChunkedMap.localIndex(x, y);
    if (chunk.tiles[i] !== tile) {
      chunk.tiles[i] = tile;
      chunk.dirty = true;
    }
  }

  getHeight(x: number, y: number): number {
    const chunk = this.chunkAt(x, y);
    return chunk ? chunk.heights[ChunkedMap.localIndex(x, y)]! : 0;
  }

  setHeight(x: number, y: number, height: number): void {
    const chunk = this.ensureChunk(x >> CHUNK_SHIFT, y >> CHUNK_SHIFT);
    const i = ChunkedMap.localIndex(x, y);
    if (chunk.heights[i] !== height) {
      chunk.heights[i] = height;
      chunk.dirty = true;
    }
  }

  isExplored(x: number, y: number): boolean {
    const chunk = this.chunkAt(x, y);
    return chunk !== undefined && chunk.explored[ChunkedMap.localIndex(x, y)] === 1;
  }

  markExplored(x: number, y: number): void {
    const chunk = this.chunkAt(x, y);
    if (chunk) chunk.explored[ChunkedMap.localIndex(x, y)] = 1;
  }
}
