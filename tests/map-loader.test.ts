import { describe, expect, it } from 'vitest';
import { isWalkable } from '../src/world/GameMap';
import { loadSpace, serializeSpace, type SpaceJSON } from '../src/world/MapLoader';
import prospectorSaloonJson from '../src/world/goodsprings/prospectorSaloon.json';
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
    npcs: [{ id: 'npc-1', name: 'Fixture NPC', x: 4, y: 7, dialogue: ['Hello there.'], fg: '#abcdef' }],
    transitions: [{ x: 5, y: 7, toSpace: 'world' }],
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

  it('has the documented door transition into the Prospector Saloon', () => {
    expect(space.transitions).toContainEqual({ x: 16, y: 12, toSpace: 'prospector-saloon' });
  });

  it('documents a playerStart on walkable ground', () => {
    const start = worldMapJson.playerStart;
    expect(start).toEqual({ x: 18, y: 24 });
    expect(isWalkable(space.grid, start.x, start.y)).toBe(true);
  });
});

describe('real Goodsprings content: prospectorSaloon.json', () => {
  const space = loadSpace(prospectorSaloonJson as SpaceJSON);

  it('has dimensions matching its tiles/heights arrays', () => {
    expect(space.grid.tiles).toHaveLength(
      prospectorSaloonJson.width * prospectorSaloonJson.height,
    );
    expect(space.grid.heights).toHaveLength(
      prospectorSaloonJson.width * prospectorSaloonJson.height,
    );
  });

  it('places every NPC (world coords, converted to local) on a walkable tile', () => {
    for (const npc of space.npcs) {
      const localX = npc.x - space.worldOrigin.x;
      const localY = npc.y - space.worldOrigin.y;
      expect(isWalkable(space.grid, localX, localY)).toBe(true);
    }
  });

  it('has the documented return transition back to the world, at the vestibule tile', () => {
    expect(space.transitions).toContainEqual({ x: 17, y: 12, toSpace: 'world' });
  });

  it('is indoors with the documented worldOrigin', () => {
    expect(space.indoor).toBe(true);
    expect(space.worldOrigin).toEqual({ x: 11, y: 10 });
  });
});
