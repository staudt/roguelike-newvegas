import type { AttackResult } from './CombatResolver';

/** Who is in the sentence. `you` has its own grammar; everyone else is a name plus a possessive. */
export interface Party {
  /** "you", "the gecko", "Sunny Smiles". */
  name: string;
  isPlayer: boolean;
  /** "your", "its", "her"… used for the weapon: "with your bare hands". */
  possessive: string;
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The log should always say what hit what, and with what:
 *   You hit the gecko in the left leg with your combat knife.
 *   The gecko hits you with its teeth.
 * A hit to the torso (or an animal's body) is the default and goes unsaid; any other limb is named.
 * Crippling and death get their own lines so they stand out in a scrolling log.
 */
export function narrateAttack(
  attacker: Party,
  defender: Party,
  weaponName: string,
  result: AttackResult,
  verbs: { hit: string; hits: string } = { hit: 'hit', hits: 'hits' },
): string[] {
  const weapon = `${attacker.possessive} ${weaponName}`;
  const lines: string[] = [];

  if (!result.hit) {
    lines.push(
      attacker.isPlayer
        ? `You miss ${defender.name} with ${weapon}.`
        : `${capitalize(attacker.name)} misses ${defender.name} with ${weapon}.`,
    );
    return lines;
  }

  const limb = result.limb!;
  const where = limb.kind === 'torso' ? '' : ` in the ${limb.name}`;
  lines.push(
    attacker.isPlayer
      ? `You ${verbs.hit} ${defender.name}${where} with ${weapon}.`
      : `${capitalize(attacker.name)} ${verbs.hits} ${defender.name}${where} with ${weapon}.`,
  );

  if (result.killed) {
    lines.push(defender.isPlayer ? 'You die...' : `${capitalize(defender.name)} dies!`);
    return lines;
  }

  if (result.limbBefore !== result.limbAfter && result.limbAfter !== 'ok') {
    const owner = defender.isPlayer ? 'Your' : `${capitalize(defender.name)}'s`;
    const verb = result.limbAfter === 'crippled' ? 'is crippled' : 'is hurt';
    lines.push(`${owner} ${limb.name} ${verb}!`);
  }

  return lines;
}

/**
 * Same lines for a bullet: "You shoot the gecko in the left leg with your 9mm pistol.",
 * "Ringo misses you with their 9mm pistol." (death and crippling lines are shared with melee).
 */
export function narrateShot(
  shooter: Party,
  target: Party,
  weaponName: string,
  result: AttackResult,
): string[] {
  return narrateAttack(shooter, target, weaponName, result, { hit: 'shoot', hits: 'shoots' });
}
