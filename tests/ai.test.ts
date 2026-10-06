import { describe, expect, it } from 'vitest';
import { nextStepToward } from '../src/ai/Pathfinding';
import { runCreatureTurns } from '../src/ai/AIScheduler';
import { LOSE_TRACK_FACTOR, PEACEFUL_WANDER_CHANCE } from '../src/config/constants';
import { createMonster, type Monster } from '../src/entities/Monster';
import { createNpc } from '../src/entities/Npc';
import { chebyshevDistance } from '../src/utils/geometry';
import { createRNG, type RNG } from '../src/utils/RNG';
import { canStep, createEmptyGrid, getTileId, setTileId } from '../src/world/GameMap';
import { buildArena, type Arena, type ArenaOptions } from './helpers/fixtures';

const NEVER_WANDER: RNG = () => 0.999;

function hunter(x: number, y: number, overrides: Partial<Monster> = {}): Monster {
  const m = createMonster('hunter', 'gecko', x, y);
  m.energy = 0; // exactly one action per tick at speed 12
  return Object.assign(m, overrides);
}

function arenaWith(opts: Omit<ArenaOptions, 'monsters'>, ...monsters: Monster[]): Arena {
  return buildArena({ ...opts, monsters });
}

function tick(arena: Arena, rng: RNG = NEVER_WANDER): void {
  runCreatureTurns(arena.state, rng, arena.events);
}

describe('hostile awareness', () => {
  it('a hostile outside its awareness radius stays put and unalerted', () => {
    const m = hunter(20, 0); // awareness 8, distance 20
    const arena = arenaWith({ width: 30, height: 1, player: { x: 0, y: 0 } }, m);
    for (let i = 0; i < 5; i++) tick(arena);
    expect(m.x).toBe(20);
    expect(m.alerted).toBe(false);
  });

  it('a hostile inside awareness with clear LOS becomes alerted and approaches', () => {
    const m = hunter(6, 0); // distance 6 <= 8
    const arena = arenaWith({ width: 30, height: 1, player: { x: 0, y: 0 } }, m);
    tick(arena);
    expect(m.alerted).toBe(true);
    expect(m.x).toBe(5);
    tick(arena);
    expect(m.x).toBe(4);
  });

  it('the awareness boundary is inclusive', () => {
    const edge = hunter(8, 0);
    const arena = arenaWith({ width: 30, height: 1, player: { x: 0, y: 0 } }, edge);
    tick(arena);
    expect(edge.alerted).toBe(true);

    const beyond = hunter(9, 0);
    const arena2 = arenaWith({ width: 30, height: 1, player: { x: 0, y: 0 } }, beyond);
    tick(arena2);
    expect(beyond.alerted).toBe(false);
    expect(beyond.x).toBe(9);
  });

  it('behind an opaque wall without a prior alert it does NOT notice you', () => {
    const m = hunter(6, 0);
    const arena = arenaWith({ width: 30, height: 1, player: { x: 0, y: 0 }, walls: [[3, 0]] }, m);
    for (let i = 0; i < 5; i++) tick(arena);
    expect(m.alerted).toBe(false);
    expect(m.x).toBe(6);
  });

  it('an unaware hostile standing behind a closed door does not notice you either', () => {
    const m = hunter(6, 0);
    const arena = arenaWith({ width: 30, height: 1, player: { x: 0, y: 0 }, doors: [[3, 0]] }, m);
    tick(arena);
    expect(m.alerted).toBe(false);
    expect(m.x).toBe(6);
  });

  it('once alerted it keeps hunting even without line of sight', () => {
    const m = hunter(6, 2);
    // A wall column with the gap at the bottom; player on the far side.
    const walls: Array<[number, number]> = [
      [3, 0],
      [3, 1],
      [3, 2],
      [3, 3],
    ];
    const arena = arenaWith({ width: 10, height: 5, player: { x: 0, y: 2 }, walls }, m);
    m.alerted = true;
    for (let i = 0; i < 4; i++) tick(arena);
    expect(m.alerted).toBe(true);
    // It has gone round to the row of the gap (y = 4) rather than butting into the wall.
    expect(m.y).toBeGreaterThan(2);
  });

  it('loses track beyond awareness * LOSE_TRACK_FACTOR', () => {
    const m = hunter(0, 0, { awareness: 4 });
    const limit = 4 * LOSE_TRACK_FACTOR; // 10
    const arena = arenaWith({ width: 40, height: 1, player: { x: 0, y: 0 } }, m);
    // Put the monster exactly at the limit: still hunting.
    m.x = limit;
    arena.state.player.x = 0;
    m.alerted = true;
    tick(arena);
    expect(m.alerted).toBe(true);
    expect(m.x).toBe(limit - 1);

    // One cell beyond: it gives up, and does not move that tick.
    m.x = limit + 1;
    tick(arena);
    expect(m.alerted).toBe(false);
    expect(m.x).toBe(limit + 1);
  });

  it('after losing track it must re-notice (awareness + LOS) before hunting again', () => {
    const m = hunter(30, 0, { awareness: 4, alerted: true });
    const arena = arenaWith({ width: 40, height: 1, player: { x: 0, y: 0 } }, m);
    tick(arena);
    expect(m.alerted).toBe(false);
    tick(arena);
    expect(m.x).toBe(30);
  });
});

describe('hostile pathing', () => {
  it('walks round a wall through the gap and reaches the player', () => {
    // Column of wall at x=5 from y=0..3, gap at y=4.
    const walls: Array<[number, number]> = [
      [5, 0],
      [5, 1],
      [5, 2],
      [5, 3],
    ];
    const m = hunter(8, 2);
    const arena = arenaWith({ width: 11, height: 5, player: { x: 2, y: 2 }, walls }, m);
    m.alerted = true;

    const visited = new Set<string>();
    let adjacentAt = -1;
    for (let i = 0; i < 25 && adjacentAt < 0; i++) {
      tick(arena);
      visited.add(`${m.x},${m.y}`);
      if (chebyshevDistance(m, arena.state.player) <= 1) adjacentAt = i;
    }
    expect(adjacentAt).toBeGreaterThanOrEqual(0);
    expect(visited.has('5,4')).toBe(true); // squeezed through the only gap
    for (const [wx, wy] of walls) expect(visited.has(`${wx},${wy}`)).toBe(false);
  });

  it('nextStepToward routes via the gap, and returns null when walled off', () => {
    const grid = createEmptyGrid(11, 5, 'ground');
    for (let y = 0; y < 4; y++) setTileId(grid, 5, y, 'wall');
    const none = () => false;

    const step = nextStepToward(grid, { x: 8, y: 2 }, { x: 2, y: 2 }, none);
    expect(step).not.toBeNull();
    expect(canStep(grid, { x: 8, y: 2 }, step!)).toBe(true);
    expect(Math.max(Math.abs(step!.x - 8), Math.abs(step!.y - 2))).toBe(1);
    // Following the steps all the way goes through the gap at (5,4) and arrives.
    let at = { x: 8, y: 2 };
    const path = new Set<string>();
    for (let i = 0; i < 20 && !(at.x === 2 && at.y === 2); i++) {
      at = nextStepToward(grid, at, { x: 2, y: 2 }, none)!;
      path.add(at.x + ',' + at.y);
    }
    expect(at).toEqual({ x: 2, y: 2 });
    expect(path.has('5,4')).toBe(true);

    setTileId(grid, 5, 4, 'wall');
    expect(nextStepToward(grid, { x: 8, y: 2 }, { x: 2, y: 2 }, none)).toBeNull();
  });

  it('nextStepToward: same cell is null, adjacent goal is the step, and the goal is never "blocked"', () => {
    const grid = createEmptyGrid(5, 1, 'ground');
    expect(nextStepToward(grid, { x: 2, y: 0 }, { x: 2, y: 0 }, () => false)).toBeNull();
    expect(nextStepToward(grid, { x: 1, y: 0 }, { x: 2, y: 0 }, () => true)).toEqual({ x: 2, y: 0 });
  });

  it('nextStepToward honours the node budget', () => {
    const grid = createEmptyGrid(60, 1, 'ground');
    expect(nextStepToward(grid, { x: 0, y: 0 }, { x: 59, y: 0 }, () => false, 5)).toBeNull();
    expect(nextStepToward(grid, { x: 0, y: 0 }, { x: 59, y: 0 }, () => false, 600)).toEqual({ x: 1, y: 0 });
  });

  it('treats other creatures as blocked: a hunter cannot pass a blocker in a corridor', () => {
    const blocker = createMonster('blocker', 'brahmin', 4, 0);
    const m = hunter(6, 0);
    const arena = arenaWith({ width: 10, height: 1, player: { x: 0, y: 0 } }, m, blocker);
    m.alerted = true;
    for (let i = 0; i < 5; i++) tick(arena);
    expect(blocker.x).toBe(4);
    expect(m.x).toBe(6); // no route round it, so the hunter holds position
  });

  it('treats other creatures as blocked: it steps round a blocker when there is room', () => {
    const blocker = createMonster('blocker', 'brahmin', 4, 1);
    const m = hunter(6, 1);
    const arena = arenaWith({ width: 10, height: 3, player: { x: 0, y: 1 } }, m, blocker);
    m.alerted = true;
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      tick(arena);
      seen.add(`${m.x},${m.y}`);
      expect(`${m.x},${m.y}`).not.toBe(`${blocker.x},${blocker.y}`);
    }
    expect(chebyshevDistance(m, arena.state.player)).toBeLessThanOrEqual(1);
  });

  it('a closed door in a corridor stops the hunter (creatures never open doors)', () => {
    const m = hunter(4, 0);
    const arena = arenaWith({ width: 10, height: 1, player: { x: 0, y: 0 }, doors: [[2, 0]] }, m);
    m.alerted = true;
    for (let i = 0; i < 6; i++) tick(arena);
    expect(m.x).toBe(4); // no route that avoids the door, so it holds position
    expect(getTileId(arena.grid, 2, 0)).toBe('door');
  });

  it('a closed door is routed around even when it is the shortest way', () => {
    const m = hunter(4, 1);
    const arena = arenaWith({ width: 10, height: 3, player: { x: 0, y: 1 }, doors: [[2, 1]] }, m);
    m.alerted = true;
    for (let i = 0; i < 12; i++) {
      tick(arena);
      expect(getTileId(arena.grid, m.x, m.y)).not.toBe('door');
    }
    expect(chebyshevDistance(m, arena.state.player)).toBeLessThanOrEqual(1);
  });

  it('an adjacent hunter attacks instead of moving', () => {
    const m = hunter(1, 0);
    const arena = arenaWith({ width: 5, height: 1, player: { x: 0, y: 0 } }, m);
    tick(arena);
    expect(m.x).toBe(1);
    expect(arena.state.messageLog).toEqual(['The gecko misses you with its teeth.']);
  });

  it('a hunter never steps onto the player', () => {
    const m = hunter(5, 0);
    const arena = arenaWith({ width: 10, height: 1, player: { x: 0, y: 0 } }, m);
    for (let i = 0; i < 10; i++) tick(arena);
    expect(m.x).toBe(1);
  });
});

describe('peaceful monsters', () => {
  function brahmin(x: number, y: number): Monster {
    const b = createMonster('b', 'brahmin', x, y);
    // Speed 9 would need two ticks to bank an action; give it one so a single tick is a turn.
    b.energy = 12;
    return b;
  }

  it('a peaceful brahmin next to the player never attacks', () => {
    const b = brahmin(1, 0);
    expect(b.hostile).toBe(false);
    const arena = arenaWith({ width: 5, height: 3, player: { x: 0, y: 0 } }, b);
    const rng = createRNG(1);
    for (let i = 0; i < 300; i++) tick(arena, rng);
    expect(arena.state.messageLog).toEqual([]);
    expect(arena.state.player.hp).toBe(arena.state.player.maxHp);
  });

  it('with a wander roll of 1 (<= chance) it steps; with a high roll it stays', () => {
    const stay = brahmin(5, 5);
    const a1 = arenaWith({ width: 11, height: 11, player: { x: 0, y: 0 } }, stay);
    tick(a1, () => (PEACEFUL_WANDER_CHANCE + 1) / 100 + 0.001);
    expect([stay.x, stay.y]).toEqual([5, 5]);

    const go = brahmin(5, 5);
    const a2 = arenaWith({ width: 11, height: 11, player: { x: 0, y: 0 } }, go);
    tick(a2, () => 0); // d100 = 1 -> wanders; direction index 0 = N
    expect([go.x, go.y]).toEqual([5, 4]);
  });

  it('wanders only within its space, never into walls, doors or other creatures', () => {
    // A 5x5 pen: walls all round, a door in the north wall.
    const walls: Array<[number, number]> = [];
    for (let i = 0; i < 7; i++) {
      walls.push([i, 0], [i, 6], [0, i], [6, i]);
    }
    const b = brahmin(3, 3);
    const other = brahmin(2, 2);
    const arena = arenaWith(
      { width: 7, height: 7, player: { x: 3, y: 5 }, walls, doors: [[3, 0]] },
      b,
      other,
    );
    // Make the brahmins wander on every action to stress the bounds.
    b.speed = other.speed = 12;
    const rng = createRNG(42);
    const wanderOften: RNG = () => (rng() < 0.5 ? 0 : rng());
    for (let i = 0; i < 500; i++) {
      tick(arena, wanderOften);
      for (const m of [b, other]) {
        expect(m.x).toBeGreaterThanOrEqual(1);
        expect(m.x).toBeLessThanOrEqual(5);
        expect(m.y).toBeGreaterThanOrEqual(1);
        expect(m.y).toBeLessThanOrEqual(5);
      }
      expect(`${b.x},${b.y}`).not.toBe(`${other.x},${other.y}`);
      expect(`${b.x},${b.y}`).not.toBe(`${arena.state.player.x},${arena.state.player.y}`);
    }
  });

  it('actually moves around over time (it is not frozen)', () => {
    const b = brahmin(5, 5);
    const arena = arenaWith({ width: 11, height: 11, player: { x: 0, y: 0 } }, b);
    const rng = createRNG(9);
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      tick(arena, rng);
      seen.add(`${b.x},${b.y}`);
    }
    expect(seen.size).toBeGreaterThan(3);
  });

  it('a brahmin that has been attacked and survived turns hostile and hunts', () => {
    const b = brahmin(4, 0);
    b.hostile = true;
    b.alerted = true;
    const arena = arenaWith({ width: 10, height: 1, player: { x: 0, y: 0 } }, b);
    tick(arena);
    expect(b.x).toBe(3);
  });
});

describe('NPCs in the scheduler', () => {
  it('a peaceful NPC does not move or attack', () => {
    const npc = createNpc('n', 'Ringo', 1, 0, ['hi']);
    const arena = buildArena({ width: 5, height: 1, player: { x: 0, y: 0 }, npcs: [npc] });
    for (let i = 0; i < 50; i++) tick(arena, createRNG(i));
    expect([npc.x, npc.y]).toEqual([1, 0]);
    expect(arena.state.messageLog).toEqual([]);
  });

  it('a hostile NPC fights back with "their bare hands"', () => {
    const npc = createNpc('n', 'Ringo', 1, 0, ['hi']);
    npc.hostile = true;
    npc.alerted = true;
    const arena = buildArena({ width: 5, height: 1, player: { x: 0, y: 0 }, npcs: [npc] });
    tick(arena);
    expect(arena.state.messageLog[0]).toMatch(/^Ringo (hits|misses) you .*with their bare hands\.$/);
  });
});
