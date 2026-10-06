import { describe, expect, it } from 'vitest';
import { createItem } from '../src/items/Item';
import { ammoStatus, inventoryLetter, inventoryLines, orderedInventory } from '../src/ui/itemLists';

function carrier() {
  const pip = createItem('pip-boy');
  const stim = createItem('stimpak');
  const gun = createItem('9mm-pistol');
  const ammo = createItem('9mm-round', 24);
  const knife = createItem('combat-knife');
  return { pip, stim, gun, ammo, knife, c: { inventory: [pip, stim, ammo, gun, knife], wielded: gun.id as string | null, readied: ammo.id as string | null } };
}

describe('item lists', () => {
  it('orders by kind group, stable inside a group', () => {
    const { c, gun, knife, ammo, stim, pip } = carrier();
    expect(orderedInventory(c.inventory)).toEqual([gun, knife, ammo, stim, pip]);
  });

  it('assigns letters', () => {
    expect(inventoryLetter(0)).toBe('a');
    expect(inventoryLetter(26)).toBe('A');
    expect(inventoryLetter(52)).toBeUndefined();
  });

  it('builds grouped lines with tags', () => {
    const { c } = carrier();
    const text = inventoryLines(c).map((l) => l.text);
    expect(text).toContain('Weapons');
    expect(text).toContain('a - 9mm pistol (wielded)');
    expect(text).toContain('c - 24 9mm rounds (readied)');
    expect(text).toContain("e - Pip-Boy 3000 (can't drop)");
  });

  it('empty inventory', () => {
    expect(inventoryLines({ inventory: [], wielded: null, readied: null })[0]!.text).toMatch(/nothing/);
  });

  it('classifies ammo', () => {
    expect(ammoStatus(null)).toBe('none');
    expect(ammoStatus(0)).toBe('empty');
    expect(ammoStatus(6)).toBe('low');
    expect(ammoStatus(7)).toBe('ok');
  });
});
