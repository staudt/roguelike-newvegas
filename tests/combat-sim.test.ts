import { describe, expect, it } from 'vitest';
import { advanceTurn, tryMovePlayer } from '../src/engine/TurnManager';
import { createMonster } from '../src/entities/Monster';
import type { Direction } from '../src/utils/geometry';
import { createRNG } from '../src/utils/RNG';
import { buildArena } from './helpers/fixtures';

const RUNS = 1000;
const MAX_ROUNDS = 500;

type Weapon = 'hands' | 'combat-knife' | 'baseball-bat';

interface FightOutcome {
  won: boolean;
  rounds: number;
  hpLeft: number;
}

/** The three squares around a player in the top-left corner of a 3x3 arena, and how to bump each. */
const SLOTS: ReadonlyArray<{ x: number; y: number; dir: Direction }> = [
  { x: 1, y: 0, dir: 'E' },
  { x: 0, y: 1, dir: 'S' },
  { x: 1, y: 1, dir: 'SE' },
];

/**
 * The player (optionally armed, optionally pre-wounded) fights adjacent monsters to the death,
 * bumping the first one standing each round, through the real engine (TurnManager + AI + resolver).
 */
function fight(defIds: string[], seed: number, weapon: Weapon, startHp?: number): FightOutcome {
  const monsters = defIds.map((defId, i) => createMonster(`m${i}`, defId, SLOTS[i]!.x, SLOTS[i]!.y));
  const { state, events } = buildArena({ width: 3, height: 3, player: { x: 0, y: 0 }, monsters });
  const rng = createRNG(seed);

  if (startHp !== undefined) state.player.hp = startHp;
  if (weapon !== 'hands') {
    state.player.wielded = state.player.inventory.find((i) => i.defId === weapon)!.id;
  }

  const space = state.spaces['arena']!;
  let rounds = 0;
  while (!state.gameOver && space.monsters.length > 0 && rounds < MAX_ROUNDS) {
    const target = space.monsters[0]!;
    const dir = SLOTS.find((s) => s.x === target.x && s.y === target.y)!.dir;
    tryMovePlayer(state, dir, events, rng);
    rounds++;
  }
  return { won: !state.gameOver && space.monsters.length === 0, rounds, hpLeft: state.player.hp };
}

function winRate(defIds: string[], weapon: Weapon, startHp?: number): number {
  let wins = 0;
  for (let seed = 1; seed <= RUNS; seed++) if (fight(defIds, seed, weapon, startHp).won) wins++;
  return wins / RUNS;
}

function average(defIds: string[], weapon: Weapon, pick: (o: FightOutcome) => number): number {
  let total = 0;
  for (let seed = 1; seed <= RUNS; seed++) total += pick(fight(defIds, seed, weapon));
  return total / RUNS;
}

/*
 * Measured with the numbers at the time of writing (2000 seeds, healthy player, 40 HP):
 *   1 gecko  : hands 99.95%, knife 100%      (a lone gecko is no threat at full health)
 *   2 geckos : hands ~79%,   knife ~98%
 *   3 geckos : hands ~14%,   knife ~70%
 *   1 gecko at 15 HP: hands ~82%, knife ~97%
 * so the "win most, but not all" band is exercised by the pack and wounded-player scenarios.
 */
describe('seeded end-to-end fights: one monster, healthy player', () => {
  it('every fight terminates well inside the round cap', () => {
    for (const defId of ['gecko', 'bloatfly', 'radroach']) {
      for (let seed = 1; seed <= 300; seed++) {
        expect(fight([defId], seed, 'hands').rounds).toBeLessThan(MAX_ROUNDS);
      }
    }
  });

  it('a fight is deterministic for a given seed', () => {
    expect(fight(['gecko', 'gecko'], 7, 'hands')).toEqual(fight(['gecko', 'gecko'], 7, 'hands'));
  });

  it('bare-handed, the player very nearly always beats a lone gecko, bloatfly or radroach', () => {
    for (const defId of ['gecko', 'bloatfly', 'radroach']) {
      expect(winRate([defId], 'hands')).toBeGreaterThanOrEqual(0.95);
    }
  });

  it('a lone gecko still draws blood from a bare-handed player on average', () => {
    expect(average(['gecko'], 'hands', (o) => o.hpLeft)).toBeLessThan(40);
  });
});

describe('seeded end-to-end fights: win rates have a meaningful band', () => {
  it('a bare-handed player beats two geckos most of the time but not always', () => {
    const rate = winRate(['gecko', 'gecko'], 'hands');
    expect(rate).toBeGreaterThanOrEqual(0.55);
    expect(rate).toBeLessThanOrEqual(0.99);
  });

  it('a bare-handed player at 15 HP beats a gecko most of the time but not always', () => {
    const rate = winRate(['gecko'], 'hands', 15);
    expect(rate).toBeGreaterThanOrEqual(0.55);
    expect(rate).toBeLessThanOrEqual(0.99);
  });

  it('a bare-handed player is usually killed by three geckos', () => {
    const rate = winRate(['gecko', 'gecko', 'gecko'], 'hands');
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThan(0.5);
  });
});

describe('weapons matter', () => {
  it('the combat knife strictly improves the win rate over bare hands, on the same seeds', () => {
    expect(winRate(['gecko', 'gecko'], 'combat-knife')).toBeGreaterThan(winRate(['gecko', 'gecko'], 'hands'));
    expect(winRate(['gecko'], 'combat-knife', 15)).toBeGreaterThan(winRate(['gecko'], 'hands', 15));
    expect(winRate(['gecko', 'gecko', 'gecko'], 'combat-knife')).toBeGreaterThan(
      winRate(['gecko', 'gecko', 'gecko'], 'hands'),
    );
  });

  it('the knife never does worse than bare hands against a lone gecko, and leaves more HP', () => {
    expect(winRate(['gecko'], 'combat-knife')).toBeGreaterThanOrEqual(winRate(['gecko'], 'hands'));
    expect(average(['gecko'], 'combat-knife', (o) => o.hpLeft)).toBeGreaterThan(
      average(['gecko'], 'hands', (o) => o.hpLeft),
    );
  });

  it('the knife shortens the average fight against every wild monster', () => {
    for (const defId of ['gecko', 'bloatfly', 'radroach']) {
      expect(average([defId], 'combat-knife', (o) => o.rounds)).toBeLessThan(
        average([defId], 'hands', (o) => o.rounds),
      );
    }
  });

  it('the bat also beats bare hands against a pair of geckos', () => {
    expect(winRate(['gecko', 'gecko'], 'baseball-bat')).toBeGreaterThan(winRate(['gecko', 'gecko'], 'hands'));
  });
});

describe('waiting is not winning', () => {
  it('a player who just stands next to a gecko eventually dies', () => {
    const gecko = createMonster('g', 'gecko', 1, 0);
    const { state, events } = buildArena({ width: 3, height: 1, player: { x: 0, y: 0 }, monsters: [gecko] });
    const rng = createRNG(3);
    for (let i = 0; i < 1000 && !state.gameOver; i++) advanceTurn(state, events, rng);
    expect(state.gameOver).toBe(true);
  });
});
