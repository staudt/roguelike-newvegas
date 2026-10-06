import { computeAC, computeMaxHP } from '../combat/CombatFormulas';
import type { Combatant } from '../combat/Combatant';
import { createLimbs } from '../combat/Limbs';
import { NORMAL_SPEED } from '../config/constants';
import { PALETTE } from '../config/palette';
import { createItem, type Item } from '../items/Item';
import type { Entity } from './Entity';

/** Fallout's seven attributes. Fixed for now; a character-creation screen comes later. */
export interface Special {
  strength: number;
  perception: number;
  endurance: number;
  charisma: number;
  intelligence: number;
  agility: number;
  luck: number;
}

export const STARTING_SPECIAL: Special = {
  strength: 5,
  perception: 6,
  endurance: 5,
  charisma: 5,
  intelligence: 6,
  agility: 7,
  luck: 5,
};

export interface Player extends Entity, Combatant {
  kind: 'player';
  name: string;
  special: Special;
  inventory: Item[];
  /** Id of the wielded item, or null for bare hands. */
  wielded: string | null;
}

export function createPlayer(x: number, y: number): Player {
  const special = { ...STARTING_SPECIAL };
  const maxHp = computeMaxHP(special.endurance);
  return {
    id: 'player',
    kind: 'player',
    glyph: '@',
    fg: PALETTE.playerFg,
    x,
    y,
    name: 'The Courier',
    special,
    hp: maxHp,
    maxHp,
    ac: computeAC(special.agility),
    agility: special.agility,
    strength: special.strength,
    speed: NORMAL_SPEED,
    energy: NORMAL_SPEED,
    limbs: createLimbs('humanoid', maxHp),
    inventory: [createItem('combat-knife'), createItem('baseball-bat')],
    wielded: null,
  };
}
