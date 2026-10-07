import { wieldedGun, wieldedItem } from '../items/Carrying';
import { itemCount, itemLabel, type Item } from '../items/Item';
import { itemDef } from '../items/ItemData';
import { addMessage, type GameState } from './GameState';

/** Ammunition stacks in the pack that the wielded gun takes (in pack order), empty if no gun is wielded. */
function usableStacks(state: GameState): Item[] {
  const gun = wieldedGun(state.player);
  if (!gun) return [];
  return state.player.inventory.filter((i) => {
    const def = itemDef(i.defId);
    return def.kind === 'ammo' && def.ammoType === gun.ammoType && itemCount(i) > 0;
  });
}

/** Remembers which ammunition the player last had readied for the gun in hand. */
export function rememberAmmo(state: GameState, ammo: Item): void {
  const player = state.player;
  const gunItem = wieldedItem(player);
  const gun = wieldedGun(player);
  const def = itemDef(ammo.defId);
  if (!gunItem || !gun || def.kind !== 'ammo' || def.ammoType !== gun.ammoType) return;
  player.lastAmmo[gunItem.defId] = ammo.defId;
}

/**
 * Called after the player takes up a weapon. A gun gets its ammunition readied without a separate
 * `Q`: the kind last readied with this gun, else the first that fits. Ammunition already readied
 * that fits stays. A melee weapon or bare hands leave what is readied alone, and a gun with no
 * ammunition in the pack changes nothing.
 */
export function readyAmmoForWielded(state: GameState): void {
  const player = state.player;
  const gunItem = wieldedItem(player);
  if (!gunItem || !wieldedGun(player)) return;

  const stacks = usableStacks(state);
  if (stacks.length === 0) return;

  const current = stacks.find((i) => i.id === player.readied);
  if (current) {
    rememberAmmo(state, current);
    return;
  }
  const remembered = player.lastAmmo[gunItem.defId];
  const pick = stacks.find((i) => i.defId === remembered) ?? stacks[0]!;
  player.readied = pick.id;
  rememberAmmo(state, pick);
  addMessage(state, `You ready ${itemLabel(pick)}.`);
}
