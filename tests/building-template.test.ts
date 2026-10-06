import { describe, expect, it } from 'vitest';
import { EventBus, type GameEvents } from '../src/engine/EventBus';
import { createGameState, getActiveSpace } from '../src/engine/GameState';
import { tryMovePlayer } from '../src/engine/TurnManager';
import { createPlayer } from '../src/entities/Player';
import {
  buildBuilding,
  defaultDoorOffset,
  outsideDoorWalkable,
  validateBuilding,
  type BuildingPatch,
  type BuildingRect,
  type DoorSide,
} from '../src/world/buildingTemplate';
import { getTileId } from '../src/world/GameMap';
import { loadSpace, type SpaceJSON } from '../src/world/MapLoader';

const RECT: BuildingRect = { x: 6, y: 5, w: 7, h: 6 };

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

function applyPatch(world: SpaceJSON, patch: BuildingPatch): SpaceJSON {
  const next: SpaceJSON = { ...world, tiles: [...world.tiles], places: [...(world.places ?? []), patch.place] };
  for (const t of patch.tiles) next.tiles[t.y * next.width + t.x] = t.id;
  return next;
}

const SIDES: Array<{
  side: DoorSide;
  door: { x: number; y: number };
  outside: { x: number; y: number };
  /** Direction pointing from the outside cell toward the door (i.e. into the building). */
  inward: DoorSide;
}> = [
  // RECT is x 6..12, y 5..10; default offset: w=7 -> 3, h=6 -> 2.
  { side: 'N', door: { x: 9, y: 5 }, outside: { x: 9, y: 4 }, inward: 'S' },
  { side: 'S', door: { x: 9, y: 10 }, outside: { x: 9, y: 11 }, inward: 'N' },
  { side: 'W', door: { x: 6, y: 7 }, outside: { x: 5, y: 7 }, inward: 'E' },
  { side: 'E', door: { x: 12, y: 7 }, outside: { x: 13, y: 7 }, inward: 'W' },
];
const OPPOSITE: Record<DoorSide, DoorSide> = { N: 'S', S: 'N', E: 'W', W: 'E' };
const STEP: Record<DoorSide, { x: number; y: number }> = {
  N: { x: 0, y: -1 },
  S: { x: 0, y: 1 },
  E: { x: 1, y: 0 },
  W: { x: -1, y: 0 },
};

describe('buildBuilding geometry', () => {
  for (const c of SIDES) {
    describe(`door on the ${c.side} side`, () => {
      const offset = defaultDoorOffset(RECT, c.side);
      const patch = buildBuilding({ name: ' Shop ', rect: RECT, doorSide: c.side, doorOffset: offset });

      it('covers the whole footprint with a wall ring, floor inside and one closed door', () => {
        const byCell = new Map(patch.tiles.map((t) => [`${t.x},${t.y}`, t.id]));
        expect(patch.tiles).toHaveLength(RECT.w * RECT.h);
        expect(byCell.size).toBe(RECT.w * RECT.h);
        for (let y = RECT.y; y < RECT.y + RECT.h; y++) {
          for (let x = RECT.x; x < RECT.x + RECT.w; x++) {
            const ring = x === RECT.x || y === RECT.y || x === RECT.x + RECT.w - 1 || y === RECT.y + RECT.h - 1;
            const expected = x === c.door.x && y === c.door.y ? 'door' : ring ? 'wall' : 'floor';
            expect(byCell.get(`${x},${y}`)).toBe(expected);
          }
        }
        expect(patch.tiles.filter((t) => t.id === 'door')).toHaveLength(1);
        expect(patch.tiles.filter((t) => t.id === 'floor')).toHaveLength((RECT.w - 2) * (RECT.h - 2));
      });

      it('describes the place rectangle (trimmed name, width/height)', () => {
        expect(patch.place).toEqual({ name: 'Shop', rect: { x: 6, y: 5, width: 7, height: 6 } });
      });
    });
  }

  it('rejects corner door offsets and undersized rectangles', () => {
    expect(() => buildBuilding({ name: 'A', rect: RECT, doorSide: 'N', doorOffset: 0 })).toThrow();
    expect(() => buildBuilding({ name: 'A', rect: RECT, doorSide: 'N', doorOffset: RECT.w - 1 })).toThrow();
    expect(() => buildBuilding({ name: 'A', rect: { x: 2, y: 2, w: 4, h: 4 }, doorSide: 'N', doorOffset: 1 })).toThrow();
  });
});

describe('end-to-end walk through a generated building (real engine)', () => {
  for (const c of SIDES) {
    it(`opens the ${c.side} door, walks in and back out with place messages`, () => {
      const offset = defaultDoorOffset(RECT, c.side);
      const patch = buildBuilding({ name: 'Shop', rect: RECT, doorSide: c.side, doorOffset: offset });
      const world = applyPatch(emptyWorld(), patch);
      expect(outsideDoorWalkable(world, RECT, c.side, offset)).toBe(true);

      const state = createGameState(createPlayer(c.outside.x, c.outside.y), { world: loadSpace(world) }, 'world');
      const events = new EventBus<GameEvents>();
      const grid = getActiveSpace(state).grid;
      const tileAtDoor = (): string | undefined => getTileId(grid, c.door.x, c.door.y);

      // Bump: opens the door, stays put, costs a turn.
      expect(tileAtDoor()).toBe('door');
      expect(tryMovePlayer(state, c.inward, events)).toBe(true);
      expect(state.messageLog).toEqual(['You open the door.']);
      expect(state.player).toMatchObject(c.outside);
      expect(state.turnCount).toBe(1);
      expect(tileAtDoor()).toBe('openDoor');

      // Onto the open door (part of the place) -> enter message.
      expect(tryMovePlayer(state, c.inward, events)).toBe(true);
      expect(state.player).toMatchObject(c.door);
      expect(state.messageLog).toEqual(['You open the door.', 'You enter Shop.']);

      // Onto the floor inside; no new message.
      expect(tryMovePlayer(state, c.inward, events)).toBe(true);
      const step = STEP[c.inward];
      expect(state.player).toMatchObject({ x: c.door.x + step.x, y: c.door.y + step.y });
      expect(getTileId(grid, state.player.x, state.player.y)).toBe('floor');
      expect(state.messageLog).toHaveLength(2);
      expect(state.activeSpaceId).toBe('world');

      // Back out: door, then outside -> leave message.
      expect(tryMovePlayer(state, OPPOSITE[c.inward], events)).toBe(true);
      expect(state.player).toMatchObject(c.door);
      expect(tryMovePlayer(state, OPPOSITE[c.inward], events)).toBe(true);
      expect(state.player).toMatchObject(c.outside);
      expect(state.messageLog.at(-1)).toBe('You leave Shop.');
    });
  }
});

describe('validateBuilding', () => {
  const base = { name: 'Shop', rect: RECT, doorSide: 'S' as DoorSide, doorOffset: 3 };

  it('accepts a clean placement, including over ground and rock', () => {
    expect(validateBuilding(emptyWorld(), base)).toEqual([]);
    const rocky = emptyWorld();
    rocky.tiles[7 * rocky.width + 8] = 'rock';
    expect(validateBuilding(rocky, base)).toEqual([]);
  });

  it('refuses a missing name', () => {
    expect(validateBuilding(emptyWorld(), { ...base, name: '  ' })).toEqual(['Name is required.']);
  });

  it('refuses border coverage, corner doors and too-small rects', () => {
    expect(validateBuilding(emptyWorld(), { ...base, rect: { x: 0, y: 5, w: 6, h: 5 } })).toEqual([
      'Building must lie inside the map and not cover its border.',
    ]);
    expect(validateBuilding(emptyWorld(), { ...base, rect: { x: 15, y: 5, w: 5, h: 5 } })).not.toEqual([]);
    expect(validateBuilding(emptyWorld(), { ...base, rect: { x: 5, y: 5, w: 5, h: 11 } })).not.toEqual([]);
    expect(validateBuilding(emptyWorld(), { ...base, doorOffset: 0 })[0]).toMatch(/corner/);
    expect(validateBuilding(emptyWorld(), { ...base, doorOffset: RECT.w - 1 })[0]).toMatch(/corner/);
    expect(validateBuilding(emptyWorld(), { ...base, rect: { x: 3, y: 3, w: 4, h: 4 } })[0]).toMatch(/Too small/);
    expect(validateBuilding(emptyWorld(), { ...base, rect: { x: 3, y: 3, w: 5, h: 3 } })[0]).toMatch(/Too small/);
  });

  it('refuses overlaps with NPCs, monsters, the player start, doors and other places', () => {
    const npc = { ...emptyWorld(), npcs: [{ id: 'n', name: 'N', x: 8, y: 7, dialogue: ['hi'] }] };
    const monster = { ...emptyWorld(), monsters: [{ defId: 'gecko', x: 8, y: 7 }] };
    const start = { ...emptyWorld(), playerStart: { x: 8, y: 7 } };
    const door = emptyWorld();
    door.tiles[7 * door.width + 8] = 'door';
    const open = emptyWorld();
    open.tiles[7 * open.width + 8] = 'openDoor';
    const place = {
      ...emptyWorld(),
      places: [{ name: 'Neighbour', rect: { x: 12, y: 8, width: 5, height: 4 } }],
    };
    const expected = [/NPC/, /gecko/, /player start/, /door/, /door/, /Neighbour/];
    [npc, monster, start, door, open, place].forEach((w, i) => {
      const errors = validateBuilding(w, base);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(expected[i]!);
    });
  });

  it('allows a building right next to another place (no overlap)', () => {
    const w = { ...emptyWorld(), places: [{ name: 'Next', rect: { x: 13, y: 5, width: 5, height: 4 } }] };
    expect(validateBuilding(w, base)).toEqual([]);
  });

  it('warns (via outsideDoorWalkable) when the cell outside the door is rock', () => {
    const world = emptyWorld();
    world.tiles[11 * world.width + 9] = 'rock';
    expect(outsideDoorWalkable(world, RECT, 'S', 3)).toBe(false);
  });
});
