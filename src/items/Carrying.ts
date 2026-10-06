import type { AttackProfile } from '../combat/Combatant';
import { itemCount, type Item } from './Item';
import { attackProfileFor, isWieldable, itemDef, type GunDef } from './ItemData';
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

/** What hitting someone with the wielded item does; null when nothing wieldable is wielded. */
export function wieldedAttackProfile(c: Carrier): AttackProfile | null {
  const item = wieldedItem(c);
  if (!item) return null;
  const def = itemDef(item.defId);
  return isWieldable(def) ? attackProfileFor(def) : null;
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
    const anyAmmo = c.inventory.some((i) => itemDef(i.defId).kind === 'ammo');
    return {
      ok: false,
      reason: anyAmmo
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

/** A carrier loses an item from hands and quiver when it leaves the pack. */
export function clearSlotsFor(c: Carrier, item: Item): void {
  if (c.wielded === item.id) c.wielded = null;
  if (c.readied === item.id) c.readied = null;
  if (c.alternate === item.id) c.alternate = null;
}
