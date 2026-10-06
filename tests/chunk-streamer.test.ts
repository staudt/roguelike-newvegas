import { describe, expect, it } from 'vitest';
import { ChunkStreamer, parseChunkPath, type ChunkCoord } from '../src/world/ChunkStreamer';
import { CHUNK_SIZE, ChunkedMap, createChunk } from '../src/world/ChunkedMap';
import { encodeChunk, type ChunkJSON } from '../src/world/ChunkCodec';
import { getTileId, setTileId } from '../src/world/GameMap';
import { GROUND_TILE } from '../src/world/Tile';

function grid(n: number, offset = 0): ChunkCoord[] {
  const out: ChunkCoord[] = [];
  for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) out.push({ cx: cx + offset, cy: cy + offset });
  return out;
}

function setup(existing: ChunkCoord[]) {
  const map = new ChunkedMap();
  const loaded: string[] = [];
  const streamer = new ChunkStreamer(map, existing, async (cx, cy) => {
    loaded.push(`${cx},${cy}`);
    return encodeChunk(createChunk(cx, cy, GROUND_TILE)) as ChunkJSON;
  });
  return { map, streamer, loaded };
}

const centerOf = (cx: number, cy: number) => ({ x: cx * CHUNK_SIZE + 5, y: cy * CHUNK_SIZE + 5 });

describe('parseChunkPath', () => {
  it('reads <cx>_<cy>.json including negatives', () => {
    expect(parseChunkPath('../world/goodsprings/chunks/3_12.json')).toEqual({ cx: 3, cy: 12 });
    expect(parseChunkPath('/x/chunks/-1_-20.json')).toEqual({ cx: -1, cy: -20 });
    expect(parseChunkPath('/x/chunks/readme.json')).toBeNull();
  });
});

describe('ChunkStreamer.ensureAround', () => {
  it('loads the 3x3 ring, only for chunks that exist', async () => {
    const { map, streamer, loaded } = setup(grid(2)); // chunks (0..1, 0..1)
    await streamer.ensureAround(centerOf(0, 0));
    expect(loaded.sort()).toEqual(['0,0', '0,1', '1,0', '1,1']);
    expect(map.chunkList()).toHaveLength(4);
    expect(streamer.stats()).toEqual({ loaded: 4, total: 4, dirty: 0 });
  });

  it('does not reach beyond one ring, and does not reload what is loaded', async () => {
    const { streamer, loaded } = setup(grid(5));
    await streamer.ensureAround(centerOf(2, 2));
    expect(loaded).toHaveLength(9);
    await streamer.ensureAround(centerOf(2, 2));
    expect(loaded).toHaveLength(9);
    await streamer.ensureAround(centerOf(3, 2));
    expect(loaded).toHaveLength(12); // one new column of three
  });

  it('shares an in-flight load between overlapping requests', async () => {
    const { streamer, loaded } = setup(grid(2));
    await Promise.all([streamer.ensureAround(centerOf(0, 0)), streamer.ensureAround(centerOf(0, 0))]);
    expect(loaded).toHaveLength(4);
  });

  it('works at negative world coordinates', async () => {
    const { map, streamer } = setup([{ cx: -1, cy: -1 }, { cx: 0, cy: 0 }]);
    await streamer.ensureAround({ x: -3, y: -3 });
    expect(map.has(-3, -3)).toBe(true);
    expect(map.has(3, 3)).toBe(true);
  });

  it('rejects when a loader fails', async () => {
    const map = new ChunkedMap();
    const streamer = new ChunkStreamer(map, [{ cx: 0, cy: 0 }], () => Promise.reject(new Error('disk')));
    await expect(streamer.ensureAround({ x: 0, y: 0 })).rejects.toThrow('disk');
  });
});

describe('ChunkStreamer.unloadFar', () => {
  it('drops clean chunks beyond keepRing and keeps the near ones', async () => {
    const { map, streamer } = setup(grid(8));
    for (const c of [0, 1, 2, 3, 4, 5]) await streamer.ensureAround(centerOf(c, c));
    const dropped = streamer.unloadFar(centerOf(5, 5), 2);
    expect(dropped).toBeGreaterThan(0);
    for (const chunk of map.chunkList()) {
      expect(Math.max(Math.abs(chunk.cx - 5), Math.abs(chunk.cy - 5))).toBeLessThanOrEqual(2);
    }
    expect(map.getChunk(5, 5)).toBeDefined();
    expect(map.getChunk(0, 0)).toBeUndefined();
  });

  it('never drops a dirty chunk (a door the player opened)', async () => {
    const { map, streamer } = setup(grid(8));
    await streamer.ensureAround(centerOf(0, 0));
    setTileId(map, 10, 10, 'openDoor');
    expect(map.getChunk(0, 0)!.dirty).toBe(true);
    streamer.unloadFar(centerOf(7, 7), 2);
    expect(map.getChunk(0, 0)).toBeDefined();
    expect(getTileId(map, 10, 10)).toBe('openDoor');
    expect(map.getChunk(1, 1)).toBeUndefined(); // clean neighbour of it did go
    expect(streamer.stats().dirty).toBe(1);
  });

  it('restores explored cells when an unloaded chunk loads again', async () => {
    const { map, streamer } = setup(grid(8));
    await streamer.ensureAround(centerOf(0, 0));
    map.markExplored(3, 4);
    map.markExplored(CHUNK_SIZE + 1, 2);
    streamer.unloadFar(centerOf(7, 7), 2);
    expect(map.has(3, 4)).toBe(false);
    expect(map.isExplored(3, 4)).toBe(false);

    await streamer.ensureAround(centerOf(0, 0));
    expect(map.isExplored(3, 4)).toBe(true);
    expect(map.isExplored(CHUNK_SIZE + 1, 2)).toBe(true);
    expect(map.isExplored(4, 4)).toBe(false);
  });
});
