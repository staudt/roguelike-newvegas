import { describe, expect, it } from 'vitest';
import { VisibleSet } from '../src/fov/VisibleSet';
import { CHUNK_SIZE, ChunkedMap, createChunk } from '../src/world/ChunkedMap';
import { chunkToText, decodeChunk, encodeChunk, type ChunkJSON } from '../src/world/ChunkCodec';
import { createEmptyGrid, FlatMap } from '../src/world/FlatMap';
import {
  GROUND_TILE,
  TILE_ORDER,
  TILES,
  tileIdOf,
  tileIndex,
  tileOpaque,
  tileWalkable,
  VOID_TILE,
} from '../src/world/Tile';

describe('tile ids', () => {
  it('covers every defined tile, with void at index 0', () => {
    expect(TILE_ORDER[0]).toBe('void');
    for (const id of Object.keys(TILES)) expect(TILE_ORDER).toContain(id);
    for (const id of TILE_ORDER) expect(tileIdOf(tileIndex(id))).toBe(id);
  });

  it('void is the unwalkable, opaque edge of the world', () => {
    expect(tileWalkable(VOID_TILE)).toBe(false);
    expect(tileOpaque(VOID_TILE)).toBe(true);
    expect(tileWalkable(tileIndex('ground'))).toBe(true);
    expect(tileWalkable(tileIndex('door'))).toBe(false);
    expect(tileWalkable(tileIndex('openDoor'))).toBe(true);
    expect(tileOpaque(tileIndex('door'))).toBe(true);
    expect(tileOpaque(tileIndex('openDoor'))).toBe(false);
  });

  it('rejects unknown tile names', () => {
    expect(() => tileIndex('lava')).toThrow(/Unknown tile/);
  });
});

describe('FlatMap', () => {
  it('reads and writes in world coordinates through its origin', () => {
    const map = new FlatMap(4, 3, { x: 10, y: -5 });
    map.setTile(11, -4, GROUND_TILE);
    map.setHeight(11, -4, 3);
    expect(map.getTile(11, -4)).toBe(GROUND_TILE);
    expect(map.getHeight(11, -4)).toBe(3);
    expect(map.has(10, -5)).toBe(true);
    expect(map.has(14, -5)).toBe(false);
    expect(map.has(9, -5)).toBe(false);
    expect(map.bounds()).toEqual({ x: 10, y: -5, width: 4, height: 3 });
  });

  it('reads void outside, ignores writes outside, tracks explored', () => {
    const map = createEmptyGrid(3, 3, 'ground');
    expect(map.getTile(-1, 0)).toBe(VOID_TILE);
    map.setTile(99, 99, GROUND_TILE);
    expect(map.has(99, 99)).toBe(false);
    expect(map.isExplored(1, 1)).toBe(false);
    map.markExplored(1, 1);
    expect(map.isExplored(1, 1)).toBe(true);
    expect(map.isExplored(50, 50)).toBe(false);
  });
});

describe('ChunkedMap', () => {
  it('cells in missing chunks are void; has() reflects existence', () => {
    const map = new ChunkedMap();
    expect(map.getTile(5, 5)).toBe(VOID_TILE);
    expect(map.has(5, 5)).toBe(false);
    expect(map.bounds()).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('writing creates the chunk, marks it dirty, and reads back', () => {
    const map = new ChunkedMap();
    map.setTile(5, 7, GROUND_TILE);
    map.setHeight(5, 7, 2);
    expect(map.has(5, 7)).toBe(true);
    expect(map.getTile(5, 7)).toBe(GROUND_TILE);
    expect(map.getHeight(5, 7)).toBe(2);
    expect(map.getChunk(0, 0)!.dirty).toBe(true);
    // the rest of the new chunk is void, not ground: only what was painted exists
    expect(map.getTile(6, 7)).toBe(VOID_TILE);
  });

  it('negative coordinates land in the right chunk and cell', () => {
    const map = new ChunkedMap();
    map.setTile(-1, -1, GROUND_TILE);
    map.setTile(-64, -64, tileIndex('wall'));
    map.setTile(-65, 0, tileIndex('rock'));
    expect(map.getChunk(-1, -1)).toBeDefined();
    expect(map.getChunk(-2, 0)).toBeDefined();
    expect(map.getTile(-1, -1)).toBe(GROUND_TILE);
    expect(map.getTile(-64, -64)).toBe(tileIndex('wall'));
    expect(map.getTile(-65, 0)).toBe(tileIndex('rock'));
    // neighbours in the same chunk are untouched
    expect(map.getTile(-2, -1)).toBe(VOID_TILE);
    expect(map.bounds()).toEqual({ x: -128, y: -64, width: 128, height: 128 });
  });

  it('keeps chunks independent across a seam', () => {
    const map = new ChunkedMap();
    map.setTile(CHUNK_SIZE - 1, 0, GROUND_TILE);
    map.setTile(CHUNK_SIZE, 0, tileIndex('wall'));
    expect(map.getTile(CHUNK_SIZE - 1, 0)).toBe(GROUND_TILE);
    expect(map.getTile(CHUNK_SIZE, 0)).toBe(tileIndex('wall'));
    expect(map.chunkList()).toHaveLength(2);
  });

  it('explored is tracked per cell and does not dirty the chunk', () => {
    const map = new ChunkedMap();
    map.addChunk(createChunk(0, 0, GROUND_TILE));
    map.markExplored(3, 3);
    expect(map.isExplored(3, 3)).toBe(true);
    expect(map.isExplored(4, 3)).toBe(false);
    expect(map.getChunk(0, 0)!.dirty).toBe(false);
  });

  it('removeChunk makes its cells void again', () => {
    const map = new ChunkedMap();
    map.setTile(1, 1, GROUND_TILE);
    map.removeChunk(0, 0);
    expect(map.has(1, 1)).toBe(false);
    expect(map.getTile(1, 1)).toBe(VOID_TILE);
  });
});

describe('chunk codec', () => {
  it('round-trips a chunk with several tiles and heights losslessly', () => {
    const chunk = createChunk(-3, 2, GROUND_TILE);
    chunk.tiles[0] = tileIndex('wall');
    chunk.tiles[100] = tileIndex('door');
    chunk.tiles[4095] = tileIndex('rock');
    chunk.heights[5] = 4;
    chunk.heights[4000] = 2;

    const json = encodeChunk(chunk);
    const back = decodeChunk(JSON.parse(JSON.stringify(json)) as ChunkJSON);

    expect(back.cx).toBe(-3);
    expect(back.cy).toBe(2);
    expect(Array.from(back.tiles)).toEqual(Array.from(chunk.tiles));
    expect(Array.from(back.heights)).toEqual(Array.from(chunk.heights));
  });

  it('compresses open ground to a handful of numbers', () => {
    const json = encodeChunk(createChunk(0, 0, GROUND_TILE));
    expect(json.tiles).toEqual([4096, 0]);
    expect(json.heights).toEqual([4096, 0]);
    expect(json.palette).toEqual(['ground']);
    expect(chunkToText(json).length).toBeLessThan(200);
  });

  it('stores tile NAMES, so the file survives a reordered tile table', () => {
    const chunk = createChunk(0, 0, tileIndex('floor'));
    const json = encodeChunk(chunk);
    expect(json.palette).toEqual(['floor']);
  });

  it('rejects corrupt data loudly', () => {
    const good = encodeChunk(createChunk(0, 0, GROUND_TILE));
    expect(() => decodeChunk({ ...good, tiles: [4000, 0] })).toThrow(/covers 4000 of 4096/);
    expect(() => decodeChunk({ ...good, tiles: [5000, 0] })).toThrow(/overruns/);
    expect(() => decodeChunk({ ...good, palette: ['lava'] })).toThrow(/Unknown tile/);
    expect(() => decodeChunk({ ...good, tiles: [4096, 3] })).toThrow(/out of range/);
  });
});

describe('VisibleSet', () => {
  it('is a window: cells outside it are never visible and adds outside are ignored', () => {
    const set = new VisibleSet(-5, -5, 11, 11);
    set.add(0, 0);
    set.add(-5, -5);
    set.add(100, 100);
    expect(set.has(0, 0)).toBe(true);
    expect(set.has(-5, -5)).toBe(true);
    expect(set.has(1, 0)).toBe(false);
    expect(set.has(100, 100)).toBe(false);
    const seen: string[] = [];
    set.forEach((x, y) => seen.push(`${x},${y}`));
    expect(seen.sort()).toEqual(['-5,-5', '0,0']);
    expect(VisibleSet.empty().has(0, 0)).toBe(false);
  });
});
