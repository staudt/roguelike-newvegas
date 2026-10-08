import { describe, expect, it } from 'vitest';
import { runCreatureTurns } from '../src/ai/AIScheduler';
import { applyThreshold } from '../src/combat/CombatResolver';
import {
  ARMOR_DT_AT_ZERO,
  CARRIED_CONDITION,
  GUN_DAMAGE_AT_ZERO,
  MELEE_DAMAGE_AT_ZERO,
  WEAR_PER_ATTACK,
} from '../src/config/constants';
import { takeOffArmor, wearArmor } from '../src/engine/Apparel';
import { creatureAttacks, playerAttacks } from '../src/engine/Combat';
import { dropItem, fireGun } from '../src/engine/Items';
import { swapWeapons, wieldItem } from '../src/engine/TurnManager';
import { createMonster } from '../src/entities/Monster';
import { createNpc } from '../src/entities/Npc';
import { damageThreshold, wieldedAttackProfile, wornIn } from '../src/items/Carrying';
import {
  armorDT,
  conditionFraction,
  conditionPercent,
  damageFactor,
  isBroken,
  rollJam,
  setConditionPercent,
  wear,
} from '../src/items/Condition';
import { createItem, type Item } from '../src/items/Item';
import { itemDef, type ArmorDef } from '../src/items/ItemData';
import { applyLoadout, loadoutOf } from '../src/items/Loadout';
import type { RNG } from '../src/utils/RNG';
import { buildArena, scriptedRNG } from './helpers/fixtures';

const ALWAYS_HIT: RNG = () => 0;
const NEVER_WANDER: RNG = () => 0.999;

function at(defId: string, percent: number): Item {
  const item = createItem(defId);
  setConditionPercent(item, percent);
  return item;
}

describe('condition', () => {
  it('starts as new, reads as a fraction and a percent, and only for things that wear', () => {
    const knife = createItem('combat-knife');
    expect(knife.condition).toBeUndefined();
    expect(conditionFraction(knife)).toBe(1);
    expect(conditionPercent(knife)).toBe('100%');
    expect(conditionPercent(createItem('stimpak'))).toBeNull();
    expect(conditionPercent(at('9mm-pistol', 62))).toBe('62%');
  });

  it('wears by points and breaks at 0, only once', () => {
    const knife = at('combat-knife', 1); // 1% of 120 = 1 point
    expect(knife.condition).toBe(1);
    expect(wear(knife, 1)).toBe(true);
    expect(isBroken(knife)).toBe(true);
    expect(wear(knife, 1)).toBe(false);
  });

  it('a gun keeps more of its damage than a blade as it wears (New Vegas: 66% vs 50%)', () => {
    expect(damageFactor(createItem('9mm-pistol'))).toBe(1);
    expect(damageFactor(at('9mm-pistol', 0))).toBeCloseTo(GUN_DAMAGE_AT_ZERO, 5);
    expect(damageFactor(at('combat-knife', 0))).toBeCloseTo(MELEE_DAMAGE_AT_ZERO, 5);
    expect(damageFactor(at('9mm-pistol', 50))).toBeCloseTo(GUN_DAMAGE_AT_ZERO + (1 - GUN_DAMAGE_AT_ZERO) / 2, 2);
  });

  it('a worn weapon passes its damage factor into the attack profile; a new one adds nothing', () => {
    const knife = at('combat-knife', 50);
    const c = { inventory: [knife], wielded: knife.id, readied: null, worn: [] as string[] };
    expect(wieldedAttackProfile(c)!.damageFactor).toBeCloseTo(0.75, 2);
    const fresh = createItem('combat-knife');
    expect(wieldedAttackProfile({ ...c, inventory: [fresh], wielded: fresh.id })!.damageFactor).toBeUndefined();
  });

  it('only a gun below half condition rolls for a jam, and a good one never touches the RNG', () => {
    expect(rollJam(createItem('9mm-pistol'), scriptedRNG([]))).toBe(false);
    expect(rollJam(at('9mm-pistol', 60), scriptedRNG([]))).toBe(false);
    expect(rollJam(at('9mm-pistol', 10), scriptedRNG([0]))).toBe(true);
    expect(rollJam(at('9mm-pistol', 10), scriptedRNG([0.99]))).toBe(false);
  });

  it('armor gives its full DT new, ARMOR_DT_AT_ZERO of it nearly gone, and none broken', () => {
    const dt = (itemDef('leather-armor') as ArmorDef).dt;
    expect(armorDT(createItem('leather-armor'))).toBe(dt);
    expect(armorDT(at('leather-armor', 1))).toBeCloseTo(dt * ARMOR_DT_AT_ZERO, 1);
    expect(armorDT(at('leather-armor', 0))).toBe(0);
  });
});

describe('Damage Threshold', () => {
  it('comes off each blow, but at least 20% (and 1) always lands', () => {
    expect(applyThreshold(8, 0)).toEqual({ damage: 8, absorbed: 0 });
    expect(applyThreshold(8, 3)).toEqual({ damage: 5, absorbed: 3 });
    expect(applyThreshold(10, 9)).toEqual({ damage: 2, absorbed: 8 });
    expect(applyThreshold(2, 5)).toEqual({ damage: 1, absorbed: 1 });
  });

  it('sums the armor worn and a natural hide', () => {
    const vest = createItem('leather-armor');
    const hat = createItem('cowboy-hat');
    const c = { inventory: [vest, hat], wielded: null, readied: null, worn: [vest.id, hat.id], naturalDT: 1 };
    expect(damageThreshold(c)).toBe(3 + 1 + 1);
  });

  it('cuts a gecko bite on an armored player, and the vest wears for it', () => {
    const gecko = createMonster('g', 'gecko', 1, 0);
    const a = buildArena({ width: 3, height: 1, player: { x: 0, y: 0 }, monsters: [gecko] });
    const armor = createItem('leather-armor');
    a.state.player.inventory.push(armor);
    a.state.player.worn.push(armor.id);
    const hpBefore = a.state.player.hp;
    // to-hit 0 (hit), limb 0.5 (the torso for a gecko's profile), damage 0.999 (max: 4)
    creatureAttacks(a.state, gecko, scriptedRNG([0, 0.5, 0.999]), a.events);
    expect(hpBefore - a.state.player.hp).toBe(1); // 4 - DT 3
    expect(armor.condition).toBe((itemDef('leather-armor') as ArmorDef).durability - 1);
  });
});

describe('weapons wear with use', () => {
  it('a landed blow wears the knife; a miss does not', () => {
    const gecko = createMonster('g', 'gecko', 1, 0);
    gecko.hp = 999;
    const a = buildArena({ width: 3, height: 1, player: { x: 0, y: 0 }, monsters: [gecko] });
    const knife = a.state.player.inventory.find((i) => i.defId === 'combat-knife')!;
    a.state.player.wielded = knife.id;
    playerAttacks(a.state, gecko, () => 0.999);
    expect(knife.condition).toBeUndefined();
    playerAttacks(a.state, gecko, ALWAYS_HIT);
    expect(knife.condition).toBe(120 - WEAR_PER_ATTACK);
  });

  it('a weapon that breaks leaves your hand, says so, and cannot be wielded again', () => {
    const gecko = createMonster('g', 'gecko', 1, 0);
    gecko.hp = 999;
    const a = buildArena({ width: 3, height: 1, player: { x: 0, y: 0 }, monsters: [gecko] });
    const knife = a.state.player.inventory.find((i) => i.defId === 'combat-knife')!;
    knife.condition = 1;
    a.state.player.wielded = knife.id;
    playerAttacks(a.state, gecko, ALWAYS_HIT);
    expect(a.state.messageLog).toContain('Your combat knife breaks!');
    expect(a.state.player.wielded).toBeNull();
    expect(a.state.player.inventory).toContain(knife);
    a.state.messageLog.length = 0;
    expect(wieldItem(a.state, knife.id, a.events)).toBe(false);
    expect(a.state.messageLog).toEqual(['The combat knife is broken.']);
  });

  it('x will not swap to a broken alternate', () => {
    const a = buildArena({ width: 3, height: 1, player: { x: 0, y: 0 } });
    const bat = a.state.player.inventory.find((i) => i.defId === 'baseball-bat')!;
    bat.condition = 0;
    a.state.player.alternate = bat.id;
    expect(swapWeapons(a.state, a.events)).toBe(false);
    expect(a.state.messageLog.at(-1)).toBe('Your baseball bat is broken.');
  });

  it('each shot wears the gun', () => {
    const a = buildArena({ width: 5, height: 1, player: { x: 0, y: 0 } });
    const pistol = a.state.player.inventory.find((i) => i.defId === '9mm-pistol')!;
    a.state.player.wielded = pistol.id;
    fireGun(a.state, 'E', a.events, ALWAYS_HIT);
    expect(pistol.condition).toBe(150 - WEAR_PER_ATTACK);
  });

  it('a worn-out gun can jam: the turn goes, the round stays', () => {
    const a = buildArena({ width: 5, height: 1, player: { x: 0, y: 0 } });
    const pistol = a.state.player.inventory.find((i) => i.defId === '9mm-pistol')!;
    const rounds = a.state.player.inventory.find((i) => i.defId === '9mm-round')!;
    setConditionPercent(pistol, 10);
    a.state.player.wielded = pistol.id;
    expect(fireGun(a.state, 'E', a.events, ALWAYS_HIT)).toBe(true);
    expect(a.state.messageLog).toContain('Your 9mm pistol jams! You clear it.');
    expect(rounds.count).toBe(24);
    expect(a.state.turnCount).toBe(1);
  });
});

describe('W and T', () => {
  it('wear, swap on the same slot, and take off, a turn each', () => {
    const a = buildArena({ width: 3, height: 1, player: { x: 0, y: 0 } });
    const p = a.state.player;
    const hat = createItem('cowboy-hat');
    const helmet = createItem('metal-helmet');
    p.inventory.push(hat, helmet);
    expect(wearArmor(a.state, hat.id, a.events)).toBe(true);
    expect(wornIn(p, 'head')).toBe(hat);
    expect(wearArmor(a.state, helmet.id, a.events)).toBe(true);
    expect(a.state.messageLog.at(-1)).toBe('You take off the cowboy hat and put on the metal helmet.');
    expect(p.worn).toEqual([helmet.id]);
    expect(takeOffArmor(a.state, helmet.id, a.events)).toBe(true);
    expect(p.worn).toEqual([]);
    expect(a.state.turnCount).toBe(3);
  });

  it('refuses broken armor and things that are not armor, free', () => {
    const a = buildArena({ width: 3, height: 1, player: { x: 0, y: 0 } });
    const rag = at('leather-armor', 0);
    a.state.player.inventory.push(rag);
    expect(wearArmor(a.state, rag.id, a.events)).toBe(false);
    const knife = a.state.player.inventory.find((i) => i.defId === 'combat-knife')!;
    expect(wearArmor(a.state, knife.id, a.events)).toBe(false);
    expect(a.state.turnCount).toBe(0);
  });

  it('dropping worn armor takes it off first', () => {
    const a = buildArena({ width: 3, height: 1, player: { x: 0, y: 0 } });
    const vest = createItem('merc-outfit');
    a.state.player.inventory.push(vest);
    a.state.player.worn.push(vest.id);
    dropItem(a.state, vest.id, a.events);
    expect(a.state.player.worn).toEqual([]);
    expect(a.state.messageLog).toEqual(['You take off the merc outfit.', 'You drop the merc outfit.']);
  });

  it('armor that falls apart comes off and says so', () => {
    const gecko = createMonster('g', 'gecko', 1, 0);
    const a = buildArena({ width: 3, height: 1, player: { x: 0, y: 0 }, monsters: [gecko] });
    const armor = createItem('leather-armor');
    armor.condition = 1;
    a.state.player.inventory.push(armor);
    a.state.player.worn.push(armor.id);
    creatureAttacks(a.state, gecko, scriptedRNG([0, 0.5, 0.999]), a.events);
    expect(a.state.messageLog).toContain('Your leather armor falls apart!');
    expect(a.state.player.worn).toEqual([]);
  });
});

describe('loadouts', () => {
  it('wear armor, take a condition in percent, and come used with an rng', () => {
    const npc = createNpc('r', 'Raider', 0, 0, ['...']);
    applyLoadout(npc, {
      inventory: ['leather-armor', { defId: '9mm-pistol', condition: 40 }, 'combat-knife'],
      wear: ['leather-armor'],
    }, () => 0);
    expect(wornIn(npc, 'body')!.defId).toBe('leather-armor');
    const pistol = npc.inventory.find((i) => i.defId === '9mm-pistol')!;
    expect(conditionPercent(pistol)).toBe('40%');
    const knife = npc.inventory.find((i) => i.defId === 'combat-knife')!;
    expect(conditionPercent(knife)).toBe(`${CARRIED_CONDITION.min}%`); // rng 0: the bottom of the range
    expect(loadoutOf(npc).wear).toEqual(['leather-armor']);
  });

  it('refuses to wear what it does not carry, or two things on one slot', () => {
    const npc = createNpc('r', 'Raider', 0, 0, ['...']);
    expect(() => applyLoadout(npc, { wear: ['leather-armor'] })).toThrow(/does not carry/);
    const two = createNpc('t', 'Two', 0, 0, ['...']);
    expect(() =>
      applyLoadout(two, { inventory: ['leather-armor', 'merc-outfit'], wear: ['leather-armor', 'merc-outfit'] }),
    ).toThrow(/two things on the body/);
  });
});

describe('creatures and broken guns', () => {
  it('a creature never draws a broken gun', () => {
    const npc = createNpc('r', 'Raider', 4, 0, ['...']);
    applyLoadout(npc, { inventory: [{ defId: '9mm-pistol', condition: 0 }, { defId: '9mm-round', count: 5 }] });
    npc.hostile = true;
    npc.alerted = true;
    npc.energy = 0;
    const a = buildArena({ width: 8, height: 1, player: { x: 0, y: 0 }, npcs: [npc] });
    runCreatureTurns(a.state, NEVER_WANDER, a.events);
    expect(npc.wielded).toBeNull();
  });
});

describe('two guns, two calibres', () => {
  it('switching guns readies the rounds that fit each, and firing keeps it right', () => {
    const a = buildArena({ width: 8, height: 1, player: { x: 0, y: 0 } });
    const p = a.state.player;
    const rifle = createItem('varmint-rifle');
    const rifleRounds = createItem('556-round', 10);
    p.inventory.push(rifle, rifleRounds);
    const pistol = p.inventory.find((i) => i.defId === '9mm-pistol')!;
    const nineMil = p.inventory.find((i) => i.defId === '9mm-round')!;

    wieldItem(a.state, rifle.id, a.events);
    expect(p.readied).toBe(rifleRounds.id);
    wieldItem(a.state, pistol.id, a.events);
    expect(p.readied).toBe(nineMil.id);

    // Wrong rounds readied by hand: the trigger swaps in the right ones by itself.
    p.wielded = rifle.id;
    p.readied = nineMil.id;
    fireGun(a.state, 'E', a.events, ALWAYS_HIT);
    expect(p.readied).toBe(rifleRounds.id);
    expect(rifleRounds.count).toBe(9);
    expect(nineMil.count).toBe(24);
  });
});

describe('natural Damage Threshold', () => {
  it("a mantis's chitin takes the edge off a blow", () => {
    const blowOn = (dt: number): number => {
      const mantis = createMonster('m', 'giant-mantis', 1, 0);
      mantis.naturalDT = dt;
      const a = buildArena({ width: 3, height: 1, player: { x: 0, y: 0 }, monsters: [mantis] });
      const knife = a.state.player.inventory.find((i) => i.defId === 'combat-knife')!;
      a.state.player.wielded = knife.id;
      const before = mantis.hp;
      playerAttacks(a.state, mantis, scriptedRNG([0, 0.5, 0.999])); // hit, the body, top damage
      return before - mantis.hp;
    };
    expect(createMonster('m', 'giant-mantis', 0, 0).naturalDT).toBe(1);
    expect(blowOn(0) - blowOn(1)).toBe(1);
  });
});
