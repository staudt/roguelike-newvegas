import { describe, expect, it } from 'vitest';
import { createPlayer } from '../src/entities/Player';
import { EventBus, type GameEvents } from '../src/engine/EventBus';
import { createGameState, placeAt } from '../src/engine/GameState';
import { tryMovePlayer } from '../src/engine/TurnManager';
import { DIRECTION_VECTORS, addPoints, rectContains, type Point, type Rect } from '../src/utils/geometry';
import { canStep, getTileId, inBounds, isWalkable, setTileId, type MapGrid } from '../src/world/GameMap';
import { RING_GAPS, loadRealWorld, readWorldMeta } from './helpers/world';

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

/** Opens every closed door in place (the player opens doors by bumping them) and returns the map. */
function openAllDoors(grid: MapGrid): MapGrid {
  const b = grid.bounds();
  for (let y = b.y; y < b.y + b.height; y++) {
    for (let x = b.x; x < b.x + b.width; x++) if (getTileId(grid, x, y) === 'door') setTileId(grid, x, y, 'openDoor');
  }
  return grid;
}

/** The authored places, in world.json order, with the one door each is expected to have. */
const PLACES: Array<{ name: string; rect: Rect; door: Point }> = [
  { name: 'Gas Station', rect: { x: 0, y: 4, width: 6, height: 5 }, door: { x: 5, y: 7 } },
  { name: "Doc Mitchell's House", rect: { x: 1, y: 12, width: 7, height: 5 }, door: { x: 7, y: 15 } },
  { name: 'General Store', rect: { x: 24, y: 4, width: 6, height: 6 }, door: { x: 26, y: 9 } },
  { name: 'Prospector Saloon', rect: { x: 32, y: 3, width: 9, height: 7 }, door: { x: 38, y: 9 } },
  { name: 'Goodspring Schoolhouse', rect: { x: 0, y: 23, width: 8, height: 7 }, door: { x: 7, y: 25 } },
  { name: "Victor's Shack", rect: { x: 12, y: 33, width: 6, height: 5 }, door: { x: 14, y: 33 } },
];
const place = (name: string) => PLACES.find((p) => p.name === name)!;

/**
 * Interior cells that are legitimately not floor: the saloon's partition wall, and the two cells
 * where an NPC was placed on bare ground (Ringo in the Gas Station, Doc in his house).
 * NOTE: the NPC cells look like editor paint left on the floor; see the report on the map.
 */
const INTERIOR_EXCEPTIONS: Record<string, Array<{ x: number; y: number; tile: string }>> = {
  'Gas Station': [{ x: 3, y: 6, tile: 'ground' }],
  "Doc Mitchell's House": [{ x: 4, y: 15, tile: 'ground' }],
  'Prospector Saloon': [
    { x: 36, y: 4, tile: 'wall' },
    { x: 36, y: 5, tile: 'wall' },
    { x: 36, y: 6, tile: 'wall' },
  ],
};

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

describe('world.json + chunks places', () => {
  const space = loadRealWorld();

  it('names exactly the six places, with the expected rects', () => {
    expect(space.places).toEqual(PLACES.map(({ name, rect }) => ({ name, rect })));
  });

  it('every place lies inside the map and its ring is wall except exactly one door (known gaps listed in RING_GAPS)', () => {
    for (const place of space.places) {
      const { rect } = place;
      expect(inBounds(space.grid, rect.x, rect.y)).toBe(true);
      expect(inBounds(space.grid, rect.x + rect.width - 1, rect.y + rect.height - 1)).toBe(true);
      const cells = ringCells(rect);
      expect(cells.filter((p) => getTileId(space.grid, p.x, p.y) === 'door'), place.name).toHaveLength(1);
      const gaps = cells.filter((p) => !['door', 'wall'].includes(getTileId(space.grid, p.x, p.y)));
      expect(gaps, place.name).toEqual(RING_GAPS[place.name] ?? []);
    }
  });

  it('each place has its door where expected, found from its ring', () => {
    for (const { name, rect, door } of PLACES) {
      const found = ringCells(rect).filter((p) => getTileId(space.grid, p.x, p.y) === 'door');
      expect(found, name).toEqual([door]);
    }
  });

  it('the interior of each place is floor (apart from INTERIOR_EXCEPTIONS)', () => {
    for (const { name, rect } of space.places) {
      const odd: Array<{ x: number; y: number; tile: string }> = [];
      for (let y = rect.y + 1; y < rect.y + rect.height - 1; y++) {
        for (let x = rect.x + 1; x < rect.x + rect.width - 1; x++) {
          const tile = getTileId(space.grid, x, y);
          if (tile !== 'floor') odd.push({ x, y, tile });
        }
      }
      expect(odd, name).toEqual(INTERIOR_EXCEPTIONS[name] ?? []);
    }
  });

  it('every place contains its NPCs: Ringo in the gas station, Doc in his house, Sunny and Trudy in the saloon, nobody else inside', () => {
    const inside = (name: string) =>
      space.npcs.filter((n) => rectContains(place(name).rect, n)).map((n) => n.id).sort();
    expect(inside('Gas Station')).toEqual(['ringo']);
    expect(inside("Doc Mitchell's House")).toEqual(['doc-mitchell']);
    expect(inside('General Store')).toEqual(['npc-2']); // Chet
    expect(inside('Prospector Saloon')).toEqual(['sunny-smiles', 'trudy']);
    expect(inside('Goodspring Schoolhouse')).toEqual([]);
    // NOTE: Victor (npc-1) stands in the street at (13,16), not in Victor's Shack: likely a map mistake.
    expect(inside("Victor's Shack")).toEqual([]);
    const at = (id: string) => space.npcs.find((n) => n.id === id)!;
    expect(at('trudy')).toMatchObject({ x: 35, y: 6 });
    expect(at('doc-mitchell')).toMatchObject({ x: 4, y: 15 });
    expect(placeAt(space, at('trudy'))?.name).toBe('Prospector Saloon');
    expect(placeAt(space, at('doc-mitchell'))?.name).toBe("Doc Mitchell's House");
    expect(placeAt(space, at('ringo'))?.name).toBe('Gas Station');
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
    const world = loadRealWorld();
    world.monsters = []; // keep the walk deterministic: no wildlife wandering through the open door
    const state = createGameState(createPlayer(9, 15), { world }, 'world'); // street east of Doc's door at (7,15)
    const events = new EventBus<GameEvents>();
    // Nobody wanders (Doc would sometimes step away from his spot before the bump).
    const still = () => 0.999;
    const seen: string[] = [];
    events.on('npc-menu', () => seen.push('npc-menu'));
    events.on('space-changed', (p) => seen.push(`space:${p.spaceId}`));

    expect(tryMovePlayer(state, 'W', events, still)).toBe(true); // (8,15) street
    expect(tryMovePlayer(state, 'W', events, still)).toBe(true); // bump: door opens
    expect(state.player).toMatchObject({ x: 8, y: 15 });
    expect(getTileId(world.grid, 7, 15)).toBe('openDoor');
    expect(tryMovePlayer(state, 'W', events, still)).toBe(true); // (7,15) the doorway
    expect(state.messageLog.at(-1)).toBe("You enter Doc Mitchell's House.");
    expect(tryMovePlayer(state, 'W', events, still)).toBe(true); // (6,15)
    expect(tryMovePlayer(state, 'W', events, still)).toBe(true); // (5,15)
    expect(tryMovePlayer(state, 'W', events, still)).toBe(false); // bump Doc at (4,15)
    expect(state.player).toMatchObject({ x: 5, y: 15 });

    for (let i = 0; i < 3; i++) expect(tryMovePlayer(state, 'E', events, still)).toBe(true); // 6, 7, 8
    expect(state.player).toMatchObject({ x: 8, y: 15 });
    expect(state.messageLog.at(-1)).toBe("You leave Doc Mitchell's House.");
    expect(state.activeSpaceId).toBe('world');
    expect(seen).toEqual(['npc-menu']);
  });
});

describe('world.json + chunks monsters', () => {
  const space = loadRealWorld();
  // Doors open when bumped, so reachability is judged with them swung open.
  const reachable = reachableFrom(openAllDoors(loadRealWorld().grid), readWorldMeta().playerStart!);

  it('places the expected wildlife', () => {
    const counts: Record<string, number> = {};
    for (const m of space.monsters) counts[m.defId] = (counts[m.defId] ?? 0) + 1;
    expect(counts).toEqual({ gecko: 3, bloatfly: 3, radroach: 2, brahmin: 2, ghoul: 1 });
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
    const start = readWorldMeta().playerStart!;
    expect(cells.has(`${start.x},${start.y}`)).toBe(false);
  });

  it('the brahmin are peaceful and the geckos (and other vermin) are hostile', () => {
    const brahmin = space.monsters.filter((m) => m.defId === 'brahmin');
    expect(brahmin).toHaveLength(2);
    for (const b of brahmin) expect(b.hostile).toBe(false);
    for (const m of space.monsters.filter((m) => m.defId !== 'brahmin')) expect(m.hostile).toBe(true);
    for (const g of space.monsters.filter((m) => m.defId === 'gecko')) expect(g.hostile).toBe(true);
  });

  it('nothing starts the game already on top of the player or alerted', () => {
    for (const m of space.monsters) expect(m.alerted).toBe(false);
  });

  it('every door cell and the street outside each are reachable from the player start', () => {
    for (const { name, door } of PLACES) {
      expect(reachable.has(`${door.x},${door.y}`), name).toBe(true);
      const outside = Object.values(DIRECTION_VECTORS)
        .map((v) => addPoints(door, v))
        .filter((p) => inBounds(space.grid, p.x, p.y) && isWalkable(space.grid, p.x, p.y))
        .filter((p) => !rectContains(place(name).rect, p));
      expect(outside.length, name).toBeGreaterThan(0);
      for (const p of outside) expect(reachable.has(`${p.x},${p.y}`), name).toBe(true);
    }
  });
});
