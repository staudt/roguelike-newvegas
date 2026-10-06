import { describe, expect, it } from 'vitest';
import type { AttackResult } from '../src/combat/CombatResolver';
import type { Limb } from '../src/combat/Limbs';
import { capitalize, narrateAttack, type Party } from '../src/combat/Narration';
import { creatureAttacks, playerAttackProfile, playerAttacks } from '../src/engine/Combat';
import { createMonster } from '../src/entities/Monster';
import { createNpc } from '../src/entities/Npc';
import { createPlayer } from '../src/entities/Player';
import { buildArena, scriptedRNG } from './helpers/fixtures';

const YOU: Party = { name: 'you', isPlayer: true, possessive: 'your' };
const GECKO: Party = { name: 'the gecko', isPlayer: false, possessive: 'its' };
const SUNNY: Party = { name: 'Sunny Smiles', isPlayer: false, possessive: 'their' };

function limb(name: string, kind: Limb['kind'] = 'leg'): Limb {
  return { id: name.replace(/ /g, '-'), name, kind, hp: 5, maxHp: 10 };
}

function hit(l: Limb, overrides: Partial<AttackResult> = {}): AttackResult {
  return {
    hit: true,
    damage: 3,
    limb: l,
    limbBefore: 'ok',
    limbAfter: 'ok',
    killed: false,
    ...overrides,
  };
}

const MISS: AttackResult = {
  hit: false,
  damage: 0,
  limb: null,
  limbBefore: null,
  limbAfter: null,
  killed: false,
};

describe('narrateAttack', () => {
  it('player hit', () => {
    expect(narrateAttack(YOU, GECKO, 'combat knife', hit(limb('left leg')))).toEqual([
      'You hit the gecko in the left leg with your combat knife.',
    ]);
  });

  it('player miss', () => {
    expect(narrateAttack(YOU, GECKO, 'bare hands', MISS)).toEqual([
      'You miss the gecko with your bare hands.',
    ]);
  });

  it('creature hit on the player', () => {
    expect(narrateAttack(GECKO, YOU, 'teeth', hit(limb('torso', 'torso')))).toEqual([
      'The gecko hits you in the torso with its teeth.',
    ]);
  });

  it('creature miss on the player', () => {
    expect(narrateAttack(GECKO, YOU, 'teeth', MISS)).toEqual(['The gecko misses you with its teeth.']);
  });

  it('a killing blow on a creature adds "dies!" and nothing about limbs', () => {
    const lines = narrateAttack(
      YOU,
      GECKO,
      'combat knife',
      hit(limb('head', 'head'), { killed: true, limbBefore: 'ok', limbAfter: 'crippled' }),
    );
    expect(lines).toEqual(['You hit the gecko in the head with your combat knife.', 'The gecko dies!']);
  });

  it('a killing blow on the player says "You die..."', () => {
    const lines = narrateAttack(GECKO, YOU, 'teeth', hit(limb('torso', 'torso'), { killed: true }));
    expect(lines).toEqual(['The gecko hits you in the torso with its teeth.', 'You die...']);
  });

  it('announces a crippled creature limb', () => {
    const lines = narrateAttack(
      YOU,
      GECKO,
      'combat knife',
      hit(limb('front left leg'), { limbBefore: 'hurt', limbAfter: 'crippled' }),
    );
    expect(lines).toEqual([
      'You hit the gecko in the front left leg with your combat knife.',
      "The gecko's front left leg is crippled!",
    ]);
  });

  it('announces a hurt player limb with "Your"', () => {
    const lines = narrateAttack(
      GECKO,
      YOU,
      'teeth',
      hit(limb('right arm', 'arm'), { limbBefore: 'ok', limbAfter: 'hurt' }),
    );
    expect(lines).toEqual([
      'The gecko hits you in the right arm with its teeth.',
      'Your right arm is hurt!',
    ]);
  });

  it('announces a crippled player limb', () => {
    const lines = narrateAttack(
      GECKO,
      YOU,
      'teeth',
      hit(limb('left leg'), { limbBefore: 'hurt', limbAfter: 'crippled' }),
    );
    expect(lines[1]).toBe('Your left leg is crippled!');
  });

  it('says nothing extra when the limb condition did not change', () => {
    expect(narrateAttack(YOU, GECKO, 'x', hit(limb('torso'), { limbBefore: 'hurt', limbAfter: 'hurt' }))).toHaveLength(1);
    expect(
      narrateAttack(YOU, GECKO, 'x', hit(limb('torso'), { limbBefore: 'crippled', limbAfter: 'crippled' })),
    ).toHaveLength(1);
    expect(narrateAttack(YOU, GECKO, 'x', hit(limb('torso')))).toHaveLength(1);
  });

  it('proper-name NPCs use "their" and take no article', () => {
    expect(narrateAttack(SUNNY, YOU, 'bare hands', hit(limb('head', 'head')))).toEqual([
      'Sunny Smiles hits you in the head with their bare hands.',
    ]);
    expect(narrateAttack(SUNNY, YOU, 'bare hands', MISS)).toEqual([
      'Sunny Smiles misses you with their bare hands.',
    ]);
    expect(narrateAttack(YOU, SUNNY, 'bare hands', hit(limb('torso'), { killed: true }))).toEqual([
      'You hit Sunny Smiles in the torso with your bare hands.',
      'Sunny Smiles dies!',
    ]);
    expect(
      narrateAttack(
        YOU,
        SUNNY,
        'bare hands',
        hit(limb('left arm', 'arm'), { limbBefore: 'ok', limbAfter: 'hurt' }),
      )[1],
    ).toBe("Sunny Smiles's left arm is hurt!");
  });
});

describe('capitalize', () => {
  it('upper-cases the first letter only', () => {
    expect(capitalize('the gecko')).toBe('The gecko');
    expect(capitalize('')).toBe('');
  });
});

describe('playerAttackProfile', () => {
  it('is bare hands when nothing is wielded', () => {
    const player = createPlayer(0, 0);
    expect(playerAttackProfile(player).weaponName).toBe('bare hands');
  });

  it('is the wielded weapon, named after its item', () => {
    const player = createPlayer(0, 0);
    const knife = player.inventory.find((i) => i.defId === 'combat-knife')!;
    player.wielded = knife.id;
    expect(playerAttackProfile(player).weaponName).toBe('combat knife');
    const bat = player.inventory.find((i) => i.defId === 'baseball-bat')!;
    player.wielded = bat.id;
    expect(playerAttackProfile(player).weaponName).toBe('baseball bat');
  });

  it('falls back to bare hands if the wielded id is not in the pack', () => {
    const player = createPlayer(0, 0);
    player.wielded = 'item-does-not-exist';
    expect(playerAttackProfile(player).weaponName).toBe('bare hands');
  });
});

describe('attack messages in the log (engine level)', () => {
  it('player vs gecko names the weapon actually in use', () => {
    // Rolls: hit, then a limb roll that lands on the torso, then low damage.
    const gecko = createMonster('g', 'gecko', 1, 0);
    const { state } = buildArena({ width: 3, height: 1, player: { x: 0, y: 0 }, monsters: [gecko] });

    playerAttacks(state, gecko, scriptedRNG([0, 0.5, 0]));
    expect(state.messageLog[0]).toMatch(/^You (hit|miss) the gecko( in the [a-z ]+)? with your bare hands\.$/);

    const knife = state.player.inventory.find((i) => i.defId === 'combat-knife')!;
    state.player.wielded = knife.id;
    state.messageLog.length = 0;
    playerAttacks(state, gecko, scriptedRNG([0, 0, 0]));
    expect(state.messageLog[0]).toBe('You hit the gecko in the head with your combat knife.');
  });

  it('a miss with the knife names the knife', () => {
    const gecko = createMonster('g', 'gecko', 1, 0);
    const { state } = buildArena({ width: 3, height: 1, player: { x: 0, y: 0 }, monsters: [gecko] });
    state.player.wielded = state.player.inventory.find((i) => i.defId === 'combat-knife')!.id;
    playerAttacks(state, gecko, scriptedRNG([0.999]));
    expect(state.messageLog).toEqual(['You miss the gecko with your combat knife.']);
  });

  it('gecko vs player: "The gecko hits you in the ... with its teeth."', () => {
    const gecko = createMonster('g', 'gecko', 1, 0);
    const { state, events } = buildArena({ width: 3, height: 1, player: { x: 0, y: 0 }, monsters: [gecko] });
    creatureAttacks(state, gecko, scriptedRNG([0, 0.5, 0]), events);
    expect(state.messageLog[0]).toMatch(/^The gecko hits you in the [a-z ]+ with its teeth\.$/);

    state.messageLog.length = 0;
    creatureAttacks(state, gecko, scriptedRNG([0.999]), events);
    expect(state.messageLog).toEqual(['The gecko misses you with its teeth.']);
  });

  it('a proper-name NPC fighting back says "their bare hands"', () => {
    const sunny = createNpc('sunny', 'Sunny Smiles', 1, 0, ['hi']);
    const { state, events } = buildArena({ width: 3, height: 1, player: { x: 0, y: 0 }, npcs: [sunny] });
    creatureAttacks(state, sunny, scriptedRNG([0.999]), events);
    expect(state.messageLog).toEqual(['Sunny Smiles misses you with their bare hands.']);
  });

  it('the player hitting a proper-name NPC uses no article', () => {
    const sunny = createNpc('sunny', 'Sunny Smiles', 1, 0, ['hi']);
    const { state } = buildArena({ width: 3, height: 1, player: { x: 0, y: 0 }, npcs: [sunny] });
    playerAttacks(state, sunny, scriptedRNG([0.999]));
    expect(state.messageLog).toEqual(['You miss Sunny Smiles with your bare hands.']);
  });

  it('a death blow on a gecko logs "The gecko dies!" and the final line is the death', () => {
    const gecko = createMonster('g', 'gecko', 1, 0);
    gecko.hp = 1;
    const { state } = buildArena({ width: 3, height: 1, player: { x: 0, y: 0 }, monsters: [gecko] });
    playerAttacks(state, gecko, scriptedRNG([0, 0.5, 0, 0.99]));
    expect(state.messageLog.at(-1)).toBe('The gecko dies!');
  });

  it('a death blow on the player logs "You die..." and ends the game', () => {
    const gecko = createMonster('g', 'gecko', 1, 0);
    const { state, events, emitted } = buildArena({
      width: 3,
      height: 1,
      player: { x: 0, y: 0 },
      monsters: [gecko],
    });
    state.player.hp = 1;
    creatureAttacks(state, gecko, scriptedRNG([0, 0.5, 0]), events);
    expect(state.messageLog.at(-1)).toBe('You die...');
    expect(state.gameOver).toBe(true);
    expect(emitted.filter((e) => e.name === 'player-died')).toHaveLength(1);
  });
});
