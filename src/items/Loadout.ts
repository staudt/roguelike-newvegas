import { addToStack, createItem, type Item } from './Item';
import { itemDef } from './ItemData';

/** Anything that carries things: the player, an NPC, a monster. */
export interface Carrier {
  inventory: Item[];
  /** Id of the wielded item, or null for bare hands / natural weapons. */
  wielded: string | null;
  /** Id of the readied ammunition stack, or null. */
  readied: string | null;
}

/** On-disk description of what someone carries (map JSON), by item definition id. */
export interface LoadoutJSON {
  /** Items carried. Ammunition may carry a count: `{ "defId": "9mm-round", "count": 12 }`. */
  inventory?: Array<string | { defId: string; count?: number }>;
  /** Definition id of the item they wield, which must also be in `inventory`. */
  wield?: string;
  /** Definition id of the ammunition they have readied, which must also be in `inventory`. */
  ready?: string;
}

/** Fills a carrier from a loadout. Unknown item ids throw, so a typo in a map fails loudly. */
export function applyLoadout(carrier: Carrier, loadout: LoadoutJSON | undefined): void {
  if (!loadout) return;
  for (const entry of loadout.inventory ?? []) {
    const spec = typeof entry === 'string' ? { defId: entry } : entry;
    addToStack(carrier.inventory, createItem(spec.defId, spec.count));
  }
  if (loadout.wield !== undefined) {
    const item = carrier.inventory.find((i) => i.defId === loadout.wield);
    if (!item) throw new Error(`Loadout wields "${loadout.wield}" but does not carry it`);
    if (itemDef(item.defId).kind !== 'weapon' && itemDef(item.defId).kind !== 'gun') {
      throw new Error(`Loadout wields "${loadout.wield}", which is not a weapon`);
    }
    carrier.wielded = item.id;
  }
  if (loadout.ready !== undefined) {
    const item = carrier.inventory.find((i) => i.defId === loadout.ready);
    if (!item) throw new Error(`Loadout readies "${loadout.ready}" but does not carry it`);
    if (itemDef(item.defId).kind !== 'ammo') {
      throw new Error(`Loadout readies "${loadout.ready}", which is not ammunition`);
    }
    carrier.readied = item.id;
  }
}

/** The inverse of applyLoadout: what someone carries, as map JSON (empty fields omitted). */
export function loadoutOf(carrier: Carrier): LoadoutJSON {
  const out: LoadoutJSON = {};
  if (carrier.inventory.length > 0) {
    out.inventory = carrier.inventory.map((i) => (i.count === undefined ? i.defId : { defId: i.defId, count: i.count }));
  }
  const wielded = carrier.inventory.find((i) => i.id === carrier.wielded);
  if (wielded) out.wield = wielded.defId;
  const readied = carrier.inventory.find((i) => i.id === carrier.readied);
  if (readied) out.ready = readied.defId;
  return out;
}
