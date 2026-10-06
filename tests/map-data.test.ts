import { describe, expect, it } from 'vitest';
import { createPlayer } from '../src/entities/Player';
import { EventBus, type GameEvents } from '../src/engine/EventBus';
import { createGameState, placeAt } from '../src/engine/GameState';
import { tryMovePlayer } from '../src/engine/TurnManager';
import { DIRECTION_VECTORS, addPoints, rectContains, type Point, type Rect } from '../src/utils/geometry';
import { canStep, getTileId, inBounds, isWalkable, setTileId, type MapGrid } from '../src/world/GameMap';
import { loadSpace, type SpaceJSON } from '../src/world/MapLoader';
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

/** A copy of the grid with every closed door opened — the player opens doors by bumping them. */
function withDoorsOpened(grid: MapGrid): MapGrid {
  const copy: MapGrid = { ...grid, tiles: [...grid.tiles], heights: new Uint8Array(grid.heights) };
  for (let y = 0; y < copy.height; y++) {
    for (let x = 0; x < copy.width; x++) if (getTileId(copy, x, y) === 'door') setTileId(copy, x, y, 'openDoor');
  }
  return copy;
}

const SALOON: Rect = { x: 11, y: 10, width: 6, height: 5 };
const HOUSE: Rect = { x: 23, y: 4, width: 6, height: 5 };

/** Cells on the outer ring of a rect. */
function ringCells(r: Rect): Point[] {
  const out: Point[] = [];
  for (let y = r.y; y < r.y + r.height; y++) {
    for (let x = r.x; x < r.x + r.width; x++) {
      if (x === r.x || y === r.y || x === r.x + r.width - 1 || y === r.y + r.height - 1) out.push({ x, y });
    }
  }
  return out;
}

describe('worldMap.json places', () => {
  const space = loadSpace(worldMapJson as SpaceJSON);

  it("names exactly the saloon and the doctor's house, with the expected rects", () => {
    expect(space.places).toEqual([
      { name: 'Prospector Saloon', rect: SALOON },
      { name: "Doc Mitchell's House", rect: HOUSE },
    ]);
  });

  it('every place lies inside the map and its ring is wall except exactly one door', () => {
    for (const place of space.places) {
      const { rect } = place;
      expect(inBounds(space.grid, rect.x, rect.y)).toBe(true);
      expect(inBounds(space.grid, rect.x + rect.width - 1, rect.y + rect.height - 1)).toBe(true);
      const ring = ringCells(rect).map((p) => getTileId(space.grid, p.x, p.y));
      expect(ring.filter((t) => t === 'door'), place.name).toHaveLength(1);
      expect(ring.filter((t) => t !== 'door').every((t) => t === 'wall'), place.name).toBe(true);
    }
  });

  it('the saloon door is on its east wall at (16,12) and the house door on its west wall at (23,6)', () => {
    expect(getTileId(space.grid, 16, 12)).toBe('door');
    expect(getTileId(space.grid, 23, 6)).toBe('door');
  });

  it('the interior of each place is floor', () => {
    for (const { rect } of space.places) {
      for (let y = rect.y + 1; y < rect.y + rect.height - 1; y++) {
        for (let x = rect.x + 1; x < rect.x + rect.width - 1; x++) {
          expect(getTileId(space.grid, x, y)).toBe('floor');
        }
      }
    }
  });

  it('every place contains its NPCs: Trudy in the saloon, Doc in his house, nobody else inside', () => {
    const inside = (rect: Rect) => space.npcs.filter((n) => rectContains(rect, n)).map((n) => n.id);
    expect(inside(SALOON)).toEqual(['trudy']);
    expect(inside(HOUSE)).toEqual(['doc-mitchell']);
    const trudy = space.npcs.find((n) => n.id === 'trudy')!;
    const doc = space.npcs.find((n) => n.id === 'doc-mitchell')!;
    expect(trudy).toMatchObject({ x: 13, y: 12 });
    expect(doc).toMatchObject({ x: 26, y: 6 });
    expect(placeAt(space, trudy)?.name).toBe('Prospector Saloon');
    expect(placeAt(space, doc)?.name).toBe("Doc Mitchell's House");
  });

  it('Doc offers talk and heal, and has some dialogue', () => {
    const doc = space.npcs.find((n) => n.id === 'doc-mitchell')!;
    expect(doc.interactions).toEqual(['talk', 'heal']);
    expect(doc.dialogue.length).toBeGreaterThan(0);
  });

  it('no monster starts inside a building', () => {
    for (const m of space.monsters) expect(placeAt(space, m)).toBeUndefined();
  });

  it('has no transitions: the buildings are part of the one map', () => {
    expect(space.transitions).toEqual([]);
  });

  it('walking in from the street to Doc: open the door, step in, bump Doc for his menu, walk back out', () => {
    const world = loadSpace(worldMapJson as SpaceJSON);
    world.monsters = []; // keep the walk deterministic: no radroach wandering through the open door
    const state = createGameState(createPlayer(21, 6), { world }, 'world');
    const events = new EventBus<GameEvents>();
    const seen: string[] = [];
    events.on('npc-menu', () => seen.push('npc-menu'));
    events.on('space-changed', (p) => seen.push(`space:${p.spaceId}`));

    expect(tryMovePlayer(state, 'E', events)).toBe(true); // (22,6) street
    expect(tryMovePlayer(state, 'E', events)).toBe(true); // bump: door opens
    expect(state.player).toMatchObject({ x: 22, y: 6 });
    expect(getTileId(world.grid, 23, 6)).toBe('openDoor');
    expect(tryMovePlayer(state, 'E', events)).toBe(true); // (23,6) the doorway
    expect(state.messageLog.at(-1)).toBe("You enter Doc Mitchell's House.");
    expect(tryMovePlayer(state, 'E', events)).toBe(true); // (24,6)
    expect(tryMovePlayer(state, 'E', events)).toBe(true); // (25,6)
    expect(tryMovePlayer(state, 'E', events)).toBe(false); // bump Doc at (26,6)
    expect(state.player).toMatchObject({ x: 25, y: 6 });

    for (let i = 0; i < 3; i++) expect(tryMovePlayer(state, 'W', events)).toBe(true); // 24, 23, 22
    expect(state.player).toMatchObject({ x: 22, y: 6 });
    expect(state.messageLog.at(-1)).toBe("You leave Doc Mitchell's House.");
    expect(state.activeSpaceId).toBe('world');
    expect(seen).toEqual(['npc-menu']);
  });
});

describe('worldMap.json monsters', () => {
  const space = loadSpace(worldMapJson as SpaceJSON);
  // Doors open when bumped, so reachability is judged with them swung open.
  const reachable = reachableFrom(withDoorsOpened(space.grid), worldMapJson.playerStart);

  it('places the expected wildlife', () => {
    const counts: Record<string, number> = {};
    for (const m of space.monsters) counts[m.defId] = (counts[m.defId] ?? 0) + 1;
    expect(counts).toEqual({ gecko: 2, bloatfly: 1, radroach: 2, brahmin: 1 });
  });

  it('every monster stands on a walkable, non-door tile reachable from playerStart (real canStep rule, doors opened)', () => {
    expect(space.monsters.length).toBeGreaterThan(0);
    for (const m of space.monsters) {
      expect(isWalkable(space.grid, m.x, m.y)).toBe(true);
      expect(['door', 'openDoor']).not.toContain(getTileId(space.grid, m.x, m.y));
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

  it('both door cells and the street outside each are reachable from the player start', () => {
    expect(reachable.has('16,12')).toBe(true);
    expect(reachable.has('17,12')).toBe(true);
    expect(reachable.has('23,6')).toBe(true);
    expect(reachable.has('22,6')).toBe(true);
  });
});
