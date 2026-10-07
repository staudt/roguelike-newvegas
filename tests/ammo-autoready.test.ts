import { afterEach, describe, expect, it } from 'vitest';
import { readyAmmo } from '../src/engine/Items';
import { swapWeapons, wieldItem } from '../src/engine/TurnManager';
import { addToStack, createItem, type Item } from '../src/items/Item';
import { ITEMS, type AmmoDef } from '../src/items/ItemData';
import type { RNG } from '../src/utils/RNG';
import { buildArena } from './helpers/fixtures';

const QUIET: RNG = () => 0.999;

function setup() {
  const a = buildArena({ width: 5, height: 1, player: { x: 0, y: 0 } });
  const p = a.state.player;
  const find = (defId: string): Item => p.inventory.find((i) => i.defId === defId)!;
  const wield = (defId: string) => wieldItem(a.state, find(defId).id, a.events, QUIET);
  return { ...a, p, find, wield };
}

/** A second kind of 9mm ammunition, to tell "the ammunition last used with this gun" apart. */
const AP: AmmoDef = { id: '9mm-ap', name: '9mm AP round', plural: '9mm AP rounds', glyph: ')', fg: '#fff', kind: 'ammo', ammoType: '9mm' };
afterEach(() => {
  delete (ITEMS as Record<string, unknown>)['9mm-ap'];
});

describe('wielding a gun readies its ammunition', () => {
  it('wielding the pistol readies the 9mm rounds', () => {
    const s = setup();
    expect(s.p.readied).toBeNull();
    s.wield('9mm-pistol');
    expect(s.p.readied).toBe(s.find('9mm-round').id);
    expect(s.state.messageLog).toEqual(['You are now wielding the 9mm pistol.', 'You ready 24 9mm rounds.']);
  });

  it('switching to a melee weapon leaves what is readied alone', () => {
    const s = setup();
    s.wield('9mm-pistol');
    s.wield('combat-knife');
    expect(s.p.readied).toBe(s.find('9mm-round').id);
    s.p.readied = null;
    s.wield('baseball-bat');
    expect(s.p.readied).toBeNull();
  });

  it('putting the gun away (bare hands) changes nothing either', () => {
    const s = setup();
    s.wield('9mm-pistol');
    wieldItem(s.state, null, s.events, QUIET);
    expect(s.p.readied).toBe(s.find('9mm-round').id);
  });

  it('a gun with no ammunition in the pack just gets wielded', () => {
    const s = setup();
    s.p.inventory = s.p.inventory.filter((i) => i.defId !== '9mm-round');
    expect(s.wield('9mm-pistol')).toBe(true);
    expect(s.p.readied).toBeNull();
    expect(s.state.messageLog).toEqual(['You are now wielding the 9mm pistol.']);
  });

  it('ammunition already readied that fits is kept, with no second message', () => {
    const s = setup();
    s.p.readied = s.find('9mm-round').id;
    s.wield('9mm-pistol');
    expect(s.state.messageLog).toEqual(['You are now wielding the 9mm pistol.']);
  });

  it('swapping weapons with x readies too', () => {
    const s = setup();
    s.wield('9mm-pistol');
    s.p.readied = null;
    s.wield('combat-knife');
    swapWeapons(s.state, s.events, QUIET); // back to the pistol
    expect(s.p.readied).toBe(s.find('9mm-round').id);
  });

  it('only ammunition that fits the gun is chosen', () => {
    const s = setup();
    (ITEMS as Record<string, unknown>)['5mm-round'] = { ...AP, id: '5mm-round', ammoType: '5mm' };
    try {
      s.p.inventory.unshift(createItem('5mm-round', 10));
      s.wield('9mm-pistol');
      expect(s.p.readied).toBe(s.find('9mm-round').id);
    } finally {
      delete (ITEMS as Record<string, unknown>)['5mm-round'];
    }
  });
});

describe('the ammunition last used with a gun comes back', () => {
  it('first time: the first that fits; afterwards: the one you last readied with it', () => {
    (ITEMS as Record<string, unknown>)['9mm-ap'] = AP;
    const s = setup();
    addToStack(s.p.inventory, createItem('9mm-ap', 8));

    s.wield('9mm-pistol');
    expect(s.p.readied).toBe(s.find('9mm-round').id); // first in the pack

    readyAmmo(s.state, s.find('9mm-ap').id); // I prefer the AP
    s.wield('combat-knife');
    s.p.readied = null; // something cleared it
    s.wield('9mm-pistol');
    expect(s.p.readied).toBe(s.find('9mm-ap').id);
  });

  it('readying ammunition while holding something else is not remembered for the gun', () => {
    (ITEMS as Record<string, unknown>)['9mm-ap'] = AP;
    const s = setup();
    addToStack(s.p.inventory, createItem('9mm-ap', 8));
    s.wield('9mm-pistol'); // remembers the plain rounds
    s.wield('baseball-bat');
    readyAmmo(s.state, s.find('9mm-ap').id);
    expect(s.p.lastAmmo['9mm-pistol']).toBe('9mm-round');
  });

  it('falls back to the first when the remembered kind is gone', () => {
    (ITEMS as Record<string, unknown>)['9mm-ap'] = AP;
    const s = setup();
    addToStack(s.p.inventory, createItem('9mm-ap', 8));
    s.wield('9mm-pistol');
    readyAmmo(s.state, s.find('9mm-ap').id);
    s.wield('combat-knife');
    s.p.inventory = s.p.inventory.filter((i) => i.defId !== '9mm-ap');
    s.p.readied = null;
    s.wield('9mm-pistol');
    expect(s.p.readied).toBe(s.find('9mm-round').id);
  });
});
