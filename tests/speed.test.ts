import { describe, expect, it } from 'vitest';
import { runCreatureTurns } from '../src/ai/AIScheduler';
import { actionsPerTurn, effectiveSpeed } from '../src/combat/CombatFormulas';
import { MAX_ACTIONS_PER_TURN, NORMAL_SPEED } from '../src/config/constants';
import { advanceTurn, tryMovePlayer } from '../src/engine/TurnManager';
import { createMonster, type Monster } from '../src/entities/Monster';
import { scriptedRNG, buildArena, type Arena } from './helpers/fixtures';
import type { RNG } from '../src/utils/RNG';

/** Row-shaped arena: player at x=0, one monster far down the corridor, nothing in between. */
function corridor(
  defId: string,
  overrides: Partial<Pick<Monster, 'speed' | 'energy' | 'awareness' | 'x'>> = {},
): { arena: Arena; monster: Monster } {
  const monster = createMonster('m', defId, overrides.x ?? 35, 0);
  monster.awareness = overrides.awareness ?? 100;
  monster.energy = overrides.energy ?? 0;
  if (overrides.speed !== undefined) monster.speed = overrides.speed;
  const arena = buildArena({ width: 60, height: 1, player: { x: 0, y: 0 }, monsters: [monster] });
  return { arena, monster };
}

/** Runs `ticks` world ticks and returns how many cells the monster advanced on each. */
function advancesPerTick(arena: Arena, monster: Monster, ticks: number, rng: RNG = () => 0.999): number[] {
  const out: number[] = [];
  for (let i = 0; i < ticks; i++) {
    const before = monster.x;
    runCreatureTurns(arena.state, rng, arena.events);
    out.push(before - monster.x);
  }
  return out;
}

/** An RNG that always misses and counts how many rolls the attacks consumed. */
function countingMissRNG(): RNG & { count: number } {
  const rng = (() => {
    rng.count++;
    return 0.999;
  }) as RNG & { count: number };
  rng.count = 0;
  return rng;
}

describe('effective speed helpers', () => {
  it('actionsPerTurn is speed / NORMAL_SPEED', () => {
    const { monster } = corridor('bloatfly');
    expect(actionsPerTurn(monster)).toBe(2);
    expect(effectiveSpeed(monster)).toBe(24);
  });

  it('crippled legs throttle effective speed', () => {
    const { monster } = corridor('bloatfly');
    for (const l of monster.limbs) if (l.kind === 'leg') l.hp = 0;
    expect(effectiveSpeed(monster)).toBeCloseTo(24 * 0.35, 10);
  });
});

describe('runCreatureTurns — energy and speed', () => {
  it('a speed-12 creature advances 1 cell per tick', () => {
    const { arena, monster } = corridor('gecko');
    expect(advancesPerTick(arena, monster, 6)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('a speed-24 creature advances 2 cells per tick', () => {
    const { arena, monster } = corridor('bloatfly');
    expect(monster.speed).toBe(24);
    expect(advancesPerTick(arena, monster, 6)).toEqual([2, 2, 2, 2, 2, 2]);
  });

  it('a speed-8 creature (radroach) acts 2 of every 3 ticks', () => {
    const { arena, monster } = corridor('radroach');
    expect(monster.speed).toBe(8);
    const moves = advancesPerTick(arena, monster, 12);
    expect(moves).toEqual([0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1]);
    expect(moves.reduce((a, b) => a + b, 0)).toBe(8); // 12 ticks * 8/12
  });

  it('a speed-18 creature alternates 1 and 2 actions', () => {
    const { arena, monster } = corridor('gecko', { speed: 18 });
    expect(advancesPerTick(arena, monster, 6)).toEqual([1, 2, 1, 2, 1, 2]);
  });

  it('a fresh monster starts with an empty bank: a normal-speed one gets exactly one action on its first tick', () => {
    const monster = createMonster('m', 'gecko', 35, 0);
    monster.awareness = 100;
    const arena = buildArena({ width: 60, height: 1, player: { x: 0, y: 0 }, monsters: [monster] });
    expect(monster.energy).toBe(0);
    runCreatureTurns(arena.state, () => 0.999, arena.events);
    expect(monster.x).toBe(34);
  });

  it('a fresh slow monster waits a tick before its first action', () => {
    const monster = createMonster('m', 'radroach', 35, 0); // speed 8 < 12
    monster.awareness = 100;
    const arena = buildArena({ width: 60, height: 1, player: { x: 0, y: 0 }, monsters: [monster] });
    runCreatureTurns(arena.state, () => 0.999, arena.events);
    expect(monster.x).toBe(35);
    runCreatureTurns(arena.state, () => 0.999, arena.events);
    expect(monster.x).toBe(34);
  });

  it('crippled legs slow a hunter: both legs crippled = 0.35x speed', () => {
    const { arena, monster } = corridor('gecko');
    for (const l of monster.limbs) if (l.kind === 'leg') l.hp = 0;
    const moves = advancesPerTick(arena, monster, 20);
    const total = moves.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(6); // 20 ticks * 0.35 = 7, give or take float dust
    expect(total).toBeLessThanOrEqual(7);
    expect(Math.max(...moves)).toBe(1);
  });

  it('a fast creature adjacent to the player attacks twice in one tick', () => {
    const fly = createMonster('f', 'bloatfly', 1, 0);
    fly.energy = 0;
    const arena = buildArena({ width: 5, height: 1, player: { x: 0, y: 0 }, monsters: [fly] });
    const rng = countingMissRNG();

    runCreatureTurns(arena.state, rng, arena.events);

    expect(arena.state.messageLog).toEqual([
      'The bloatfly misses you with its stinger.',
      'The bloatfly misses you with its stinger.',
    ]);
    expect(rng.count).toBe(2);
  });

  it('a speed-12 creature adjacent to the player attacks once per tick', () => {
    const gecko = createMonster('g', 'gecko', 1, 0);
    gecko.energy = 0;
    const arena = buildArena({ width: 5, height: 1, player: { x: 0, y: 0 }, monsters: [gecko] });
    const rng = countingMissRNG();
    runCreatureTurns(arena.state, rng, arena.events);
    expect(arena.state.messageLog).toEqual(['The gecko misses you with its teeth.']);
    expect(rng.count).toBe(1);
  });

  it('scripted rolls: two bloatfly stings consume exactly the rolls they need', () => {
    const fly = createMonster('f', 'bloatfly', 1, 0);
    fly.energy = 0;
    const arena = buildArena({ width: 5, height: 1, player: { x: 0, y: 0 }, monsters: [fly] });
    // Two misses: one roll each. A third roll would throw.
    const rng = scriptedRNG([0.999, 0.999]);
    runCreatureTurns(arena.state, rng, arena.events);
    expect(rng.consumed).toBe(2);
  });

  it('leftover energy beyond one action is capped, so an idle creature cannot burst later', () => {
    const gecko = createMonster('g', 'gecko', 1, 0);
    gecko.energy = 1000;
    const arena = buildArena({ width: 5, height: 1, player: { x: 0, y: 0 }, monsters: [gecko] });
    arena.state.player.hp = arena.state.player.maxHp = 10_000;
    const rng = countingMissRNG();

    runCreatureTurns(arena.state, rng, arena.events);
    expect(rng.count).toBe(MAX_ACTIONS_PER_TURN);
    expect(gecko.energy).toBeLessThanOrEqual(NORMAL_SPEED);

    // The following tick is back to normal: 12 banked + 12 = 2 actions at most.
    rng.count = 0;
    runCreatureTurns(arena.state, rng, arena.events);
    expect(rng.count).toBeLessThanOrEqual(2);
  });

  it('a creature idle for 10 ticks does not then get 10 actions', () => {
    // Far away and unaware (awareness 8): it idles, spending its actions on nothing.
    const { arena, monster } = corridor('radroach', { awareness: 3, x: 35 });
    for (let i = 0; i < 10; i++) runCreatureTurns(arena.state, () => 0.999, arena.events);
    expect(monster.energy).toBeLessThanOrEqual(NORMAL_SPEED);

    // Now bring it adjacent and measure the burst.
    monster.x = 1;
    monster.awareness = 100;
    const rng = countingMissRNG();
    runCreatureTurns(arena.state, rng, arena.events);
    expect(rng.count).toBeLessThanOrEqual(2);
  });

  it('MAX_ACTIONS_PER_TURN bounds a silly speed', () => {
    const fly = createMonster('f', 'bloatfly', 1, 0);
    fly.speed = 100_000;
    fly.energy = 0;
    const arena = buildArena({ width: 5, height: 1, player: { x: 0, y: 0 }, monsters: [fly] });
    arena.state.player.hp = arena.state.player.maxHp = 10_000;
    const rng = countingMissRNG();
    runCreatureTurns(arena.state, rng, arena.events);
    expect(rng.count).toBe(MAX_ACTIONS_PER_TURN);
    expect(fly.energy).toBeLessThanOrEqual(NORMAL_SPEED);
  });

  it('stops acting once the player is dead mid-tick', () => {
    const fly = createMonster('f', 'bloatfly', 1, 0);
    fly.energy = 0;
    fly.speed = 120; // would be 8 swings
    const arena = buildArena({ width: 5, height: 1, player: { x: 0, y: 0 }, monsters: [fly] });
    arena.state.player.hp = 1;
    // Always hit, torso/head irrelevant, min damage.
    runCreatureTurns(arena.state, () => 0, arena.events);
    expect(arena.state.gameOver).toBe(true);
    const deaths = arena.state.messageLog.filter((m) => m === 'You die...');
    expect(deaths).toHaveLength(1);
    expect(arena.state.messageLog.length).toBeLessThan(MAX_ACTIONS_PER_TURN);
  });
});

describe('player speed and the world clock', () => {
  it('a normal-speed player ticks the world exactly once per action', () => {
    const { arena } = corridor('gecko');
    advanceTurn(arena.state, arena.events, () => 0.999);
    advanceTurn(arena.state, arena.events, () => 0.999);
    expect(arena.state.turnCount).toBe(2);
  });

  it('a player with both legs crippled burns extra world ticks per action', () => {
    const { arena, monster } = corridor('gecko', { speed: 12 });
    for (const l of arena.state.player.limbs) if (l.kind === 'leg') l.hp = 0;

    const startX = monster.x;
    advanceTurn(arena.state, arena.events, () => 0.999);
    const first = arena.state.turnCount;
    expect(first).toBeGreaterThan(1);
    // 12 energy needed, 4.2 per tick => 3 ticks. The hunter got 3 actions in that one player action.
    expect(first).toBe(3);
    expect(startX - monster.x).toBe(3);

    // Over many actions the average cost is 1 / 0.35 ticks.
    for (let i = 0; i < 19; i++) advanceTurn(arena.state, arena.events, () => 0.999);
    expect(arena.state.turnCount / 20).toBeGreaterThan(2.5);
    expect(arena.state.turnCount / 20).toBeLessThan(3.2);
  });

  it('one crippled leg costs about 1/0.675 ticks per action', () => {
    const { arena } = corridor('gecko');
    arena.state.player.limbs.find((l) => l.id === 'left-leg')!.hp = 0;
    for (let i = 0; i < 40; i++) advanceTurn(arena.state, arena.events, () => 0.999);
    const perAction = arena.state.turnCount / 40;
    expect(perAction).toBeGreaterThan(1.3);
    expect(perAction).toBeLessThan(1.6);
  });

  it('a speed-24 player acting twice only ticks the world once', () => {
    const { arena, monster } = corridor('gecko', { speed: 12 });
    arena.state.player.speed = 24;
    const startX = monster.x;

    advanceTurn(arena.state, arena.events, () => 0.999);
    advanceTurn(arena.state, arena.events, () => 0.999);
    expect(arena.state.turnCount).toBe(1);
    expect(startX - monster.x).toBe(1);

    advanceTurn(arena.state, arena.events, () => 0.999);
    advanceTurn(arena.state, arena.events, () => 0.999);
    expect(arena.state.turnCount).toBe(2);
  });

  it('a speed-24 player moving via tryMovePlayer gets two steps per world tick', () => {
    const arena = buildArena({ width: 20, height: 1, player: { x: 0, y: 0 } });
    arena.state.player.speed = 24;
    for (let i = 0; i < 6; i++) expect(tryMovePlayer(arena.state, 'E', arena.events, () => 0.999)).toBe(true);
    expect(arena.state.player.x).toBe(6);
    expect(arena.state.turnCount).toBe(3);
  });

  it('the crippled player gets hit more often per action than a healthy one', () => {
    function hitsTaken(crippled: boolean): number {
      const gecko = createMonster('g', 'gecko', 1, 0);
      gecko.energy = 0;
      const arena = buildArena({ width: 5, height: 1, player: { x: 0, y: 0 }, monsters: [gecko] });
      arena.state.player.hp = arena.state.player.maxHp = 10_000;
      if (crippled) for (const l of arena.state.player.limbs) if (l.kind === 'leg') l.hp = 0;
      // Always misses; we only count swings.
      advanceTurn(arena.state, arena.events, () => 0.999);
      return arena.state.messageLog.filter((m) => m.includes('misses you')).length;
    }
    expect(hitsTaken(false)).toBe(1);
    expect(hitsTaken(true)).toBe(3);
  });
});
