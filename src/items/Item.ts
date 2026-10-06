import { itemDef, type ItemFlags } from './ItemData';

/**
 * An instance of an item: a stable id plus which definition it is. Plain data, like all state.
 * `count` is only for stackable things (ammunition); absent means one.
 */
export interface Item {
  id: string;
  defId: string;
  count?: number;
  /** Overrides the definition's flags for this one item (a quest copy that can't be dropped). */
  flags?: ItemFlags;
}

let nextItemId = 1;

export function createItem(defId: string, count?: number): Item {
  const def = itemDef(defId); // fail fast on a typo
  const item: Item = { id: `item-${nextItemId++}`, defId };
  if (def.kind === 'ammo') item.count = Math.max(1, count ?? 1);
  return item;
}

export function itemCount(item: Item): number {
  return item.count ?? 1;
}

export function isStackable(item: Item): boolean {
  return itemDef(item.defId).kind === 'ammo';
}

/** Merges an item into a pile if a stack of the same kind is already there, else appends it. */
export function addToStack(pile: Item[], item: Item): Item {
  if (isStackable(item)) {
    const existing = pile.find((i) => i.defId === item.defId);
    if (existing) {
      existing.count = itemCount(existing) + itemCount(item);
      return existing;
    }
  }
  pile.push(item);
  return item;
}

/** "combat knife", "12 9mm rounds", "1 9mm round". */
export function itemLabel(item: Item): string {
  const def = itemDef(item.defId);
  if (item.count === undefined) return def.name;
  return `${item.count} ${item.count === 1 ? def.name : (def.plural ?? `${def.name}s`)}`;
}

/** Same with an article for sentences: "a combat knife", "the 9mm pistol" is up to the caller. */
export function itemWithArticle(item: Item): string {
  const label = itemLabel(item);
  if (item.count !== undefined) return label;
  return /^[aeiou]/i.test(label) ? `an ${label}` : `a ${label}`;
}

/** Can the player let go of this? Instance flags win over the definition's. */
export function isUndroppable(item: Item): boolean {
  const flags = item.flags ?? itemDef(item.defId).flags;
  return flags?.undroppable === true;
}
