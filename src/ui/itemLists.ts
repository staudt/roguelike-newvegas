import { isUndroppable, itemLabel, type Item } from '../items/Item';
import { itemDef, type ItemKind } from '../items/ItemData';
import type { Carrier } from '../items/Loadout';
import type { PanelLine } from './Menu';

/** Pure helpers shared by the inventory panel, the item menus and the status bar. */

const GROUPS: Array<{ heading: string; kinds: ItemKind[] }> = [
  { heading: 'Weapons', kinds: ['weapon', 'gun'] },
  { heading: 'Ammunition', kinds: ['ammo'] },
  { heading: 'Consumables', kinds: ['consumable'] },
  { heading: 'Other', kinds: ['misc'] },
];

function groupIndex(item: Item): number {
  const kind = itemDef(item.defId).kind;
  return GROUPS.findIndex((g) => g.kinds.includes(kind));
}

/** Inventory in display order (grouped by kind, stable inside a group). Menus use this order too. */
export function orderedInventory(items: readonly Item[]): Item[] {
  return items
    .map((item, i) => ({ item, i, g: groupIndex(item) }))
    .sort((a, b) => a.g - b.g || a.i - b.i)
    .map((e) => e.item);
}

/** a-z then A-Z; undefined past 52 items (no hotkey). */
export function inventoryLetter(index: number): string | undefined {
  if (index < 26) return String.fromCharCode(97 + index);
  if (index < 52) return String.fromCharCode(65 + index - 26);
  return undefined;
}

export function itemTags(c: Carrier, item: Item): string[] {
  const tags: string[] = [];
  if (c.wielded === item.id) tags.push('(wielded)');
  if (c.readied === item.id) tags.push('(readied)');
  if (c.alternate === item.id) tags.push('(alternate)');
  if (isUndroppable(item)) tags.push("(can't drop)");
  return tags;
}

/** Inventory panel contents: kind headings, then "a - 12 9mm rounds (readied)" rows. */
export function inventoryLines(c: Carrier): PanelLine[] {
  if (c.inventory.length === 0) return [{ text: 'You are carrying nothing.', cls: 'dim' }];
  const ordered = orderedInventory(c.inventory);
  const lines: PanelLine[] = [];
  let lastGroup = -1;
  ordered.forEach((item, i) => {
    const g = groupIndex(item);
    if (g !== lastGroup) {
      if (lastGroup >= 0) lines.push({ text: '' });
      lines.push({ text: GROUPS[g]!.heading, cls: 'head' });
      lastGroup = g;
    }
    const def = itemDef(item.defId);
    const tags = itemTags(c, item);
    const letter = inventoryLetter(i) ?? ' ';
    lines.push({
      text: `${letter} - ${itemLabel(item)}${tags.length ? ` ${tags.join(' ')}` : ''}`,
      glyph: { ch: def.glyph, color: def.fg },
    });
  });
  return lines;
}

export type AmmoStatus = 'none' | 'empty' | 'low' | 'ok';

export const LOW_AMMO = 6;

/** How the status bar shows ammunition: `null` = nothing readied. */
export function ammoStatus(count: number | null): AmmoStatus {
  if (count === null) return 'none';
  if (count <= 0) return 'empty';
  return count <= LOW_AMMO ? 'low' : 'ok';
}
