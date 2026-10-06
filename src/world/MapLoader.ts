import type { Space } from '../engine/GameState';
import { createMonster } from '../entities/Monster';
import { createNpc, type InteractionId, type Npc } from '../entities/Npc';
import type { Point } from '../utils/geometry';
import type { MapGrid } from './GameMap';

/**
 * On-disk shape of one space. Goodsprings is hand-authored rather than procedurally generated,
 * so unlike rogueout's ASCII-plan-plus-generator format, a space here is plain JSON: a flat tile
 * grid, a parallel height grid, and its NPCs/transitions. The map editor reads and writes exactly
 * this shape (see src/editor/MapDocument.ts).
 */
export interface SpaceJSON {
  id: string;
  name: string;
  indoor: boolean;
  worldOrigin: Point;
  width: number;
  height: number;
  /** Row-major tile ids, length width*height. */
  tiles: string[];
  /** Row-major terrain height 0..4, length width*height. Ignored for non-ground tiles. */
  heights: number[];
  npcs: Array<{
    id: string;
    name: string;
    x: number;
    y: number;
    dialogue: string[];
    fg?: string;
    /** Omitted means just 'talk'. More than one opens a menu on bump. */
    interactions?: InteractionId[];
  }>;
  /** Creatures placed from the monster table. Omitted means none. */
  monsters?: Array<{ defId: string; x: number; y: number }>;
  transitions: Array<{ x: number; y: number; toSpace: string }>;
  /** Where the player starts out. Only meaningful on the space the game boots into ('world'). */
  playerStart?: Point;
}

export function loadSpace(data: SpaceJSON): Space {
  const expected = data.width * data.height;
  if (data.tiles.length !== expected) {
    throw new Error(
      `Space "${data.id}": tiles length ${data.tiles.length} does not match ${data.width}x${data.height}`,
    );
  }
  if (data.heights.length !== expected) {
    throw new Error(
      `Space "${data.id}": heights length ${data.heights.length} does not match ${data.width}x${data.height}`,
    );
  }

  const grid: MapGrid = {
    width: data.width,
    height: data.height,
    tiles: [...data.tiles],
    heights: Uint8Array.from(data.heights),
  };

  const npcs: Npc[] = data.npcs.map((n) => createNpc(n.id, n.name, n.x, n.y, n.dialogue, n.fg, n.interactions));
  const monsters = (data.monsters ?? []).map((m, i) => createMonster(`${m.defId}-${i + 1}`, m.defId, m.x, m.y));

  return {
    id: data.id,
    name: data.name,
    indoor: data.indoor,
    worldOrigin: { ...data.worldOrigin },
    grid,
    npcs,
    monsters,
    transitions: data.transitions.map((t) => ({ ...t })),
    visible: new Uint8Array(expected),
    explored: new Uint8Array(expected),
  };
}

/** The inverse of loadSpace — used by the map editor to write a Space back out as JSON. */
export function serializeSpace(space: Space): SpaceJSON {
  return {
    id: space.id,
    name: space.name,
    indoor: space.indoor,
    worldOrigin: { ...space.worldOrigin },
    width: space.grid.width,
    height: space.grid.height,
    tiles: [...space.grid.tiles],
    heights: Array.from(space.grid.heights),
    npcs: space.npcs.map((n) => ({
      id: n.id,
      name: n.name,
      x: n.x,
      y: n.y,
      dialogue: [...n.dialogue],
      fg: n.fg,
      interactions: [...n.interactions],
    })),
    monsters: space.monsters.map((m) => ({ defId: m.defId, x: m.x, y: m.y })),
    transitions: space.transitions.map((t) => ({ ...t })),
  };
}
