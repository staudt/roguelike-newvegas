import { describe, expect, it } from 'vitest';
import { runCreatureTurns } from '../src/ai/AIScheduler';
import { NPC_WANDER_CHANCE, NPC_WANDER_RADIUS } from '../src/config/constants';
import { createNpc, type Npc } from '../src/entities/Npc';
import { chebyshevDistance } from '../src/utils/geometry';
import { createRNG, type RNG } from '../src/utils/RNG';
import { getTileId } from '../src/world/GameMap';
import { buildArena, type Arena } from './helpers/fixtures';

const NEVER: RNG = () => 0.999;

function person(x: number, y: number): Npc {
  const n = createNpc('n', 'Trudy', x, y, ['hi']);
  n.energy = 0;
  return n;
}

function tick(a: Arena, rng: RNG): void {
  runCreatureTurns(a.state, rng, a.events);
}

describe('idle people wander a little', () => {
  it('they move now and then, but never beyond their wander radius from home', () => {
    const npc = person(15, 10);
    const a = buildArena({ width: 30, height: 20, player: { x: 0, y: 0 }, npcs: [npc] });
    const rng = createRNG(7);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      tick(a, rng);
      seen.add(`${npc.x},${npc.y}`);
      expect(chebyshevDistance(npc, npc.home)).toBeLessThanOrEqual(NPC_WANDER_RADIUS);
    }
    expect(seen.size).toBeGreaterThan(3); // not a statue
    expect(seen.size).toBeLessThanOrEqual((2 * NPC_WANDER_RADIUS + 1) ** 2);
  });

  it('only on a small chance per turn: most turns they stand still', () => {
    const npc = person(15, 10);
    const a = buildArena({ width: 30, height: 20, player: { x: 0, y: 0 }, npcs: [npc] });
    let moves = 0;
    const rng = createRNG(3);
    for (let i = 0; i < 1000; i++) {
      const before = `${npc.x},${npc.y}`;
      tick(a, rng);
      if (`${npc.x},${npc.y}` !== before) moves++;
    }
    expect(moves).toBeGreaterThan(0);
    expect(moves / 1000).toBeLessThanOrEqual(NPC_WANDER_CHANCE / 100);
  });

  it('a low roll makes them step; a high one keeps them still', () => {
    const npc = person(15, 10);
    const a = buildArena({ width: 30, height: 20, player: { x: 0, y: 0 }, npcs: [npc] });
    tick(a, NEVER);
    expect([npc.x, npc.y]).toEqual([15, 10]);
    tick(a, () => 0);
    expect([npc.x, npc.y]).not.toEqual([15, 10]);
  });

  it('they do not push through a closed door', () => {
    const npc = person(1, 0);
    const a = buildArena({ width: 3, height: 1, player: { x: 2, y: 0 }, npcs: [npc], doors: [[0, 0]] });
    for (let i = 0; i < 300; i++) tick(a, createRNG(i));
    expect(getTileId(a.grid, 0, 0)).toBe('door');
    expect(npc.x).toBeGreaterThanOrEqual(1);
  });

  it('they stay out of anyone else\'s cell, the player\'s included', () => {
    const npc = person(1, 0);
    const other = person(0, 0);
    other.id = 'o';
    const a = buildArena({ width: 3, height: 1, player: { x: 2, y: 0 }, npcs: [npc, other] });
    for (let i = 0; i < 200; i++) {
      tick(a, createRNG(i));
      expect(new Set([npc.x, other.x, a.state.player.x]).size).toBe(3);
    }
  });

  it('someone alarmed or investigating goes about that, not wandering', () => {
    const npc = person(15, 10);
    npc.investigate = { x: 15, y: 10 }; // already there: finishes at once, no wander roll used
    const a = buildArena({ width: 30, height: 20, player: { x: 0, y: 0 }, npcs: [npc] });
    tick(a, () => 0);
    expect([npc.x, npc.y]).toEqual([15, 10]);
    expect(npc.investigate).toBeNull();
  });
});
