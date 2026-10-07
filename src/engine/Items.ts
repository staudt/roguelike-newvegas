import { canFire, clearSlotsFor, consumeRound, findItem } from '../items/Carrying';
import { addToStack, isUndroppable, itemLabel, itemWithArticle } from '../items/Item';
import { itemDef } from '../items/ItemData';
import { DIRECTION_VECTORS, type Direction } from '../utils/geometry';
import { defaultRNG, type RNG } from '../utils/RNG';
import { rememberAmmo } from './Ammo';
import { fireProjectile } from './Combat';
import type { EventBus, GameEvents } from './EventBus';
import { addMessage, getActiveSpace, type GameState } from './GameState';
import { addGroundItem, groundItemsAt } from './GroundItems';
import { advanceTurn } from './TurnManager';

export { groundItemsAt };

/** "the baseball bat", but stacks keep their count: "12 9mm rounds". */
function definite(item: Parameters<typeof itemLabel>[0]): string {
  return item.count !== undefined ? itemLabel(item) : `the ${itemLabel(item)}`;
}

/**
 * `,`: pick up the given items (by id) from the player's cell, or everything. All of it costs one
 * turn. Ammunition merges into the stack you already carry, so a readied stack stays readied.
 */
export function pickUp(
  state: GameState,
  itemIds: string[] | 'all',
  events: EventBus<GameEvents>,
  rng: RNG = defaultRNG,
): boolean {
  if (state.gameOver) return false;
  const space = getActiveSpace(state);
  const here = groundItemsAt(state, state.player.x, state.player.y);
  const chosen = itemIds === 'all' ? here : here.filter((g) => itemIds.includes(g.item.id));

  if (chosen.length === 0) {
    addMessage(state, 'There is nothing here to pick up.');
    return false;
  }

  for (const ground of chosen) {
    space.items.splice(space.items.indexOf(ground), 1);
    addMessage(state, `You pick up ${itemWithArticle(ground.item)}.`);
    addToStack(state.player.inventory, ground.item);
  }

  advanceTurn(state, events, rng);
  return true;
}

/** `d`: drop an item (the whole stack) on the player's cell. Undroppable things refuse, free. */
export function dropItem(
  state: GameState,
  itemId: string,
  events: EventBus<GameEvents>,
  rng: RNG = defaultRNG,
): boolean {
  if (state.gameOver) return false;
  const player = state.player;
  const item = findItem(player, itemId);
  if (!item) return false;

  if (isUndroppable(item)) {
    addMessage(state, `You can't let go of the ${itemLabel(item)}.`);
    return false;
  }

  const wasWielded = player.wielded === item.id;
  player.inventory.splice(player.inventory.indexOf(item), 1);
  clearSlotsFor(player, item);
  addGroundItem(getActiveSpace(state), player.x, player.y, item);

  addMessage(state, `You drop ${definite(item)}.`);
  if (wasWielded) addMessage(state, 'You are now empty handed.');

  advanceTurn(state, events, rng);
  return true;
}

/** `q`: use a consumable. A stimpak heals and is used up. */
export function useItem(
  state: GameState,
  itemId: string,
  events: EventBus<GameEvents>,
  rng: RNG = defaultRNG,
): boolean {
  if (state.gameOver) return false;
  const player = state.player;
  const item = findItem(player, itemId);
  if (!item) return false;

  const def = itemDef(item.defId);
  if (def.kind !== 'consumable') {
    addMessage(state, "You can't use that.");
    return false;
  }
  if (player.hp >= player.maxHp) {
    addMessage(state, 'You are already at full health.');
    return false;
  }

  player.hp = Math.min(player.maxHp, player.hp + def.heal);
  player.inventory.splice(player.inventory.indexOf(item), 1);
  clearSlotsFor(player, item);
  addMessage(state, `You use ${itemWithArticle(item)}. You feel better.`);

  advanceTurn(state, events, rng);
  return true;
}

/**
 * `Q`: set the ammunition `f` will fire (null to ready nothing). A free action. Any ammunition may
 * be readied, even the wrong kind for the wielded gun; `f` will say so.
 */
export function readyAmmo(
  state: GameState,
  itemId: string | null,
  _events?: EventBus<GameEvents>,
): boolean {
  if (state.gameOver) return false;
  const player = state.player;
  if (itemId === null) {
    player.readied = null;
    addMessage(state, 'You ready nothing.');
    return false;
  }
  const item = findItem(player, itemId);
  if (!item) return false;
  if (itemDef(item.defId).kind !== 'ammo') {
    addMessage(state, "You can't ready that.");
    return false;
  }
  player.readied = item.id;
  rememberAmmo(state, item);
  addMessage(state, `You ready ${itemLabel(item)}.`);
  return false;
}

/**
 * `f` + direction: fire the wielded gun along a straight line. A refusal (no gun, no ammunition,
 * wrong ammunition) is a message and no turn; otherwise one round is spent and a turn passes.
 */
export function fireGun(
  state: GameState,
  direction: Direction,
  events: EventBus<GameEvents>,
  rng: RNG = defaultRNG,
): boolean {
  if (state.gameOver) return false;
  const check = canFire(state.player);
  if (!check.ok) {
    addMessage(state, check.reason);
    return false;
  }

  consumeRound(state.player);
  fireProjectile(state, state.player, check.gun, DIRECTION_VECTORS[direction], rng, events);
  advanceTurn(state, events, rng);
  return true;
}
