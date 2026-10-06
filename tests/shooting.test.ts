import { describe, expect, it } from 'vitest';
import { computeToHit } from '../src/combat/CombatFormulas';
import type { Combatant } from '../src/combat/Combatant';
import { resolveShot } from '../src/combat/CombatResolver';
import { createLimbs } from '../src/combat/Limbs';
import { GUN_NOISE_RADIUS } from '../src/config/constants';
import type { GameEvents } from '../src/engine/EventBus';
import { fireGun, readyAmmo } from '../src/engine/Items';
import { wieldItem } from '../src/engine/TurnManager';
import { createMonster, type Monster } from '../src/entities/Monster';
import { createNpc } from '../src/entities/Npc';
import { canFire, consumeRound, readiedAmmoCount, readiedStack, wieldedGun } from '../src/items/Carrying';
import { createItem } from '../src/items/Item';
import { ITEMS, itemDef, type GunDef } from '../src/items/ItemData';
import { setHeight } from '../src/world/GameMap';
import type { RNG } from '../src/utils/RNG';
import { buildArena, scriptedRNG, type ArenaOptions } from './helpers/fixtures';

/** Every roll 0: every attack hits the head for minimum damage. */
const ALWAYS_HIT: RNG = () => 0;
const ALWAYS_MISS: RNG = () => 0.999;

const PISTOL = itemDef('9mm-pistol') as GunDef;

function armed(opts: ArenaOptions, ready = true) {
  const arena = buildArena(opts);
  const player = arena.state.player;
  const pistol = player.inventory.find((i) => i.defId === '9mm-pistol')!;
  const ammo = player.inventory.find((i) => i.defId === '9mm-round')!;
  player.wielded = pistol.id;
  if (ready) player.readied = ammo.id;
  return { ...arena, player, pistol, ammo };
}

function monsterAt(id: string, x: number, y: number, defId = 'gecko'): Monster {
  const m = createMonster(id, defId, x, y);
  return m;
}

function shots(arena: { emitted: Array<{ name: string; payload: unknown }> }) {
  return arena.emitted.filter((e) => e.name === 'shot-fired').map((e) => e.payload as GameEvents['shot-fired']);
}

describe('canFire', () => {
  it('no gun wielded', () => {
    const a = buildArena({ width: 5, height: 1, player: { x: 0, y: 0 } });
    expect(canFire(a.state.player)).toEqual({ ok: false, reason: 'You have no gun wielded.' });
    a.state.player.wielded = a.state.player.inventory.find((i) => i.defId === 'baseball-bat')!.id;
    expect(canFire(a.state.player)).toEqual({ ok: false, reason: 'You have no gun wielded.' });
  });

  it('ammunition in the pack but none readied points at Q', () => {
    const a = armed({ width: 5, height: 1, player: { x: 0, y: 0 } }, false);
    expect(canFire(a.player)).toEqual({ ok: false, reason: 'You have no ammunition readied. (Press Q.)' });
  });

  it('no ammunition at all', () => {
    const a = armed({ width: 5, height: 1, player: { x: 0, y: 0 } }, false);
    a.player.inventory = a.player.inventory.filter((i) => i.defId !== '9mm-round');
    expect(canFire(a.player)).toEqual({ ok: false, reason: 'You have no ammunition for the 9mm pistol.' });
  });

  it('readied ammunition of the wrong kind', () => {
    ITEMS['test-10mm'] = { id: 'test-10mm', name: '10mm round', plural: '10mm rounds', glyph: ')', fg: '#fff', kind: 'ammo', ammoType: '10mm' };
    try {
      const a = armed({ width: 5, height: 1, player: { x: 0, y: 0 } });
      const wrong = createItem('test-10mm', 5);
      a.player.inventory.push(wrong);
      a.player.readied = wrong.id;
      expect(canFire(a.player)).toEqual({
        ok: false,
        reason: 'Your 9mm pistol takes 9mm rounds, not 10mm rounds.',
      });
    } finally {
      delete ITEMS['test-10mm'];
    }
  });

  it('a readied stack that is gone', () => {
    const a = armed({ width: 5, height: 1, player: { x: 0, y: 0 } });
    a.player.inventory = a.player.inventory.filter((i) => i !== a.ammo);
    expect(canFire(a.player)).toEqual({ ok: false, reason: 'You are out of 9mm rounds.' });
  });

  it('ok: returns the gun and the stack', () => {
    const a = armed({ width: 5, height: 1, player: { x: 0, y: 0 } });
    const check = canFire(a.player);
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.gun.id).toBe('9mm-pistol');
      expect(check.ammo).toBe(a.ammo);
    }
    expect(wieldedGun(a.player)?.id).toBe('9mm-pistol');
    expect(readiedStack(a.player)).toBe(a.ammo);
    expect(readiedAmmoCount(a.player)).toBe(24);
  });

  it('consumeRound spends one and removes the emptied stack from pack and quiver', () => {
    const a = armed({ width: 5, height: 1, player: { x: 0, y: 0 } });
    a.ammo.count = 2;
    consumeRound(a.player);
    expect(a.ammo.count).toBe(1);
    consumeRound(a.player);
    expect(a.player.inventory).not.toContain(a.ammo);
    expect(a.player.readied).toBeNull();
    consumeRound(a.player); // nothing readied: harmless
  });
});

describe('resolveShot', () => {
  function who(overrides: Partial<Combatant> = {}): Combatant {
    return {
      hp: 40, maxHp: 40, ac: 5, agility: 5, strength: 5, speed: 12, energy: 12,
      limbs: createLimbs('humanoid', 40),
      ...overrides,
    };
  }
  // A flat gun: no range bonus at all up close, a plain 3 points per cell past 6.
  const accuracy = { closeRange: 4, closeBonus: 0, effectiveRange: 6, effectiveBonus: 0, falloffPerCell: 3, aimFalloffPerCell: 0.15, aimFloor: 0.4 };
  const shot = { damage: { min: 10, max: 10 }, accuracyBonus: 0, accuracy, hitProfile: { head: 0, torso: 1, arm: 0, leg: 0 } };

  it('range falloff: past the effective range the chance drops falloffPerCell per cell', () => {
    // agility 5, bonus 0, ac 5 -> 50 - 10 = 40% out to the effective range. Roll d100 = 40 hits, 41 misses.
    expect(resolveShot(scriptedRNG([0.39, 0, 0]), who(), who(), shot, 1).hit).toBe(true);
    expect(resolveShot(scriptedRNG([0.4]), who(), who(), shot, 1).hit).toBe(false);
    const at9 = 40 - 3 * 3;
    expect(resolveShot(scriptedRNG([(at9 - 1) / 100, 0, 0]), who(), who(), shot, 9).hit).toBe(true);
    expect(resolveShot(scriptedRNG([at9 / 100]), who(), who(), shot, 9).hit).toBe(false);
  });

  it('the to-hit chance clamps at 5%', () => {
    expect(computeToHit(5, -3 * 99, 0, 5)).toBe(5);
    expect(resolveShot(scriptedRNG([0.04, 0, 0]), who(), who(), shot, 100).hit).toBe(true);
    expect(resolveShot(scriptedRNG([0.05]), who(), who(), shot, 100).hit).toBe(false);
  });

  it('aims with Perception when the shooter has it, else Agility', () => {
    // perception 15 vs agility 5: +50 points. 5 + ... clamp 95. roll 0.9 -> 91 hits.
    expect(resolveShot(scriptedRNG([0.85, 0, 0]), who({ perception: 15 }), who(), shot, 1).hit).toBe(true);
    expect(resolveShot(scriptedRNG([0.85]), who(), who(), shot, 1).hit).toBe(false);
  });

  it('adds no Strength bonus', () => {
    const r = resolveShot(scriptedRNG([0, 0, 0]), who({ strength: 10 }), who(), shot, 1);
    expect(r.damage).toBe(10);
  });

  it('head hits do 1.5x', () => {
    const headShot = { ...shot, hitProfile: { head: 1, torso: 0, arm: 0, leg: 0 } };
    const r = resolveShot(scriptedRNG([0, 0, 0]), who(), who(), headShot, 1);
    expect(r.limb!.kind).toBe('head');
    expect(r.damage).toBe(15);
  });

  it('follows the shot hit profile and mutates the target', () => {
    const legShot = { ...shot, hitProfile: { head: 0, torso: 0, arm: 0, leg: 1 } };
    const target = who();
    const r = resolveShot(scriptedRNG([0, 0.5, 0]), who(), target, legShot, 1);
    expect(r.limb!.kind).toBe('leg');
    expect(target.hp).toBe(30);
    expect(r.limb!.hp).toBe(10);
    expect(r.killed).toBe(false);
  });

  it('reports a kill', () => {
    const r = resolveShot(scriptedRNG([0, 0, 0]), who(), who({ hp: 5 }), shot, 1);
    expect(r.killed).toBe(true);
  });

  it('a miss touches nothing', () => {
    const target = who();
    const r = resolveShot(scriptedRNG([0.999]), who(), target, shot, 1);
    expect(r).toMatchObject({ hit: false, damage: 0, limb: null, killed: false });
    expect(target.hp).toBe(40);
  });
});

describe('fireGun', () => {
  it('refusal: a message, no turn, nothing consumed', () => {
    const a = armed({ width: 5, height: 1, player: { x: 0, y: 0 } }, false);
    expect(fireGun(a.state, 'E', a.events, scriptedRNG([]))).toBe(false);
    expect(a.state.messageLog).toEqual(['You have no ammunition readied. (Press Q.)']);
    expect(a.state.turnCount).toBe(0);
    expect(a.ammo.count).toBe(24);
    expect(shots(a)).toEqual([]);
  });

  it('consumes a round, costs a turn, and a hit narrates with the gun name', () => {
    const gecko = monsterAt('g', 3, 0);
    const a = armed({ width: 10, height: 1, player: { x: 0, y: 0 }, monsters: [gecko] });
    expect(fireGun(a.state, 'E', a.events, ALWAYS_HIT)).toBe(true);
    expect(a.ammo.count).toBe(23);
    expect(a.state.turnCount).toBe(1);
    expect(a.state.messageLog[0]).toBe('You shoot the gecko in the head with your 9mm pistol.');
    expect(gecko.hp).toBe(12 - 6); // min damage 4, head x1.5, no strength bonus
    expect(gecko.hostile && gecko.alerted).toBe(true);
  });

  it('a miss names the gun, and a missed creature still turns hostile', () => {
    const brahmin = monsterAt('b', 3, 0, 'brahmin');
    const a = armed({ width: 10, height: 1, player: { x: 0, y: 0 }, monsters: [brahmin] });
    fireGun(a.state, 'E', a.events, ALWAYS_MISS);
    expect(a.state.messageLog[0]).toBe('You miss the brahmin with your 9mm pistol.');
    expect(brahmin.hostile).toBe(true);
  });

  it('shooting at nothing', () => {
    const a = armed({ width: 10, height: 1, player: { x: 0, y: 0 } });
    fireGun(a.state, 'E', a.events, ALWAYS_HIT);
    expect(a.state.messageLog).toEqual(['You fire your 9mm pistol.', 'The shot whizzes away.']);
    expect(a.ammo.count).toBe(23);
  });

  it('killing the target removes it; the last round empties the quiver', () => {
    const gecko = monsterAt('g', 1, 0);
    gecko.hp = 1;
    const a = armed({ width: 5, height: 1, player: { x: 0, y: 0 }, monsters: [gecko] });
    a.ammo.count = 1;
    fireGun(a.state, 'E', a.events, scriptedRNG([0, 0, 0, 0.99]));
    expect(a.state.messageLog.at(-1)).toBe('The gecko dies!');
    expect(a.state.spaces.arena!.monsters).toEqual([]);
    expect(a.player.readied).toBeNull();
    expect(a.player.inventory).not.toContain(a.ammo);
  });

  it('works in all 8 directions', () => {
    const dirs = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0], NE: [1, -1], NW: [-1, -1], SE: [1, 1], SW: [-1, 1] } as const;
    for (const [dir, [dx, dy]] of Object.entries(dirs)) {
      const gecko = monsterAt('g', 4 + dx * 2, 4 + dy * 2);
      const a = armed({ width: 9, height: 9, player: { x: 4, y: 4 }, monsters: [gecko] });
      fireGun(a.state, dir as keyof typeof dirs, a.events, ALWAYS_HIT);
      expect(a.state.messageLog[0], dir).toBe('You shoot the gecko in the head with your 9mm pistol.');
    }
  });

  it('range: reaches 10 cells, not 11', () => {
    const near = monsterAt('n', 10, 0);
    const a = armed({ width: 20, height: 1, player: { x: 0, y: 0 }, monsters: [near] });
    fireGun(a.state, 'E', a.events, ALWAYS_HIT);
    expect(a.state.messageLog[0]).toMatch(/^You shoot the gecko/);
    expect(shots(a)[0]!.path).toHaveLength(10);

    const far = monsterAt('f', 11, 0);
    const b = armed({ width: 20, height: 1, player: { x: 0, y: 0 }, monsters: [far] });
    fireGun(b.state, 'E', b.events, ALWAYS_HIT);
    expect(b.state.messageLog).toEqual(['You fire your 9mm pistol.', 'The shot whizzes away.']);
    expect(far.hp).toBe(12);
  });

  it('distance lowers the chance to hit', () => {
    // gecko ac 4, small (-8), perception 6, pistol +5: 79% adjacent, 59% at distance 6, 35% at 9.
    const gecko = monsterAt('g', 9, 0);
    const a = armed({ width: 12, height: 1, player: { x: 0, y: 0 }, monsters: [gecko] });
    fireGun(a.state, 'E', a.events, scriptedRNG([0.4]));
    expect(a.state.messageLog[0]).toBe('You miss the gecko with your 9mm pistol.');
    const gecko2 = monsterAt('g', 1, 0);
    const b = armed({ width: 10, height: 1, player: { x: 0, y: 0 }, monsters: [gecko2] });
    fireGun(b.state, "E", b.events, scriptedRNG([0.4, 0, 0, 0.999]));
    expect(b.state.messageLog[0]).toMatch(/^You shoot the gecko/);
  });

  it('a wall stops the bullet', () => {
    const gecko = monsterAt('g', 5, 0);
    const a = armed({ width: 10, height: 1, player: { x: 0, y: 0 }, monsters: [gecko], walls: [[3, 0]] });
    fireGun(a.state, 'E', a.events, ALWAYS_HIT);
    expect(gecko.hp).toBe(12);
    expect(shots(a)[0]!.path).toEqual([{ x: 1, y: 0 }, { x: 2, y: 0 }]);
    expect(a.state.messageLog).toEqual(['You fire your 9mm pistol.', 'The shot whizzes away.']);
  });

  it('a closed door stops it too', () => {
    const gecko = monsterAt('g', 5, 0);
    const a = armed({ width: 10, height: 1, player: { x: 0, y: 0 }, monsters: [gecko], doors: [[2, 0]] });
    fireGun(a.state, 'E', a.events, ALWAYS_HIT);
    expect(gecko.hp).toBe(12);
  });

  it('terrain height between shooter and target is cover', () => {
    const gecko = monsterAt('g', 5, 0);
    const a = armed({ width: 10, height: 1, player: { x: 0, y: 0 }, monsters: [gecko] });
    setHeight(a.grid, 3, 0, 2);
    fireGun(a.state, 'E', a.events, ALWAYS_HIT);
    expect(gecko.hp).toBe(12);
    expect(shots(a)[0]!.path.at(-1)).toEqual({ x: 3, y: 0 });
  });

  it('only the first creature is hit when the shot connects', () => {
    const first = monsterAt('a', 2, 0);
    const second = monsterAt('b', 4, 0);
    const a = armed({ width: 10, height: 1, player: { x: 0, y: 0 }, monsters: [first, second] });
    fireGun(a.state, 'E', a.events, ALWAYS_HIT);
    expect(first.hp).toBe(6);
    expect(second.hp).toBe(12);
    expect(shots(a)[0]).toMatchObject({ shooterId: 'player', hitId: 'a' });
    expect(shots(a)[0]!.path).toHaveLength(2);
  });

  it('a miss keeps flying and rolls against the next creature', () => {
    const first = monsterAt('a', 2, 0);
    const second = monsterAt('b', 4, 0);
    const a = armed({ width: 10, height: 1, player: { x: 0, y: 0 }, monsters: [first, second] });
    // first: miss (0.999). second: hit (0), limb 0 (head), damage 0.
    fireGun(a.state, 'E', a.events, scriptedRNG([0.999, 0, 0, 0]));
    expect(a.state.messageLog.slice(0, 2)).toEqual([
      'You miss the gecko with your 9mm pistol.',
      'You shoot the gecko in the head with your 9mm pistol.',
    ]);
    expect(first.hp).toBe(12);
    expect(second.hp).toBe(6);
    expect(first.alerted).toBe(true);
    expect(shots(a)[0]).toMatchObject({ hitId: 'b' });
  });

  it('missing everything flies the full range and has no hitId', () => {
    const only = monsterAt('a', 2, 0);
    const a = armed({ width: 20, height: 1, player: { x: 0, y: 0 }, monsters: [only] });
    fireGun(a.state, 'E', a.events, ALWAYS_MISS);
    expect(shots(a)[0]!.hitId).toBeUndefined();
    expect(shots(a)[0]!.path).toHaveLength(10);
    expect(a.state.messageLog).toEqual(['You miss the gecko with your 9mm pistol.']);
  });

  it('shooting a peaceful NPC turns them hostile', () => {
    const sunny = createNpc('sunny', 'Sunny', 2, 0, ['hi']);
    const a = armed({ width: 10, height: 1, player: { x: 0, y: 0 }, npcs: [sunny] });
    fireGun(a.state, 'E', a.events, ALWAYS_HIT);
    expect(a.state.messageLog[0]).toBe('You shoot Sunny in the head with your 9mm pistol.');
    expect(sunny.hostile && sunny.alerted).toBe(true);
  });

  it('wielding a gun makes melee use the butt', () => {
    const gecko = monsterAt('g', 1, 0);
    const a = armed({ width: 5, height: 1, player: { x: 0, y: 0 }, monsters: [gecko] });
    a.state.player.wielded = a.pistol.id;
    // tryMovePlayer bump attacks; just check the profile name through the log
    // (resolved through playerAttacks).
    return import('../src/engine/Combat').then(({ playerAttacks }) => {
      playerAttacks(a.state, gecko, ALWAYS_MISS);
      expect(a.state.messageLog).toEqual(['You miss the gecko with your 9mm pistol.']);
    });
  });

  it('readying and wielding through the verbs makes the whole sequence work', () => {
    const gecko = monsterAt('g', 2, 0);
    const a = buildArena({ width: 6, height: 1, player: { x: 0, y: 0 }, monsters: [gecko] });
    const p = a.state.player;
    wieldItem(a.state, p.inventory.find((i) => i.defId === '9mm-pistol')!.id, a.events, ALWAYS_MISS);
    fireGun(a.state, 'E', a.events, ALWAYS_MISS);
    expect(a.state.messageLog.at(-1)).toBe('You have no ammunition readied. (Press Q.)');
    readyAmmo(a.state, p.inventory.find((i) => i.defId === '9mm-round')!.id);
    expect(fireGun(a.state, 'E', a.events, ALWAYS_HIT)).toBe(true);
    expect(gecko.hp).toBeLessThan(12);
  });
});

describe('gunshot noise', () => {
  it('alerts hostiles within the radius with no line of sight; ignores peaceful and distant ones', () => {
    const near = monsterAt('near', 10, 5); // behind a wall, 10 away
    const edge = monsterAt('edge', GUN_NOISE_RADIUS, 0);
    const beyond = monsterAt('beyond', GUN_NOISE_RADIUS + 1, 1);
    const peaceful = monsterAt('brahmin', 4, 4, 'brahmin');
    const sunny = createNpc('sunny', 'Sunny', 5, 5, ['hi']);
    const a = armed({
      width: 30,
      height: 10,
      player: { x: 0, y: 0 },
      monsters: [near, edge, beyond, peaceful],
      npcs: [sunny],
      walls: [[9, 5], [9, 4], [9, 6]],
    });
    fireGun(a.state, 'S', a.events, ALWAYS_HIT);
    expect(near.alerted).toBe(true);
    expect(edge.alerted).toBe(true);
    expect(beyond.alerted).toBe(false);
    expect(peaceful.alerted).toBe(false);
    expect(peaceful.hostile).toBe(false);
    expect(sunny.alerted).toBe(false);
  });

  it('a refused shot makes no noise', () => {
    const near = monsterAt('near', 3, 3);
    const a = armed({ width: 10, height: 10, player: { x: 0, y: 0 }, monsters: [near] }, false);
    fireGun(a.state, 'S', a.events, ALWAYS_HIT);
    expect(near.alerted).toBe(false);
  });
});

describe('shot-fired event', () => {
  it('lists the crossed cells in order, ending at the hit', () => {
    const gecko = monsterAt('g', 3, 3);
    const a = armed({ width: 8, height: 8, player: { x: 0, y: 0 }, monsters: [gecko] });
    fireGun(a.state, 'SE', a.events, ALWAYS_HIT);
    expect(shots(a)).toEqual([
      { path: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }], shooterId: 'player', hitId: 'g' },
    ]);
  });

  it('is not emitted for a refused shot', () => {
    const a = armed({ width: 5, height: 1, player: { x: 0, y: 0 } }, false);
    fireGun(a.state, 'E', a.events, ALWAYS_HIT);
    expect(shots(a)).toEqual([]);
  });
});

describe('pistol data', () => {
  it('is a 10 cell gun', () => {
    expect(PISTOL.range).toBe(10);
    expect(PISTOL.ammoType).toBe('9mm');
  });
});
