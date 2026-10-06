import { EventBus, type GameEvents } from '../../src/engine/EventBus';
import { createGameState, type GameState, type Space } from '../../src/engine/GameState';
import type { Monster } from '../../src/entities/Monster';
import type { Npc } from '../../src/entities/Npc';
import { createPlayer } from '../../src/entities/Player';
import { VisibleSet } from '../../src/fov/VisibleSet';
import { createEmptyGrid, setTileId, type MapGrid } from '../../src/world/GameMap';
import type { RNG } from '../../src/utils/RNG';

/** An RNG that replays a fixed queue and counts how many values were consumed. Throws if it runs dry. */
export interface ScriptedRNG extends RNG {
  readonly consumed: number;
}

export function scriptedRNG(values: number[]): ScriptedRNG {
  let i = 0;
  const rng = (() => {
    if (i >= values.length) throw new Error(`ScriptedRNG exhausted after ${values.length} rolls`);
    return values[i++]!;
  }) as RNG & { consumed: number };
  Object.defineProperty(rng, 'consumed', { get: () => i });
  return rng as ScriptedRNG;
}

/** The d100 value `randomInt(rng, 1, 100)` produces for a given raw roll. */
export function d100(roll: number): number {
  return 1 + Math.floor(roll * 100);
}

export interface ArenaOptions {
  width: number;
  height: number;
  /** Local (== world) coordinates. */
  player: { x: number; y: number };
  walls?: Array<[number, number]>;
  doors?: Array<[number, number]>;
  monsters?: Monster[];
  npcs?: Npc[];
  indoor?: boolean;
}

export interface Arena {
  state: GameState;
  events: EventBus<GameEvents>;
  grid: MapGrid;
  /** Names of every event emitted, in order, with payloads. */
  emitted: Array<{ name: string; payload: unknown }>;
}

/** A flat, open space with world origin (0,0), plus a recorder for the interesting events. */
export function buildArena(opts: ArenaOptions): Arena {
  const grid = createEmptyGrid(opts.width, opts.height, 'ground');
  for (const [x, y] of opts.walls ?? []) setTileId(grid, x, y, 'wall');
  for (const [x, y] of opts.doors ?? []) setTileId(grid, x, y, 'door');

  const space: Space = {
    id: 'arena',
    name: 'Arena',
    indoor: opts.indoor ?? false,
    grid,
    npcs: opts.npcs ?? [],
    monsters: opts.monsters ?? [],
    transitions: [],
    places: [],
    visible: VisibleSet.empty(),
  };

  const state = createGameState(createPlayer(opts.player.x, opts.player.y), { arena: space }, 'arena');
  const events = new EventBus<GameEvents>();
  const emitted: Arena['emitted'] = [];
  for (const name of ['turn-ended', 'npc-interacted', 'space-changed', 'attack-prompted', 'npc-menu', 'player-died']) {
    events.on(name, (payload: unknown) => emitted.push({ name, payload }));
  }
  return { state, events, grid, emitted };
}
