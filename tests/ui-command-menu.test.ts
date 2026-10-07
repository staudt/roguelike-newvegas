import { describe, expect, it } from 'vitest';
import { buildCommandList, type CommandContext } from '../src/ui/commandMenu';

const none: CommandContext = {
  itemsHere: 0, gunWielded: false, readiedAmmo: 0, ammoInPack: 0, hurt: false, consumables: 0, droppable: 0,
};
const ids = (c: Partial<CommandContext>) => buildCommandList({ ...none, ...c }).map((r) => r.id);

describe('buildCommandList', () => {
  it('starts with Wield when nothing is contextual', () => {
    expect(ids({})).toEqual(['wield', 'inventory', 'sheet', 'fight', 'kick', 'run', 'wait', 'help', 'wear']);
  });
  it('offers Pick up only with items here', () => {
    expect(ids({ itemsHere: 1 })[0]).toBe('pickup');
    expect(ids({})).not.toContain('pickup');
  });
  it('offers Fire only with gun and readied ammo', () => {
    expect(ids({ gunWielded: true, readiedAmmo: 3 })[0]).toBe('fire');
    expect(ids({ readiedAmmo: 3 })).not.toContain('fire');
    expect(ids({ gunWielded: true })).not.toContain('fire');
  });
  it('offers Ready ammo with a gun, none readied, and ammo in pack', () => {
    expect(ids({ gunWielded: true, ammoInPack: 1 })[0]).toBe('ready');
    expect(ids({ gunWielded: true })).not.toContain('ready');
    expect(ids({ gunWielded: true, readiedAmmo: 2, ammoInPack: 1 })).not.toContain('ready');
  });
  it('offers Use item with consumables', () => {
    expect(ids({ consumables: 1 })[0]).toBe('use');
  });
  it('orders hurt + items + gun with Use first', () => {
    expect(ids({ hurt: true, consumables: 1, itemsHere: 1, gunWielded: true, readiedAmmo: 1 }).slice(0, 3)).toEqual([
      'use', 'pickup', 'fire',
    ]);
    expect(ids({ consumables: 1, itemsHere: 1, gunWielded: true, readiedAmmo: 1 }).slice(0, 3)).toEqual([
      'pickup', 'fire', 'use',
    ]);
  });
  it('omits Drop when nothing is droppable and keeps standard order', () => {
    expect(ids({})).not.toContain('drop');
    expect(ids({ droppable: 2 })).toEqual(['wield', 'inventory', 'drop', 'sheet', 'fight', 'kick', 'run', 'wait', 'help', 'wear']);
  });
  it('greys only Wear', () => {
    const rows = buildCommandList({ ...none, itemsHere: 1, droppable: 1 });
    expect(rows.filter((r) => r.disabled).map((r) => r.id)).toEqual(['wear']);
  });
});
