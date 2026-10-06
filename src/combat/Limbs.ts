/**
 * Limb damage — the groundwork for VATS-style targeting later. Every creature has a body plan: a
 * list of limbs, each with its own hit points. Every blow lands on one limb, hurting both that
 * limb and the creature's overall HP. A limb at half health is *hurt*, at zero it is *crippled*,
 * and what that costs depends on the limb's kind: legs slow you down, arms spoil your aim, a
 * crippled head rattles you.
 */
export type LimbKind = 'head' | 'torso' | 'arm' | 'leg';
export type LimbCondition = 'ok' | 'hurt' | 'crippled';

export interface Limb {
  id: string;
  name: string;
  kind: LimbKind;
  hp: number;
  maxHp: number;
}

interface LimbSpec {
  id: string;
  name: string;
  kind: LimbKind;
  /** Limb max HP as a fraction of the creature's max HP. */
  hpFraction: number;
}

export type BodyPlanId = 'humanoid' | 'quadruped' | 'insect';

export const BODY_PLANS: Record<BodyPlanId, readonly LimbSpec[]> = {
  humanoid: [
    { id: 'head', name: 'head', kind: 'head', hpFraction: 0.4 },
    { id: 'torso', name: 'torso', kind: 'torso', hpFraction: 1 },
    { id: 'left-arm', name: 'left arm', kind: 'arm', hpFraction: 0.5 },
    { id: 'right-arm', name: 'right arm', kind: 'arm', hpFraction: 0.5 },
    { id: 'left-leg', name: 'left leg', kind: 'leg', hpFraction: 0.5 },
    { id: 'right-leg', name: 'right leg', kind: 'leg', hpFraction: 0.5 },
  ],
  quadruped: [
    { id: 'head', name: 'head', kind: 'head', hpFraction: 0.4 },
    { id: 'torso', name: 'body', kind: 'torso', hpFraction: 1 },
    { id: 'front-left-leg', name: 'front left leg', kind: 'leg', hpFraction: 0.4 },
    { id: 'front-right-leg', name: 'front right leg', kind: 'leg', hpFraction: 0.4 },
    { id: 'hind-left-leg', name: 'hind left leg', kind: 'leg', hpFraction: 0.4 },
    { id: 'hind-right-leg', name: 'hind right leg', kind: 'leg', hpFraction: 0.4 },
  ],
  insect: [
    { id: 'head', name: 'head', kind: 'head', hpFraction: 0.4 },
    { id: 'torso', name: 'body', kind: 'torso', hpFraction: 1 },
    { id: 'left-wing', name: 'left wing', kind: 'leg', hpFraction: 0.5 },
    { id: 'right-wing', name: 'right wing', kind: 'leg', hpFraction: 0.5 },
  ],
};

export function createLimbs(plan: BodyPlanId, maxHp: number): Limb[] {
  return BODY_PLANS[plan].map((spec) => {
    const limbMax = Math.max(1, Math.round(maxHp * spec.hpFraction));
    return { id: spec.id, name: spec.name, kind: spec.kind, hp: limbMax, maxHp: limbMax };
  });
}

export function limbCondition(limb: Limb): LimbCondition {
  if (limb.hp <= 0) return 'crippled';
  if (limb.hp <= limb.maxHp / 2) return 'hurt';
  return 'ok';
}

/** Fully restores every limb (Doc Mitchell's Heal). */
export function healLimbs(limbs: Limb[]): void {
  for (const limb of limbs) limb.hp = limb.maxHp;
}

const MIN_SPEED_FACTOR = 0.25;

/**
 * How much walking ability is left, 1 = full. Counts every `leg`-kind limb, so a two-legged
 * creature with one crippled leg moves at ~two-thirds speed, and one with both crippled crawls.
 */
export function legSpeedFactor(limbs: readonly Limb[]): number {
  const legs = limbs.filter((l) => l.kind === 'leg');
  if (legs.length === 0) return 1;
  const crippled = legs.filter((l) => limbCondition(l) === 'crippled').length / legs.length;
  const hurt = legs.filter((l) => limbCondition(l) === 'hurt').length / legs.length;
  return Math.max(MIN_SPEED_FACTOR, 1 - 0.65 * crippled - 0.25 * hurt);
}

/** To-hit penalty (in percentage points) from damaged arms and head. */
export function limbAccuracyPenalty(limbs: readonly Limb[]): number {
  let penalty = 0;
  for (const limb of limbs) {
    const condition = limbCondition(limb);
    if (limb.kind === 'arm') penalty += condition === 'crippled' ? 15 : condition === 'hurt' ? 5 : 0;
    if (limb.kind === 'head') penalty += condition === 'crippled' ? 15 : condition === 'hurt' ? 5 : 0;
  }
  return penalty;
}
