import { DAYLIGHT_SIGHT_RADIUS, INDOOR_SIGHT_RADIUS } from '../config/constants';
import type { Monster } from '../entities/Monster';
import type { Npc } from '../entities/Npc';
import type { Player } from '../entities/Player';
import type { Point } from '../utils/geometry';
import type { MapGrid } from '../world/GameMap';

/**
 * A doorway (or any deliberate crossing) between two spaces. `x`/`y` are WORLD coordinates and
 * are the *same* on both sides of the doorway — the saloon's interior places its own door
 * transition at the exact world point the outdoor door sits at. That's what makes crossing
 * seamless: the player's x/y never change, only `activeSpaceId` does.
 */
export interface Transition {
  x: number;
  y: number;
  toSpace: string;
}

/**
 * One map the player can be standing in: the outdoor world, or a building interior. Interiors
 * are separate `MapGrid`s (own local coordinates) rather than cells carved out of the world map —
 * the world is expected to grow large, and keeping each building's data independent is what lets
 * it be authored, saved, and loaded on its own. `worldOrigin` is what stitches a local grid back
 * into world space: world (wx, wy) <-> local (wx - worldOrigin.x, wy - worldOrigin.y). The
 * outdoor world itself has `worldOrigin = {0, 0}`, so the common case costs nothing.
 */
export interface Space {
  id: string;
  name: string;
  indoor: boolean;
  worldOrigin: Point;
  grid: MapGrid;
  npcs: Npc[];
  monsters: Monster[];
  transitions: Transition[];
  visible: Uint8Array;
  explored: Uint8Array;
}

export function sightRadiusFor(space: Space): number {
  return space.indoor ? INDOOR_SIGHT_RADIUS : DAYLIGHT_SIGHT_RADIUS;
}

export function worldToLocal(space: Space, point: Point): Point {
  return { x: point.x - space.worldOrigin.x, y: point.y - space.worldOrigin.y };
}

export function localToWorld(space: Space, point: Point): Point {
  return { x: point.x + space.worldOrigin.x, y: point.y + space.worldOrigin.y };
}

/** A monologue bubble floating above an NPC on the canvas. Transient — never saved. */
export interface Balloon {
  entityId: string;
  text: string;
  x: number;
  y: number;
  turnsLeft: number;
}

export interface GameState {
  player: Player;
  spaces: Record<string, Space>;
  activeSpaceId: string;
  turnCount: number;
  messageLog: string[];
  balloons: Balloon[];
  gameOver: boolean;
}

export function getActiveSpace(state: GameState): Space {
  const space = state.spaces[state.activeSpaceId];
  if (!space) throw new Error(`Unknown space "${state.activeSpaceId}"`);
  return space;
}

export function addMessage(state: GameState, text: string): void {
  state.messageLog.push(text);
}

export function createGameState(
  player: Player,
  spaces: Record<string, Space>,
  activeSpaceId: string,
): GameState {
  return {
    player,
    spaces,
    activeSpaceId,
    turnCount: 0,
    messageLog: [],
    balloons: [],
    gameOver: false,
  };
}
