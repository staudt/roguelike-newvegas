import { describe, expect, it } from 'vitest';
import type { Creature } from '../src/entities/Creature';
import { createMonster } from '../src/entities/Monster';
import { createNpc } from '../src/entities/Npc';
import { createPlayer } from '../src/entities/Player';
import { EventBus, type GameEvents } from '../src/engine/EventBus';
import { createGameState } from '../src/engine/GameState';
import {
  advanceTurn,
  confirmAttack,
  fightDirection,
  tryMovePlayer,
  useInteraction,
  wieldItem,
} from '../src/engine/TurnManager';
import type { RNG } from '../src/utils/RNG';
import { loadRealWorld } from './helpers/world';
import { buildArena, scriptedRNG } from './helpers/fixtures';

/** Every roll is a natural 100: every attack misses. */
const ALWAYS_MISS: RNG = () => 0.999;
/** Every roll is 0: every attack hits the first limb (head) for minimum damage. */
const ALWAYS_HIT: RNG = () => 0;

function promptTargets(emitted: Array<{ name: string; payload: unknown }>): Creature[] {
  return emitted
    .filter((e) => e.name === 'attack-prompted')
    .map((e) => (e.payload as GameEvents['attack-prompted']).target);
}

describe('bumping creatures', () => {
  it('bumping a hostile attacks it and spends a turn', () => {
    const gecko = createMonster('g', 'gecko', 3, 2);
    const { state, events } = buildArena({ width: 7, height: 5, player: { x: 2, y: 2 }, monsters: [gecko] });

    const spent = tryMovePlayer(state, 'E', events, ALWAYS_MISS);

    expect(spent).toBe(true);
    expect(state.turnCount).toBe(1);
    expect(state.player).toMatchObject({ x: 2, y: 2 }); // attacked, did not move
    expect(state.messageLog[0]).toBe('You miss the gecko with your bare hands.');
    // The gecko got its turn afterwards.
    expect(state.messageLog[1]).toBe('The gecko misses you with its teeth.');
  });

  it('a bump that hits damages the hostile', () => {
    const gecko = createMonster('g', 'gecko', 3, 2);
    const { state, events } = buildArena({ width: 7, height: 5, player: { x: 2, y: 2 }, monsters: [gecko] });
    tryMovePlayer(state, 'E', events, ALWAYS_HIT);
    expect(gecko.hp).toBeLessThan(gecko.maxHp);
  });

  it('bumping a peaceful brahmin prompts, spends no turn and deals no damage', () => {
    const brahmin = createMonster('b', 'brahmin', 3, 2);
    const { state, events, emitted } = buildArena({
      width: 7,
      height: 5,
      player: { x: 2, y: 2 },
      monsters: [brahmin],
    });

    const spent = tryMovePlayer(state, 'E', events, scriptedRNG([]));

    expect(spent).toBe(false);
    expect(promptTargets(emitted)).toEqual([brahmin]);
    expect(state.turnCount).toBe(0);
    expect(brahmin.hp).toBe(brahmin.maxHp);
    expect(brahmin.hostile).toBe(false);
    expect(state.messageLog).toEqual([]);
    expect(state.player).toMatchObject({ x: 2, y: 2 });
  });

  it('confirmAttack fights, spends a turn, and turns a surviving brahmin hostile', () => {
    const brahmin = createMonster('b', 'brahmin', 3, 2);
    const { state, events } = buildArena({ width: 7, height: 5, player: { x: 2, y: 2 }, monsters: [brahmin] });

    const spent = confirmAttack(state, brahmin, events, ALWAYS_HIT);

    expect(spent).toBe(true);
    expect(state.messageLog[0]).toBe('You attack the brahmin!');
    expect(state.messageLog[1]).toMatch(/^You hit the brahmin in the head with your bare hands\.$/);
    expect(brahmin.hp).toBeLessThan(brahmin.maxHp);
    expect(brahmin.hostile).toBe(true);
    expect(brahmin.alerted).toBe(true);
    expect(state.turnCount).toBe(1);
  });

  it('once hostile, the brahmin hits back on later ticks', () => {
    const brahmin = createMonster('b', 'brahmin', 3, 2);
    const { state, events } = buildArena({ width: 7, height: 5, player: { x: 2, y: 2 }, monsters: [brahmin] });
    confirmAttack(state, brahmin, events, ALWAYS_MISS);
    advanceTurn(state, events, ALWAYS_MISS);
    expect(state.messageLog.some((m) => m.startsWith('The brahmin misses you with its horns'))).toBe(true);
  });

  it('a confirmed attack that misses still turns the target hostile', () => {
    const brahmin = createMonster('b', 'brahmin', 3, 2);
    const { state, events } = buildArena({ width: 7, height: 5, player: { x: 2, y: 2 }, monsters: [brahmin] });
    confirmAttack(state, brahmin, events, ALWAYS_MISS);
    expect(brahmin.hostile).toBe(true);
    expect(brahmin.hp).toBe(brahmin.maxHp);
  });

  it('bumping a single-"talk" NPC speaks, as before: free, no menu', () => {
    const villager = createNpc('v', 'Villager', 3, 2, ['Howdy.']);
    const { state, events, emitted } = buildArena({ width: 7, height: 5, player: { x: 2, y: 2 }, npcs: [villager] });

    const spent = tryMovePlayer(state, 'E', events, scriptedRNG([]));

    expect(spent).toBe(false);
    expect(state.messageLog).toEqual(['Villager: "Howdy."']);
    expect(emitted.map((e) => e.name)).toEqual(['npc-interacted']);
    expect(state.turnCount).toBe(0);
  });
});

describe('fightDirection', () => {
  it('on an empty square logs "You attack thin air." and spends a turn', () => {
    const { state, events } = buildArena({ width: 7, height: 5, player: { x: 2, y: 2 } });
    const spent = fightDirection(state, 'E', events, scriptedRNG([]));
    expect(spent).toBe(true);
    expect(state.messageLog).toEqual(['You attack thin air.']);
    expect(state.turnCount).toBe(1);
  });

  it('attacks a hostile directly', () => {
    const gecko = createMonster('g', 'gecko', 3, 2);
    const { state, events } = buildArena({ width: 7, height: 5, player: { x: 2, y: 2 }, monsters: [gecko] });
    expect(fightDirection(state, 'E', events, ALWAYS_HIT)).toBe(true);
    expect(gecko.hp).toBeLessThan(gecko.maxHp);
  });

  it('into a peaceful NPC prompts and does nothing else, unless confirmed', () => {
    const sunny = createNpc('s', 'Sunny Smiles', 3, 2, ['Hi.']);
    const { state, events, emitted } = buildArena({ width: 7, height: 5, player: { x: 2, y: 2 }, npcs: [sunny] });

    expect(fightDirection(state, 'E', events, scriptedRNG([]))).toBe(false);
    expect(promptTargets(emitted)).toEqual([sunny]);
    expect(state.turnCount).toBe(0);
    expect(state.messageLog).toEqual([]);
    expect(sunny.hostile).toBe(false);
    expect(sunny.hp).toBe(sunny.maxHp);

    expect(fightDirection(state, 'E', events, ALWAYS_MISS, true)).toBe(true);
    expect(state.turnCount).toBe(1);
    expect(state.messageLog[0]).toBe('You miss Sunny Smiles with your bare hands.');
    expect(sunny.hostile).toBe(true);
  });

  it('into a peaceful brahmin prompts as well', () => {
    const brahmin = createMonster('b', 'brahmin', 3, 2);
    const { state, events, emitted } = buildArena({
      width: 7,
      height: 5,
      player: { x: 2, y: 2 },
      monsters: [brahmin],
    });
    expect(fightDirection(state, 'E', events, scriptedRNG([]))).toBe(false);
    expect(promptTargets(emitted)).toEqual([brahmin]);
  });

  it('a wall square is still "thin air" (nothing there to hit) and costs a turn', () => {
    const { state, events } = buildArena({ width: 7, height: 5, player: { x: 2, y: 2 }, walls: [[3, 2]] });
    expect(fightDirection(state, 'E', events, scriptedRNG([]))).toBe(true);
    expect(state.messageLog).toEqual(['You attack thin air.']);
  });
});

describe('Doc Mitchell (real data): menu, heal, talk', () => {
  function docState() {
    const space = loadRealWorld();
    space.monsters = []; // deterministic: wildlife is not under test here
    const player = createPlayer(25, 6); // directly west of Doc at (26,6)
    const state = createGameState(player, { [space.id]: space }, space.id);
    const events = new EventBus<GameEvents>();
    const emitted: Array<{ name: string; payload: unknown }> = [];
    for (const name of ['npc-menu', 'npc-interacted', 'attack-prompted', 'turn-ended']) {
      events.on(name, (payload: unknown) => emitted.push({ name, payload }));
    }
    const doc = space.npcs.find((n) => n.id === 'doc-mitchell')!;
    return { state, events, emitted, doc };
  }

  it('bumping Doc emits npc-menu and does NOT speak, spend a turn or prompt', () => {
    const { state, events, emitted, doc } = docState();
    expect(doc.interactions).toEqual(['talk', 'heal']);

    const spent = tryMovePlayer(state, 'E', events, scriptedRNG([]));

    expect(spent).toBe(false);
    expect(emitted.map((e) => e.name)).toEqual(['npc-menu']);
    expect((emitted[0]!.payload as GameEvents['npc-menu']).npc).toBe(doc);
    expect(state.messageLog).toEqual([]);
    expect(state.balloons).toEqual([]);
    expect(state.turnCount).toBe(0);
    expect(doc.dialogueIndex).toBe(0);
  });

  it('Heal restores HP and every limb, logs a line, and costs a turn', () => {
    const { state, events, doc } = docState();
    state.player.hp = 3;
    for (const l of state.player.limbs) l.hp = 0;

    const spent = useInteraction(state, doc, 'heal', events, scriptedRNG([]));

    expect(spent).toBe(true);
    expect(state.player.hp).toBe(state.player.maxHp);
    expect(state.player.limbs.every((l) => l.hp === l.maxHp)).toBe(true);
    expect(state.messageLog).toEqual(['Doc Mitchell patches you up. You feel much better.']);
    expect(state.turnCount).toBe(1);
  });

  it('healing restores crippled-leg speed (the world ticks once per action again)', () => {
    const { state, events, doc } = docState();
    for (const l of state.player.limbs) if (l.kind === 'leg') l.hp = 0;
    useInteraction(state, doc, 'heal', events, ALWAYS_MISS /* nobody wanders on the real map */);
    const before = state.turnCount;
    advanceTurn(state, events, ALWAYS_MISS /* nobody wanders on the real map */);
    expect(state.turnCount - before).toBe(1);
  });

  it('Talk cycles through the dialogue lines, wrapping, and is free', () => {
    const { state, events, doc } = docState();
    const lines = doc.dialogue;
    expect(lines.length).toBeGreaterThan(1);

    const spoken: string[] = [];
    for (let i = 0; i < lines.length + 1; i++) {
      expect(useInteraction(state, doc, 'talk', events, scriptedRNG([]))).toBe(false);
      spoken.push(state.balloons[0]!.text);
    }
    expect(spoken).toEqual([...lines, lines[0]]);
    expect(state.messageLog[0]).toBe(`Doc Mitchell: "${lines[0]}"`);
    expect(state.turnCount).toBe(0);
    expect(state.player.hp).toBe(state.player.maxHp);
  });

  it('attacking Doc (confirmed) turns him hostile like anyone else', () => {
    const { state, events, doc } = docState();
    confirmAttack(state, doc, events, ALWAYS_HIT);
    expect(doc.hostile).toBe(true);
  });
});

describe('wieldItem', () => {
  function withKnife() {
    const gecko = createMonster('g', 'gecko', 3, 2);
    const arena = buildArena({ width: 7, height: 5, player: { x: 2, y: 2 }, monsters: [gecko] });
    const knife = arena.state.player.inventory.find((i) => i.defId === 'combat-knife')!;
    return { ...arena, gecko, knife };
  }

  it('sets player.wielded, logs the line and costs a turn', () => {
    const { state, events, knife } = withKnife();
    const spent = wieldItem(state, knife.id, events, ALWAYS_MISS);
    expect(spent).toBe(true);
    expect(state.player.wielded).toBe(knife.id);
    expect(state.messageLog[0]).toBe('You are now wielding the combat knife.');
    expect(state.turnCount).toBe(1);
  });

  it('a subsequent attack names the knife; unwielding goes back to bare hands', () => {
    const { state, events, knife } = withKnife();
    wieldItem(state, knife.id, events, ALWAYS_MISS);
    state.messageLog.length = 0;
    tryMovePlayer(state, 'E', events, ALWAYS_MISS);
    expect(state.messageLog[0]).toBe('You miss the gecko with your combat knife.');

    expect(wieldItem(state, null, events, ALWAYS_MISS)).toBe(true);
    expect(state.player.wielded).toBeNull();
    expect(state.messageLog).toContain('You are now empty handed.');
    state.messageLog.length = 0;
    tryMovePlayer(state, 'E', events, ALWAYS_MISS);
    expect(state.messageLog[0]).toBe('You miss the gecko with your bare hands.');
  });

  it('wielding null when already empty handed is free', () => {
    const { state, events } = withKnife();
    expect(wieldItem(state, null, events, scriptedRNG([]))).toBe(false);
    expect(state.messageLog).toEqual(['You are already empty handed.']);
    expect(state.turnCount).toBe(0);
  });

  it('re-wielding the same item and wielding an unknown id are free', () => {
    const { state, events, knife } = withKnife();
    wieldItem(state, knife.id, events, ALWAYS_MISS);
    const turns = state.turnCount;
    expect(wieldItem(state, knife.id, events, scriptedRNG([]))).toBe(false);
    expect(state.messageLog.at(-1)).toBe('You are already wielding the combat knife.');
    expect(wieldItem(state, 'nope', events, scriptedRNG([]))).toBe(false);
    expect(state.turnCount).toBe(turns);
  });

  it('switching to the bat names the bat', () => {
    const { state, events } = withKnife();
    const bat = state.player.inventory.find((i) => i.defId === 'baseball-bat')!;
    wieldItem(state, bat.id, events, ALWAYS_MISS);
    expect(state.messageLog[0]).toBe('You are now wielding the baseball bat.');
  });
});

describe('death and permadeath', () => {
  function dying() {
    const gecko = createMonster('g', 'gecko', 3, 2);
    const arena = buildArena({ width: 7, height: 5, player: { x: 2, y: 2 }, monsters: [gecko] });
    arena.state.player.hp = 1;
    return { ...arena, gecko };
  }

  it('the player dying sets gameOver, emits player-died once, and logs "You die..."', () => {
    const { state, events, emitted } = dying();
    // Player waits a turn; the gecko always hits.
    advanceTurn(state, events, ALWAYS_HIT);
    expect(state.player.hp).toBeLessThanOrEqual(0);
    expect(state.gameOver).toBe(true);
    expect(emitted.filter((e) => e.name === 'player-died')).toHaveLength(1);
    expect(state.messageLog.at(-1)).toBe('You die...');
  });

  it('after death, moves, fights, wielding, healing and advanceTurn all do nothing', () => {
    const { state, events, emitted, gecko } = dying();
    advanceTurn(state, events, ALWAYS_HIT);
    const turns = state.turnCount;
    const log = [...state.messageLog];
    const at = { x: state.player.x, y: state.player.y };
    const knife = state.player.inventory[0]!;
    const doc = createNpc('d', 'Doc', 5, 2, ['hi'], undefined, ['talk', 'heal']);

    expect(tryMovePlayer(state, 'W', events, ALWAYS_HIT)).toBe(false);
    expect(tryMovePlayer(state, 'E', events, ALWAYS_HIT)).toBe(false);
    expect(fightDirection(state, 'E', events, ALWAYS_HIT)).toBe(false);
    expect(confirmAttack(state, gecko, events, ALWAYS_HIT)).toBe(false);
    expect(wieldItem(state, knife.id, events, ALWAYS_HIT)).toBe(false);
    expect(useInteraction(state, doc, 'heal', events, ALWAYS_HIT)).toBe(false);
    advanceTurn(state, events, ALWAYS_HIT);

    expect(state.turnCount).toBe(turns);
    expect(state.messageLog).toEqual(log);
    expect(state.player).toMatchObject(at);
    expect(state.player.hp).toBeLessThanOrEqual(0);
    expect(state.player.wielded).toBeNull();
    expect(emitted.filter((e) => e.name === 'player-died')).toHaveLength(1);
  });

  it('a fast creature that kills on its first swing does not swing again or re-emit death', () => {
    const fly = createMonster('f', 'bloatfly', 3, 2);
    fly.energy = 0;
    fly.speed = 60;
    const { state, events, emitted } = buildArena({
      width: 7,
      height: 5,
      player: { x: 2, y: 2 },
      monsters: [fly],
    });
    state.player.hp = 1;
    advanceTurn(state, events, ALWAYS_HIT);
    expect(emitted.filter((e) => e.name === 'player-died')).toHaveLength(1);
    expect(state.messageLog.filter((m) => m === 'You die...')).toHaveLength(1);
    expect(state.messageLog.filter((m) => m.includes('hits you'))).toHaveLength(1);
  });

  it('two creatures adjacent: only one gets to kill the player', () => {
    const a = createMonster('a', 'gecko', 3, 2);
    const b = createMonster('b', 'gecko', 1, 2);
    const { state, events, emitted } = buildArena({
      width: 7,
      height: 5,
      player: { x: 2, y: 2 },
      monsters: [a, b],
    });
    state.player.hp = 1;
    advanceTurn(state, events, ALWAYS_HIT);
    expect(emitted.filter((e) => e.name === 'player-died')).toHaveLength(1);
    expect(state.messageLog.filter((m) => m.includes('hits you'))).toHaveLength(1);
  });
});

describe('killing creatures', () => {
  it('removes a slain monster from the space and prints "dies!"', () => {
    const gecko = createMonster('g', 'gecko', 3, 2);
    gecko.hp = 1;
    const { state, events } = buildArena({ width: 7, height: 5, player: { x: 2, y: 2 }, monsters: [gecko] });

    tryMovePlayer(state, 'E', events, ALWAYS_HIT);

    expect(state.spaces['arena']!.monsters).toEqual([]);
    expect(state.messageLog).toContain('The gecko dies!');
    expect(state.turnCount).toBe(1);
    // The square is free now: the player can walk onto it.
    expect(tryMovePlayer(state, 'E', events, ALWAYS_HIT)).toBe(true);
    expect(state.player).toMatchObject({ x: 3, y: 2 });
  });

  it('a dead monster no longer acts later in the same tick', () => {
    const gecko = createMonster('g', 'gecko', 3, 2);
    gecko.hp = 1;
    const { state, events } = buildArena({ width: 7, height: 5, player: { x: 2, y: 2 }, monsters: [gecko] });
    tryMovePlayer(state, 'E', events, ALWAYS_HIT);
    expect(state.messageLog.filter((m) => m.startsWith('The gecko hits you') || m.startsWith('The gecko misses'))).toEqual([]);
  });

  it('killing an NPC removes it and its speech balloon', () => {
    const sunny = createNpc('s', 'Sunny Smiles', 3, 2, ['Hi.']);
    sunny.hp = 1;
    const { state, events } = buildArena({ width: 7, height: 5, player: { x: 2, y: 2 }, npcs: [sunny] });
    tryMovePlayer(state, 'E', events, scriptedRNG([])); // talk: balloon up
    expect(state.balloons).toHaveLength(1);

    confirmAttack(state, sunny, events, ALWAYS_HIT);

    expect(state.spaces['arena']!.npcs).toEqual([]);
    expect(state.balloons).toEqual([]);
    expect(state.messageLog).toContain('Sunny Smiles dies!');
  });

  it('a surviving victim turns hostile (and an NPC fights back with their hands)', () => {
    const sunny = createNpc('s', 'Sunny Smiles', 3, 2, ['Hi.']);
    const { state, events } = buildArena({ width: 7, height: 5, player: { x: 2, y: 2 }, npcs: [sunny] });
    confirmAttack(state, sunny, events, ALWAYS_MISS);
    expect(sunny.hostile).toBe(true);
    expect(state.messageLog).toContain('Sunny Smiles misses you with their bare hands.');
  });
});
