import { describe, expect, it } from 'vitest';
import { BALLOON_TURNS } from '../src/config/constants';
import { createNpc } from '../src/entities/Npc';
import { createPlayer } from '../src/entities/Player';
import { advanceTurn, tryMovePlayer } from '../src/engine/TurnManager';
import { EventBus, type GameEvents } from '../src/engine/EventBus';
import { createGameState, type GameState, type Space } from '../src/engine/GameState';
import { createEmptyGrid, setTileId } from '../src/world/GameMap';
import { loadSpace, type SpaceJSON } from '../src/world/MapLoader';
import prospectorSaloonJson from '../src/world/goodsprings/prospectorSaloon.json';
import worldMapJson from '../src/world/goodsprings/worldMap.json';

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
    worldOrigin: { x: 0, y: 0 },
    grid,
    npcs: [npc],
    transitions: [],
    visible: new Uint8Array(25),
    explored: new Uint8Array(25),
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

describe('tryMovePlayer — seamless door crossing (real Goodsprings data)', () => {
  function buildWorldState(): { state: GameState; events: EventBus<GameEvents> } {
    const world = loadSpace(worldMapJson as SpaceJSON);
    const saloon = loadSpace(prospectorSaloonJson as SpaceJSON);

    // Start two tiles east of the door (world (16,12)) on open ground, facing west toward it.
    const player = createPlayer(18, 12);
    const state = createGameState(player, { world, 'prospector-saloon': saloon }, 'world');
    const events = new EventBus<GameEvents>();
    return { state, events };
  }

  it('walks from the street, through the door, to the interior vestibule, and back out', () => {
    const { state, events } = buildWorldState();
    const spaceChanges: string[] = [];
    events.on('space-changed', (payload) => spaceChanges.push(payload.spaceId));

    // Approach: plain ground step, no transition here.
    expect(tryMovePlayer(state, 'W', events)).toBe(true);
    expect(state.player).toMatchObject({ x: 17, y: 12 });
    expect(state.activeSpaceId).toBe('world');

    // Step onto the door tile itself — flips into the saloon interior, same world coordinates.
    expect(tryMovePlayer(state, 'W', events)).toBe(true);
    expect(state.player).toMatchObject({ x: 16, y: 12 });
    expect(state.activeSpaceId).toBe('prospector-saloon');

    // Step onto the one-tile interior vestibule — flips straight back out to the world.
    expect(tryMovePlayer(state, 'E', events)).toBe(true);
    expect(state.player).toMatchObject({ x: 17, y: 12 });
    expect(state.activeSpaceId).toBe('world');

    expect(spaceChanges).toEqual(['prospector-saloon', 'world']);
  });

  it('each crossing step still costs exactly one turn', () => {
    const { state, events } = buildWorldState();

    tryMovePlayer(state, 'W', events);
    tryMovePlayer(state, 'W', events);
    tryMovePlayer(state, 'E', events);

    expect(state.turnCount).toBe(3);
  });
});
