import { ARMOR_WEAR_FRACTION, WEAR_PER_ATTACK } from '../config/constants';
import type { Limb } from '../combat/Limbs';
import { capitalize } from '../combat/Narration';
import { theName, type Creature } from '../entities/Creature';
import type { Player } from '../entities/Player';
import { clearSlotsFor, wieldedItem, wornIn } from '../items/Carrying';
import { wear } from '../items/Condition';
import type { Item } from '../items/Item';
import { itemDef } from '../items/ItemData';
import { addMessage, getActiveSpace, type GameState } from './GameState';

/**
 * When things wear (see items/Condition): a weapon each time it is fired or lands a blow, armor
 * each time the piece covering the struck spot stops some damage. What breaks comes off at once
 * (a broken weapon leaves the hand, broken armor the body) and stays in the pack for repair.
 */

type Wearer = Player | Creature;

/** "Your" / "The gecko's" / "Sunny Smiles's", for the break line. */
function owner(who: Wearer): string {
  return who.kind === 'player' ? 'Your' : `${capitalize(theName(who))}'s`;
}

function seen(state: GameState, who: Wearer): boolean {
  return who.kind === 'player' || getActiveSpace(state).visible.has(who.x, who.y);
}

function breakOff(state: GameState, who: Wearer, item: Item, verb: string): void {
  clearSlotsFor(who, item);
  if (seen(state, who)) addMessage(state, `${owner(who)} ${itemDef(item.defId).name} ${verb}!`);
}

/** The wielded weapon or gun takes one use of wear. Bare hands and teeth don't wear. */
export function wearWielded(state: GameState, who: Wearer): void {
  const item = wieldedItem(who);
  if (item && wear(item, WEAR_PER_ATTACK)) breakOff(state, who, item, 'breaks');
}

/**
 * A blow that `absorbed` some damage wears the armor covering where it landed: the head piece for
 * a head hit, the body piece for anything else.
 */
export function wearArmorHit(state: GameState, who: Wearer, limb: Limb | null, absorbed: number): void {
  if (!limb || absorbed <= 0) return;
  const piece = wornIn(who, limb.kind === 'head' ? 'head' : 'body');
  if (!piece) return;
  const points = Math.max(1, Math.round(absorbed * ARMOR_WEAR_FRACTION));
  if (wear(piece, points)) breakOff(state, who, piece, 'falls apart');
}
