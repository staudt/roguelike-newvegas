import { describe, expect, it } from 'vitest';
import { runCreatureTurns } from '../src/ai/AIScheduler';
import { NPC_WANDER_CHANCE, NPC_WANDER_RADIUS, PEACEFUL_WANDER_CHANCE } from '../src/config/constants';
import { playerAttacks } from '../src/engine/Combat';
import { dropCreatureItems } from '../src/engine/GroundItems';
import { CREATURES, creatureDef, traitsOf } from '../src/entities/CreatureData';
import { createMonster } from '../src/entities/Monster';
import { createNpc } from '../src/entities/Npc';
import type { RNG } from '../src/utils/RNG';
import { getTileId } from '../src/world/GameMap';
import { buildArena } from './helpers/fixtures';

const ALWAYS_HIT: RNG = () => 0;
const NEVER_WANDER: RNG = () => 0.999;

describe('creature kinds decide behaviour, not NPC vs monster', () => {
  it('a named NPC takes its stats and traits from the townsperson kind by default', () => {
    const def = creatureDef('townsperson');
    const npc = createNpc('t', 'Trudy', 3, 4, ['hi']);
    expect(npc).toMatchObject({
      defId: 'townsperson',
      glyph: '@',
      hp: def.hp,
      ac: def.ac,
      awareness: def.awareness,
      social: true,
      opensDoors: true,
      wanderChance: NPC_WANDER_CHANCE,
      wanderRadius: NPC_WANDER_RADIUS,
      home: { x: 3, y: 4 },
      proper: true,
      hostile: false,
    });
  });

  it('a profile kind swaps the stats and traits, and the person keeps their name', () => {
    const npc = createNpc('z', 'Old Zeke', 0, 0, ['...'], undefined, ['talk'], { kind: 'ghoul' });
    expect(npc).toMatchObject({ name: 'Old Zeke', proper: true, hp: creatureDef('ghoul').hp, social: false, opensDoors: false });
    expect(npc.hostile).toBe(true); // a feral ghoul attacks on sight, named or not
  });

  it('animals roam freely and step more often; people stay near home', () => {
    expect(traitsOf(creatureDef('brahmin'))).toEqual({
      opensDoors: false,
      social: false,
      wanderChance: PEACEFUL_WANDER_CHANCE,
      wanderRadius: null,
    });
    expect(traitsOf({ ...creatureDef('brahmin'), wanderRadius: 2 }).wanderRadius).toBe(2);
  });

  it('every kind has a known body and sane numbers', () => {
    for (const def of Object.values(CREATURES)) {
      expect(def.hp).toBeGreaterThan(0);
      expect(def.speed).toBeGreaterThan(0);
      expect(def.awareness).toBeGreaterThan(0);
    }
  });
});

describe('an unnamed person placed from the table acts like one', () => {
  it('hears a scream and comes to look, where a brahmin does not', () => {
    const victim = createNpc('doc', 'Doc', 1, 0, ['hi']);
    const local = createMonster('local', 'townsperson', 5, 0);
    const brahmin = createMonster('cow', 'brahmin', 6, 0);
    const a = buildArena({ width: 10, height: 1, player: { x: 0, y: 0 }, npcs: [victim], monsters: [local, brahmin] });
    playerAttacks(a.state, victim, ALWAYS_HIT);
    expect(local.investigate).toEqual({ x: 1, y: 0 });
    expect(local.alarm).toBe('pending');
    expect(brahmin.investigate).toBeNull();
  });

  it('cries out when hit, like a named person', () => {
    const local = createMonster('local', 'townsperson', 1, 0);
    const a = buildArena({ width: 10, height: 1, player: { x: 0, y: 0 }, monsters: [local] });
    playerAttacks(a.state, local, ALWAYS_HIT);
    expect(local.provoked).toBe(true);
    expect(a.state.messageLog).toContain('You hear a scream.');
  });

  it('opens a closed door on its way to you, where an animal cannot get through', () => {
    for (const [defId, opens] of [['townsperson', true], ['gecko', false]] as const) {
      const c = createMonster('c', defId, 4, 1);
      c.hostile = true;
      c.alerted = true;
      c.energy = 0;
      // A wall across the arena with one door; the player waits on the far side.
      const walls: Array<[number, number]> = [[2, 0], [2, 2]];
      const a = buildArena({ width: 6, height: 3, player: { x: 0, y: 1 }, monsters: [c], walls, doors: [[2, 1]] });
      for (let i = 0; i < 3; i++) runCreatureTurns(a.state, NEVER_WANDER, a.events);
      expect(getTileId(a.grid, 2, 1) === 'openDoor').toBe(opens);
    }
  });
});

describe('loot comes from the kind', () => {
  it('a named NPC of a kind with loot leaves it behind', () => {
    const npc = createNpc('g', 'Gecko Jim', 2, 2, ['hiss'], undefined, ['talk'], { kind: 'gecko' });
    const a = buildArena({ width: 5, height: 5, player: { x: 0, y: 0 }, npcs: [npc] });
    dropCreatureItems(a.state, npc, ALWAYS_HIT);
    expect(a.state.spaces.arena!.items.map((g) => g.item.defId)).toEqual(['gecko-hide']);
  });
});
