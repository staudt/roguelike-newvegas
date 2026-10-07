import { describe, expect, it } from 'vitest';
import { DIRECTION_VECTORS, addPoints, rectContains, type Point } from '../src/utils/geometry';
import { canStep, createEmptyGrid, getTileId, inBounds, isWalkable, setHeight, setTileId, type MapGrid } from '../src/world/GameMap';
import { loadRealWorld, readWorldMeta } from './helpers/world';

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

/** Opens every closed door in place (the player opens doors by bumping them) and returns the map. */
function openAllDoors(grid: MapGrid): MapGrid {
  const b = grid.bounds();
  for (let y = b.y; y < b.y + b.height; y++) {
    for (let x = b.x; x < b.x + b.width; x++) if (getTileId(grid, x, y) === 'door') setTileId(grid, x, y, 'openDoor');
  }
  return grid;
}

describe('world.json + chunks connectivity (doors open when bumped)', () => {
  const space = loadRealWorld();
  const start = readWorldMeta().playerStart!;
  const opened = openAllDoors(loadRealWorld().grid);
  const reachable = reachableFrom(opened, start);

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

  it('reaches every walkable interior cell of every building once the doors are open', () => {
    expect(space.places).toHaveLength(6);
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

  /** The player starts inside Doc's house, so "sealed" is judged from a street cell outside every building. */
  const STREET = { x: 9, y: 15 };

  it('the street start used for the sealing tests is open ground outside every building', () => {
    expect(isWalkable(space.grid, STREET.x, STREET.y)).toBe(true);
    expect(space.places.some((p) => rectContains(p.rect, STREET))).toBe(false);
    expect(reachableFrom(opened, STREET).has(`${start.x},${start.y}`)).toBe(true);
  });

  it('keeps each building sealed while its door is closed: the way in is only through the door', () => {
    const fromStreet = reachableFrom(space.grid, STREET);
    for (const place of space.places) {
      const interior: string[] = [];
      for (let y = place.rect.y + 1; y < place.rect.y + place.rect.height - 1; y++) {
        for (let x = place.rect.x + 1; x < place.rect.x + place.rect.width - 1; x++) {
          if (isWalkable(space.grid, x, y)) interior.push(`${x},${y}`);
        }
      }
      expect(interior.length, place.name).toBeGreaterThan(4);
      for (const k of interior) expect(fromStreet.has(k), `${place.name} ${k}`).toBe(false);
      // And no walkable cell of the place's rect is reachable either (closed doors are not walkable).
      const inside = [...fromStreet].filter((k) => {
        const [x, y] = k.split(',').map(Number) as [number, number];
        return rectContains(place.rect, { x, y });
      });
      expect(inside, place.name).toEqual([]);
    }
  });

  it('the only way into each building is its door: sealing the door cell with a wall cuts the interior off', () => {
    const sealed = openAllDoors(loadRealWorld().grid);
    const b = sealed.bounds();
    for (let y = b.y; y < b.y + b.height; y++) {
      for (let x = b.x; x < b.x + b.width; x++) if (getTileId(sealed, x, y) === 'openDoor') setTileId(sealed, x, y, 'wall');
    }
    const r = reachableFrom(sealed, STREET);
    for (const place of space.places) {
      const interior: string[] = [];
      for (let y = place.rect.y + 1; y < place.rect.y + place.rect.height - 1; y++) {
        for (let x = place.rect.x + 1; x < place.rect.x + place.rect.width - 1; x++) {
          if (isWalkable(sealed, x, y)) interior.push(`${x},${y}`);
        }
      }
      for (const k of interior) expect(r.has(k), `${place.name} ${k}`).toBe(false);
    }
  });

  it('does not consider every tile trivially reachable (sanity: the void beyond the map is excluded)', () => {
    // Guards against a vacuous flood fill (e.g. one that ignores canStep entirely): the rock
    // border tiles are hard barriers and must never show up as reachable.
    expect(reachable.has('-1,-1')).toBe(false);
    expect(reachable.has('64,64')).toBe(false);
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
