import type { AttackProfile, DamageRange, HitProfile } from '../combat/Combatant';

/**
 * Item definitions, data-driven like everything else.
 *
 * Kinds: a melee `weapon`; a `gun` (fires `ammo` of its `ammoType` along a straight line, and can
 * be used as a clumsy club); `armor` (worn on the body or head); `ammo` (stacks); a `consumable`
 * (stimpak); and `misc` (junk, quest items). Weapons, guns and armor wear out: each has a
 * `durability` (condition points when new, see items/Condition). `flags` hold rules that cut across kinds — an `undroppable` item (the Pip-Boy, later
 * quest items) refuses to be dropped; an instance may override its definition's flags.
 */
export interface ItemFlags {
  /** `d` refuses: "You can't let go of the Pip-Boy 3000." Also never sold or stolen. */
  undroppable?: boolean;
  /** Plot-relevant. Implies nothing by itself yet; quests will key off it. */
  quest?: boolean;
}

interface ItemDefBase {
  id: string;
  /** Singular display name without an article: "combat knife". */
  name: string;
  /** Plural for stacks: "9mm rounds". Defaults to name + "s". */
  plural?: string;
  glyph: string;
  fg: string;
  flags?: ItemFlags;
}

/** Things that wear out with use and break at 0 (see items/Condition). */
interface Durable {
  /** Condition points when new. Each shot or blow landed costs WEAR_PER_ATTACK; armor wears when hit. */
  durability: number;
}

export interface WeaponDef extends ItemDefBase, Durable {
  kind: 'weapon';
  /** What the weapon does in melee. `weaponName` is filled in from `name`. */
  attack: Omit<AttackProfile, 'weaponName'>;
}

/**
 * How a gun's accuracy changes with distance. A gun only declares its `effectiveRange`; the bands
 * that shape *where* a shot lands are the same proportions for every gun, as fractions of it (see
 * AIM_ZONES). A pistol with range 6 is torso-leaning at 1-2 cells, at its best for aimed shots at
 * 3-4, torso-leaning again at 5-6, and loses accuracy beyond.
 */
export interface ShotAccuracy {
  /** The gun's good range in cells. Past it the chance to hit falls off. */
  effectiveRange: number;
  /** To-hit bonus out to two thirds of effectiveRange (hard to miss)... */
  closeBonus: number;
  /** ...sliding to this bonus at effectiveRange. */
  effectiveBonus: number;
  /** Beyond effectiveRange the bonus drops by this many points per cell (can go negative). */
  falloffPerCell: number;
}

export interface ShotProfile {
  damage: DamageRange;
  accuracy: ShotAccuracy;
  accuracyBonus: number;
  /** Guns aim for the middle of a person; some weapons spread wider. */
  hitProfile: HitProfile;
  /** Multiplies the rolled damage: a worn gun hits softer. Absent means 1. */
  damageFactor?: number;
}

export interface GunDef extends ItemDefBase, Durable {
  kind: 'gun';
  /** Which ammunition it takes: ammo items with the same `ammoType`. */
  ammoType: string;
  /** How far a shot flies, in cells. */
  range: number;
  shot: ShotProfile;
  /** Hitting someone with the gun itself. */
  butt: Omit<AttackProfile, 'weaponName'>;
}

export type ArmorSlot = 'body' | 'head';

/** Where armor goes, in the order the game lists it. */
export const ARMOR_SLOTS: readonly ArmorSlot[] = ['body', 'head'];

/**
 * Clothing and armor, New Vegas style: Damage Threshold comes off every hit (never below
 * MIN_DAMAGE_FRACTION of it), summed over what you wear, and falls as the piece wears.
 */
export interface ArmorDef extends ItemDefBase, Durable {
  kind: 'armor';
  slot: ArmorSlot;
  /** Damage Threshold at full condition. */
  dt: number;
}

export interface AmmoDef extends ItemDefBase {
  kind: 'ammo';
  ammoType: string;
}

export interface ConsumableDef extends ItemDefBase {
  kind: 'consumable';
  /** Hit points restored. (Limbs need a doctor.) */
  heal: number;
}

export interface MiscDef extends ItemDefBase {
  kind: 'misc';
}

export type ItemDef = WeaponDef | GunDef | ArmorDef | AmmoDef | ConsumableDef | MiscDef;
export type DurableDef = WeaponDef | GunDef | ArmorDef;
export type ItemKind = ItemDef['kind'];

const ITEM_TABLE = {
  'combat-knife': {
    id: 'combat-knife',
    name: 'combat knife',
    glyph: ')',
    fg: '#b8c4cc',
    kind: 'weapon',
    durability: 120,
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
    fg: '#c9a46b',
    kind: 'weapon',
    durability: 100,
    attack: {
      damage: { min: 4, max: 8 },
      accuracyBonus: -5,
      // A wide swing: more likely to take a head off its shoulders than a knife is.
      hitProfile: { head: 22, torso: 40, arm: 20, leg: 18 },
      strengthBonus: true,
    },
  },
  '9mm-pistol': {
    id: '9mm-pistol',
    name: '9mm pistol',
    glyph: ')',
    fg: '#8fa0b0',
    kind: 'gun',
    durability: 150,
    ammoType: '9mm',
    range: 10,
    shot: {
      damage: { min: 4, max: 9 },
      accuracyBonus: 5,
      accuracy: {
        effectiveRange: 6,
        closeBonus: 35,
        effectiveBonus: 15,
        falloffPerCell: 8,
      },
      hitProfile: { head: 12, torso: 50, arm: 19, leg: 19 },
    },
    butt: {
      damage: { min: 1, max: 2 },
      accuracyBonus: -5,
      hitProfile: { head: 10, torso: 45, arm: 20, leg: 25 },
      strengthBonus: false,
    },
  },
  'kitchen-knife': {
    id: 'kitchen-knife',
    name: 'kitchen knife',
    glyph: ')',
    fg: '#c0c8cc',
    kind: 'weapon',
    durability: 60,
    attack: {
      damage: { min: 2, max: 4 },
      accuracyBonus: 5,
      hitProfile: { head: 8, torso: 44, arm: 24, leg: 24 },
      strengthBonus: true,
    },
  },
  'rolling-pin': {
    id: 'rolling-pin',
    name: 'rolling pin',
    glyph: ')',
    fg: '#c8a070',
    kind: 'weapon',
    durability: 80,
    attack: {
      damage: { min: 2, max: 5 },
      accuracyBonus: 0,
      hitProfile: { head: 20, torso: 45, arm: 18, leg: 17 },
      strengthBonus: true,
    },
  },
  'tire-iron': {
    id: 'tire-iron',
    name: 'tire iron',
    glyph: ')',
    fg: '#707880',
    kind: 'weapon',
    // Solid steel: it outlasts any bat.
    durability: 150,
    attack: {
      damage: { min: 3, max: 7 },
      accuracyBonus: 0,
      hitProfile: { head: 18, torso: 42, arm: 20, leg: 20 },
      strengthBonus: true,
    },
  },
  'varmint-rifle': {
    id: 'varmint-rifle',
    name: 'varmint rifle',
    glyph: ')',
    fg: '#7a6a50',
    kind: 'gun',
    durability: 120,
    ammoType: '5.56mm',
    // Long and accurate: clumsy up close, at its best at range.
    range: 16,
    shot: {
      damage: { min: 6, max: 12 },
      accuracyBonus: 10,
      accuracy: {
        effectiveRange: 10,
        closeBonus: 20,
        effectiveBonus: 25,
        falloffPerCell: 5,
      },
      hitProfile: { head: 14, torso: 50, arm: 18, leg: 18 },
    },
    butt: {
      damage: { min: 2, max: 4 },
      accuracyBonus: -5,
      hitProfile: { head: 10, torso: 45, arm: 20, leg: 25 },
      strengthBonus: false,
    },
  },
  '9mm-round': {
    id: '9mm-round',
    name: '9mm round',
    plural: '9mm rounds',
    glyph: ')',
    fg: '#d4a84a',
    kind: 'ammo',
    ammoType: '9mm',
  },
  '556-round': {
    id: '556-round',
    name: '5.56mm round',
    plural: '5.56mm rounds',
    glyph: ')',
    fg: '#c8b070',
    kind: 'ammo',
    ammoType: '5.56mm',
  },
  // Armor: NetHack's `[`. DT is New Vegas's scaled to this game's smaller damage numbers.
  'merc-outfit': {
    id: 'merc-outfit',
    name: 'merc outfit',
    glyph: '[',
    fg: '#8a7a56',
    kind: 'armor',
    slot: 'body',
    dt: 2,
    durability: 100,
  },
  'leather-armor': {
    id: 'leather-armor',
    name: 'leather armor',
    plural: 'leather armor',
    glyph: '[',
    fg: '#8a5a34',
    kind: 'armor',
    slot: 'body',
    dt: 3,
    durability: 150,
  },
  'cowboy-hat': {
    id: 'cowboy-hat',
    name: 'cowboy hat',
    glyph: '[',
    fg: '#a07040',
    kind: 'armor',
    slot: 'head',
    dt: 1,
    durability: 60,
  },
  'metal-helmet': {
    id: 'metal-helmet',
    name: 'metal helmet',
    glyph: '[',
    fg: '#9098a0',
    kind: 'armor',
    slot: 'head',
    dt: 2,
    durability: 120,
  },
  stimpak: {
    id: 'stimpak',
    name: 'stimpak',
    glyph: '!',
    fg: '#e05a5a',
    kind: 'consumable',
    heal: 25,
  },
  'pip-boy': {
    id: 'pip-boy',
    name: 'Pip-Boy 3000',
    glyph: '(',
    fg: '#7fd0ff',
    kind: 'misc',
    flags: { undroppable: true, quest: true },
  },
  'gecko-hide': {
    id: 'gecko-hide',
    name: 'gecko hide',
    glyph: '%',
    fg: '#7fbf5f',
    kind: 'misc',
  },
} satisfies Record<string, ItemDef>;

/** Every item id, checked at compile time wherever code names an item. */
export type ItemId = keyof typeof ITEM_TABLE;

/** The table, indexed by plain strings (map JSON is untyped). */
export const ITEMS: Record<string, ItemDef> = ITEM_TABLE;

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

/** What hitting someone with this item does. Only weapons and guns are meant to be wielded. */
export function attackProfileFor(def: ItemDef): AttackProfile {
  if (def.kind === 'weapon') return { ...def.attack, weaponName: def.name };
  if (def.kind === 'gun') return { ...def.butt, weaponName: def.name };
  return BARE_HANDS;
}

/** Does this wear out (weapons, guns, armor)? */
export function isDurable(def: ItemDef): def is DurableDef {
  return def.kind === 'weapon' || def.kind === 'gun' || def.kind === 'armor';
}

/** Can this be wielded (weapons and guns)? Ammo, stimpaks and junk cannot. */
export function isWieldable(def: ItemDef): boolean {
  return def.kind === 'weapon' || def.kind === 'gun';
}
