import { describe, expect, it } from 'vitest';
import { nextStepToward } from '../src/ai/Pathfinding';
import { runCreatureTurns } from '../src/ai/AIScheduler';
import { createMonster, type Monster } from '../src/entities/Monster';
import { getActiveSpace, locationName, placeAt, type Place } from '../src/engine/GameState';
import { tryMovePlayer } from '../src/engine/TurnManager';
import { hasLineOfSight } from '../src/fov/LineOfSight';
import { computeVisible, isVisible } from '../src/fov/Visibility';
import type { RNG } from '../src/utils/RNG';
import { canStep, createEmptyGrid, getTileId, setTileId } from '../src/world/GameMap';
import type { FlatMap } from '../src/world/FlatMap';
import { buildArena, type Arena } from './helpers/fixtures';

const NEVER_WANDER: RNG = () => 0.999;

function hunter(x: number, y: number): Monster {
  const m = createMonster('hunter', 'gecko', x, y);
  m.energy = 0; // exactly one action per tick at speed 12
  m.alerted = true;
  return m;
}

function tick(arena: Arena): void {
  runCreatureTurns(arena.state, NEVER_WANDER, arena.events);
}

describe('bumping a closed door', () => {
  it('opens it, costs one turn, leaves the player in place and logs "You open the door."', () => {
    const { state, events, grid } = buildArena({ width: 5, height: 1, player: { x: 0, y: 0 }, doors: [[1, 0]] });

    const spent = tryMovePlayer(state, 'E', events);

    expect(spent).toBe(true);
    expect(getTileId(grid, 1, 0)).toBe('openDoor');
    expect(state.player).toMatchObject({ x: 0, y: 0 });
    expect(state.turnCount).toBe(1);
    expect(state.messageLog).toEqual(['You open the door.']);
  });

  it('a second step goes through the now-open door; no second "open" message', () => {
    const { state, events } = buildArena({ width: 5, height: 1, player: { x: 0, y: 0 }, doors: [[1, 0]] });
    tryMovePlayer(state, 'E', events);

    expect(tryMovePlayer(state, 'E', events)).toBe(true);

    expect(state.player).toMatchObject({ x: 1, y: 0 });
    expect(state.turnCount).toBe(2);
    expect(state.messageLog).toEqual(['You open the door.']);
  });

  it('an already-open door is simply walked through, with no message', () => {
    const { state, events, grid } = buildArena({ width: 5, height: 1, player: { x: 0, y: 0 } });
    setTileId(grid, 1, 0, 'openDoor');

    expect(tryMovePlayer(state, 'E', events)).toBe(true);

    expect(state.player).toMatchObject({ x: 1, y: 0 });
    expect(state.turnCount).toBe(1);
    expect(state.messageLog).toEqual([]);
  });

  it('works from any direction, diagonals included', () => {
    const { state, events, grid } = buildArena({ width: 3, height: 3, player: { x: 0, y: 0 }, doors: [[1, 1]] });
    expect(tryMovePlayer(state, 'SE', events)).toBe(true);
    expect(getTileId(grid, 1, 1)).toBe('openDoor');
    expect(state.player).toMatchObject({ x: 0, y: 0 });
  });

  it('a closed door is not walkable but an open one is (canStep)', () => {
    const grid = createEmptyGrid(3, 1, 'ground');
    setTileId(grid, 1, 0, 'door');
    expect(canStep(grid, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(false);
    setTileId(grid, 1, 0, 'openDoor');
    expect(canStep(grid, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(true);
  });
});

describe('doors and sight', () => {
  it('a closed door blocks line of sight past it, but the door cell itself is seen', () => {
    const grid = createEmptyGrid(5, 1, 'ground');
    setTileId(grid, 2, 0, 'door');
    expect(hasLineOfSight(grid, { x: 0, y: 0 }, { x: 2, y: 0 })).toBe(true);
    expect(hasLineOfSight(grid, { x: 0, y: 0 }, { x: 3, y: 0 })).toBe(false);
    expect(hasLineOfSight(grid, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false);
  });

  it('an open door lets sight through', () => {
    const grid = createEmptyGrid(5, 1, 'ground');
    setTileId(grid, 2, 0, 'openDoor');
    expect(hasLineOfSight(grid, { x: 0, y: 0 }, { x: 2, y: 0 })).toBe(true);
    expect(hasLineOfSight(grid, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
  });

  /** A walled room x4..8, y2..6 on open ground with its door on the west wall at (4,4). */
  function roomGrid() {
    const grid = createEmptyGrid(14, 9, 'ground');
    for (let y = 2; y <= 6; y++) {
      for (let x = 4; x <= 8; x++) {
        const edge = x === 4 || x === 8 || y === 2 || y === 6;
        setTileId(grid, x, y, edge ? 'wall' : 'floor');
      }
    }
    setTileId(grid, 4, 4, 'door');
    return grid;
  }

  it('from outside a closed-door building, no interior floor is visible', () => {
    const grid = roomGrid();
    const visible = computeVisible(grid, { x: 1, y: 4 }, 12);
    expect(isVisible(visible, grid, 4, 4)).toBe(true); // the door itself
    for (let y = 3; y <= 5; y++) {
      for (let x = 5; x <= 7; x++) expect(isVisible(visible, grid, x, y), `${x},${y}`).toBe(false);
    }
  });

  it('after opening the door, cells in line with it become visible', () => {
    const grid = roomGrid();
    setTileId(grid, 4, 4, 'openDoor');
    const visible = computeVisible(grid, { x: 1, y: 4 }, 12);
    expect(isVisible(visible, grid, 5, 4)).toBe(true);
    expect(isVisible(visible, grid, 6, 4)).toBe(true);
    expect(isVisible(visible, grid, 7, 4)).toBe(true);
  });

  it('bumping the door open in the real engine reveals the room on the next view', () => {
    const grid = roomGrid();
    const arena = buildArena({ width: 14, height: 9, player: { x: 3, y: 4 } });
    (arena.grid as FlatMap).tiles.set((grid as FlatMap).tiles);
    const space = getActiveSpace(arena.state);
    expect(isVisible(computeVisible(space.grid, { x: 3, y: 4 }, 12), space.grid, 6, 4)).toBe(false);
    tryMovePlayer(arena.state, 'E', arena.events);
    expect(isVisible(computeVisible(space.grid, { x: 3, y: 4 }, 12), space.grid, 6, 4)).toBe(true);
  });
});

describe('doors and creatures', () => {
  it('a ground-level hunter cannot path through a closed door: nextStepToward returns null', () => {
    const grid = createEmptyGrid(10, 1, 'ground');
    setTileId(grid, 2, 0, 'door');
    expect(nextStepToward(grid, { x: 4, y: 0 }, { x: 0, y: 0 }, () => false)).toBeNull();
  });

  it('through an open door nextStepToward steps into the doorway', () => {
    const grid = createEmptyGrid(10, 1, 'ground');
    setTileId(grid, 2, 0, 'openDoor');
    expect(nextStepToward(grid, { x: 4, y: 0 }, { x: 0, y: 0 }, () => false)).toEqual({ x: 3, y: 0 });
    expect(nextStepToward(grid, { x: 3, y: 0 }, { x: 0, y: 0 }, () => false)).toEqual({ x: 2, y: 0 });
  });

  it('an alerted gecko holds still behind a closed door in the real scheduler', () => {
    const m = hunter(4, 0);
    const arena = buildArena({ width: 10, height: 1, player: { x: 0, y: 0 }, doors: [[2, 0]], monsters: [m] });
    for (let i = 0; i < 6; i++) tick(arena);
    expect(m.x).toBe(4);
    expect(getTileId(arena.grid, 2, 0)).toBe('door'); // monsters never open doors
  });

  it('the same gecko comes through once the door is open, and reaches the player', () => {
    const m = hunter(4, 0);
    const arena = buildArena({ width: 10, height: 1, player: { x: 0, y: 0 }, doors: [[2, 0]], monsters: [m] });
    setTileId(arena.grid, 2, 0, 'openDoor');
    const xs: number[] = [];
    for (let i = 0; i < 3; i++) {
      tick(arena);
      xs.push(m.x);
    }
    expect(xs.slice(0, 2)).toEqual([3, 2]); // through the doorway
    expect(m.x).toBeLessThanOrEqual(1);
  });
});

describe('places: enter / leave messages', () => {
  const HALL: Place = { name: 'Hall', rect: { x: 3, y: 0, width: 3, height: 3 } };

  function hallArena(start = { x: 0, y: 1 }) {
    const arena = buildArena({ width: 9, height: 3, player: start });
    arena.state.spaces.arena!.places = [HALL];
    return arena;
  }

  it('logs "You enter Hall." once when stepping across the boundary, not on moves within', () => {
    const { state, events } = hallArena();
    tryMovePlayer(state, 'E', events); // x=1
    tryMovePlayer(state, 'E', events); // x=2
    expect(state.messageLog).toEqual([]);

    tryMovePlayer(state, 'E', events); // x=3: first cell of the hall
    expect(state.messageLog).toEqual(['You enter Hall.']);

    tryMovePlayer(state, 'E', events); // x=4
    tryMovePlayer(state, 'E', events); // x=5
    tryMovePlayer(state, 'N', events); // within the hall
    tryMovePlayer(state, 'S', events);
    expect(state.messageLog).toEqual(['You enter Hall.']);
  });

  it('logs "You leave Hall." once when stepping back out', () => {
    const { state, events } = hallArena({ x: 5, y: 1 });
    tryMovePlayer(state, 'W', events); // x=4, but start was already inside: no message
    expect(state.messageLog).toEqual([]);
    tryMovePlayer(state, 'W', events); // x=3
    tryMovePlayer(state, 'W', events); // x=2, outside
    expect(state.messageLog).toEqual(['You leave Hall.']);
    tryMovePlayer(state, 'W', events);
    expect(state.messageLog).toEqual(['You leave Hall.']);
  });

  it('fires again on each fresh crossing', () => {
    const { state, events } = hallArena({ x: 2, y: 1 });
    for (const d of ['E', 'W', 'E', 'W'] as const) tryMovePlayer(state, d, events);
    expect(state.messageLog).toEqual(['You enter Hall.', 'You leave Hall.', 'You enter Hall.', 'You leave Hall.']);
  });

  it('a blocked move or a door-opening bump while staying put emits no place message', () => {
    const arena = buildArena({ width: 9, height: 3, player: { x: 2, y: 1 }, walls: [[2, 0]], doors: [[3, 1]] });
    arena.state.spaces.arena!.places = [HALL];
    tryMovePlayer(arena.state, 'N', arena.events); // wall
    tryMovePlayer(arena.state, 'E', arena.events); // opens the door (3,1), which is inside the hall
    expect(arena.state.messageLog).toEqual(['You open the door.']);
    tryMovePlayer(arena.state, 'E', arena.events); // onto the doorway: enter
    expect(arena.state.messageLog).toEqual(['You open the door.', 'You enter Hall.']);
  });
});

describe('places: locationName and nesting', () => {
  // Deliberately listed outer-after-inner so "innermost wins" can't be a first-match accident.
  const places: Place[] = [
    { name: 'Vault', rect: { x: 4, y: 0, width: 2, height: 3 } },
    { name: 'Keep', rect: { x: 2, y: 0, width: 6, height: 3 } },
  ];

  function nested() {
    const arena = buildArena({ width: 9, height: 3, player: { x: 0, y: 1 } });
    arena.state.spaces.arena!.places = places;
    return arena;
  }

  it('locationName is the space name outside any place and the place name inside', () => {
    const { state } = nested();
    expect(locationName(state)).toBe('Arena');
    state.player.x = 2;
    expect(locationName(state)).toBe('Keep');
    state.player.x = 8;
    expect(locationName(state)).toBe('Arena');
  });

  it('the innermost place wins where places overlap', () => {
    const { state } = nested();
    const space = getActiveSpace(state);
    expect(placeAt(space, { x: 3, y: 1 })?.name).toBe('Keep');
    expect(placeAt(space, { x: 4, y: 1 })?.name).toBe('Vault');
    expect(placeAt(space, { x: 5, y: 2 })?.name).toBe('Vault');
    expect(placeAt(space, { x: 6, y: 1 })?.name).toBe('Keep');
    expect(placeAt(space, { x: 1, y: 1 })).toBeUndefined();
    state.player.x = 4;
    expect(locationName(state)).toBe('Vault');
  });

  it('walking inward and out announces each boundary as it changes the current place', () => {
    const { state, events } = nested();
    for (let i = 0; i < 8; i++) tryMovePlayer(state, 'E', events); // x = 8
    expect(state.messageLog).toEqual([
      'You enter Keep.', // x=2
      'You enter Vault.', // x=4
      'You enter Keep.', // x=6, back out of the vault but still in the keep
      'You leave Keep.', // x=8
    ]);
  });
});
