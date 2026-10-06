import { itemDef } from './ItemData';

/** An instance of an item: a stable id plus which definition it is. Plain data, like all state. */
export interface Item {
  id: string;
  defId: string;
}

let nextItemId = 1;

export function createItem(defId: string): Item {
  itemDef(defId); // fail fast on a typo
  return { id: `item-${nextItemId++}`, defId };
}
