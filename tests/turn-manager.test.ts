import { VisibleSet } from '../src/fov/VisibleSet';
import { describe, expect, it } from 'vitest';
import { BALLOON_TURNS } from '../src/config/constants';
import { createNpc } from '../src/entities/Npc';
import { createPlayer } from '../src/entities/Player';
import { advanceTurn, tryMovePlayer } from '../src/engine/TurnManager';
import { EventBus, type GameEvents } from '../src/engine/EventBus';
import { createGameState, type GameState, type Space } from '../src/engine/GameState';
import { createEmptyGrid, getTileId, setTileId } from '../src/world/GameMap';
import { loadRealWorld } from './helpers/world';

/**
 * A tiny synthetic 5x5 flat space: player starts center (2,2), an NPC sits just north at (2,1),
 * and a wall sits just south at (2,3) so blocked moves are also exercisable. Everything else is
 * open flat ground, so east/west shuffles are "free" moves that cost a turn but touch nothing.
 */
function buildSyntheticState(): { state: GameState; events: EventBus<GameEvents> } {
  const grid = createEmptyGrid(5, 5, 'ground');
  setTileId(grid, 2, 3, 'wall');

  const npc = createNpc('villager', 'Villager', 2, 1, ['Howdy, stranger.', 'Dusty out today.']);

  const space: Space = {
    id: 'test',
    name: 'Test Space',
    indoor: false,
    grid,
    npcs: [npc],
    monsters: [],
    transitions: [],
    places: [],
    visible: VisibleSet.empty(),
  };

  const player = createPlayer(2, 2);
  const state = createGameState(player, { test: space }, 'test');
  const events = new EventBus<GameEvents>();
  return { state, events };
}

describe('tryMovePlayer / advanceTurn — bump and turn-cost rules', () => {
  it('bumping an adjacent NPC talks instead of moving, costs no turn, and logs a message', () => {
    const { state, events } = buildSyntheticState();

    const spentTurn = tryMovePlayer(state, 'N', events);

    expect(spentTurn).toBe(false);
    expect(state.player.x).toBe(2);
    expect(state.player.y).toBe(2);
    expect(state.turnCount).toBe(0);
    expect(state.balloons).toHaveLength(1);
    expect(state.balloons[0]).toMatchObject({ entityId: 'villager', turnsLeft: BALLOON_TURNS });
    expect(state.messageLog).toEqual(['Villager: "Howdy, stranger."']);
  });

  it('bumping the same NPC again does not duplicate the balloon, and cycles to the next line', () => {
    const { state, events } = buildSyntheticState();

    tryMovePlayer(state, 'N', events);
    tryMovePlayer(state, 'N', events); // bump again without moving — replaces, not stacks

    expect(state.balloons).toHaveLength(1);
    expect(state.balloons[0]!.text).toBe('Dusty out today.');
    expect(state.messageLog).toEqual([
      'Villager: "Howdy, stranger."',
      'Villager: "Dusty out today."',
    ]);

    tryMovePlayer(state, 'N', events); // wraps back to the first line
    expect(state.balloons[0]!.text).toBe('Howdy, stranger.');
  });

  it('a blocked move (wall) costs no turn and leaves the player in place', () => {
    const { state, events } = buildSyntheticState();

    const spentTurn = tryMovePlayer(state, 'S', events);

    expect(spentTurn).toBe(false);
    expect(state.player.x).toBe(2);
    expect(state.player.y).toBe(2);
    expect(state.turnCount).toBe(0);
  });

  it('a successful move costs exactly one turn', () => {
    const { state, events } = buildSyntheticState();

    const spentTurn = tryMovePlayer(state, 'E', events);

    expect(spentTurn).toBe(true);
    expect(state.player.x).toBe(3);
    expect(state.player.y).toBe(2);
    expect(state.turnCount).toBe(1);
  });

  it('a balloon disappears as soon as the player actually moves', () => {
    const { state, events } = buildSyntheticState();

    tryMovePlayer(state, 'N', events); // bump: balloon up, no turn cost
    expect(state.balloons).toHaveLength(1);

    tryMovePlayer(state, 'S', events); // blocked by wall: not a move, balloon stays
    expect(state.balloons).toHaveLength(1);

    tryMovePlayer(state, 'E', events); // real step
    expect(state.balloons).toHaveLength(0);
  });

  it('a balloon still expires after BALLOON_TURNS if the player just waits', () => {
    const { state, events } = buildSyntheticState();

    tryMovePlayer(state, 'N', events);
    for (let i = 0; i < BALLOON_TURNS - 1; i++) advanceTurn(state, events);
    expect(state.balloons).toHaveLength(1);

    advanceTurn(state, events);
    expect(state.balloons).toHaveLength(0);
  });

  it('advanceTurn alone increments turnCount and emits turn-ended', () => {
    const { state, events } = buildSyntheticState();
    let emittedTurnCount: number | undefined;
    events.on('turn-ended', (payload) => {
      emittedTurnCount = payload.turnCount;
    });

    advanceTurn(state, events);

    expect(state.turnCount).toBe(1);
    expect(emittedTurnCount).toBe(1);
  });

  it('emits npc-interacted when bumping an NPC', () => {
    const { state, events } = buildSyntheticState();
    const interacted: string[] = [];
    events.on('npc-interacted', (payload) => interacted.push(payload.npc.id));

    tryMovePlayer(state, 'N', events);

    expect(interacted).toEqual(['villager']);
  });
});

describe('tryMovePlayer — the Prospector Saloon on the real merged map', () => {
  function buildWorldState(): { state: GameState; events: EventBus<GameEvents> } {
    const world = loadRealWorld();
    world.monsters = []; // deterministic: wildlife is not under test here
    // Two tiles east of the saloon's east door at (16,12), on open street, facing west.
    const state = createGameState(createPlayer(18, 12), { world }, 'world');
    return { state, events: new EventBus<GameEvents>() };
  }

  it('the door starts closed; bumping it opens it, costs a turn and leaves you outside', () => {
    const { state, events } = buildWorldState();
    expect(tryMovePlayer(state, 'W', events)).toBe(true); // (17,12), street
    expect(getTileId(state.spaces.world!.grid, 16, 12)).toBe('door');

    expect(tryMovePlayer(state, 'W', events)).toBe(true); // bump the door
    expect(getTileId(state.spaces.world!.grid, 16, 12)).toBe('openDoor');
    expect(state.player).toMatchObject({ x: 17, y: 12 });
    expect(state.messageLog).toEqual(['You open the door.']);
    expect(state.turnCount).toBe(2);
  });

  it('walks in through the door, says "You enter", and never changes space', () => {
    const { state, events } = buildWorldState();
    const spaceChanges: string[] = [];
    events.on('space-changed', (p) => spaceChanges.push(p.spaceId));

    tryMovePlayer(state, 'W', events); // (17,12)
    tryMovePlayer(state, 'W', events); // open the door
    expect(tryMovePlayer(state, 'W', events)).toBe(true); // onto the door cell (16,12), inside the rect
    expect(state.player).toMatchObject({ x: 16, y: 12 });
    expect(state.messageLog).toEqual(['You open the door.', 'You enter Prospector Saloon.']);

    expect(tryMovePlayer(state, 'W', events)).toBe(true); // (15,12), further in: no new message
    expect(state.messageLog).toHaveLength(2);
    expect(state.activeSpaceId).toBe('world');
    expect(spaceChanges).toEqual([]);
  });

  it('walking back out says "You leave" exactly once', () => {
    const { state, events } = buildWorldState();
    for (const d of ['W', 'W', 'W', 'W'] as const) tryMovePlayer(state, d, events); // ends at (15,12)
    state.messageLog.length = 0;

    tryMovePlayer(state, 'E', events); // (16,12) door cell, still inside the rect
    expect(state.messageLog).toEqual([]);
    tryMovePlayer(state, 'E', events); // (17,12), outside
    expect(state.messageLog).toEqual(['You leave Prospector Saloon.']);
    tryMovePlayer(state, 'E', events);
    expect(state.messageLog).toHaveLength(1);
  });

  it('a single "talk" bump speaks to Trudy, free, once inside', () => {
    const { state, events } = buildWorldState();
    const menus: string[] = [];
    events.on('npc-menu', (p) => menus.push(p.npc.id));
    for (const d of ['W', 'W', 'W', 'W', 'W'] as const) tryMovePlayer(state, d, events); // (14,12)
    expect(state.player).toMatchObject({ x: 14, y: 12 });
    const turns = state.turnCount;
    state.messageLog.length = 0;

    expect(tryMovePlayer(state, 'W', events)).toBe(false); // Trudy at (13,12)
    expect(state.player).toMatchObject({ x: 14, y: 12 });
    expect(state.turnCount).toBe(turns);
    expect(state.balloons).toHaveLength(1);
    expect(state.balloons[0]!.entityId).toBe('trudy');
    expect(state.messageLog[0]).toMatch(/^Trudy: "/);
    expect(menus).toEqual([]);
  });

  it('each step and each door-opening costs exactly one turn', () => {
    const { state, events } = buildWorldState();
    for (const d of ['W', 'W', 'W'] as const) tryMovePlayer(state, d, events);
    expect(state.turnCount).toBe(3);
  });
});

describe('tryMovePlayer — transitions between spaces (synthetic two-space fixture)', () => {
  /** Two 6x1 strips sharing world coordinates; stepping on x=3 of A enters B, on x=2 of B returns. */
  function buildTwoSpaces(): { state: GameState; events: EventBus<GameEvents> } {
    const mk = (id: string, transitions: Space['transitions']): Space => ({
      id,
      name: id,
      indoor: false,
      grid: createEmptyGrid(6, 1, 'ground'),
      npcs: [],
      monsters: [],
      transitions,
      places: [],
      visible: VisibleSet.empty(),
    });
    const a = mk('a', [{ x: 3, y: 0, toSpace: 'b' }]);
    const b = mk('b', [{ x: 2, y: 0, toSpace: 'a' }]);
    const state = createGameState(createPlayer(1, 0), { a, b }, 'a');
    return { state, events: new EventBus<GameEvents>() };
  }

  it('crossing a transition cell flips the active space, keeps world coordinates, and flips back', () => {
    const { state, events } = buildTwoSpaces();
    const changes: string[] = [];
    events.on('space-changed', (p) => changes.push(p.spaceId));

    expect(tryMovePlayer(state, 'E', events)).toBe(true); // (2,0), plain
    expect(state.activeSpaceId).toBe('a');
    expect(tryMovePlayer(state, 'E', events)).toBe(true); // (3,0), transition
    expect(state.player).toMatchObject({ x: 3, y: 0 });
    expect(state.activeSpaceId).toBe('b');
    expect(tryMovePlayer(state, 'E', events)).toBe(true); // (4,0) in b
    expect(state.activeSpaceId).toBe('b');
    expect(tryMovePlayer(state, 'W', events)).toBe(true); // (3,0)
    expect(tryMovePlayer(state, 'W', events)).toBe(true); // (2,0), transition back
    expect(state.activeSpaceId).toBe('a');

    expect(changes).toEqual(['b', 'a']);
  });

  it('each crossing step still costs exactly one turn', () => {
    const { state, events } = buildTwoSpaces();
    tryMovePlayer(state, 'E', events);
    tryMovePlayer(state, 'E', events);
    tryMovePlayer(state, 'E', events);
    expect(state.turnCount).toBe(3);
  });
});
