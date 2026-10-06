import { describe, expect, it } from 'vitest';
import { runCreatureTurns } from '../src/ai/AIScheduler';
import type { GameEvents } from '../src/engine/EventBus';
import { recomputeVisibility } from '../src/engine/TurnManager';
import { createMonster } from '../src/entities/Monster';
import { createNpc, type Npc } from '../src/entities/Npc';
import { applyLoadout, type LoadoutJSON } from '../src/items/Loadout';
import { itemCount } from '../src/items/Item';
import { setHeight } from '../src/world/GameMap';
import type { RNG } from '../src/utils/RNG';
import { buildArena, type Arena, type ArenaOptions } from './helpers/fixtures';

const MISS: RNG = () => 0.999;
const HIT: RNG = () => 0;

const PISTOL_LOADOUT: LoadoutJSON = {
  inventory: ['9mm-pistol', { defId: '9mm-round', count: 3 }],
  ready: '9mm-round',
};

/** A provoked, gun-carrying Ringo. */
function ringo(x: number, y: number, loadout: LoadoutJSON = PISTOL_LOADOUT): Npc {
  const npc = createNpc('ringo', 'Ringo', x, y, ['hi']);
  applyLoadout(npc, loadout);
  npc.hostile = true;
  npc.alerted = true;
  npc.energy = 0;
  return npc;
}

function arena(opts: Omit<ArenaOptions, 'npcs'>, ...npcs: Npc[]): Arena {
  return buildArena({ ...opts, npcs });
}

function tick(a: Arena, rng: RNG = MISS): void {
  runCreatureTurns(a.state, rng, a.events);
}

function shots(a: Arena) {
  return a.emitted.filter((e) => e.name === 'shot-fired').map((e) => e.payload as GameEvents['shot-fired']);
}

function ammoLeft(npc: Npc): number {
  const stack = npc.inventory.find((i) => i.defId === '9mm-round');
  return stack ? itemCount(stack) : 0;
}

describe('an armed hostile draws, lines up and fires', () => {
  it('spends exactly one action drawing the pistol, with a message when you can see them', () => {
    const r = ringo(5, 0);
    const a = arena({ width: 10, height: 1, player: { x: 0, y: 0 } }, r);
    recomputeVisibility(a.state);
    tick(a);
    expect(r.wielded).toBe(r.inventory.find((i) => i.defId === '9mm-pistol')!.id);
    expect(a.state.messageLog).toEqual(['Ringo wields their 9mm pistol!']);
    expect(shots(a)).toEqual([]);
    expect(ammoLeft(r)).toBe(3);
    expect(r.x).toBe(5);
  });

  it('draws silently if the player cannot see the creature', () => {
    const r = ringo(5, 0);
    const a = arena({ width: 10, height: 1, player: { x: 0, y: 0 } }, r);
    // visibility never computed: nothing is in view
    tick(a);
    expect(r.wielded).not.toBeNull();
    expect(a.state.messageLog).toEqual([]);
  });

  it('readies its ammunition as part of drawing if nothing was readied', () => {
    const r = ringo(5, 0, { inventory: ['9mm-pistol', { defId: '9mm-round', count: 3 }] });
    expect(r.readied).toBeNull();
    const a = arena({ width: 10, height: 1, player: { x: 0, y: 0 } }, r);
    tick(a);
    expect(r.readied).toBe(r.inventory.find((i) => i.defId === '9mm-round')!.id);
    tick(a, MISS);
    expect(shots(a)).toHaveLength(1);
  });

  it('then fires along a straight line: ammo spent, narrated, event emitted', () => {
    const r = ringo(5, 0);
    const a = arena({ width: 10, height: 1, player: { x: 0, y: 0 } }, r);
    recomputeVisibility(a.state);
    tick(a); // draw
    tick(a, MISS); // fire
    expect(ammoLeft(r)).toBe(2);
    expect(a.state.messageLog).toEqual(['Ringo wields their 9mm pistol!', 'Ringo misses you with their 9mm pistol.']);
    const [shot] = shots(a);
    expect(shot).toMatchObject({ shooterId: 'ringo' });
    expect(shot!.hitId).toBeUndefined();
    expect(r.x).toBe(5); // stood still to shoot
  });

  it('a hit narrates "shoots you in the ..." and hurts the player', () => {
    const r = ringo(3, 0);
    const a = arena({ width: 10, height: 1, player: { x: 0, y: 0 } }, r);
    tick(a);
    tick(a, HIT);
    expect(a.state.messageLog.at(-1)).toBe('Ringo shoots you in the head with their 9mm pistol.');
    expect(a.state.player.hp).toBeLessThan(a.state.player.maxHp);
    expect(shots(a)[0]!.hitId).toBe('player');
  });

  it('fires on a diagonal', () => {
    const r = ringo(4, 4);
    const a = arena({ width: 10, height: 10, player: { x: 0, y: 0 } }, r);
    tick(a);
    tick(a);
    expect(shots(a)).toHaveLength(1);
    expect(shots(a)[0]!.path[0]).toEqual({ x: 3, y: 3 });
    expect(r.x).toBe(4);
  });

  it('shoots point-blank when adjacent', () => {
    const r = ringo(1, 0);
    const a = arena({ width: 5, height: 1, player: { x: 0, y: 0 } }, r);
    tick(a);
    tick(a);
    expect(a.state.messageLog.at(-1)).toBe('Ringo misses you with their 9mm pistol.');
    expect(shots(a)).toHaveLength(1);
  });

  it('lines up with one step orthogonally, preferring to keep its distance', () => {
    const r = ringo(5, 1);
    r.wielded = r.inventory.find((i) => i.defId === '9mm-pistol')!.id;
    const a = arena({ width: 10, height: 3, player: { x: 0, y: 0 } }, r);
    tick(a);
    expect({ x: r.x, y: r.y }).toEqual({ x: 6, y: 0 }); // (4,0) and (5,0) line up too, but are closer
    expect(shots(a)).toEqual([]);
    tick(a);
    expect(shots(a)).toHaveLength(1);
  });

  it('lines up onto a diagonal', () => {
    const r = ringo(5, 4);
    r.wielded = r.inventory.find((i) => i.defId === '9mm-pistol')!.id;
    const a = arena({ width: 10, height: 10, player: { x: 0, y: 0 } }, r);
    tick(a);
    expect({ x: r.x, y: r.y }).toEqual({ x: 5, y: 5 });
    tick(a);
    expect(shots(a)).toHaveLength(1);
  });

  it('closes in when no single step gives a shot', () => {
    const r = ringo(8, 4);
    r.wielded = r.inventory.find((i) => i.defId === '9mm-pistol')!.id;
    const a = arena({ width: 12, height: 8, player: { x: 0, y: 0 } }, r);
    tick(a);
    expect(Math.max(r.x, r.y)).toBeLessThan(8);
    expect(shots(a)).toEqual([]);
  });

  it('does not shoot from beyond the gun range, and approaches', () => {
    const r = ringo(14, 0);
    r.wielded = r.inventory.find((i) => i.defId === '9mm-pistol')!.id;
    const a = arena({ width: 20, height: 1, player: { x: 0, y: 0 } }, r);
    tick(a);
    expect(shots(a)).toEqual([]);
    expect(r.x).toBe(13);
  });

  it('does not shoot through another creature', () => {
    const r = ringo(5, 0);
    r.wielded = r.inventory.find((i) => i.defId === '9mm-pistol')!.id;
    const brahmin = createMonster('b', 'brahmin', 2, 0);
    const a = buildArena({ width: 10, height: 1, player: { x: 0, y: 0 }, npcs: [r], monsters: [brahmin] });
    tick(a);
    expect(shots(a)).toEqual([]);
    expect(ammoLeft(r)).toBe(3);
    expect(brahmin.hp).toBe(brahmin.maxHp);
  });

  it('does not shoot through a wall', () => {
    const r = ringo(5, 0);
    r.wielded = r.inventory.find((i) => i.defId === '9mm-pistol')!.id;
    const a = arena({ width: 10, height: 1, player: { x: 0, y: 0 }, walls: [[3, 0]] }, r);
    tick(a);
    expect(shots(a)).toEqual([]);
  });

  it('does not shoot through terrain cover', () => {
    const r = ringo(5, 0);
    r.wielded = r.inventory.find((i) => i.defId === '9mm-pistol')!.id;
    const a = arena({ width: 10, height: 1, player: { x: 0, y: 0 } }, r);
    setHeight(a.grid, 3, 0, 2);
    tick(a);
    expect(shots(a)).toEqual([]);
  });

  it('a shot alerts other hostiles nearby but not peaceful ones', () => {
    const r = ringo(5, 0);
    const gecko = createMonster('g', 'gecko', 5, 7);
    const brahmin = createMonster('b', 'brahmin', 6, 7, );
    const a = buildArena({ width: 10, height: 10, player: { x: 0, y: 0 }, npcs: [r], monsters: [gecko, brahmin] });
    tick(a); // draw
    gecko.alerted = false;
    tick(a); // fire
    expect(gecko.alerted).toBe(true);
    expect(brahmin.alerted).toBe(false);
  });

  it('every action is one action: speed 24 draws and fires in the same tick', () => {
    const r = ringo(5, 0);
    r.speed = 24;
    const a = arena({ width: 10, height: 1, player: { x: 0, y: 0 } }, r);
    tick(a);
    expect(shots(a)).toHaveLength(1);
    expect(ammoLeft(r)).toBe(2);
  });
});

describe('an armed hostile without usable ammunition', () => {
  it('never draws a gun it has no ammunition for', () => {
    const r = ringo(1, 0, { inventory: ['9mm-pistol'] });
    const a = arena({ width: 5, height: 1, player: { x: 0, y: 0 } }, r);
    recomputeVisibility(a.state);
    tick(a);
    expect(r.wielded).toBeNull();
    expect(a.state.messageLog).toEqual(['Ringo misses you with their bare hands.']);
    expect(shots(a)).toEqual([]);
  });

  it('runs dry: the last round is fired, then the gun is put away', () => {
    const r = ringo(5, 0, { inventory: ['9mm-pistol', { defId: '9mm-round', count: 1 }], ready: '9mm-round' });
    const a = arena({ width: 10, height: 1, player: { x: 0, y: 0 } }, r);
    recomputeVisibility(a.state);
    tick(a); // draw
    tick(a); // fire the only round
    expect(ammoLeft(r)).toBe(0);
    expect(r.readied).toBeNull();
    a.state.messageLog.length = 0;
    tick(a); // out of ammo
    expect(a.state.messageLog).toEqual(["Ringo's 9mm pistol is out of ammo."]);
    expect(r.wielded).toBeNull();
    expect(shots(a)).toHaveLength(1);
    tick(a); // now an ordinary melee-range hunter again
    expect(r.x).toBe(4);
  });

  it('falls back on a melee weapon it carries', () => {
    const r = ringo(1, 0, {
      inventory: ['9mm-pistol', 'baseball-bat'],
      wield: '9mm-pistol',
    });
    const a = arena({ width: 5, height: 1, player: { x: 0, y: 0 } }, r);
    recomputeVisibility(a.state);
    tick(a);
    expect(a.state.messageLog).toEqual(["Ringo's 9mm pistol is out of ammo."]);
    expect(r.wielded).toBe(r.inventory.find((i) => i.defId === 'baseball-bat')!.id);
    tick(a);
    expect(a.state.messageLog.at(-1)).toBe('Ringo misses you with their baseball bat.');
  });

  it('out-of-ammo message is silent when unseen', () => {
    const r = ringo(1, 0, { inventory: ['9mm-pistol'], wield: '9mm-pistol' });
    const a = arena({ width: 5, height: 1, player: { x: 0, y: 0 } }, r);
    tick(a);
    expect(a.state.messageLog).toEqual([]);
    expect(r.wielded).toBeNull();
  });
});

describe('melee creatures use what they carry', () => {
  it('a hostile wielding a baseball bat hits with it and the log says so', () => {
    const r = ringo(1, 0, { inventory: ['baseball-bat'], wield: 'baseball-bat' });
    const a = arena({ width: 5, height: 1, player: { x: 0, y: 0 } }, r);
    tick(a, HIT);
    expect(a.state.messageLog[0]).toBe('Ringo hits you in the head with their baseball bat.');
  });

  it('monsters keep their natural attack', () => {
    const gecko = createMonster('g', 'gecko', 1, 0);
    gecko.energy = 0;
    const a = buildArena({ width: 5, height: 1, player: { x: 0, y: 0 }, monsters: [gecko] });
    tick(a, HIT);
    expect(a.state.messageLog[0]).toMatch(/^The gecko hits you in the .* with its teeth\.$/);
  });
});

describe('the headline scenario: hit Ringo and he draws and shoots back', () => {
  it('is peaceful with an unwielded pistol, provoked by the player, then arms himself', async () => {
    const { playerAttacks } = await import('../src/engine/Combat');
    const r = createNpc('ringo', 'Ringo', 1, 0, ['hi']);
    applyLoadout(r, PISTOL_LOADOUT);
    r.energy = 0;
    const a = buildArena({ width: 8, height: 1, player: { x: 0, y: 0 }, npcs: [r] });
    recomputeVisibility(a.state);
    tick(a);
    expect(r.wielded).toBeNull(); // peaceful: leaves the gun alone
    expect(a.state.messageLog).toEqual([]);

    playerAttacks(a.state, r, MISS); // a miss still provokes
    expect(r.hostile && r.alerted).toBe(true);
    a.state.messageLog.length = 0;
    tick(a);
    expect(a.state.messageLog).toEqual(['Ringo wields their 9mm pistol!']);
    tick(a);
    expect(a.state.messageLog.at(-1)).toBe('Ringo misses you with their 9mm pistol.');
  });
});
