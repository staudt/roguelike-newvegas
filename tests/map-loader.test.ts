import { describe, expect, it } from 'vitest';
import { isWalkable } from '../src/world/GameMap';
import { loadSpace, serializeSpace, type SpaceJSON } from '../src/world/MapLoader';
import worldMapJson from '../src/world/goodsprings/worldMap.json';

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

    expect(space.grid.width).toBe(fixture.width);
    expect(space.grid.height).toBe(fixture.height);
    expect(space.grid.tiles).toEqual(fixture.tiles);
    expect(Array.from(space.grid.heights)).toEqual(fixture.heights);
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
    expect(space.worldOrigin).toEqual({ x: 3, y: 7 });
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

  it('initializes fresh, fully-unseen visible/explored sets sized to the grid', () => {
    const fixture = buildFixture();
    const space = loadSpace(fixture);

    expect(space.visible).toHaveLength(fixture.width * fixture.height);
    expect(space.explored).toHaveLength(fixture.width * fixture.height);
    expect(Array.from(space.visible).every((v) => v === 0)).toBe(true);
    expect(Array.from(space.explored).every((v) => v === 0)).toBe(true);
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
    space.grid.tiles[0] = 'wall';
    space.transitions[0]!.toSpace = 'mutated';
    expect(fixture.tiles[0]).toBe('floor');
    expect(fixture.transitions[0]!.toSpace).toBe('world');
  });
});

describe('real Goodsprings content: worldMap.json', () => {
  const space = loadSpace(worldMapJson as SpaceJSON);

  it('has dimensions matching its tiles/heights arrays', () => {
    expect(space.grid.tiles).toHaveLength(worldMapJson.width * worldMapJson.height);
    expect(space.grid.heights).toHaveLength(worldMapJson.width * worldMapJson.height);
  });

  it('places every NPC on a walkable tile', () => {
    for (const npc of space.npcs) {
      expect(isWalkable(space.grid, npc.x, npc.y)).toBe(true);
    }
  });

  it('has no transitions: the buildings are part of the one map now', () => {
    expect(space.transitions).toEqual([]);
  });

  it('has places: the Prospector Saloon and Doc Mitchell House', () => {
    expect(space.places.map((p) => p.name)).toEqual(["Prospector Saloon", "Doc Mitchell's House"]);
  });

  it('documents a playerStart on walkable ground', () => {
    const start = worldMapJson.playerStart;
    expect(start).toEqual({ x: 18, y: 24 });
    expect(isWalkable(space.grid, start.x, start.y)).toBe(true);
  });
});
