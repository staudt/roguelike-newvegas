import { describe, expect, it } from 'vitest';
import { createPlayer } from '../src/entities/Player';
import { EventBus, type GameEvents } from '../src/engine/EventBus';
import { createGameState } from '../src/engine/GameState';
import { tryMovePlayer } from '../src/engine/TurnManager';
import { DIRECTION_VECTORS, addPoints, type Point } from '../src/utils/geometry';
import { canStep, getTileId, inBounds, isWalkable, type MapGrid } from '../src/world/GameMap';
import { loadSpace, type SpaceJSON } from '../src/world/MapLoader';
import docMitchellsHouseJson from '../src/world/goodsprings/docMitchellsHouse.json';
import prospectorSaloonJson from '../src/world/goodsprings/prospectorSaloon.json';
import worldMapJson from '../src/world/goodsprings/worldMap.json';

/** Same real-rule (`canStep`) flood fill as map-connectivity.test.ts, over all 8 directions. */
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

describe('docMitchellsHouse.json', () => {
  const space = loadSpace(docMitchellsHouseJson as SpaceJSON);
  const toLocal = (p: Point): Point => ({ x: p.x - space.worldOrigin.x, y: p.y - space.worldOrigin.y });

  // The exit transition's cell (world (22,6)) is the one-tile vestibule just outside the door.
  const vestibule = toLocal({ x: 22, y: 6 });
  const reachable = reachableFrom(space.grid, vestibule);

  it('is an indoor space anchored at world (22,4) and sized 7x5', () => {
    expect(space.id).toBe('doc-mitchells-house');
    expect(space.indoor).toBe(true);
    expect(space.worldOrigin).toEqual({ x: 22, y: 4 });
    expect([space.grid.width, space.grid.height]).toEqual([7, 5]);
  });

  it('has its door at world (23,6) and the exit vestibule at world (22,6)', () => {
    const door = toLocal({ x: 23, y: 6 });
    expect(getTileId(space.grid, door.x, door.y)).toBe('door');
    expect(isWalkable(space.grid, vestibule.x, vestibule.y)).toBe(true);
    expect(space.transitions).toEqual([{ x: 22, y: 6, toSpace: 'world' }]);
  });

  it('is reachable end to end from the vestibule: door, floor, and Doc', () => {
    const door = toLocal({ x: 23, y: 6 });
    expect(reachable.has(`${door.x},${door.y}`)).toBe(true);

    expect(space.npcs).toHaveLength(1);
    const doc = space.npcs[0]!;
    expect(doc).toMatchObject({ id: 'doc-mitchell', x: 26, y: 6 });
    const docLocal = toLocal(doc);
    expect(getTileId(space.grid, docLocal.x, docLocal.y)).toBe('floor');
    expect(reachable.has(`${docLocal.x},${docLocal.y}`)).toBe(true);
  });

  it('every floor tile in the house is reachable from the vestibule', () => {
    for (let y = 0; y < space.grid.height; y++) {
      for (let x = 0; x < space.grid.width; x++) {
        if (isWalkable(space.grid, x, y)) expect(reachable.has(`${x},${y}`)).toBe(true);
      }
    }
  });

  it('Doc offers talk and heal, and has some dialogue', () => {
    const doc = space.npcs[0]!;
    expect(doc.interactions).toEqual(['talk', 'heal']);
    expect(doc.dialogue.length).toBeGreaterThan(0);
  });

  it('the return transition cell is itself reachable', () => {
    for (const t of space.transitions) {
      const local = toLocal(t);
      expect(reachable.has(`${local.x},${local.y}`)).toBe(true);
    }
  });

  it('walking in from the street with the real world data reaches Doc and the way back out', () => {
    const world = loadSpace(worldMapJson as SpaceJSON);
    const saloon = loadSpace(prospectorSaloonJson as SpaceJSON);
    const house = loadSpace(docMitchellsHouseJson as SpaceJSON);
    const state = createGameState(
      createPlayer(21, 6),
      { world, 'prospector-saloon': saloon, 'doc-mitchells-house': house },
      'world',
    );
    const events = new EventBus<GameEvents>();
    const names: string[] = [];
    events.on('npc-menu', () => names.push('npc-menu'));
    events.on('space-changed', (p) => names.push(`space:${p.spaceId}`));

    expect(tryMovePlayer(state, 'E', events)).toBe(true); // (22,6) street, no transition
    expect(state.activeSpaceId).toBe('world');
    expect(tryMovePlayer(state, 'E', events)).toBe(true); // (23,6) the door
    expect(state.activeSpaceId).toBe('doc-mitchells-house');
    expect(tryMovePlayer(state, 'E', events)).toBe(true); // (24,6)
    expect(tryMovePlayer(state, 'E', events)).toBe(true); // (25,6)
    expect(tryMovePlayer(state, 'E', events)).toBe(false); // bump Doc at (26,6)
    expect(state.player).toMatchObject({ x: 25, y: 6 });

    // Walk back out: (24,6), the door (23,6), then the vestibule (22,6) flips to the world.
    expect(tryMovePlayer(state, 'W', events)).toBe(true);
    expect(tryMovePlayer(state, 'W', events)).toBe(true);
    expect(tryMovePlayer(state, 'W', events)).toBe(true);
    expect(state.player).toMatchObject({ x: 22, y: 6 });
    expect(state.activeSpaceId).toBe('world');
    expect(names).toEqual(['space:doc-mitchells-house', 'npc-menu', 'space:world']);
  });
});

describe('worldMap.json monsters', () => {
  const space = loadSpace(worldMapJson as SpaceJSON);
  const reachable = reachableFrom(space.grid, worldMapJson.playerStart);

  it('places the expected wildlife', () => {
    const counts: Record<string, number> = {};
    for (const m of space.monsters) counts[m.defId] = (counts[m.defId] ?? 0) + 1;
    expect(counts).toEqual({ gecko: 2, bloatfly: 1, radroach: 2, brahmin: 1 });
  });

  it('every monster stands on a walkable, non-door tile reachable from playerStart (real canStep rule)', () => {
    expect(space.monsters.length).toBeGreaterThan(0);
    for (const m of space.monsters) {
      expect(isWalkable(space.grid, m.x, m.y)).toBe(true);
      expect(getTileId(space.grid, m.x, m.y)).not.toBe('door');
      expect(reachable.has(`${m.x},${m.y}`)).toBe(true);
    }
  });

  it('monsters never share a cell with each other, an NPC, or the player start', () => {
    const cells = new Set<string>();
    for (const c of [...space.monsters, ...space.npcs]) {
      const key = `${c.x},${c.y}`;
      expect(cells.has(key)).toBe(false);
      cells.add(key);
    }
    const start = worldMapJson.playerStart;
    expect(cells.has(`${start.x},${start.y}`)).toBe(false);
  });

  it('the brahmin is peaceful and the geckos (and other vermin) are hostile', () => {
    const brahmin = space.monsters.filter((m) => m.defId === 'brahmin');
    expect(brahmin).toHaveLength(1);
    expect(brahmin[0]!.hostile).toBe(false);
    for (const m of space.monsters.filter((m) => m.defId !== 'brahmin')) expect(m.hostile).toBe(true);
    for (const g of space.monsters.filter((m) => m.defId === 'gecko')) expect(g.hostile).toBe(true);
  });

  it('nothing starts the game already on top of the player or alerted', () => {
    for (const m of space.monsters) expect(m.alerted).toBe(false);
  });

  it('the world has transitions for both buildings, and the Doc door tile is a door', () => {
    expect(space.transitions.map((t) => t.toSpace).sort()).toEqual(['doc-mitchells-house', 'prospector-saloon']);
    expect(getTileId(space.grid, 23, 6)).toBe('door');
  });

  it('the Doc door is reachable from the player start', () => {
    expect(reachable.has('23,6')).toBe(true);
    expect(reachable.has('22,6')).toBe(true);
  });
});
