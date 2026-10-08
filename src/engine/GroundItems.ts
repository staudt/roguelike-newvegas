import type { Creature } from '../entities/Creature';
import { creatureDef, type LootEntry } from '../entities/CreatureData';
import { addToStack, createItem, isStackable, itemWithArticle, type Item } from '../items/Item';
import { itemDef } from '../items/ItemData';
import { randomInt, type RNG } from '../utils/RNG';
import { getActiveSpace, type GameState, type GroundItem, type Space } from './GameState';

/** Items lying on one cell of the active space, in the order they were dropped. */
export function groundItemsAt(state: GameState, x: number, y: number): GroundItem[] {
  return getActiveSpace(state).items.filter((g) => g.x === x && g.y === y);
}

/** Puts an item on the floor; ammunition merges into a stack already lying there. */
export function addGroundItem(space: Pick<Space, 'items'>, x: number, y: number, item: Item): void {
  if (isStackable(item)) {
    const existing = space.items.find((g) => g.x === x && g.y === y && g.item.defId === item.defId);
    if (existing) {
      const pile = [existing.item];
      addToStack(pile, item);
      return;
    }
  }
  space.items.push({ x, y, item });
}

/**
 * A dead creature leaves what it carried plus rolled loot on its cell. Each loot entry is rolled
 * independently (`chance` percent); ammunition rolls a count in its range only when it drops.
 */
export function dropCreatureItems(state: GameState, creature: Creature, rng: RNG): void {
  const space = getActiveSpace(state);
  for (const item of creature.inventory) addGroundItem(space, creature.x, creature.y, item);
  creature.inventory = [];
  creature.wielded = null;
  creature.readied = null;

  const loot = lootOf(creature);
  for (const entry of loot) {
    if (randomInt(rng, 1, 100) > entry.chance) continue;
    const count =
      itemDef(entry.defId).kind === 'ammo' && entry.count
        ? randomInt(rng, entry.count.min, entry.count.max)
        : undefined;
    addGroundItem(space, creature.x, creature.y, createItem(entry.defId, count));
  }
}


function lootOf(creature: Creature): LootEntry[] {
  return creatureDef(creature.defId).loot ?? [];
}

/** "You see here a baseball bat." / "There are several objects here." / null for an empty cell. */
export function describeGroundHere(state: GameState, x: number, y: number): string | null {
  const here = groundItemsAt(state, x, y);
  if (here.length === 0) return null;
  if (here.length === 1) return `You see here ${itemWithArticle(here[0]!.item)}.`;
  return 'There are several objects here.';
}
