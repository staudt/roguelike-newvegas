import { DAYLIGHT_SIGHT_RADIUS, INDOOR_SIGHT_RADIUS } from '../config/constants';
import { startingStanding, type Standing } from '../entities/Factions';
import type { Monster } from '../entities/Monster';
import type { Item } from '../items/Item';
import type { Npc } from '../entities/Npc';
import type { Player } from '../entities/Player';
import { rectContains, type Point, type Rect } from '../utils/geometry';
import type { VisibleSet } from '../fov/VisibleSet';
import type { TileMap } from '../world/TileMap';

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
 * A named rectangle of the map — "Prospector Saloon", "Doc Mitchell's House". Purely descriptive:
 * it carries no walls or rules (those are ordinary tiles), it just names where you are. Smaller
 * places nest inside larger ones and win when both contain you.
 */
export interface Place {
  name: string;
  rect: Rect;
}

/** An item lying on the floor. Several can share a cell. */
export interface GroundItem {
  x: number;
  y: number;
  item: Item;
}

export interface Space {
  id: string;
  name: string;
  indoor: boolean;
  /** Every coordinate in the game is a world coordinate; the map decides which cells exist. */
  grid: TileMap;
  npcs: Npc[];
  monsters: Monster[];
  items: GroundItem[];
  transitions: Transition[];
  places: Place[];
  /** Cells in view right now. What has been seen before lives in the map (isExplored). */
  visible: VisibleSet;
}

/** The innermost named place containing a world point, if any. */
export function placeAt(space: Space, point: Point): Place | undefined {
  let best: Place | undefined;
  for (const place of space.places) {
    if (!rectContains(place.rect, point)) continue;
    if (!best || place.rect.width * place.rect.height < best.rect.width * best.rect.height) best = place;
  }
  return best;
}

/** What to show as "Location": the place you're standing in, else the space's own name. */
export function locationName(state: GameState): string {
  const space = getActiveSpace(state);
  return placeAt(space, state.player)?.name ?? space.name;
}

export function sightRadiusFor(space: Space): number {
  return space.indoor ? INDOOR_SIGHT_RADIUS : DAYLIGHT_SIGHT_RADIUS;
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
  /** The player's standing with each faction, -100..100. At or below `HOSTILE_STANDING` it attacks on sight. */
  standing: Standing;
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
    standing: startingStanding(),
  };
}
