import { describe, expect, it } from 'vitest';
import { computeToHit, strengthDamageBonus } from '../src/combat/CombatFormulas';
import type { AttackProfile, Combatant, HitProfile } from '../src/combat/Combatant';
import { pickLimb, resolveMelee } from '../src/combat/CombatResolver';
import { createLimbs, type BodyPlanId, type LimbKind } from '../src/combat/Limbs';
import { attackProfileFor, BARE_HANDS, itemDef } from '../src/items/ItemData';
import { createRNG } from '../src/utils/RNG';
import { scriptedRNG } from './helpers/fixtures';

function makeCombatant(overrides: Partial<Combatant> = {}, plan: BodyPlanId = 'humanoid'): Combatant {
  const maxHp = overrides.maxHp ?? 40;
  return {
    hp: maxHp,
    maxHp,
    ac: 5,
    agility: 5,
    strength: 5,
    speed: 12,
    energy: 12,
    limbs: createLimbs(plan, maxHp),
    ...overrides,
  };
}

/** A profile that can only ever strike one kind of limb. */
function only(kind: LimbKind): HitProfile {
  return { head: 0, torso: 0, arm: 0, leg: 0, [kind]: 1 };
}

function attackOf(overrides: Partial<AttackProfile> = {}): AttackProfile {
  return {
    weaponName: 'test stick',
    damage: { min: 3, max: 3 },
    accuracyBonus: 0,
    hitProfile: only('torso'),
    strengthBonus: false,
    ...overrides,
  };
}

describe('computeToHit', () => {
  it('follows 50 + (agility-5)*5 + accuracy - limbPenalty - AC*2', () => {
    expect(computeToHit(5, 0, 0, 5)).toBe(40);
    expect(computeToHit(7, 5, 0, 5)).toBe(55);
    expect(computeToHit(7, 5, 10, 5)).toBe(45);
    expect(computeToHit(5, 0, 0, 10)).toBe(30);
  });

  it('is clamped to at most 95', () => {
    expect(computeToHit(20, 50, 0, 0)).toBe(95);
  });

  it('is clamped to at least 5', () => {
    expect(computeToHit(1, -50, 30, 20)).toBe(5);
  });
});

describe('strengthDamageBonus', () => {
  it('is floor((strength - 3) / 2), never negative', () => {
    expect(strengthDamageBonus(1)).toBe(0);
    expect(strengthDamageBonus(3)).toBe(0);
    expect(strengthDamageBonus(5)).toBe(1);
    expect(strengthDamageBonus(7)).toBe(2);
    expect(strengthDamageBonus(10)).toBe(3);
  });
});

describe('resolveMelee — hit and miss', () => {
  it('a forced miss changes no state and consumes only the to-hit roll', () => {
    const attacker = makeCombatant();
    const defender = makeCombatant();
    const before = JSON.stringify(defender);
    const rng = scriptedRNG([0.999]);

    const result = resolveMelee(rng, attacker, defender, attackOf());

    expect(result).toEqual({
      hit: false,
      damage: 0,
      limb: null,
      limbBefore: null,
      limbAfter: null,
      killed: false,
      absorbed: 0,
    });
    expect(JSON.stringify(defender)).toBe(before);
    expect(rng.consumed).toBe(1);
  });

  it('a forced hit damages BOTH the defender HP and the struck limb', () => {
    const attacker = makeCombatant();
    const defender = makeCombatant();
    const rng = scriptedRNG([0, 0.5, 0.5]);

    const result = resolveMelee(rng, attacker, defender, attackOf({ damage: { min: 3, max: 3 } }));

    expect(result.hit).toBe(true);
    expect(result.damage).toBe(3);
    expect(result.limb?.kind).toBe('torso');
    expect(defender.hp).toBe(37);
    const torso = defender.limbs.find((l) => l.id === 'torso')!;
    expect(torso.hp).toBe(37);
    // Every other limb is untouched.
    expect(defender.limbs.filter((l) => l !== torso).every((l) => l.hp === l.maxHp)).toBe(true);
    expect(rng.consumed).toBe(3);
  });

  it('the to-hit threshold is inclusive: rolling exactly the chance hits, one above misses', () => {
    // agility 5, AC 5 => 40%. Raw roll 0.39 => d100 = 40 (hit); 0.40 => 41 (miss).
    const hit = resolveMelee(scriptedRNG([0.39, 0, 0]), makeCombatant(), makeCombatant(), attackOf());
    const miss = resolveMelee(scriptedRNG([0.4]), makeCombatant(), makeCombatant(), attackOf());
    expect(hit.hit).toBe(true);
    expect(miss.hit).toBe(false);
  });

  it('even a hopeless attacker can hit on a natural 1, and a perfect one can miss on a 100', () => {
    const hopeless = makeCombatant({ agility: 1 });
    const tank = makeCombatant({ ac: 40 });
    expect(resolveMelee(scriptedRNG([0, 0, 0]), hopeless, tank, attackOf()).hit).toBe(true);

    const ace = makeCombatant({ agility: 20 });
    expect(resolveMelee(scriptedRNG([0.999]), ace, makeCombatant({ ac: 0 }), attackOf()).hit).toBe(false);
  });

  it('crippled attacker arms reduce the hit chance', () => {
    // 40% base; two crippled arms => 10%. Roll 0.2 (d100 = 21) hits normally but misses crippled.
    const healthy = makeCombatant();
    const maimed = makeCombatant();
    for (const l of maimed.limbs) if (l.kind === 'arm') l.hp = 0;

    expect(resolveMelee(scriptedRNG([0.2, 0, 0]), healthy, makeCombatant(), attackOf()).hit).toBe(true);
    expect(resolveMelee(scriptedRNG([0.2]), maimed, makeCombatant(), attackOf()).hit).toBe(false);
  });
});

describe('resolveMelee — damage', () => {
  it('rolls damage in [min, max] inclusive', () => {
    const attack = attackOf({ damage: { min: 2, max: 5 } });
    const low = resolveMelee(scriptedRNG([0, 0, 0]), makeCombatant(), makeCombatant(), attack);
    const high = resolveMelee(scriptedRNG([0, 0, 0.9999]), makeCombatant(), makeCombatant(), attack);
    expect(low.damage).toBe(2);
    expect(high.damage).toBe(5);
  });

  it('adds the strength bonus only when strengthBonus is true', () => {
    const strong = makeCombatant({ strength: 9 }); // +3
    const withBonus = resolveMelee(
      scriptedRNG([0, 0, 0]),
      strong,
      makeCombatant(),
      attackOf({ strengthBonus: true }),
    );
    const without = resolveMelee(
      scriptedRNG([0, 0, 0]),
      strong,
      makeCombatant(),
      attackOf({ strengthBonus: false }),
    );
    expect(withBonus.damage).toBe(3 + 3);
    expect(without.damage).toBe(3);
  });

  it('head hits deal x1.5, rounded', () => {
    const attack = attackOf({ damage: { min: 3, max: 3 }, hitProfile: only('head') });
    const defender = makeCombatant();
    const result = resolveMelee(scriptedRNG([0, 0.5, 0]), makeCombatant(), defender, attack);
    expect(result.limb?.kind).toBe('head');
    expect(result.damage).toBe(5); // 4.5 rounds up
    expect(defender.hp).toBe(35);
    expect(defender.limbs.find((l) => l.kind === 'head')!.hp).toBe(16 - 5);

    const even = resolveMelee(
      scriptedRNG([0, 0.5, 0]),
      makeCombatant(),
      makeCombatant(),
      attackOf({ damage: { min: 4, max: 4 }, hitProfile: only('head') }),
    );
    expect(even.damage).toBe(6);
  });

  it('the strength bonus is added before the head multiplier', () => {
    const attack = attackOf({ damage: { min: 2, max: 2 }, hitProfile: only('head'), strengthBonus: true });
    const result = resolveMelee(scriptedRNG([0, 0.5, 0]), makeCombatant({ strength: 5 }), makeCombatant(), attack);
    expect(result.damage).toBe(Math.round((2 + 1) * 1.5)); // 5
  });

  it('non-head hits are not multiplied', () => {
    const result = resolveMelee(
      scriptedRNG([0, 0.5, 0]),
      makeCombatant(),
      makeCombatant(),
      attackOf({ damage: { min: 4, max: 4 }, hitProfile: only('leg') }),
    );
    expect(result.damage).toBe(4);
  });

  it('a hit always does at least 1 damage', () => {
    const result = resolveMelee(
      scriptedRNG([0, 0.5, 0]),
      makeCombatant(),
      makeCombatant(),
      attackOf({ damage: { min: 0, max: 0 }, hitProfile: only('head') }),
    );
    expect(result.hit).toBe(true);
    expect(result.damage).toBe(1);
  });

  it('limb HP never goes below 0 even when the blow overkills the limb', () => {
    const defender = makeCombatant({ maxHp: 100 });
    const arm = defender.limbs.find((l) => l.kind === 'arm')!;
    arm.hp = 2;
    const result = resolveMelee(
      scriptedRNG([0, 0.2, 0]),
      makeCombatant(),
      defender,
      attackOf({ damage: { min: 9, max: 9 }, hitProfile: only('arm') }),
    );
    expect(result.limb).toBe(arm);
    expect(arm.hp).toBe(0);
    expect(defender.hp).toBe(91); // the creature still takes the full blow
  });
});

describe('resolveMelee — kills and limb transitions', () => {
  it('killed is true when HP reaches 0 exactly, and when it goes below', () => {
    const exact = makeCombatant({ hp: 3 });
    expect(resolveMelee(scriptedRNG([0, 0.5, 0]), makeCombatant(), exact, attackOf()).killed).toBe(true);
    expect(exact.hp).toBe(0);

    const over = makeCombatant({ hp: 1 });
    expect(resolveMelee(scriptedRNG([0, 0.5, 0]), makeCombatant(), over, attackOf()).killed).toBe(true);
    expect(over.hp).toBeLessThan(0);

    const alive = makeCombatant({ hp: 4 });
    expect(resolveMelee(scriptedRNG([0, 0.5, 0]), makeCombatant(), alive, attackOf()).killed).toBe(false);
  });

  it('reports ok -> hurt -> crippled across successive blows to the same limb', () => {
    const defender = makeCombatant({ maxHp: 40 });
    const leg = defender.limbs.find((l) => l.id === 'left-leg')!; // 20 HP
    expect(leg.maxHp).toBe(20);
    // Weight is split across two legs, so a low roll hits the left leg first.
    const attack = attackOf({ damage: { min: 10, max: 10 }, hitProfile: only('leg') });

    const first = resolveMelee(scriptedRNG([0, 0, 0]), makeCombatant(), defender, attack);
    expect(first.limb).toBe(leg);
    expect([first.limbBefore, first.limbAfter]).toEqual(['ok', 'hurt']);
    expect(leg.hp).toBe(10);

    const second = resolveMelee(scriptedRNG([0, 0, 0]), makeCombatant(), defender, attack);
    expect([second.limbBefore, second.limbAfter]).toEqual(['hurt', 'crippled']);
    expect(leg.hp).toBe(0);

    const third = resolveMelee(scriptedRNG([0, 0, 0]), makeCombatant(), defender, attack);
    expect([third.limbBefore, third.limbAfter]).toEqual(['crippled', 'crippled']);
  });

  it('a blow that stays above half leaves the limb ok -> ok', () => {
    const defender = makeCombatant({ maxHp: 40 });
    const result = resolveMelee(
      scriptedRNG([0, 0.5, 0]),
      makeCombatant(),
      defender,
      attackOf({ damage: { min: 1, max: 1 }, hitProfile: only('torso') }),
    );
    expect([result.limbBefore, result.limbAfter]).toEqual(['ok', 'ok']);
  });
});

describe('pickLimb', () => {
  function tally(plan: BodyPlanId, maxHp: number, attack: AttackProfile, n: number, seed: number) {
    const rng = createRNG(seed);
    const counts: Record<LimbKind, number> = { head: 0, torso: 0, arm: 0, leg: 0 };
    const defender = makeCombatant({ maxHp }, plan);
    for (let i = 0; i < n; i++) counts[pickLimb(rng, defender, attack).kind]++;
    return counts;
  }

  const knife = attackProfileFor(itemDef('combat-knife'));
  const bat = attackProfileFor(itemDef('baseball-bat'));

  it('a bat hits the head more often than a knife does', () => {
    const n = 5000;
    const knifeCounts = tally('humanoid', 40, knife, n, 11);
    const batCounts = tally('humanoid', 40, bat, n, 11);
    expect(batCounts.head).toBeGreaterThan(knifeCounts.head);
    // And roughly in line with the declared weights (22% vs 8%).
    expect(batCounts.head / n).toBeGreaterThan(0.18);
    expect(batCounts.head / n).toBeLessThan(0.26);
    expect(knifeCounts.head / n).toBeGreaterThan(0.05);
    expect(knifeCounts.head / n).toBeLessThan(0.11);
  });

  it('never selects a kind whose weight is 0 (humanoid, arm: 0)', () => {
    const noArms = attackOf({ hitProfile: { head: 10, torso: 45, arm: 0, leg: 25 } });
    const counts = tally('humanoid', 40, noArms, 5000, 3);
    expect(counts.arm).toBe(0);
    expect(counts.head + counts.torso + counts.leg).toBe(5000);
  });

  it('a gecko-style profile (arm: 0) on a quadruped still only picks real limbs', () => {
    const gecko = attackOf({ hitProfile: { head: 15, torso: 45, arm: 0, leg: 40 } });
    const counts = tally('quadruped', 12, gecko, 5000, 4);
    expect(counts.arm).toBe(0);
    expect(counts.leg / 5000).toBeGreaterThan(0.35);
    expect(counts.leg / 5000).toBeLessThan(0.45);
  });

  it('splits a kind\'s weight evenly across its limbs', () => {
    const rng = createRNG(5);
    const defender = makeCombatant({ maxHp: 40 });
    const attack = attackOf({ hitProfile: only('arm') });
    const ids = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      const id = pickLimb(rng, defender, attack).id;
      ids.set(id, (ids.get(id) ?? 0) + 1);
    }
    expect([...ids.keys()].sort()).toEqual(['left-arm', 'right-arm']);
    expect(ids.get('left-arm')! / 4000).toBeGreaterThan(0.45);
    expect(ids.get('left-arm')! / 4000).toBeLessThan(0.55);
  });

  it('four quadruped legs each get a quarter of the leg weight', () => {
    const rng = createRNG(6);
    const defender = makeCombatant({ maxHp: 12 }, 'quadruped');
    const attack = attackOf({ hitProfile: only('leg') });
    const ids = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      const id = pickLimb(rng, defender, attack).id;
      ids.set(id, (ids.get(id) ?? 0) + 1);
    }
    expect(ids.size).toBe(4);
    for (const count of ids.values()) {
      expect(count / 4000).toBeGreaterThan(0.2);
      expect(count / 4000).toBeLessThan(0.3);
    }
  });

  it('bare hands profile never targets a missing arm kind on an insect', () => {
    const counts = tally('insect', 5, BARE_HANDS, 3000, 8);
    expect(counts.arm).toBe(0);
  });
});
