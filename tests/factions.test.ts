import { describe, expect, it } from 'vitest';
import { runCreatureTurns } from '../src/ai/AIScheduler';
import { GUN_NOISE_RADIUS } from '../src/config/constants';
import { emitSound } from '../src/engine/Sound';
import {
  FACTIONS,
  HOSTILE_STANDING,
  factionRelation,
  hostileToPlayer,
  startingStanding,
} from '../src/entities/Factions';
import { createMonster } from '../src/entities/Monster';
import { MONSTERS, monsterStartsHostile } from '../src/entities/MonsterData';
import { createNpc, type Npc, type NpcProfile } from '../src/entities/Npc';
import { npcProfile } from '../src/entities/NpcData';
import type { RNG } from '../src/utils/RNG';
import { buildArena, type Arena } from './helpers/fixtures';

const NEVER: RNG = () => 0.999;

function person(id: string, x: number, y: number, profile: NpcProfile = {}): Npc {
  const n = createNpc(id, id, x, y, ['hi'], undefined, ['talk'], profile);
  n.energy = 0;
  return n;
}

function tick(a: Arena, rng: RNG = NEVER): void {
  runCreatureTurns(a.state, rng, a.events);
}

describe('faction relations', () => {
  it('the big factions are at war, whoever you are', () => {
    expect(factionRelation('ncr', 'legion')).toBe('hostile');
    expect(factionRelation('legion', 'ncr')).toBe('hostile');
    expect(factionRelation('ncr', 'powder-gangers')).toBe('hostile');
  });

  it('members of a faction are friendly to each other', () => {
    expect(factionRelation('ncr', 'ncr')).toBe('friendly');
    expect(factionRelation(null, null)).toBe('friendly');
  });

  it('beasts are hostile to every person but not to each other', () => {
    expect(factionRelation('wildlife', null)).toBe('hostile');
    expect(factionRelation('ghouls', 'ncr')).toBe('hostile');
    expect(factionRelation('legion', 'wildlife')).toBe('hostile');
    expect(factionRelation('wildlife', 'ghouls')).toBe('neutral');
  });

  it('Powder Gangers prey on civilians; other pairs are neutral', () => {
    expect(factionRelation('powder-gangers', null)).toBe('hostile');
    expect(factionRelation('ncr', null)).toBe('neutral');
    expect(factionRelation('legion', 'powder-gangers')).toBe('neutral');
  });
});

describe('hostile on sight', () => {
  it('peaceful never; others by faction standing; factionless non-peaceful always', () => {
    const standing = startingStanding();
    expect(hostileToPlayer('wildlife', 'peaceful', standing)).toBe(false);
    expect(hostileToPlayer('wildlife', 'aggressive', standing)).toBe(true);
    expect(hostileToPlayer('ncr', 'aggressive', standing)).toBe(false);
    expect(hostileToPlayer(null, 'territorial', standing)).toBe(true);
    standing.ncr = HOSTILE_STANDING;
    expect(hostileToPlayer('ncr', 'aggressive', standing)).toBe(true);
    standing.ncr = HOSTILE_STANDING + 1;
    expect(hostileToPlayer('ncr', 'aggressive', standing)).toBe(false);
  });

  it('every monster kind keeps the hostility it had before factions', () => {
    for (const def of Object.values(MONSTERS)) {
      expect(monsterStartsHostile(def)).toBe(def.id !== 'brahmin');
      expect(FACTIONS[def.faction]).toBeDefined();
    }
    expect(createMonster('b', 'brahmin', 0, 0).hostile).toBe(false);
    expect(createMonster('g', 'gecko', 0, 0).hostile).toBe(true);
  });

  it('people default to peaceful civilians; a Powder Ganger is hostile from the start', () => {
    expect(person('p', 0, 0).hostile).toBe(false);
    const ganger = person('g', 0, 0, { faction: 'powder-gangers', temperament: 'aggressive' });
    expect(ganger.hostile).toBe(true);
    expect(ganger.faction).toBe('powder-gangers');
  });

  it('a faction the player falls out with turns on them the next time they act', () => {
    const soldier = person('s', 5, 0, { faction: 'ncr', temperament: 'aggressive' });
    const a = buildArena({ width: 10, height: 1, player: { x: 0, y: 0 }, npcs: [soldier] });
    tick(a);
    expect(soldier.hostile).toBe(false);
    a.state.standing.ncr = -80;
    tick(a);
    expect(soldier.hostile).toBe(true);
  });

  it('a peaceful member is not turned by standing', () => {
    const medic = person('m', 5, 0, { faction: 'ncr', temperament: 'peaceful' });
    const a = buildArena({ width: 10, height: 1, player: { x: 0, y: 0 }, npcs: [medic] });
    a.state.standing.ncr = -100;
    tick(a);
    expect(medic.hostile).toBe(false);
  });
});

describe('named people', () => {
  it('Sunny is bold and Doc is timid; strangers are steady', () => {
    expect(npcProfile('sunny-smiles').nerve).toBe('bold');
    expect(npcProfile('doc-mitchell').nerve).toBe('timid');
    expect(npcProfile('trudy')).toEqual({});
    expect(person('x', 0, 0).nerve).toBe('steady');
  });
});

describe('nerve decides how a provoked person fights', () => {
  function provoked(nerve: NpcProfile['nerve']): { npc: Npc; a: Arena } {
    const npc = person('n', 3, 3, { nerve });
    npc.hostile = npc.alerted = npc.provoked = true;
    const a = buildArena({ width: 20, height: 7, player: { x: 1, y: 3 }, npcs: [npc] });
    return { npc, a };
  }

  it('a bold person brawls bare-handed rather than run, whatever they roll', () => {
    const { npc, a } = provoked('bold');
    tick(a, () => 0);
    expect(npc.stance).toBe('fight');
    expect(npc.x).toBe(2);
  });

  it('a timid person always runs when unarmed, even on the unluckiest roll', () => {
    const { npc, a } = provoked('timid');
    tick(a, NEVER);
    expect(npc.stance).toBe('flee');
  });
});

describe('gunshots draw hunters, not territorial creatures', () => {
  function shotArena() {
    const hunter = createMonster('hunter', 'gecko', GUN_NOISE_RADIUS - 1, 0); // aggressive
    const guard = createMonster('guard', 'radroach', GUN_NOISE_RADIUS - 1, 1); // territorial, shot far from its patch
    const nearGuard = createMonster('near', 'radroach', 3, 1); // territorial, shot in its patch
    const a = buildArena({ width: 30, height: 4, player: { x: 0, y: 0 }, monsters: [hunter, guard, nearGuard] });
    emitSound(a.state, { x: 0, y: 0 }, 'gunshot', a.state.player, NEVER);
    return { hunter, guard, nearGuard };
  }

  it('an aggressive creature comes from afar', () => {
    expect(shotArena().hunter.alerted).toBe(true);
  });

  it('a territorial one ignores a shot beyond its awareness but reacts to one on its patch', () => {
    const { guard, nearGuard } = shotArena();
    expect(guard.alerted).toBe(false);
    expect(nearGuard.alerted).toBe(true);
  });
});
