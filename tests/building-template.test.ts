import { describe, expect, it } from 'vitest';
import { EventBus, type GameEvents } from '../src/engine/EventBus';
import { createGameState, type GameState } from '../src/engine/GameState';
import { tryMovePlayer } from '../src/engine/TurnManager';
import { createPlayer } from '../src/entities/Player';
import {
  buildBuilding,
  defaultDoorOffset,
  idToFileName,
  outsideDoorWalkable,
  slugify,
  validateBuilding,
  type BuildingRect,
  type DoorSide,
} from '../src/world/buildingTemplate';
import { loadSpace, type SpaceJSON } from '../src/world/MapLoader';

const RECT: BuildingRect = { x: 6, y: 5, w: 7, h: 6 };

function tileOf(space: SpaceJSON, wx: number, wy: number): string | undefined {
  const lx = wx - space.worldOrigin.x;
  const ly = wy - space.worldOrigin.y;
  if (lx < 0 || ly < 0 || lx >= space.width || ly >= space.height) return undefined;
  return space.tiles[ly * space.width + lx];
}

function emptyWorld(): SpaceJSON {
  return {
    id: 'world',
    name: 'World',
    indoor: false,
    worldOrigin: { x: 0, y: 0 },
    width: 20,
    height: 16,
    tiles: new Array<string>(20 * 16).fill('ground'),
    heights: new Array<number>(20 * 16).fill(0),
    npcs: [],
    transitions: [],
  };
}

function applyPatch(world: SpaceJSON, patch: ReturnType<typeof buildBuilding>['outdoorPatch']): SpaceJSON {
  const next: SpaceJSON = { ...world, tiles: [...world.tiles], transitions: [...world.transitions, patch.transition] };
  for (const t of patch.tiles) next.tiles[t.y * next.width + t.x] = t.id;
  return next;
}

const SIDES: Array<{
  side: DoorSide;
  origin: { x: number; y: number };
  size: { w: number; h: number };
  door: { x: number; y: number };
  outside: { x: number; y: number };
  /** Direction pointing from the outside cell toward the door (i.e. into the building). */
  inward: DoorSide;
}> = [
  // RECT is x 6..12, y 5..10; default offset: w=7 -> 3, h=6 -> 2.
  { side: 'N', origin: { x: 6, y: 4 }, size: { w: 7, h: 7 }, door: { x: 9, y: 5 }, outside: { x: 9, y: 4 }, inward: 'S' },
  { side: 'S', origin: { x: 6, y: 5 }, size: { w: 7, h: 7 }, door: { x: 9, y: 10 }, outside: { x: 9, y: 11 }, inward: 'N' },
  { side: 'W', origin: { x: 5, y: 5 }, size: { w: 8, h: 6 }, door: { x: 6, y: 7 }, outside: { x: 5, y: 7 }, inward: 'E' },
  { side: 'E', origin: { x: 6, y: 5 }, size: { w: 8, h: 6 }, door: { x: 12, y: 7 }, outside: { x: 13, y: 7 }, inward: 'W' },
];

describe('buildBuilding geometry', () => {
  for (const c of SIDES) {
    describe(`door on the ${c.side} side`, () => {
      const offset = defaultDoorOffset(RECT, c.side);
      const result = buildBuilding({ id: 'shop', name: 'Shop', rect: RECT, doorSide: c.side, doorOffset: offset });
      const { interior, outdoorPatch } = result;

      it('puts the interior origin, size and metadata in the right place', () => {
        expect(interior.worldOrigin).toEqual(c.origin);
        expect({ w: interior.width, h: interior.height }).toEqual(c.size);
        expect(interior.tiles).toHaveLength(c.size.w * c.size.h);
        expect(interior.heights).toHaveLength(c.size.w * c.size.h);
        expect(interior).toMatchObject({ id: 'shop', name: 'Shop', indoor: true, building: 'shop', floor: 0 });
        expect(interior.npcs).toEqual([]);
        expect(interior.monsters ?? []).toEqual([]);
      });

      it('has the door and vestibule at the right cells with matching transitions', () => {
        expect(outdoorPatch.transition).toEqual({ ...c.door, toSpace: 'shop' });
        expect(interior.transitions).toEqual([{ ...c.outside, toSpace: 'world' }]);
        expect(tileOf(interior, c.door.x, c.door.y)).toBe('door');
        expect(tileOf(interior, c.outside.x, c.outside.y)).toBe('ground');
      });

      it('has a wall ring, floor inside, and walls everywhere else in the vestibule row/column', () => {
        const floors = interior.tiles.filter((t) => t === 'floor').length;
        expect(floors).toBe((RECT.w - 2) * (RECT.h - 2));
        expect(interior.tiles.filter((t) => t === 'ground')).toHaveLength(1);
        expect(interior.tiles.filter((t) => t === 'door')).toHaveLength(1);
        expect(interior.tiles.filter((t) => t === 'wall')).toHaveLength(
          c.size.w * c.size.h - floors - 2,
        );
      });

      it('has a hollow outdoor ring with a rock core and one door', () => {
        const byCell = new Map(outdoorPatch.tiles.map((t) => [`${t.x},${t.y}`, t.id]));
        expect(byCell.size).toBe(RECT.w * RECT.h);
        for (let y = RECT.y; y < RECT.y + RECT.h; y++) {
          for (let x = RECT.x; x < RECT.x + RECT.w; x++) {
            const ring = x === RECT.x || y === RECT.y || x === RECT.x + RECT.w - 1 || y === RECT.y + RECT.h - 1;
            const expected = x === c.door.x && y === c.door.y ? 'door' : ring ? 'wall' : 'rock';
            expect(byCell.get(`${x},${y}`)).toBe(expected);
          }
        }
      });

      it('survives a loadSpace round trip', () => {
        const space = loadSpace(interior);
        expect(space.id).toBe('shop');
        expect(space.indoor).toBe(true);
        expect(space.worldOrigin).toEqual(c.origin);
        expect(space.grid.width).toBe(c.size.w);
      });
    });
  }

  it('rejects corner door offsets and undersized rectangles', () => {
    expect(() => buildBuilding({ id: 'a', name: 'A', rect: RECT, doorSide: 'N', doorOffset: 0 })).toThrow();
    expect(() => buildBuilding({ id: 'a', name: 'A', rect: RECT, doorSide: 'N', doorOffset: RECT.w - 1 })).toThrow();
    expect(() => buildBuilding({ id: 'a', name: 'A', rect: { x: 2, y: 2, w: 4, h: 4 }, doorSide: 'N', doorOffset: 1 })).toThrow();
  });
});

describe('end-to-end walk through a generated building (real engine)', () => {
  for (const c of SIDES) {
    it(`walks in and back out through a ${c.side} door`, () => {
      const offset = defaultDoorOffset(RECT, c.side);
      const { outdoorPatch, interior } = buildBuilding({ id: 'shop', name: 'Shop', rect: RECT, doorSide: c.side, doorOffset: offset });
      const world = applyPatch(emptyWorld(), outdoorPatch);
      expect(outsideDoorWalkable(world, RECT, c.side, offset)).toBe(true);

      const player = createPlayer(c.outside.x, c.outside.y);
      const state: GameState = createGameState(
        player,
        { world: loadSpace(world), shop: loadSpace(interior) },
        'world',
      );
      const events = new EventBus<GameEvents>();
      const changes: string[] = [];
      events.on('space-changed', (payload) => changes.push(payload.spaceId));

      // Outside cell -> onto the door tile flips into the interior.
      expect(tryMovePlayer(state, c.inward, events)).toBe(true);
      expect(state.player).toMatchObject(c.door);
      expect(state.activeSpaceId).toBe('shop');

      // Door -> floor inside.
      expect(tryMovePlayer(state, c.inward, events)).toBe(true);
      expect(state.activeSpaceId).toBe('shop');
      const inwardStep = ({ N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] } as Record<DoorSide, number[]>)[c.inward]!;
      expect(state.player).toMatchObject({ x: c.door.x + inwardStep[0]!, y: c.door.y + inwardStep[1]! });

      // Back toward the door, then out onto the vestibule cell flips back to the world.
      const outward: DoorSide = { N: 'S', S: 'N', E: 'W', W: 'E' }[c.inward] as DoorSide;
      expect(tryMovePlayer(state, outward, events)).toBe(true);
      expect(state.player).toMatchObject(c.door);
      expect(tryMovePlayer(state, outward, events)).toBe(true);
      expect(state.player).toMatchObject(c.outside);
      expect(state.activeSpaceId).toBe('world');
      expect(changes).toEqual(['shop', 'world']);
    });
  }
});

describe('validateBuilding / helpers', () => {
  const base = { id: 'shop', name: 'Shop', rect: RECT, doorSide: 'S' as DoorSide, doorOffset: 3 };

  it('accepts a clean placement', () => {
    expect(validateBuilding(emptyWorld(), ['world'], base)).toEqual([]);
  });

  it('refuses duplicate ids, border coverage, corner doors and too-small rects', () => {
    expect(validateBuilding(emptyWorld(), ['world', 'shop'], base)).not.toEqual([]);
    expect(validateBuilding(emptyWorld(), [], { ...base, rect: { x: 0, y: 5, w: 6, h: 5 } })).not.toEqual([]);
    expect(validateBuilding(emptyWorld(), [], { ...base, rect: { x: 15, y: 5, w: 5, h: 5 } })).not.toEqual([]);
    expect(validateBuilding(emptyWorld(), [], { ...base, doorOffset: 0 })).not.toEqual([]);
    expect(validateBuilding(emptyWorld(), [], { ...base, rect: { x: 3, y: 3, w: 4, h: 4 } })).not.toEqual([]);
  });

  it('refuses overlaps with transitions, NPCs and monsters', () => {
    const w1 = { ...emptyWorld(), transitions: [{ x: 8, y: 7, toSpace: 'x' }] };
    const w2 = { ...emptyWorld(), npcs: [{ id: 'n', name: 'N', x: 8, y: 7, dialogue: ['hi'] }] };
    const w3 = { ...emptyWorld(), monsters: [{ defId: 'gecko', x: 8, y: 7 }] };
    for (const w of [w1, w2, w3]) expect(validateBuilding(w, [], base)).not.toEqual([]);
  });

  it('warns (via outsideDoorWalkable) when the cell outside the door is rock', () => {
    const world = emptyWorld();
    world.tiles[11 * world.width + 9] = 'rock';
    expect(outsideDoorWalkable(world, RECT, 'S', 3)).toBe(false);
  });

  it('slugs names and derives file names', () => {
    expect(slugify('Goodsprings General Store!')).toBe('goodsprings-general-store');
    expect(idToFileName('goodsprings-general-store')).toBe('goodspringsGeneralStore.json');
    expect(idToFileName('shop')).toBe('shop.json');
  });
});
