import type { AttackProfile } from '../combat/Combatant';
import { armorDT, damageFactor, isBroken } from './Condition';
import { itemCount, type Item } from './Item';
import { attackProfileFor, isWieldable, itemDef, type ArmorSlot, type GunDef } from './ItemData';
import type { Carrier } from './Loadout';

/** Pure helpers over anything that carries things (player, NPC, monster), shared with the UI. */

export function findItem(c: Carrier, itemId: string | null): Item | null {
  if (itemId === null) return null;
  return c.inventory.find((i) => i.id === itemId) ?? null;
}

export function wieldedItem(c: Carrier): Item | null {
  return findItem(c, c.wielded);
}

export function wieldedGun(c: Carrier): GunDef | null {
  const item = wieldedItem(c);
  if (!item) return null;
  const def = itemDef(item.defId);
  return def.kind === 'gun' ? def : null;
}

/** What hitting someone with the wielded item does (softer when it is worn); null when nothing wieldable is wielded. */
export function wieldedAttackProfile(c: Carrier): AttackProfile | null {
  const item = wieldedItem(c);
  if (!item) return null;
  const def = itemDef(item.defId);
  if (!isWieldable(def)) return null;
  const factor = damageFactor(item);
  return factor < 1 ? { ...attackProfileFor(def), damageFactor: factor } : attackProfileFor(def);
}

/** The armor worn, in pack order. */
export function wornItems(c: Carrier): Item[] {
  return c.inventory.filter((i) => c.worn.includes(i.id));
}

/** The armor worn on `slot`, if any. */
export function wornIn(c: Carrier, slot: ArmorSlot): Item | null {
  return wornItems(c).find((i) => {
    const def = itemDef(i.defId);
    return def.kind === 'armor' && def.slot === slot;
  }) ?? null;
}

/** Damage Threshold from everything worn (each piece by its condition), plus any natural hide. */
export function damageThreshold(c: Carrier & { naturalDT?: number }): number {
  let dt = c.naturalDT ?? 0;
  for (const item of wornItems(c)) dt += armorDT(item);
  return dt;
}

/** Usable: not broken. A broken weapon can't be wielded and broken armor can't be worn. */
export function isUsable(item: Item): boolean {
  return !isBroken(item);
}

export function readiedStack(c: Carrier): Item | null {
  const item = findItem(c, c.readied);
  return item && itemDef(item.defId).kind === 'ammo' ? item : null;
}

export function readiedAmmoCount(c: Carrier): number {
  const stack = readiedStack(c);
  return stack ? itemCount(stack) : 0;
}

export type FireCheck =
  | { ok: true; gun: GunDef; ammo: Item }
  | { ok: false; reason: string };

/** Can this carrier fire right now? If not, why (as the message the player sees). */
export function canFire(c: Carrier): FireCheck {
  const gun = wieldedGun(c);
  if (!gun) return { ok: false, reason: 'You have no gun wielded.' };

  if (c.readied === null) {
    const fitting = c.inventory.some((i) => {
      const def = itemDef(i.defId);
      return def.kind === 'ammo' && def.ammoType === gun.ammoType && itemCount(i) > 0;
    });
    return {
      ok: false,
      reason: fitting
        ? 'You have no ammunition readied. (Press Q.)'
        : `You have no ammunition for the ${gun.name}.`,
    };
  }

  const ammo = readiedStack(c);
  if (!ammo) return { ok: false, reason: `You are out of ${ammoName(gun.ammoType)} rounds.` };

  const ammoDef = itemDef(ammo.defId);
  if (ammoDef.kind !== 'ammo' || ammoDef.ammoType !== gun.ammoType) {
    return {
      ok: false,
      reason: `Your ${gun.name} takes ${ammoName(gun.ammoType)} rounds, not ${ammoDef.plural ?? `${ammoDef.name}s`}.`,
    };
  }
  return { ok: true, gun, ammo };
}

/** "9mm" for the ammo type, which doubles as the display prefix. */
function ammoName(ammoType: string): string {
  return ammoType;
}

/** Spends one round from the readied stack; an emptied stack leaves the pack and the quiver. */
export function consumeRound(c: Carrier): void {
  const stack = readiedStack(c);
  if (!stack) return;
  const left = itemCount(stack) - 1;
  if (left > 0) {
    stack.count = left;
    return;
  }
  c.inventory.splice(c.inventory.indexOf(stack), 1);
  c.readied = null;
}

/** A carrier loses an item from hands, quiver and body when it leaves the pack (or breaks). */
export function clearSlotsFor(c: Carrier, item: Item): void {
  if (c.wielded === item.id) c.wielded = null;
  if (c.readied === item.id) c.readied = null;
  if (c.alternate === item.id) c.alternate = null;
  c.worn = c.worn.filter((id) => id !== item.id);
}
