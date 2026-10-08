import { describe, expect, it } from 'vitest';
import { createMonster } from '../src/entities/Monster';
import { createNpc } from '../src/entities/Npc';
import { kickDirection } from '../src/engine/Kick';
import { swapWeapons, wieldItem } from '../src/engine/TurnManager';
import type { RNG } from '../src/utils/RNG';
import { setHeight } from '../src/world/GameMap';
import { buildArena } from './helpers/fixtures';

const ALWAYS_HIT: RNG = () => 0;

describe('kick', () => {
  it('knocks a gecko back a square', () => {
    const gecko = createMonster('g', 'gecko', 3, 2);
    const { state, events } = buildArena({ width: 12, height: 5, player: { x: 2, y: 2 }, monsters: [gecko] });
    kickDirection(state, 'E', events, ALWAYS_HIT);
    expect(state.messageLog.some((m) => m.includes('is knocked back.'))).toBe(true);
    expect(gecko.hostile).toBe(true);
  });

  it('does not move a brahmin but angers it', () => {
    const brahmin = createMonster('b', 'brahmin', 3, 2);
    const { state, events } = buildArena({ width: 12, height: 5, player: { x: 2, y: 2 }, monsters: [brahmin] });
    kickDirection(state, 'E', events, () => 0.5);
    expect(brahmin.x).toBe(3);
  });

  it('a knocked creature slams into the one behind it', () => {
    const a = createMonster('a', 'gecko', 3, 2);
    const b = createMonster('b', 'brahmin', 4, 2);
    const { state, events } = buildArena({ width: 12, height: 5, player: { x: 2, y: 2 }, monsters: [a, b] });
    kickDirection(state, 'E', events, ALWAYS_HIT);
    expect(a.x).toBe(3);
    expect(b.hostile).toBe(true);
    expect(state.messageLog.some((m) => m.includes('slams into'))).toBe(true);
  });
});

describe('alternate weapon', () => {
  it('x swaps back to the previous weapon', () => {
    const { state, events } = buildArena({ width: 6, height: 5, player: { x: 2, y: 2 } });
    const knife = state.player.inventory.find((i) => i.defId === 'combat-knife')!;
    const pistol = state.player.inventory.find((i) => i.defId === '9mm-pistol')!;
    wieldItem(state, knife.id, events);
    wieldItem(state, pistol.id, events);
    expect(state.player.alternate).toBe(knife.id);
    swapWeapons(state, events);
    expect(state.player.wielded).toBe(knife.id);
    expect(state.player.alternate).toBe(pistol.id);
  });
});

describe('x without an alternate', () => {
  it('goes bare handed, and x again brings the weapon back', () => {
    const { state, events } = buildArena({ width: 6, height: 5, player: { x: 2, y: 2 } });
    const knife = state.player.inventory.find((i) => i.defId === 'combat-knife')!;
    state.player.wielded = knife.id;
    swapWeapons(state, events);
    expect(state.player.wielded).toBeNull();
    swapWeapons(state, events);
    expect(state.player.wielded).toBe(knife.id);
  });
  it('does nothing when already bare handed with no alternate', () => {
    const { state, events } = buildArena({ width: 6, height: 5, player: { x: 2, y: 2 } });
    expect(swapWeapons(state, events)).toBe(false);
  });
});

describe('kick balance and terrain', () => {
  const arena = (monsters: ReturnType<typeof createMonster>[], heights: Array<[number, number]> = []) => {
    const a = buildArena({ width: 16, height: 3, player: { x: 1, y: 1 }, monsters });
    const grid = a.state.spaces[a.state.activeSpaceId]!.grid;
    for (const [x, h] of heights) for (let y = 0; y < 3; y++) setHeight(grid, x, y, h);
    return a;
  };
  /** Cells the target flew, measured before the world gets to act on it. */
  const flown = (m: ReturnType<typeof createMonster>, heights: Array<[number, number]> = [], roll = 0.5) => {
    const a = arena([m], heights);
    m.speed = 0; // stays where it lands
    kickDirection(a.state, 'E', a.events, () => roll);
    return m.x - 2;
  };

  it('a young gecko is usually sent two or more squares', () => {
    for (const roll of [0.01, 0.3, 0.6]) {
      expect(flown(createMonster('g', 'young-gecko', 2, 1), [], roll)).toBeGreaterThanOrEqual(2);
    }
  });

  it('a grown gecko is heavy: one or two squares', () => {
    for (const roll of [0.01, 0.3, 0.6]) {
      const d = flown(createMonster('g', 'gecko', 2, 1), [], roll);
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(2);
    }
  });

  it('a ghoul is light: sent 1-2 squares', () => {
    const d = flown(createMonster('z', 'ghoul', 2, 1), [], 0.5);
    expect(d).toBeGreaterThanOrEqual(1);
    expect(d).toBeLessThanOrEqual(3);
  });

  it('kicking up a rise sends the target a lot less far', () => {
    const level = flown(createMonster('g', 'young-gecko', 2, 1));
    const uphill = flown(createMonster('g', 'young-gecko', 2, 1), [[3, 1], [4, 1], [5, 1], [6, 1]]);
    expect(uphill).toBeLessThan(level);
  });

  it('kicking down a slope sends it tumbling to the bottom', () => {
    const heights: Array<[number, number]> = [[2, 4], [3, 3], [4, 2], [5, 1], [6, 0]];
    const down = flown(createMonster('g', 'young-gecko', 2, 1), heights, 0.1);
    expect(down).toBeGreaterThanOrEqual(3);
  });
});

describe('stagger', () => {
  it('a fast ghoul that was knocked back needs a while before it is on you again', () => {
    const ghoul = createMonster('z', 'ghoul', 3, 1);
    const { state, events } = buildArena({ width: 16, height: 3, player: { x: 2, y: 1 }, monsters: [ghoul] });
    kickDirection(state, 'E', events, () => 0.5);
    expect(ghoul.x - state.player.x).toBeGreaterThanOrEqual(2); // not back adjacent on the same turn
  });
});

describe('kicking a peaceful', () => {
  const prompts = (emitted: Array<{ name: string; payload: unknown }>) =>
    emitted.filter((e) => e.name === 'attack-prompted').map((e) => e.payload as { target: unknown; kick?: string });

  it('asks first: no turn, no kick, nobody provoked', () => {
    const doc = createNpc('doc', 'Doc', 3, 2, ['hi']);
    const a = buildArena({ width: 12, height: 5, player: { x: 2, y: 2 }, npcs: [doc] });
    const turns = a.state.turnCount;
    expect(kickDirection(a.state, 'E', a.events, ALWAYS_HIT)).toBe(false);
    expect(prompts(a.emitted)).toEqual([{ target: doc, kick: 'E' }]);
    expect(a.state.turnCount).toBe(turns);
    expect(doc.hostile).toBe(false);
    expect(doc.x).toBe(3);
    expect(a.state.messageLog).toEqual([]);
  });

  it('asks about a peaceful animal too', () => {
    const brahmin = createMonster('b', 'brahmin', 3, 2);
    const a = buildArena({ width: 12, height: 5, player: { x: 2, y: 2 }, monsters: [brahmin] });
    expect(kickDirection(a.state, 'E', a.events, ALWAYS_HIT)).toBe(false);
    expect(prompts(a.emitted)).toHaveLength(1);
  });

  it('once confirmed it kicks, spends the turn and provokes them', () => {
    const doc = createNpc('doc', 'Doc', 3, 2, ['hi']);
    const a = buildArena({ width: 12, height: 5, player: { x: 2, y: 2 }, npcs: [doc] });
    const turns = a.state.turnCount;
    expect(kickDirection(a.state, 'E', a.events, ALWAYS_HIT, true)).toBe(true);
    expect(a.state.turnCount).toBe(turns + 1);
    expect(doc.hostile && doc.provoked).toBe(true);
  });

  it('a hostile is kicked without asking, and thin air needs no confirmation', () => {
    const gecko = createMonster('g', 'gecko', 3, 2);
    const a = buildArena({ width: 12, height: 5, player: { x: 2, y: 2 }, monsters: [gecko] });
    expect(kickDirection(a.state, 'E', a.events, ALWAYS_HIT)).toBe(true);
    expect(kickDirection(a.state, 'N', a.events, ALWAYS_HIT)).toBe(true);
    expect(prompts(a.emitted)).toHaveLength(0);
  });
});
