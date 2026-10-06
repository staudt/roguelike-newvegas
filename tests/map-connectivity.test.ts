import { describe, expect, it } from 'vitest';
import { DIRECTION_VECTORS, addPoints, type Point } from '../src/utils/geometry';
import { canStep, createEmptyGrid, inBounds, setHeight, type MapGrid } from '../src/world/GameMap';
import { loadSpace, type SpaceJSON } from '../src/world/MapLoader';
import prospectorSaloonJson from '../src/world/goodsprings/prospectorSaloon.json';
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

describe('worldMap.json connectivity', () => {
  const space = loadSpace(worldMapJson as SpaceJSON);
  const start = worldMapJson.playerStart;
  const reachable = reachableFrom(space.grid, start);

  it('reaches every NPC from the player start, respecting the height-step rule', () => {
    for (const npc of space.npcs) {
      expect(reachable.has(`${npc.x},${npc.y}`)).toBe(true);
    }
  });

  it('reaches the door transition into the Prospector Saloon', () => {
    for (const t of space.transitions) {
      expect(reachable.has(`${t.x},${t.y}`)).toBe(true);
    }
  });

  it('does not consider every tile trivially reachable (sanity: rock border is excluded)', () => {
    // Guards against a vacuous flood fill (e.g. one that ignores canStep entirely): the rock
    // border tiles are hard barriers and must never show up as reachable.
    expect(reachable.has('0,0')).toBe(false);
  });
});

describe('prospectorSaloon.json connectivity', () => {
  const space = loadSpace(prospectorSaloonJson as SpaceJSON);
  // The door sits at local (5,2); (4,2) is the floor tile just inside, facing the door — a
  // natural interior starting point that doesn't depend on having already crossed the threshold.
  const doorFacingCell: Point = { x: 4, y: 2 };
  const reachable = reachableFrom(space.grid, doorFacingCell);

  it('reaches Trudy from the door-facing interior cell', () => {
    for (const npc of space.npcs) {
      const local = { x: npc.x - space.worldOrigin.x, y: npc.y - space.worldOrigin.y };
      expect(reachable.has(`${local.x},${local.y}`)).toBe(true);
    }
  });

  it('reaches the door tile and the return-transition vestibule tile', () => {
    expect(reachable.has('5,2')).toBe(true); // the door itself, local coords
    for (const t of space.transitions) {
      const local = { x: t.x - space.worldOrigin.x, y: t.y - space.worldOrigin.y };
      expect(reachable.has(`${local.x},${local.y}`)).toBe(true);
    }
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
