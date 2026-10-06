import { describe, expect, it } from 'vitest';
import { playerAttacks } from '../src/engine/Combat';
import { groundItemsAt } from '../src/engine/GroundItems';
import { createMonster } from '../src/entities/Monster';
import { MONSTERS } from '../src/entities/MonsterData';
import { createNpc } from '../src/entities/Npc';
import { applyLoadout } from '../src/items/Loadout';
import { isWalkable } from '../src/world/GameMap';
import { loadSpace, serializeSpace, type SpaceJSON } from '../src/world/MapLoader';
import { buildArena, scriptedRNG } from './helpers/fixtures';
import { loadRealWorld } from './helpers/world';

/** hit, head, min damage: kills anything at 1 hp. */
const KILL = [0, 0, 0];

describe('loot on death', () => {
  it('a monster drops a rolled item when the chance succeeds', () => {
    const gecko = createMonster('g', 'gecko', 1, 0);
    gecko.hp = 1;
    const { state } = buildArena({ width: 3, height: 1, player: { x: 0, y: 0 }, monsters: [gecko] });
    playerAttacks(state, gecko, scriptedRNG([...KILL, 0.2])); // d100 = 21 <= 35
    expect(groundItemsAt(state, 1, 0).map((g) => g.item.defId)).toEqual(['gecko-hide']);
    expect(state.spaces.arena!.monsters).toEqual([]);
  });

  it('and nothing when it fails (the boundary is inclusive)', () => {
    const miss = createMonster('g', 'gecko', 1, 0);
    miss.hp = 1;
    const a = buildArena({ width: 3, height: 1, player: { x: 0, y: 0 }, monsters: [miss] });
    playerAttacks(a.state, miss, scriptedRNG([...KILL, 0.35])); // d100 = 36 > 35
    expect(groundItemsAt(a.state, 1, 0)).toEqual([]);

    const edge = createMonster('g2', 'gecko', 1, 0);
    edge.hp = 1;
    const b = buildArena({ width: 3, height: 1, player: { x: 0, y: 0 }, monsters: [edge] });
    playerAttacks(b.state, edge, scriptedRNG([...KILL, 0.34])); // d100 = 35
    expect(groundItemsAt(b.state, 1, 0)).toHaveLength(1);
  });

  it('monsters without a loot table roll nothing', () => {
    const fly = createMonster('f', 'bloatfly', 1, 0);
    fly.hp = 1;
    const { state } = buildArena({ width: 3, height: 1, player: { x: 0, y: 0 }, monsters: [fly] });
    playerAttacks(state, fly, scriptedRNG(KILL)); // exactly the combat rolls, none for loot
    expect(groundItemsAt(state, 1, 0)).toEqual([]);
  });

  it('ammunition loot rolls a count in its range, only when it drops', () => {
    MONSTERS['test-bandit'] = {
      ...MONSTERS.gecko!,
      id: 'test-bandit',
      loot: [{ defId: '9mm-round', chance: 50, count: { min: 3, max: 7 } }],
    };
    try {
      const lo = createMonster('b1', 'test-bandit', 1, 0);
      lo.hp = 1;
      const a = buildArena({ width: 3, height: 1, player: { x: 0, y: 0 }, monsters: [lo] });
      playerAttacks(a.state, lo, scriptedRNG([...KILL, 0.1, 0])); // drops, count 3
      expect(groundItemsAt(a.state, 1, 0)[0]!.item.count).toBe(3);

      const hi = createMonster('b2', 'test-bandit', 1, 0);
      hi.hp = 1;
      const b = buildArena({ width: 3, height: 1, player: { x: 0, y: 0 }, monsters: [hi] });
      playerAttacks(b.state, hi, scriptedRNG([...KILL, 0.1, 0.999])); // count 7
      expect(groundItemsAt(b.state, 1, 0)[0]!.item.count).toBe(7);

      const none = createMonster('b3', 'test-bandit', 1, 0);
      none.hp = 1;
      const c = buildArena({ width: 3, height: 1, player: { x: 0, y: 0 }, monsters: [none] });
      playerAttacks(c.state, none, scriptedRNG([...KILL, 0.9])); // no count roll consumed
      expect(groundItemsAt(c.state, 1, 0)).toEqual([]);
    } finally {
      delete MONSTERS['test-bandit'];
    }
  });

  it('a dead NPC drops everything it carried, and its hands and quiver are cleared', () => {
    const ringo = createNpc('ringo', 'Ringo', 1, 0, ['hi']);
    applyLoadout(ringo, {
      inventory: ['9mm-pistol', { defId: '9mm-round', count: 8 }, 'stimpak'],
      wield: '9mm-pistol',
      ready: '9mm-round',
    });
    ringo.hp = 1;
    const { state } = buildArena({ width: 3, height: 1, player: { x: 0, y: 0 }, npcs: [ringo] });
    playerAttacks(state, ringo, scriptedRNG(KILL)); // NPCs have no loot table: no extra rolls
    const dropped = groundItemsAt(state, 1, 0).map((g) => [g.item.defId, g.item.count]);
    expect(dropped).toEqual([['9mm-pistol', undefined], ['9mm-round', 8], ['stimpak', undefined]]);
    expect(ringo.inventory).toEqual([]);
    expect(ringo.wielded).toBeNull();
    expect(ringo.readied).toBeNull();
    expect(state.spaces.arena!.npcs).toEqual([]);
  });

  it('carried ammunition and rolled ammunition merge on the floor', () => {
    MONSTERS['test-bandit'] = { ...MONSTERS.gecko!, id: 'test-bandit', loot: [{ defId: '9mm-round', chance: 100, count: { min: 2, max: 2 } }] };
    try {
      const m = createMonster('b', 'test-bandit', 1, 0);
      applyLoadout(m, { inventory: [{ defId: '9mm-round', count: 5 }] });
      m.hp = 1;
      const { state } = buildArena({ width: 3, height: 1, player: { x: 0, y: 0 }, monsters: [m] });
      playerAttacks(state, m, scriptedRNG([...KILL, 0, 0]));
      const here = groundItemsAt(state, 1, 0);
      expect(here).toHaveLength(1);
      expect(here[0]!.item.count).toBe(7);
    } finally {
      delete MONSTERS['test-bandit'];
    }
  });
});

describe('creature melee uses what it wields', () => {
  it('names the wielded weapon, with "their" for a proper name', async () => {
    const { creatureAttacks, creatureMeleeProfile } = await import('../src/engine/Combat');
    const ringo = createNpc('ringo', 'Ringo', 1, 0, ['hi']);
    applyLoadout(ringo, { inventory: ['baseball-bat'], wield: 'baseball-bat' });
    const { state, events } = buildArena({ width: 3, height: 1, player: { x: 0, y: 0 }, npcs: [ringo] });
    expect(creatureMeleeProfile(ringo).weaponName).toBe('baseball bat');
    creatureAttacks(state, ringo, scriptedRNG([0.999]), events);
    expect(state.messageLog).toEqual(['Ringo misses you with their baseball bat.']);
  });

  it('a wielded gun is used as a club (butt), and nothing wielded falls back to the natural attack', async () => {
    const { creatureMeleeProfile } = await import('../src/engine/Combat');
    const ringo = createNpc('ringo', 'Ringo', 1, 0, ['hi']);
    applyLoadout(ringo, { inventory: ['9mm-pistol'], wield: '9mm-pistol' });
    expect(creatureMeleeProfile(ringo).weaponName).toBe('9mm pistol');
    expect(creatureMeleeProfile(ringo).strengthBonus).toBe(false);
    const gecko = createMonster('g', 'gecko', 0, 0);
    expect(creatureMeleeProfile(gecko)).toBe(gecko.attack);
    expect(creatureMeleeProfile(gecko).weaponName).toBe('teeth');
  });
});

const FLAT: SpaceJSON = {
  id: 'hut',
  name: 'Hut',
  indoor: true,
  worldOrigin: { x: 5, y: 5 },
  width: 3,
  height: 3,
  tiles: Array(9).fill('floor') as string[],
  heights: Array(9).fill(0) as number[],
  npcs: [
    {
      id: 'ringo',
      name: 'Ringo',
      x: 5,
      y: 5,
      dialogue: ['hi'],
      interactions: ['talk'],
      inventory: ['9mm-pistol', { defId: '9mm-round', count: 8 }],
      wield: '9mm-pistol',
      ready: '9mm-round',
    },
  ],
  monsters: [{ defId: 'gecko', x: 6, y: 6, inventory: ['gecko-hide'] }],
  items: [
    { defId: 'stimpak', x: 7, y: 7 },
    { defId: '9mm-round', x: 6, y: 5, count: 12 },
  ],
  transitions: [],
};

describe('loader: ground items and loadouts', () => {
  it('loads ground items and creature loadouts', () => {
    const space = loadSpace(FLAT);
    expect(space.items.map((g) => [g.x, g.y, g.item.defId, g.item.count])).toEqual([
      [7, 7, 'stimpak', undefined],
      [6, 5, '9mm-round', 12],
    ]);
    const ringo = space.npcs[0]!;
    expect(ringo.inventory.map((i) => i.defId)).toEqual(['9mm-pistol', '9mm-round']);
    expect(ringo.inventory[1]!.count).toBe(8);
    expect(ringo.wielded).toBe(ringo.inventory[0]!.id);
    expect(ringo.readied).toBe(ringo.inventory[1]!.id);
    expect(space.monsters[0]!.inventory.map((i) => i.defId)).toEqual(['gecko-hide']);
  });

  it('round-trips through serializeSpace', () => {
    const out = serializeSpace(loadSpace(FLAT));
    expect(out.items).toEqual(FLAT.items);
    expect(out.npcs[0]).toMatchObject({
      inventory: ['9mm-pistol', { defId: '9mm-round', count: 8 }],
      wield: '9mm-pistol',
      ready: '9mm-round',
    });
    expect(out.monsters).toEqual([{ defId: 'gecko', x: 6, y: 6, inventory: ['gecko-hide'] }]);
    // and it loads again to the same thing
    expect(serializeSpace(loadSpace(out))).toEqual(out);
  });

  it('an NPC with no loadout serializes without loadout fields', () => {
    const plain: SpaceJSON = { ...FLAT, npcs: [{ id: 'a', name: 'A', x: 5, y: 5, dialogue: ['x'] }], monsters: [], items: undefined };
    const out = serializeSpace(loadSpace(plain));
    expect(out.npcs[0]).not.toHaveProperty('inventory');
    expect(out.npcs[0]).not.toHaveProperty('wield');
    expect(out.items).toBeUndefined();
  });

  it('an unknown item id throws, on the floor or in a pack', () => {
    expect(() => loadSpace({ ...FLAT, items: [{ defId: 'laser-rifle', x: 5, y: 5 }] })).toThrow(/Unknown item/);
    expect(() =>
      loadSpace({ ...FLAT, npcs: [{ id: 'a', name: 'A', x: 5, y: 5, dialogue: ['x'], inventory: ['laser-rifle'] }] }),
    ).toThrow(/Unknown item/);
  });

  it('wielding something that is not carried throws', () => {
    expect(() =>
      loadSpace({ ...FLAT, npcs: [{ id: 'a', name: 'A', x: 5, y: 5, dialogue: ['x'], wield: '9mm-pistol' }] }),
    ).toThrow(/does not carry/);
    expect(() =>
      loadSpace({ ...FLAT, npcs: [{ id: 'a', name: 'A', x: 5, y: 5, dialogue: ['x'], inventory: ['stimpak'], wield: 'stimpak' }] }),
    ).toThrow(/not a weapon/);
  });
});

describe('Goodsprings (real data)', () => {
  const space = loadRealWorld();

  it('every ground item lies on a walkable cell', () => {
    expect(space.items.length).toBe(4);
    for (const g of space.items) {
      expect(isWalkable(space.grid, g.x, g.y), `${g.item.defId} at ${g.x},${g.y}`).toBe(true);
    }
    const at = (x: number, y: number) => space.items.find((g) => g.x === x && g.y === y)!.item;
    expect(at(18, 22).defId).toBe('stimpak');
    expect(at(19, 22)).toMatchObject({ defId: '9mm-round', count: 12 });
    expect(at(12, 11).defId).toBe('9mm-pistol');
    expect(at(14, 13).defId).toBe('stimpak');
  });

  it('Ringo carries a pistol and ammunition, ammo readied, pistol NOT wielded', () => {
    const ringo = space.npcs.find((n) => n.id === 'ringo')!;
    expect(ringo.inventory.map((i) => i.defId)).toEqual(['9mm-pistol', '9mm-round']);
    expect(ringo.inventory[1]!.count).toBe(8);
    expect(ringo.readied).toBe(ringo.inventory[1]!.id);
    expect(ringo.wielded).toBeNull();
    expect(ringo.hostile).toBe(false);
  });

  it('Doc Mitchell carries three stimpaks', () => {
    const doc = space.npcs.find((n) => n.id === 'doc-mitchell')!;
    expect(doc.inventory.map((i) => i.defId)).toEqual(['stimpak', 'stimpak', 'stimpak']);
  });
});
