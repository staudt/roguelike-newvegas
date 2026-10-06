import { describe, expect, it } from 'vitest';
import { DIRECTION_VECTORS, addPoints, rectContains, type Point } from '../src/utils/geometry';
import { canStep, createEmptyGrid, inBounds, isWalkable, setHeight, setTileId, type MapGrid } from '../src/world/GameMap';
import { loadSpace, type SpaceJSON } from '../src/world/MapLoader';
import worldMapJson from '../src/world/goodsprings/worldMap.json';

/**
 * Flood-fills `grid` from `start` using the REAL height-step rule (`canStep`), not raw tile
 * walkability — a naive walkability-only flood fill would happily cross a 2-rung ridge jump that
 * the game actually forbids, so it could report a map as connected when a player can't actually
 * get there. Considers all 8 directions, matching every move the player/chord detector can make.
 */
function reachableFrom(grid: MapGrid, start: Point): Set<string> {
  const key = (p: Point) => `${p.x},${p.y}`;
  const visited = new Set<string>([key(start)]);
  const queue: Point[] = [start];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const vector of Object.values(DIRECTION_VECTORS)) {
      const next = addPoints(current, vector);
      if (!inBounds(grid, next.x, next.y)) continue;
      if (visited.has(key(next))) continue;
      if (!canStep(grid, current, next)) continue;
      visited.add(key(next));
      queue.push(next);
    }
  }

  return visited;
}

/** A copy of `grid` with every closed door swung open — the player opens doors by bumping them. */
function withDoorsOpened(grid: MapGrid): MapGrid {
  const copy: MapGrid = { ...grid, tiles: [...grid.tiles], heights: new Uint8Array(grid.heights) };
  for (let y = 0; y < copy.height; y++) {
    for (let x = 0; x < copy.width; x++) {
      if (copy.tiles[y * copy.width + x] === 'door') setTileId(copy, x, y, 'openDoor');
    }
  }
  return copy;
}

describe('worldMap.json connectivity (doors open when bumped)', () => {
  const space = loadSpace(worldMapJson as SpaceJSON);
  const start = worldMapJson.playerStart;
  const opened = withDoorsOpened(space.grid);
  const reachable = reachableFrom(opened, start);
  const closedReach = reachableFrom(space.grid, start);

  it('reaches every NPC from the player start, respecting the height-step rule', () => {
    expect(space.npcs.length).toBeGreaterThan(0);
    for (const npc of space.npcs) {
      expect(reachable.has(`${npc.x},${npc.y}`), npc.id).toBe(true);
    }
  });

  it('reaches Trudy in the saloon and Doc Mitchell in his house', () => {
    const trudy = space.npcs.find((n) => n.id === 'trudy')!;
    const doc = space.npcs.find((n) => n.id === 'doc-mitchell')!;
    expect(reachable.has(`${trudy.x},${trudy.y}`)).toBe(true);
    expect(reachable.has(`${doc.x},${doc.y}`)).toBe(true);
  });

  it('reaches every monster', () => {
    expect(space.monsters.length).toBeGreaterThan(0);
    for (const m of space.monsters) expect(reachable.has(`${m.x},${m.y}`), m.id).toBe(true);
  });

  it('reaches every walkable interior cell of both buildings once the doors are open', () => {
    expect(space.places).toHaveLength(2);
    for (const place of space.places) {
      let cells = 0;
      for (let y = place.rect.y; y < place.rect.y + place.rect.height; y++) {
        for (let x = place.rect.x; x < place.rect.x + place.rect.width; x++) {
          if (!isWalkable(opened, x, y)) continue; // the wall ring
          cells++;
          expect(reachable.has(`${x},${y}`), `${place.name} ${x},${y}`).toBe(true);
        }
      }
      expect(cells).toBeGreaterThan(4);
    }
  });

  it('keeps each building sealed while its door is closed: the way in is only through the door', () => {
    const trudy = space.npcs.find((n) => n.id === 'trudy')!;
    const doc = space.npcs.find((n) => n.id === 'doc-mitchell')!;
    expect(closedReach.has(`${trudy.x},${trudy.y}`)).toBe(false);
    expect(closedReach.has(`${doc.x},${doc.y}`)).toBe(false);
    for (const place of space.places) {
      for (let y = place.rect.y + 1; y < place.rect.y + place.rect.height - 1; y++) {
        for (let x = place.rect.x + 1; x < place.rect.x + place.rect.width - 1; x++) {
          expect(closedReach.has(`${x},${y}`), `${place.name} ${x},${y}`).toBe(false);
        }
      }
      // And no walkable cell of the place's ring is reachable either (closed doors are not walkable).
      const inside = [...closedReach].filter((k) => {
        const [x, y] = k.split(',').map(Number) as [number, number];
        return rectContains(place.rect, { x, y });
      });
      expect(inside).toEqual([]);
    }
  });

  it('the only way into each building is its door: sealing the door cell with a wall cuts the interior off', () => {
    const sealed = withDoorsOpened(space.grid);
    for (let i = 0; i < sealed.tiles.length; i++) if (sealed.tiles[i] === 'openDoor') sealed.tiles[i] = 'wall';
    const r = reachableFrom(sealed, start);
    const trudy = space.npcs.find((n) => n.id === 'trudy')!;
    const doc = space.npcs.find((n) => n.id === 'doc-mitchell')!;
    expect(r.has(`${trudy.x},${trudy.y}`)).toBe(false);
    expect(r.has(`${doc.x},${doc.y}`)).toBe(false);
  });

  it('does not consider every tile trivially reachable (sanity: rock border is excluded)', () => {
    // Guards against a vacuous flood fill (e.g. one that ignores canStep entirely): the rock
    // border tiles are hard barriers and must never show up as reachable.
    expect(reachable.has('0,0')).toBe(false);
  });
});

describe('reachableFrom height-rule sanity (synthetic)', () => {
  it('a 2-rung ridge jump is NOT considered reachable even though both tiles are walkable', () => {
    const grid = createEmptyGrid(3, 1, 'ground');
    setHeight(grid, 2, 0, 2); // a 2-rung jump from height 0 is blocked by MAX_STEP_HEIGHT_DELTA
    const reachable = reachableFrom(grid, { x: 0, y: 0 });
    expect(reachable.has('1,0')).toBe(true);
    expect(reachable.has('2,0')).toBe(false);
  });
});
