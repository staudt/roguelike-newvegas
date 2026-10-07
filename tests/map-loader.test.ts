import { describe, expect, it } from 'vitest';
import { getHeight, getTileId, isWalkable } from '../src/world/GameMap';
import { FlatMap } from '../src/world/FlatMap';
import { ChunkedMap } from '../src/world/ChunkedMap';
import { encodeChunk } from '../src/world/ChunkCodec';
import { loadSpace, loadWorld, serializeSpace, type SpaceJSON, type WorldMetaJSON } from '../src/world/MapLoader';
import { loadRealWorld, readWorldChunks, readWorldMeta } from './helpers/world';

function buildFixture(): SpaceJSON {
  return {
    id: 'fixture',
    name: 'Fixture Space',
    indoor: true,
    worldOrigin: { x: 3, y: 7 },
    width: 3,
    height: 2,
    tiles: ['floor', 'floor', 'door', 'wall', 'floor', 'wall'],
    heights: [0, 0, 0, 0, 0, 0],
    npcs: [{ id: 'npc-1', name: 'Fixture NPC', x: 4, y: 7, dialogue: ['Hello there.'], fg: '#abcdef', interactions: ['talk'] }],
    monsters: [{ defId: 'gecko', x: 4, y: 8 }],
    transitions: [{ x: 5, y: 7, toSpace: 'world' }],
    places: [{ name: 'Fixture Hall', rect: { x: 3, y: 7, width: 2, height: 2 } }],
  };
}

describe('loadSpace / serializeSpace round trip', () => {
  it('losslessly round-trips a hand-built SpaceJSON', () => {
    const fixture = buildFixture();
    const space = loadSpace(fixture);
    const serialized = serializeSpace(space);

    expect(serialized).toEqual(fixture);
  });

  it('loads grid dimensions, tiles, and heights faithfully', () => {
    const fixture = buildFixture();
    const space = loadSpace(fixture);

    expect(space.grid).toBeInstanceOf(FlatMap);
    expect(space.grid.bounds()).toEqual({ x: 3, y: 7, width: 3, height: 2 });
    const tiles: string[] = [];
    for (let y = 7; y < 9; y++) for (let x = 3; x < 6; x++) tiles.push(getTileId(space.grid, x, y));
    expect(tiles).toEqual(fixture.tiles);
    expect(getHeight(space.grid, 3, 7)).toBe(0);
  });

  it('loads places as named rects, copied rather than aliased', () => {
    const fixture = buildFixture();
    const space = loadSpace(fixture);
    expect(space.places).toEqual([{ name: 'Fixture Hall', rect: { x: 3, y: 7, width: 2, height: 2 } }]);
    space.places[0]!.rect.x = 99;
    expect(fixture.places![0]!.rect.x).toBe(3);
  });

  it('treats an omitted places list as none', () => {
    const fixture = buildFixture();
    delete fixture.places;
    expect(loadSpace(fixture).places).toEqual([]);
  });

  it('loads npcs, transitions, worldOrigin, and indoor flag', () => {
    const fixture = buildFixture();
    const space = loadSpace(fixture);

    expect(space.id).toBe('fixture');
    expect(space.name).toBe('Fixture Space');
    expect(space.indoor).toBe(true);
    expect((space.grid as FlatMap).origin).toEqual({ x: 3, y: 7 });
    expect(space.transitions).toEqual([{ x: 5, y: 7, toSpace: 'world' }]);
    expect(space.npcs).toHaveLength(1);
    expect(space.npcs[0]).toMatchObject({
      id: 'npc-1',
      name: 'Fixture NPC',
      x: 4,
      y: 7,
      dialogue: ['Hello there.'],
      fg: '#abcdef',
    });
  });

  it('initializes a fresh, empty view and nothing explored', () => {
    const space = loadSpace(buildFixture());
    expect(space.visible.width).toBe(0);
    for (let y = 7; y < 9; y++) for (let x = 3; x < 6; x++) expect(space.grid.isExplored(x, y)).toBe(false);
  });

  it('rejects a tiles array whose length does not match width*height', () => {
    const fixture = buildFixture();
    fixture.tiles = fixture.tiles.slice(0, -1);
    expect(() => loadSpace(fixture)).toThrow();
  });

  it('rejects a heights array whose length does not match width*height', () => {
    const fixture = buildFixture();
    fixture.heights = fixture.heights.slice(0, -1);
    expect(() => loadSpace(fixture)).toThrow();
  });

  it('defensively copies arrays rather than aliasing the input', () => {
    const fixture = buildFixture();
    const space = loadSpace(fixture);
    (space.grid as FlatMap).tiles[0] = 0;
    space.transitions[0]!.toSpace = 'mutated';
    expect(fixture.tiles[0]).toBe('floor');
    expect(getTileId(space.grid, 3, 7)).toBe('void');
    expect(fixture.transitions[0]!.toSpace).toBe('world');
  });
});

const GOODSPRINGS_PLACES = ['Gas Station', "Doc Mitchell's House", 'General Store', 'Prospector Saloon', 'Goodspring Schoolhouse', "Victor's Shack"];

describe('loadWorld', () => {
  const meta = readWorldMeta();

  it('builds a chunked world from meta plus chunk files, with entities placed', () => {
    const space = loadRealWorld();
    expect(space.grid).toBeInstanceOf(ChunkedMap);
    expect(space.id).toBe('world');
    expect(space.name).toBe(meta.name);
    expect(space.indoor).toBe(false);
    expect(space.npcs.map((n) => n.id)).toEqual(meta.npcs.map((n) => n.id));
    expect(space.monsters).toHaveLength(meta.monsters!.length);
    expect(space.places.map((p) => p.name)).toEqual(GOODSPRINGS_PLACES);
    expect(space.transitions).toEqual([]);
    expect((space.grid as ChunkedMap).chunkList()).toHaveLength(readWorldChunks().length);
  });

  it('round-trips chunks: re-encoding the loaded chunks decodes to the same cells', () => {
    const chunks = readWorldChunks();
    const space = loadWorld(meta, chunks);
    const again = loadWorld(meta, (space.grid as ChunkedMap).chunkList().map(encodeChunk));
    for (const c of chunks) {
      for (let i = 0; i < 64 * 64; i += 37) {
        const x = c.cx * 64 + (i % 64);
        const y = c.cy * 64 + Math.floor(i / 64);
        expect(getTileId(again.grid, x, y)).toBe(getTileId(space.grid, x, y));
        expect(getHeight(again.grid, x, y)).toBe(getHeight(space.grid, x, y));
      }
    }
  });

  it('loads with no chunks at all (everything void) and places entities regardless', () => {
    const empty: WorldMetaJSON = { ...meta };
    const space = loadWorld(empty, []);
    expect(space.grid.has(0, 0)).toBe(false);
    expect(space.npcs.length).toBe(meta.npcs.length);
  });

  it('knows where the real map ends: cells outside the authored chunks are void', () => {
    const space = loadRealWorld();
    expect(getTileId(space.grid, -1, 0)).toBe('void');
    expect(getTileId(space.grid, 0, -1)).toBe('void');
  });
});

describe('real Goodsprings content: world.json + chunks', () => {
  const space = loadRealWorld();
  const meta = readWorldMeta();

  it('places every NPC on a walkable tile', () => {
    for (const npc of space.npcs) {
      expect(isWalkable(space.grid, npc.x, npc.y)).toBe(true);
    }
  });

  it('has no transitions: the buildings are part of the one map now', () => {
    expect(space.transitions).toEqual([]);
  });

  it('has the six places: gas station, Doc Mitchell House, general store, saloon, schoolhouse, Victor shack', () => {
    expect(space.places.map((p) => p.name)).toEqual(GOODSPRINGS_PLACES);
  });

  it('documents a playerStart on walkable ground', () => {
    const start = meta.playerStart!;
    expect(start).toEqual({ x: 4, y: 13 });
    expect(isWalkable(space.grid, start.x, start.y)).toBe(true);
  });
});
