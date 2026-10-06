import { describe, expect, it } from 'vitest';
import {
  createLimbs,
  healLimbs,
  legSpeedFactor,
  limbAccuracyPenalty,
  limbCondition,
  type Limb,
} from '../src/combat/Limbs';

function find(limbs: Limb[], id: string): Limb {
  return limbs.find((l) => l.id === id)!;
}

function cripple(limbs: Limb[], ...ids: string[]): void {
  for (const id of ids) find(limbs, id).hp = 0;
}

describe('createLimbs', () => {
  it('humanoid: head 40%, torso 100%, arms and legs 50% of max HP', () => {
    const limbs = createLimbs('humanoid', 40);
    const byId = Object.fromEntries(limbs.map((l) => [l.id, l.maxHp]));
    expect(byId).toEqual({
      head: 16,
      torso: 40,
      'left-arm': 20,
      'right-arm': 20,
      'left-leg': 20,
      'right-leg': 20,
    });
    expect(limbs.every((l) => l.hp === l.maxHp)).toBe(true);
  });

  it('quadruped: head 40%, body 100%, four legs at 40% (rounded)', () => {
    const limbs = createLimbs('quadruped', 12);
    expect(limbs.map((l) => [l.id, l.maxHp])).toEqual([
      ['head', 5],
      ['torso', 12],
      ['front-left-leg', 5],
      ['front-right-leg', 5],
      ['hind-left-leg', 5],
      ['hind-right-leg', 5],
    ]);
    expect(limbs.filter((l) => l.kind === 'arm')).toHaveLength(0);
    expect(limbs.filter((l) => l.kind === 'leg')).toHaveLength(4);
  });

  it('insect: head, body, and two wings that count as legs', () => {
    const limbs = createLimbs('insect', 5);
    expect(limbs.map((l) => [l.id, l.kind, l.maxHp])).toEqual([
      ['head', 'head', 2],
      ['torso', 'torso', 5],
      ['left-wing', 'leg', 3],
      ['right-wing', 'leg', 3],
    ]);
  });

  it('every limb has at least 1 HP even for a tiny creature', () => {
    for (const limbs of [createLimbs('humanoid', 1), createLimbs('insect', 1), createLimbs('quadruped', 1)]) {
      expect(limbs.every((l) => l.maxHp >= 1)).toBe(true);
    }
  });

  it('names the torso "body" for animals and "torso" for people', () => {
    expect(find(createLimbs('quadruped', 12), 'torso').name).toBe('body');
    expect(find(createLimbs('humanoid', 12), 'torso').name).toBe('torso');
  });
});

describe('limbCondition', () => {
  const mk = (hp: number, maxHp: number): Limb => ({ id: 'x', name: 'x', kind: 'arm', hp, maxHp });

  it('is ok above 50%, hurt at or below 50%, crippled only at zero', () => {
    expect(limbCondition(mk(20, 20))).toBe('ok');
    expect(limbCondition(mk(11, 20))).toBe('ok');
    expect(limbCondition(mk(10, 20))).toBe('hurt'); // exactly half is hurt
    expect(limbCondition(mk(1, 20))).toBe('hurt');
    expect(limbCondition(mk(0, 20))).toBe('crippled');
  });

  it('handles odd max HP (half is fractional)', () => {
    expect(limbCondition(mk(3, 5))).toBe('ok');
    expect(limbCondition(mk(2, 5))).toBe('hurt');
  });

  it('treats negative HP as crippled', () => {
    expect(limbCondition(mk(-3, 5))).toBe('crippled');
  });
});

describe('legSpeedFactor', () => {
  it('is 1 with every leg ok', () => {
    expect(legSpeedFactor(createLimbs('humanoid', 40))).toBe(1);
  });

  it('is 1 when there are no legs at all', () => {
    expect(legSpeedFactor([])).toBe(1);
  });

  it('one of two legs crippled is 0.675', () => {
    const limbs = createLimbs('humanoid', 40);
    cripple(limbs, 'left-leg');
    expect(legSpeedFactor(limbs)).toBeCloseTo(0.675, 10);
  });

  it('both legs crippled is 0.35 (the 0.25 floor is not reached by crippling alone)', () => {
    const limbs = createLimbs('humanoid', 40);
    cripple(limbs, 'left-leg', 'right-leg');
    expect(legSpeedFactor(limbs)).toBeCloseTo(0.35, 10);
  });

  it('never drops below the 0.25 floor, whatever the limb state', () => {
    const limbs = createLimbs('humanoid', 40);
    cripple(limbs, 'left-leg', 'right-leg', 'head', 'torso', 'left-arm', 'right-arm');
    expect(legSpeedFactor(limbs)).toBeGreaterThanOrEqual(0.25);
  });

  it('hurt legs cost 0.25 each, proportionally', () => {
    const limbs = createLimbs('humanoid', 40);
    find(limbs, 'left-leg').hp = 10;
    expect(legSpeedFactor(limbs)).toBeCloseTo(0.875, 10);
    find(limbs, 'right-leg').hp = 10;
    expect(legSpeedFactor(limbs)).toBeCloseTo(0.75, 10);
  });

  it('one crippled leg and one hurt leg combine', () => {
    const limbs = createLimbs('humanoid', 40);
    cripple(limbs, 'left-leg');
    find(limbs, 'right-leg').hp = 5;
    expect(legSpeedFactor(limbs)).toBeCloseTo(1 - 0.325 - 0.125, 10);
  });

  it('quadruped with one of four legs crippled keeps most of its speed', () => {
    const limbs = createLimbs('quadruped', 12);
    cripple(limbs, 'front-left-leg');
    expect(legSpeedFactor(limbs)).toBeCloseTo(1 - 0.65 / 4, 10);
  });

  it('quadruped with all legs crippled is 0.35', () => {
    const limbs = createLimbs('quadruped', 12);
    cripple(limbs, 'front-left-leg', 'front-right-leg', 'hind-left-leg', 'hind-right-leg');
    expect(legSpeedFactor(limbs)).toBeCloseTo(0.35, 10);
  });

  it('insect wings count as legs', () => {
    const limbs = createLimbs('insect', 5);
    cripple(limbs, 'left-wing');
    expect(legSpeedFactor(limbs)).toBeCloseTo(0.675, 10);
  });

  it('ignores arm, head and torso damage', () => {
    const limbs = createLimbs('humanoid', 40);
    cripple(limbs, 'head', 'torso', 'left-arm', 'right-arm');
    expect(legSpeedFactor(limbs)).toBe(1);
  });
});

describe('limbAccuracyPenalty', () => {
  it('is 0 for an undamaged body', () => {
    expect(limbAccuracyPenalty(createLimbs('humanoid', 40))).toBe(0);
  });

  it('a hurt arm costs 5, a crippled arm 15', () => {
    const limbs = createLimbs('humanoid', 40);
    find(limbs, 'left-arm').hp = 10;
    expect(limbAccuracyPenalty(limbs)).toBe(5);
    cripple(limbs, 'left-arm');
    expect(limbAccuracyPenalty(limbs)).toBe(15);
  });

  it('both arms crippled stack to 30', () => {
    const limbs = createLimbs('humanoid', 40);
    cripple(limbs, 'left-arm', 'right-arm');
    expect(limbAccuracyPenalty(limbs)).toBe(30);
  });

  it('a hurt head costs 5 and a crippled head 15', () => {
    const limbs = createLimbs('humanoid', 40);
    find(limbs, 'head').hp = 8;
    expect(limbAccuracyPenalty(limbs)).toBe(5);
    cripple(limbs, 'head');
    expect(limbAccuracyPenalty(limbs)).toBe(15);
  });

  it('arms and head add together', () => {
    const limbs = createLimbs('humanoid', 40);
    cripple(limbs, 'head', 'left-arm');
    find(limbs, 'right-arm').hp = 10;
    expect(limbAccuracyPenalty(limbs)).toBe(35);
  });

  it('legs and torso do not affect aim', () => {
    const limbs = createLimbs('humanoid', 40);
    cripple(limbs, 'left-leg', 'right-leg', 'torso');
    expect(limbAccuracyPenalty(limbs)).toBe(0);
  });

  it('a quadruped (no arms) only suffers from its head', () => {
    const limbs = createLimbs('quadruped', 12);
    cripple(limbs, 'front-left-leg', 'head');
    expect(limbAccuracyPenalty(limbs)).toBe(15);
  });
});

describe('healLimbs', () => {
  it('restores every limb to full', () => {
    const limbs = createLimbs('humanoid', 40);
    cripple(limbs, 'left-leg', 'head');
    find(limbs, 'torso').hp = 3;
    healLimbs(limbs);
    expect(limbs.every((l) => l.hp === l.maxHp)).toBe(true);
    expect(legSpeedFactor(limbs)).toBe(1);
  });
});
