import type { AttackProfile } from '../combat/Combatant';

/**
 * Item definitions, data-driven like everything else. For now only melee weapons exist; guns,
 * ammunition and consumables land with the next milestone (`f` fire needs a wielded gun plus
 * readied ammo, per the design).
 */
export interface ItemDef {
  id: string;
  /** Display name without an article: "combat knife". */
  name: string;
  glyph: string;
  kind: 'weapon';
  /** What the weapon does when used in melee. `weaponName` is filled in from `name`. */
  attack: Omit<AttackProfile, 'weaponName'>;
}

export const ITEMS: Record<string, ItemDef> = {
  'combat-knife': {
    id: 'combat-knife',
    name: 'combat knife',
    glyph: ')',
    kind: 'weapon',
    attack: {
      damage: { min: 3, max: 6 },
      accuracyBonus: 5,
      // A blade finds the middle of a person and the limbs they flail with.
      hitProfile: { head: 8, torso: 44, arm: 24, leg: 24 },
      strengthBonus: true,
    },
  },
  'baseball-bat': {
    id: 'baseball-bat',
    name: 'baseball bat',
    glyph: ')',
    kind: 'weapon',
    attack: {
      damage: { min: 4, max: 8 },
      accuracyBonus: -5,
      // A wide swing: more likely to take a head off its shoulders than a knife is.
      hitProfile: { head: 22, torso: 40, arm: 20, leg: 18 },
      strengthBonus: true,
    },
  },
};

/** Bare hands: weak, but they are always there. */
export const BARE_HANDS: AttackProfile = {
  weaponName: 'bare hands',
  damage: { min: 1, max: 3 },
  accuracyBonus: 0,
  hitProfile: { head: 10, torso: 45, arm: 20, leg: 25 },
  strengthBonus: true,
};

export function itemDef(defId: string): ItemDef {
  const def = ITEMS[defId];
  if (!def) throw new Error(`Unknown item "${defId}"`);
  return def;
}

export function attackProfileFor(def: ItemDef): AttackProfile {
  return { ...def.attack, weaponName: def.name };
}
