import { describe, expect, it } from 'vitest';
import { runCreatureTurns } from '../src/ai/AIScheduler';
import { SCREAM_NOISE_RADIUS, SHOUT_NOISE_RADIUS } from '../src/config/constants';
import { playerAttacks } from '../src/engine/Combat';
import { emitSound } from '../src/engine/Sound';
import { createMonster } from '../src/entities/Monster';
import { createNpc, type Npc } from '../src/entities/Npc';
import type { RNG } from '../src/utils/RNG';
import { buildArena, type Arena } from './helpers/fixtures';

/** Every roll 0: every blow lands for minimum damage. */
const ALWAYS_HIT: RNG = () => 0;
const NEVER_WANDER: RNG = () => 0.999;

function person(id: string, x: number, y: number): Npc {
  const n = createNpc(id, id, x, y, ['hi']);
  n.energy = 0; // exactly one action per tick
  return n;
}

function tick(arena: Arena): void {
  runCreatureTurns(arena.state, NEVER_WANDER, arena.events);
}

describe('provoking a peaceful person', () => {
  it('turns them hostile and provoked, and they scream', () => {
    const doc = person('Doc', 1, 0);
    const a = buildArena({ width: 10, height: 1, player: { x: 0, y: 0 }, npcs: [doc] });
    playerAttacks(a.state, doc, ALWAYS_HIT);
    expect(doc.hostile && doc.alerted && doc.provoked).toBe(true);
    expect(a.state.messageLog).toContain('You hear a scream.');
  });

  it('a peaceful within earshot comes to look; one beyond does not', () => {
    const doc = person('Doc', 1, 0);
    const near = person('near', 1 + SCREAM_NOISE_RADIUS, 0);
    const far = person('far', 2 + SCREAM_NOISE_RADIUS, 0);
    const a = buildArena({ width: 40, height: 1, player: { x: 0, y: 0 }, npcs: [doc, near, far] });
    playerAttacks(a.state, doc, ALWAYS_HIT);
    expect(near.investigate).toEqual({ x: 1, y: 0 });
    expect(near.hostile).toBe(false);
    expect(far.investigate).toBeNull();
  });

  it('killing a peaceful outright still draws a crowd, but leaves nobody provoked', () => {
    const doc = person('Doc', 1, 0);
    doc.hp = 1;
    doc.limbs.forEach((l) => (l.hp = 1));
    const bystander = person('by', 5, 0);
    const a = buildArena({ width: 10, height: 1, player: { x: 0, y: 0 }, npcs: [doc, bystander] });
    playerAttacks(a.state, doc, ALWAYS_HIT);
    expect(a.state.spaces.arena!.npcs).not.toContain(doc);
    expect(bystander.investigate).toEqual({ x: 1, y: 0 });
    expect(bystander.hostile).toBe(false);
  });

  it('a creature hostile by nature raises no alarm', () => {
    const gecko = createMonster('g', 'gecko', 1, 0);
    const bystander = person('by', 5, 0);
    const a = buildArena({ width: 10, height: 1, player: { x: 0, y: 0 }, monsters: [gecko], npcs: [bystander] });
    playerAttacks(a.state, gecko, ALWAYS_HIT);
    expect(gecko.provoked).toBe(false);
    expect(bystander.investigate).toBeNull();
  });
});

describe('sounds', () => {
  it('a shout carries further than a scream', () => {
    const listener = person('l', SCREAM_NOISE_RADIUS + 2, 0);
    const a = buildArena({ width: 40, height: 1, player: { x: 0, y: 0 }, npcs: [listener] });
    emitSound(a.state, { x: 0, y: 0 }, 'scream');
    expect(listener.investigate).toBeNull();
    emitSound(a.state, { x: 0, y: 0 }, 'shout');
    expect(SCREAM_NOISE_RADIUS + 2).toBeLessThanOrEqual(SHOUT_NOISE_RADIUS);
    expect(listener.investigate).toEqual({ x: 0, y: 0 });
  });

  it('a gunshot does not lure peaceful people or animals', () => {
    const npc = person('p', 3, 0);
    const brahmin = createMonster('b', 'brahmin', 4, 0);
    const a = buildArena({ width: 10, height: 1, player: { x: 0, y: 0 }, npcs: [npc], monsters: [brahmin] });
    emitSound(a.state, { x: 0, y: 0 }, 'gunshot');
    expect(npc.investigate).toBeNull();
    expect(brahmin.investigate).toBeNull();
    expect(brahmin.alerted).toBe(false);
  });

  it('a screaming sound does not stir a peaceful animal', () => {
    const brahmin = createMonster('b', 'brahmin', 4, 0);
    const a = buildArena({ width: 10, height: 1, player: { x: 0, y: 0 }, monsters: [brahmin] });
    emitSound(a.state, { x: 0, y: 0 }, 'scream');
    expect(brahmin.investigate).toBeNull();
  });
});

describe('investigating', () => {
  it('walks toward the noise, one step a turn, and stops next to it', () => {
    const walker = person('w', 6, 0);
    walker.investigate = { x: 1, y: 0 };
    const a = buildArena({ width: 10, height: 1, player: { x: 9, y: 0 }, npcs: [walker] });
    tick(a);
    expect(walker.x).toBe(5);
    for (let i = 0; i < 10; i++) tick(a);
    expect(walker.x).toBe(2);
    expect(walker.investigate).toBeNull();
  });

  it('gives up when there is no way there', () => {
    const walker = person('w', 6, 0);
    walker.investigate = { x: 1, y: 0 };
    const a = buildArena({
      width: 10,
      height: 3,
      player: { x: 9, y: 2 },
      npcs: [walker],
      walls: [[4, 0], [4, 1], [4, 2]],
    });
    tick(a);
    expect(walker.investigate).toBeNull();
  });
});

describe('witnessing the fight', () => {
  function scene(wall = false) {
    const doc = person('Doc', 1, 0);
    doc.hostile = doc.provoked = doc.alerted = true;
    const watcher = person('watcher', 6, 0);
    const a = buildArena({
      width: 12,
      height: 3,
      player: { x: 1, y: 2 },
      npcs: [doc, watcher],
      ...(wall ? { walls: [[3, 0], [3, 1], [4, 0], [4, 1]] as Array<[number, number]> } : {}),
    });
    return { a, doc, watcher };
  }

  it('a peaceful who sees a provoked neighbour turns on the player too', () => {
    const { a, watcher } = scene();
    tick(a);
    expect(watcher.hostile && watcher.provoked && watcher.alerted).toBe(true);
  });

  it('one who cannot see them does not', () => {
    const { a, watcher } = scene(true);
    tick(a);
    expect(watcher.hostile).toBe(false);
  });

  it('a neighbour out of their awareness goes unseen', () => {
    const { a, watcher } = scene();
    watcher.awareness = 2;
    tick(a);
    expect(watcher.hostile).toBe(false);
  });

  it('seeing a gecko fight the player means nothing', () => {
    const gecko = createMonster('g', 'gecko', 2, 0);
    gecko.hostile = gecko.alerted = true;
    const watcher = person('watcher', 5, 0);
    const a = buildArena({ width: 12, height: 3, player: { x: 1, y: 2 }, npcs: [watcher], monsters: [gecko] });
    tick(a);
    expect(watcher.hostile).toBe(false);
  });

  it('a provoked brahmin is no cause for alarm either', () => {
    const brahmin = createMonster('b', 'brahmin', 2, 0);
    brahmin.hostile = brahmin.provoked = brahmin.alerted = true;
    const watcher = person('watcher', 5, 0);
    const a = buildArena({ width: 12, height: 3, player: { x: 1, y: 2 }, npcs: [watcher], monsters: [brahmin] });
    tick(a);
    expect(watcher.hostile).toBe(false);
  });

  it('the Doc Mitchell chain: scream, neighbour comes, sees him fight, joins', () => {
    const doc = person('Doc', 1, 0);
    const neighbour = person('Neighbour', 9, 0);
    const a = buildArena({ width: 14, height: 1, player: { x: 0, y: 0 }, npcs: [doc, neighbour] });
    doc.energy = -1000; // Doc stays put: he screamed and is busy
    playerAttacks(a.state, doc, ALWAYS_HIT);
    expect(neighbour.investigate).not.toBeNull();
    for (let i = 0; i < 4 && !neighbour.hostile; i++) tick(a);
    expect(neighbour.hostile && neighbour.provoked).toBe(true);
    expect(neighbour.investigate).toBeNull();
  });
});

describe('scream versus gunshot', () => {
  it('a scream alerts people at once; a gunshot only sometimes draws a look, and raises no alarm', () => {
    const listener = person('l', 4, 0);
    const a = buildArena({ width: 20, height: 1, player: { x: 0, y: 0 }, npcs: [listener] });
    emitSound(a.state, { x: 0, y: 0 }, 'gunshot', undefined, () => 0.999);
    expect(listener.investigate).toBeNull();
    emitSound(a.state, { x: 0, y: 0 }, 'gunshot', undefined, () => 0);
    expect(listener.investigate).toEqual({ x: 0, y: 0 });
    expect(listener.alarm).toBeNull();

    listener.investigate = null;
    emitSound(a.state, { x: 0, y: 0 }, 'scream');
    expect(listener.investigate).toEqual({ x: 0, y: 0 });
    expect(listener.alarm).toBe('pending');
  });

  it('someone who hears a scream passes it on, reaching people the scream itself missed', () => {
    const sunny = person('Sunny', 8, 0);
    const far = person('Far', 8 + SCREAM_NOISE_RADIUS, 0); // out of the scream's range, in the shout's
    const a = buildArena({ width: 40, height: 1, player: { x: 39, y: 0 }, npcs: [sunny, far] });
    emitSound(a.state, { x: 0, y: 0 }, 'scream');
    expect(far.alarm).toBeNull();
    tick(a);
    expect(sunny.alarm).toBe('done');
    expect(sunny.x).toBe(8); // relaying took her action
    expect(far.alarm).not.toBeNull(); // alerted; may already have relayed it too
    expect(far.investigate).toEqual({ x: 0, y: 0 }); // sent to the original trouble, not to Sunny
  });

  it('each person relays once, then walks to the scream and is free to react again later', () => {
    const sunny = person('Sunny', 6, 0);
    const a = buildArena({ width: 40, height: 1, player: { x: 39, y: 0 }, npcs: [sunny] });
    emitSound(a.state, { x: 0, y: 0 }, 'scream');
    const log = () => a.state.messageLog.filter((m) => m.includes('shout')).length;
    tick(a);
    const afterFirst = log();
    for (let i = 0; i < 12; i++) tick(a);
    expect(log()).toBe(afterFirst);
    expect(sunny.investigate).toBeNull();
    expect(sunny.alarm).toBeNull();
  });

  it('a gunshot-curious person who then hears a scream is still alerted and relays it', () => {
    const p = person('p', 5, 0);
    p.investigate = { x: 20, y: 0 };
    const a = buildArena({ width: 40, height: 1, player: { x: 39, y: 0 }, npcs: [p] });
    emitSound(a.state, { x: 0, y: 0 }, 'scream');
  });
});
