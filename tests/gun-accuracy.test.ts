import { describe, expect, it } from 'vitest';
import { aimSpread, computeToHit, crowdPenalty, rangeAccuracyBonus, targetEvasion } from '../src/combat/CombatFormulas';
import type { Combatant } from '../src/combat/Combatant';
import { resolveShot } from '../src/combat/CombatResolver';
import { createLimbs } from '../src/combat/Limbs';
import { createMonster } from '../src/entities/Monster';
import { createNpc } from '../src/entities/Npc';
import { createPlayer } from '../src/entities/Player';
import { itemDef, type GunDef } from '../src/items/ItemData';
import { createRNG } from '../src/utils/RNG';

const GUN = itemDef('9mm-pistol') as GunDef;
const SHOT = GUN.shot;
const ACC = SHOT.accuracy;

function who(overrides: Partial<Combatant> = {}): Combatant {
  return {
    hp: 1e6, maxHp: 1e6, ac: 5, agility: 5, strength: 5, perception: 6, speed: 12, energy: 12,
    limbs: createLimbs('humanoid', 1000),
    ...overrides,
  };
}

/** Percent chance for a Perception 6 shooter with the pistol, straight from the formulas. */
function chance(target: Pick<Combatant, 'ac' | 'size' | 'speed'>, d: number): number {
  return computeToHit(6, SHOT.accuracyBonus + rangeAccuracyBonus(ACC, d) + targetEvasion(target), 0, target.ac);
}

const gecko = () => createMonster('g', 'gecko', 0, 0);
const bloatfly = () => createMonster('f', 'bloatfly', 0, 0);
const radroach = () => createMonster('r', 'radroach', 0, 0);
const brahmin = () => createMonster('b', 'brahmin', 0, 0);
const npc = () => createNpc('n', 'Sunny', 0, 0, ['hi']);
const medium = { ac: 5, size: 'medium', speed: 12 } as const;

describe('rangeAccuracyBonus', () => {
  it('is the close bonus out to two thirds of the effective range', () => {
    for (const d of [1, 2, 3, 4]) expect(rangeAccuracyBonus(ACC, d)).toBe(35);
  });
  it('slides linearly to the effective bonus', () => {
    expect(rangeAccuracyBonus(ACC, 5)).toBe(25);
    expect(rangeAccuracyBonus(ACC, 6)).toBe(15);
  });
  it('falls off per cell beyond the effective range, and may go negative', () => {
    expect(rangeAccuracyBonus(ACC, 7)).toBe(7);
    expect(rangeAccuracyBonus(ACC, 8)).toBe(-1);
    expect(rangeAccuracyBonus(ACC, 10)).toBe(-17);
  });
});

describe('aimSpread', () => {
  it('follows the shared bands: torso-leaning close, widest in the sweet spot, torso again, then the floor', () => {
    expect([1, 2].map((d) => aimSpread(ACC, d))).toEqual([0.5, 0.5]);
    expect([3, 4].map((d) => aimSpread(ACC, d))).toEqual([1.5, 1.5]);
    expect([5, 6].map((d) => aimSpread(ACC, d))).toEqual([0.7, 0.7]);
    expect([7, 10, 50].map((d) => aimSpread(ACC, d))).toEqual([0.4, 0.4, 0.4]);
  });
  it('scales with the gun: a range-3 gun has its sweet spot at 2', () => {
    const short = { ...ACC, effectiveRange: 3 };
    expect([1, 2, 3, 4].map((d) => aimSpread(short, d))).toEqual([0.5, 1.5, 0.7, 0.4]);
  });
});

describe('crowdPenalty', () => {
  it('costs 10 per adjacent hostile, capped at 30, and only for shots at range', () => {
    expect(crowdPenalty(0, 5)).toBe(0);
    expect(crowdPenalty(1, 5)).toBe(10);
    expect(crowdPenalty(2, 5)).toBe(20);
    expect(crowdPenalty(9, 5)).toBe(30);
    expect(crowdPenalty(3, 1)).toBe(0);
  });
  it('lowers the hit chance in resolveShot', () => {
    const hits = (crowd: number) => {
      const rng = createRNG(3);
      let n = 0;
      for (let i = 0; i < 4000; i++) if (resolveShot(rng, who(), who(), SHOT, 5, crowd).hit) n++;
      return n;
    };
    expect(hits(2)).toBeLessThan(hits(0) - 400);
  });
});

describe('targetEvasion', () => {
  it('size modifiers', () => {
    expect(targetEvasion({ size: 'tiny', speed: 12 })).toBe(-20);
    expect(targetEvasion({ size: 'small', speed: 12 })).toBe(-8);
    expect(targetEvasion({ size: 'medium', speed: 12 })).toBe(0);
    expect(targetEvasion({ size: undefined, speed: 12 })).toBe(0);
    expect(targetEvasion({ size: 'large', speed: 12 })).toBe(8);
  });
  it('speed above 12 costs half a point per point; slower costs nothing', () => {
    expect(targetEvasion({ size: 'medium', speed: 24 })).toBe(-6);
    expect(targetEvasion({ size: 'medium', speed: 8 })).toBe(0);
  });
  it('monsters carry their size', () => {
    expect([gecko().size, bloatfly().size, radroach().size, brahmin().size]).toEqual([
      'small', 'tiny', 'small', 'large',
    ]);
  });
});

describe('pistol hit chance for a medium target', () => {
  it('is hard to miss at 1-4 cells', () => {
    for (const d of [1, 2, 3, 4]) expect(chance(medium, d)).toBeGreaterThanOrEqual(80);
  });
  it('is 65-75% at 6 cells', () => {
    expect(chance(medium, 6)).toBeGreaterThanOrEqual(65);
    expect(chance(medium, 6)).toBeLessThanOrEqual(75);
  });
  it('drops 8 points per cell beyond that, never below 5', () => {
    expect(chance(medium, 6) - chance(medium, 7)).toBe(8);
    expect(chance(medium, 7) - chance(medium, 8)).toBe(8);
    expect(chance(medium, 9)).toBeGreaterThanOrEqual(5);
    expect(computeToHit(6, SHOT.accuracyBonus + rangeAccuracyBonus(ACC, 100), 0, 5)).toBe(5);
  });
  it('resolveShot rolls that chance', () => {
    const hits = (d: number) => {
      const rng = createRNG(7);
      let n = 0;
      for (let i = 0; i < 4000; i++) if (resolveShot(rng, who(), who(), SHOT, d).hit) n++;
      return (n / 4000) * 100;
    };
    expect(Math.abs(hits(2) - chance(medium, 2))).toBeLessThan(3);
    expect(Math.abs(hits(6) - chance(medium, 6))).toBeLessThan(3);
    expect(hits(9)).toBeLessThan(hits(6));
  });
});

describe('size and speed', () => {
  it('smaller targets are harder, larger easier', () => {
    const base = { ac: 5, speed: 12 };
    expect(chance({ ...base, size: 'tiny' }, 3)).toBeLessThan(chance({ ...base, size: 'small' }, 3));
    expect(chance({ ...base, size: 'small' }, 3)).toBeLessThan(chance({ ...base, size: 'medium' }, 3));
    expect(chance({ ...base, size: 'medium' }, 3)).toBeLessThan(chance({ ...base, size: 'large' }, 3));
  });
  it('a bloatfly point-blank is clearly harder than a medium target but still reasonable', () => {
    const c = chance(bloatfly(), 1);
    expect(c).toBeLessThan(chance(medium, 1) - 20);
    expect(c).toBeGreaterThanOrEqual(50);
  });
  it('speed counts the creature speed, not crippled legs', () => {
    const t = who({ speed: 24, size: 'medium' });
    for (const l of t.limbs) if (l.kind === 'leg') l.hp = 0;
    expect(targetEvasion(t)).toBe(-6);
  });
});

describe('where the bullet lands', () => {
  /** Perception 20 vs AC 0 clamps to 95%: nearly every roll is a hit, so the sample is large. */
  function stats(d: number, rolls = 6000) {
    const rng = createRNG(42);
    let hits = 0;
    let torso = 0;
    let head = 0;
    for (let i = 0; i < rolls; i++) {
      const r = resolveShot(rng, who({ perception: 20 }), who({ ac: 0 }), SHOT, d);
      if (!r.hit) continue;
      hits++;
      if (r.limb!.kind === 'torso') torso++;
      if (r.limb!.kind === 'head') head++;
    }
    return { torso: torso / hits, head: head / hits };
  }

  it('point blank leans on the torso; 3-4 cells is the best band for the head and limbs', () => {
    expect(stats(2).torso).toBeGreaterThan(stats(4).torso + 0.1);
    expect(stats(4).head).toBeGreaterThan(stats(2).head * 1.5);
  });

  it('5-6 cells is torso-leaning again, and beyond the range the spread bottoms out', () => {
    expect(stats(6).torso).toBeGreaterThan(stats(4).torso + 0.05);
    expect(stats(9, 20000).torso).toBeCloseTo(50 / 70, 1);
    expect(stats(30).torso).toBeCloseTo(stats(9, 20000).torso, 1);
  });

  it('the head can be hit at any range', () => {
    for (const d of [1, 4, 9]) expect(stats(d).head).toBeGreaterThan(0.03);
  });
});

describe('creatures shooting the player use the same curve', () => {
  it('hits the player at the formula chance at every range', () => {
    const player = createPlayer(0, 0);
    const trials = 4000;
    for (const d of [2, 6, 9]) {
      const rng = createRNG(100 + d);
      let n = 0;
      for (let i = 0; i < trials; i++) {
        player.hp = player.maxHp;
        if (resolveShot(rng, who({ perception: 6 }), player, SHOT, d).hit) n++;
      }
      const expected = chance(player, d);
      expect(Math.abs((n / trials) * 100 - expected)).toBeLessThan(3);
    }
  });
  it('a shooter with no Perception falls back to Agility on the same curve', () => {
    const rng = createRNG(5);
    const s = who({ agility: 6 });
    delete s.perception;
    let n = 0;
    for (let i = 0; i < 4000; i++) if (resolveShot(rng, s, who(), SHOT, 3).hit) n++;
    expect(Math.abs((n / 4000) * 100 - chance(medium, 3))).toBeLessThan(3);
  });
});

describe('hit chance table (Perception 6, 9mm pistol)', () => {
  it('stays inside 5..95 for every creature and distance', () => {
    for (const t of [gecko(), bloatfly(), radroach(), brahmin(), npc()]) {
      for (const d of [1, 4, 6, 8, 10]) {
        const c = chance(t, d);
        expect(c).toBeGreaterThanOrEqual(5);
        expect(c).toBeLessThanOrEqual(95);
      }
    }
  });
});
