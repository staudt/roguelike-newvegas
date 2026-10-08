import { findItem, wornIn } from '../items/Carrying';
import { isBroken } from '../items/Condition';
import { itemLabel } from '../items/Item';
import { itemDef } from '../items/ItemData';
import { defaultRNG, type RNG } from '../utils/RNG';
import type { EventBus, GameEvents } from './EventBus';
import { addMessage, type GameState } from './GameState';
import { advanceTurn } from './TurnManager';

/**
 * `W` puts on armor and `T` takes it off, one turn each. Wearing something on a slot that is
 * already covered swaps them in the same turn. Broken armor can't be worn.
 */

export function wearArmor(
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
  if (def.kind !== 'armor') {
    addMessage(state, `You can't wear the ${itemLabel(item)}.`);
    return false;
  }
  if (player.worn.includes(item.id)) {
    addMessage(state, `You are already wearing the ${def.name}.`);
    return false;
  }
  if (isBroken(item)) {
    addMessage(state, `The ${def.name} is too far gone to wear.`);
    return false;
  }

  const previous = wornIn(player, def.slot);
  if (previous) {
    player.worn = player.worn.filter((id) => id !== previous.id);
    addMessage(state, `You take off the ${itemDef(previous.defId).name} and put on the ${def.name}.`);
  } else {
    addMessage(state, `You put on the ${def.name}.`);
  }
  player.worn.push(item.id);
  advanceTurn(state, events, rng);
  return true;
}

export function takeOffArmor(
  state: GameState,
  itemId: string,
  events: EventBus<GameEvents>,
  rng: RNG = defaultRNG,
): boolean {
  if (state.gameOver) return false;
  const player = state.player;
  const item = findItem(player, itemId);
  if (!item || !player.worn.includes(item.id)) {
    addMessage(state, "You aren't wearing that.");
    return false;
  }
  player.worn = player.worn.filter((id) => id !== item.id);
  addMessage(state, `You take off the ${itemDef(item.defId).name}.`);
  advanceTurn(state, events, rng);
  return true;
}
