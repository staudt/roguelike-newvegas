import { describe, expect, it } from 'vitest';
import { runCreatureTurns } from '../src/ai/AIScheduler';
import { GUN_KEEP_DISTANCE } from '../src/config/constants';
import { createMonster } from '../src/entities/Monster';
import { createNpc, type Npc } from '../src/entities/Npc';
import { applyLoadout, type LoadoutJSON } from '../src/items/Loadout';
import { chebyshevDistance } from '../src/utils/geometry';
import type { RNG } from '../src/utils/RNG';
import { getTileId } from '../src/world/GameMap';
import { buildArena, scriptedRNG, type Arena, type ArenaOptions } from './helpers/fixtures';

const NEVER: RNG = () => 0.999;
const ALWAYS: RNG = () => 0;

/** A person the player has just provoked: hostile, alerted, provoked, one action per tick. */
function provoked(x: number, y: number, loadout?: LoadoutJSON): Npc {
  const n = createNpc('doc', 'Doc', x, y, ['hi']);
  applyLoadout(n, loadout);
  n.hostile = n.alerted = n.provoked = true;
  n.energy = 0;
  return n;
}

function arena(opts: Omit<ArenaOptions, 'npcs'>, ...npcs: Npc[]): Arena {
  return buildArena({ ...opts, npcs });
}

function tick(a: Arena, rng: RNG = NEVER): void {
  runCreatureTurns(a.state, rng, a.events);
}

describe('people open doors', () => {
  it('a person investigating a scream opens the door in the way, then walks through', () => {
    const inside = createNpc('in', 'Trudy', 6, 0, ['hi']);
    inside.energy = 0;
    inside.investigate = { x: 0, y: 0 };
    const a = arena({ width: 10, height: 1, player: { x: 9, y: 0 }, doors: [[4, 0]] }, inside);
    tick(a);
    expect(inside.x).toBe(5);
    tick(a); // bumps the door
    expect(getTileId(a.grid, 4, 0)).toBe('openDoor');
    expect(inside.x).toBe(5); // opening took the action
    tick(a);
    expect(inside.x).toBe(4);
  });

  it('a provoked person chasing you opens doors too, but a gecko still does not', () => {
    const doc = provoked(4, 0, { inventory: ['baseball-bat'], wield: 'baseball-bat' });
    const gecko = createMonster('g', 'gecko', 4, 2);
    gecko.hostile = gecko.alerted = true;
    gecko.energy = 0;
    const a = buildArena({
      width: 10,
      height: 3,
      player: { x: 0, y: 0 },
      doors: [[2, 0], [2, 2]],
      npcs: [doc],
      monsters: [gecko],
    });
    for (let i = 0; i < 6; i++) tick(a);
    expect(getTileId(a.grid, 2, 0)).toBe('openDoor');
    expect(getTileId(a.grid, 2, 2)).toBe('door');
  });
});

describe('a provoked person with no weapon', () => {
  it('runs away from the player', () => {
    const doc = provoked(3, 3);
    const a = arena({ width: 20, height: 7, player: { x: 1, y: 3 } }, doc);
    const before = chebyshevDistance(doc, a.state.player);
    tick(a, scriptedRNG([0, 0.999, 0.999])); // flees; no scream
    expect(doc.stance).toBe('flee');
    expect(chebyshevDistance(doc, a.state.player)).toBeGreaterThan(before);
  });

  it('keeps screaming from time to time while the player is in sight, drawing others', () => {
    const doc = provoked(3, 3);
    const bystander = createNpc('by', 'Trudy', 12, 3, ['hi']);
    const a = arena({ width: 20, height: 7, player: { x: 1, y: 3 } }, doc, bystander);
    tick(a, scriptedRNG([0, 0])); // stance roll, then the scream roll
    expect(a.state.messageLog).toContain('You hear a scream.');
    expect(bystander.alarm).not.toBeNull();
    expect([doc.x, doc.y]).toEqual([3, 3]); // screaming took the action
  });

  it('a few stand and brawl instead', () => {
    const doc = provoked(3, 3);
    const a = arena({ width: 20, height: 7, player: { x: 1, y: 3 } }, doc);
    tick(a, scriptedRNG([0.99])); // above UNARMED_FLEE_CHANCE
    expect(doc.stance).toBe('fight');
    expect(doc.x).toBe(2);
  });

  it('cornered, lashes out', () => {
    const doc = provoked(1, 0);
    const a = arena({ width: 2, height: 1, player: { x: 0, y: 0 } }, doc);
    tick(a, scriptedRNG([0, 0.999, 0.999, 0.999, 0.999, 0.999]));
    expect(a.state.messageLog.some((m) => m.startsWith('Doc '))).toBe(true);
  });

  it('a person who was hostile all along does not flee', () => {
    const raider = provoked(3, 3);
    raider.provoked = false;
    const a = arena({ width: 20, height: 7, player: { x: 1, y: 3 } }, raider);
    tick(a);
    expect(raider.stance).toBeNull();
    expect(raider.x).toBe(2);
  });
});

describe('a provoked person with a weapon', () => {
  it('a melee weapon: closes in and fights', () => {
    const doc = provoked(4, 3, { inventory: ['baseball-bat'], wield: 'baseball-bat' });
    const a = arena({ width: 20, height: 7, player: { x: 1, y: 3 } }, doc);
    tick(a, ALWAYS);
    expect(doc.stance).toBe('fight');
    expect(doc.x).toBe(3);
  });

  it('a gun: backs off when you are close, and shoots otherwise', () => {
    const gun: LoadoutJSON = { inventory: ['9mm-pistol', { defId: '9mm-round', count: 6 }], ready: '9mm-round' };
    const doc = provoked(2, 3, gun);
    const a = arena({ width: 20, height: 7, player: { x: 1, y: 3 } }, doc);
    // draws the pistol first (it starts holstered), then the kite roll succeeds
    tick(a, ALWAYS);
    expect(doc.stance).toBe('fight');
    const before = chebyshevDistance(doc, a.state.player);
    tick(a, ALWAYS);
    expect(chebyshevDistance(doc, a.state.player)).toBeGreaterThan(before);
    expect(before).toBeLessThan(GUN_KEEP_DISTANCE);
  });

  it('a gun: when the kite roll fails it fires', () => {
    const gun: LoadoutJSON = { inventory: ['9mm-pistol', { defId: '9mm-round', count: 6 }], wield: '9mm-pistol', ready: '9mm-round' };
    const doc = provoked(2, 3, gun);
    const a = arena({ width: 20, height: 7, player: { x: 1, y: 3 } }, doc);
    tick(a, NEVER);
    expect(a.emitted.filter((e) => e.name === 'shot-fired')).toHaveLength(1);
  });
});
