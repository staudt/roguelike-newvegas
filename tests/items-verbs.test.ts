import { describe, expect, it } from 'vitest';
import { groundItemsAt, dropItem, pickUp, readyAmmo, useItem } from '../src/engine/Items';
import { tryMovePlayer, wieldItem } from '../src/engine/TurnManager';
import { addGroundItem } from '../src/engine/GroundItems';
import { getActiveSpace } from '../src/engine/GameState';
import { createItem, itemCount, type Item } from '../src/items/Item';
import type { RNG } from '../src/utils/RNG';
import { buildArena, scriptedRNG } from './helpers/fixtures';

const QUIET: RNG = () => 0.999;

function setup() {
  const arena = buildArena({ width: 7, height: 5, player: { x: 2, y: 2 } });
  const player = arena.state.player;
  const find = (defId: string): Item => player.inventory.find((i) => i.defId === defId)!;
  return { ...arena, player, find, space: getActiveSpace(arena.state) };
}

function floorAt(s: ReturnType<typeof setup>, x: number, y: number, defId: string, count?: number): Item {
  const item = createItem(defId, count);
  addGroundItem(s.space, x, y, item);
  return item;
}

describe('stepping onto items', () => {
  it('one item: "You see here a baseball bat."', () => {
    const s = setup();
    floorAt(s, 3, 2, 'baseball-bat');
    tryMovePlayer(s.state, 'E', s.events, QUIET);
    expect(s.state.messageLog).toEqual(['You see here a baseball bat.']);
  });

  it('a stack names its count; an item with a vowel gets "an"', () => {
    const s = setup();
    floorAt(s, 3, 2, '9mm-round', 12);
    floorAt(s, 4, 2, 'stimpak');
    tryMovePlayer(s.state, 'E', s.events, QUIET);
    tryMovePlayer(s.state, 'E', s.events, QUIET);
    expect(s.state.messageLog).toEqual(['You see here 12 9mm rounds.', 'You see here a stimpak.']);
  });

  it('several objects: "There are several objects here."', () => {
    const s = setup();
    floorAt(s, 3, 2, 'baseball-bat');
    floorAt(s, 3, 2, 'combat-knife');
    tryMovePlayer(s.state, 'E', s.events, QUIET);
    expect(s.state.messageLog).toEqual(['There are several objects here.']);
  });

  it('an empty cell says nothing', () => {
    const s = setup();
    tryMovePlayer(s.state, 'E', s.events, QUIET);
    expect(s.state.messageLog).toEqual([]);
  });

  it('floor ammunition of the same kind merges into one stack', () => {
    const s = setup();
    floorAt(s, 3, 2, '9mm-round', 5);
    floorAt(s, 3, 2, '9mm-round', 7);
    expect(groundItemsAt(s.state, 3, 2)).toHaveLength(1);
    expect(groundItemsAt(s.state, 3, 2)[0]!.item.count).toBe(12);
  });
});

describe('pickUp', () => {
  it('moves the item to the pack, logs it and costs one turn', () => {
    const s = setup();
    const knife = floorAt(s, 2, 2, 'combat-knife');
    expect(pickUp(s.state, [knife.id], s.events, QUIET)).toBe(true);
    expect(s.state.messageLog).toEqual(['You pick up a combat knife.']);
    expect(s.player.inventory).toContain(knife);
    expect(groundItemsAt(s.state, 2, 2)).toEqual([]);
    expect(s.state.turnCount).toBe(1);
  });

  it("'all' takes everything, one line per item, ONE turn", () => {
    const s = setup();
    floorAt(s, 2, 2, 'stimpak');
    floorAt(s, 2, 2, '9mm-round', 12);
    expect(pickUp(s.state, 'all', s.events, QUIET)).toBe(true);
    expect(s.state.messageLog).toEqual(['You pick up a stimpak.', 'You pick up 12 9mm rounds.']);
    expect(s.state.turnCount).toBe(1);
    expect(groundItemsAt(s.state, 2, 2)).toEqual([]);
  });

  it('picking by id leaves the rest on the floor', () => {
    const s = setup();
    const a = floorAt(s, 2, 2, 'stimpak');
    floorAt(s, 2, 2, 'baseball-bat');
    pickUp(s.state, [a.id], s.events, QUIET);
    expect(groundItemsAt(s.state, 2, 2).map((g) => g.item.defId)).toEqual(['baseball-bat']);
  });

  it('ammunition merges into the carried stack and keeps a readied stack readied', () => {
    const s = setup();
    const stack = s.find('9mm-round');
    s.player.readied = stack.id;
    floorAt(s, 2, 2, '9mm-round', 12);
    pickUp(s.state, 'all', s.events, QUIET);
    expect(itemCount(stack)).toBe(36);
    expect(s.player.inventory.filter((i) => i.defId === '9mm-round')).toHaveLength(1);
    expect(s.player.readied).toBe(stack.id);
  });

  it('nothing there: a message and no turn', () => {
    const s = setup();
    expect(pickUp(s.state, 'all', s.events, scriptedRNG([]))).toBe(false);
    expect(s.state.messageLog).toEqual(['There is nothing here to pick up.']);
    expect(s.state.turnCount).toBe(0);
  });

  it('ids that are not on this cell pick nothing', () => {
    const s = setup();
    const far = floorAt(s, 4, 4, 'stimpak');
    expect(pickUp(s.state, [far.id], s.events, scriptedRNG([]))).toBe(false);
    expect(groundItemsAt(s.state, 4, 4)).toHaveLength(1);
  });
});

describe('dropItem', () => {
  it('drops on the player cell, logs "the", costs a turn', () => {
    const s = setup();
    const bat = s.find('baseball-bat');
    expect(dropItem(s.state, bat.id, s.events, QUIET)).toBe(true);
    expect(s.state.messageLog).toEqual(['You drop the baseball bat.']);
    expect(s.player.inventory).not.toContain(bat);
    expect(groundItemsAt(s.state, 2, 2)[0]!.item).toBe(bat);
    expect(s.state.turnCount).toBe(1);
  });

  it('drops a whole stack and says the count', () => {
    const s = setup();
    dropItem(s.state, s.find('9mm-round').id, s.events, QUIET);
    expect(s.state.messageLog).toEqual(['You drop 24 9mm rounds.']);
    expect(groundItemsAt(s.state, 2, 2)[0]!.item.count).toBe(24);
  });

  it('dropping the wielded item empties your hands', () => {
    const s = setup();
    const bat = s.find('baseball-bat');
    wieldItem(s.state, bat.id, s.events, QUIET);
    s.state.messageLog.length = 0;
    dropItem(s.state, bat.id, s.events, QUIET);
    expect(s.state.messageLog).toEqual(['You drop the baseball bat.', 'You are now empty handed.']);
    expect(s.player.wielded).toBeNull();
  });

  it('dropping readied ammunition clears the quiver', () => {
    const s = setup();
    const ammo = s.find('9mm-round');
    readyAmmo(s.state, ammo.id);
    dropItem(s.state, ammo.id, s.events, QUIET);
    expect(s.player.readied).toBeNull();
  });

  it('the Pip-Boy refuses with the exact line and no turn', () => {
    const s = setup();
    const pip = s.find('pip-boy');
    expect(dropItem(s.state, pip.id, s.events, scriptedRNG([]))).toBe(false);
    expect(s.state.messageLog).toEqual(["You can't let go of the Pip-Boy 3000."]);
    expect(s.player.inventory).toContain(pip);
    expect(s.state.turnCount).toBe(0);
  });

  it('an instance flag can make any item undroppable', () => {
    const s = setup();
    const bat = s.find('baseball-bat');
    bat.flags = { undroppable: true };
    expect(dropItem(s.state, bat.id, s.events, scriptedRNG([]))).toBe(false);
    expect(s.state.messageLog).toEqual(["You can't let go of the baseball bat."]);
  });

  it('an unknown id does nothing', () => {
    const s = setup();
    expect(dropItem(s.state, 'nope', s.events, scriptedRNG([]))).toBe(false);
    expect(s.state.messageLog).toEqual([]);
  });

  it('dropped ammunition merges with a stack already on the floor, and can be picked up again', () => {
    const s = setup();
    floorAt(s, 2, 2, '9mm-round', 4);
    dropItem(s.state, s.find('9mm-round').id, s.events, QUIET);
    expect(groundItemsAt(s.state, 2, 2)).toHaveLength(1);
    expect(groundItemsAt(s.state, 2, 2)[0]!.item.count).toBe(28);
    pickUp(s.state, 'all', s.events, QUIET);
    expect(s.find('9mm-round').count).toBe(28);
  });
});

describe('useItem', () => {
  it('a stimpak heals, is consumed, costs a turn', () => {
    const s = setup();
    s.player.hp = 10;
    const before = s.player.inventory.filter((i) => i.defId === 'stimpak').length;
    expect(useItem(s.state, s.find('stimpak').id, s.events, QUIET)).toBe(true);
    expect(s.player.hp).toBe(35);
    expect(s.player.inventory.filter((i) => i.defId === 'stimpak')).toHaveLength(before - 1);
    expect(s.state.messageLog).toEqual(['You use a stimpak. You feel better.']);
    expect(s.state.turnCount).toBe(1);
  });

  it('healing caps at max HP', () => {
    const s = setup();
    s.player.hp = s.player.maxHp - 3;
    useItem(s.state, s.find('stimpak').id, s.events, QUIET);
    expect(s.player.hp).toBe(s.player.maxHp);
  });

  it('at full health it refuses without spending the stimpak or a turn', () => {
    const s = setup();
    expect(useItem(s.state, s.find('stimpak').id, s.events, scriptedRNG([]))).toBe(false);
    expect(s.state.messageLog).toEqual(['You are already at full health.']);
    expect(s.player.inventory.filter((i) => i.defId === 'stimpak')).toHaveLength(2);
  });

  it('non-consumables cannot be used', () => {
    const s = setup();
    s.player.hp = 5;
    expect(useItem(s.state, s.find('baseball-bat').id, s.events, scriptedRNG([]))).toBe(false);
    expect(s.state.messageLog).toEqual(["You can't use that."]);
    expect(s.state.turnCount).toBe(0);
  });
});

describe('wielding guns and readying ammunition', () => {
  it('a gun can be wielded', () => {
    const s = setup();
    const gun = s.find('9mm-pistol');
    expect(wieldItem(s.state, gun.id, s.events, QUIET)).toBe(true);
    expect(s.player.wielded).toBe(gun.id);
    expect(s.state.messageLog).toEqual(['You are now wielding the 9mm pistol.']);
  });

  it('ammunition and stimpaks cannot be wielded (free refusal)', () => {
    const s = setup();
    expect(wieldItem(s.state, s.find('9mm-round').id, s.events, scriptedRNG([]))).toBe(false);
    expect(s.state.messageLog).toEqual(["You can't wield 24 9mm rounds."]);
    expect(wieldItem(s.state, s.find('stimpak').id, s.events, scriptedRNG([]))).toBe(false);
    expect(s.player.wielded).toBeNull();
    expect(s.state.turnCount).toBe(0);
  });

  it('readyAmmo is free and logs the count', () => {
    const s = setup();
    expect(readyAmmo(s.state, s.find('9mm-round').id)).toBe(false);
    expect(s.player.readied).toBe(s.find('9mm-round').id);
    expect(s.state.messageLog).toEqual(['You ready 24 9mm rounds.']);
    expect(s.state.turnCount).toBe(0);
  });

  it('readying null says "You ready nothing."', () => {
    const s = setup();
    readyAmmo(s.state, s.find('9mm-round').id);
    readyAmmo(s.state, null);
    expect(s.player.readied).toBeNull();
    expect(s.state.messageLog.at(-1)).toBe('You ready nothing.');
  });

  it('only ammunition can be readied', () => {
    const s = setup();
    readyAmmo(s.state, s.find('stimpak').id);
    expect(s.player.readied).toBeNull();
    expect(s.state.messageLog).toEqual(["You can't ready that."]);
  });
});
