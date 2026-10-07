import { GROUND_LEVELS, PALETTE, ROAD_LEVELS, groundLevel, type GroundLevel } from '../config/palette';

/**
 * Tiles are deliberately plain data: walkability and opacity live here, not on the map. The one
 * exception is `ground` — its glyph and colors are *not* fixed, they're derived from the per-cell
 * height stored on the map (see `visualFor`), which is how the `▒ ▒ ▓ █` elevation ladder works.
 */
export interface TileDef {
  id: string;
  walkable: boolean;
  opaque: boolean;
  /** When true, glyph/fg/bg below are ignored — `visualFor` derives them from cell height. */
  isGround?: boolean;
  /** Ground-like tiles with their own look: one rung per height instead of the desert ladder. */
  levels?: readonly GroundLevel[];
  glyph?: string;
  fg?: string;
  bg?: string;
  /**
   * An object standing on top of some base (rock, wall, fence, safe...): it draws only its glyph and
   * takes the background of whatever is underneath. The base is stored in the cell's height byte as a
   * base code (see `baseCodeOf`), and the editor keeps it when you paint an object over a cell.
   */
  overlay?: boolean;
}

/**
 * Base codes for overlay cells, stored in the height byte: 0..3 desert ground at that height,
 * 4..7 road at height code-4, 8 indoor floor. Plain ground cells just store 0..3.
 */
export const BASE_ROAD = 4;
export const BASE_FLOOR = 8;

export const TILES: Record<string, TileDef> = {
  // Nothing is here: the edge of the known map. Unwalkable and opaque, drawn as black - the hard
  // stop where the world ends. Cells outside any chunk read as void too.
  void: { id: 'void', walkable: false, opaque: true, glyph: ' ', fg: '#000000', bg: '#000000' },
  ground: { id: 'ground', walkable: true, opaque: false, isGround: true },
  // Paved ground: behaves exactly like ground (it keeps a height and obeys the height rules).
  road: { id: 'road', walkable: true, opaque: false, isGround: true, levels: ROAD_LEVELS },
  rock: {
    id: 'rock',
    walkable: false,
    opaque: true,
    glyph: '*',
    fg: PALETTE.rockFg,
    overlay: true,
  },
  wall: {
    id: 'wall',
    walkable: false,
    opaque: true,
    glyph: '#',
    fg: PALETTE.wallFg,
    overlay: true,
  },
  // A closed door blocks movement and sight; bumping it opens it (see TurnManager). Once open it
  // is ordinary walkable, see-through floor, so a lit room is visible through its open door.
  door: {
    id: 'door',
    walkable: false,
    opaque: true,
    glyph: '+',
    fg: PALETTE.doorFg,
    bg: PALETTE.doorBg,
  },
  openDoor: {
    id: 'openDoor',
    walkable: true,
    opaque: false,
    glyph: "'",
    fg: PALETTE.doorFg,
    bg: PALETTE.floorBg,
  },
  floor: {
    id: 'floor',
    walkable: true,
    opaque: false,
    glyph: ' ', // just the lamplit colour: no dots on the floor
    fg: PALETTE.floorFg,
    bg: PALETTE.floorBg,
  },
};

export function tileDef(id: string): TileDef {
  const def = TILES[id];
  if (!def) throw new Error(`Unknown tile id "${id}"`);
  return def;
}

export interface TileVisual {
  glyph: string;
  fg: string;
  bg: string;
}

/** The base code a cell offers to an object painted over it (see `BASE_FLOOR`). */
export function baseCodeOf(id: string, height: number): number {
  const def = tileDef(id);
  if (def.overlay) return height; // already holds its own base
  if (id === 'road') return BASE_ROAD + Math.max(0, Math.min(ROAD_LEVELS.length - 1, height));
  if (def.isGround) return Math.max(0, Math.min(GROUND_LEVELS.length - 1, height));
  if (id === 'void') return 0;
  return BASE_FLOOR;
}

/** The ground height under a base code (0 for floor): what line of sight treats as the terrain there. */
export function baseGroundHeight(code: number): number {
  if (code >= BASE_FLOOR) return 0;
  return code >= BASE_ROAD ? code - BASE_ROAD : code;
}

function baseBackground(code: number): string {
  if (code >= BASE_FLOOR) return PALETTE.floorBg;
  if (code >= BASE_ROAD) return ROAD_LEVELS[Math.min(ROAD_LEVELS.length - 1, code - BASE_ROAD)]!.bg;
  return groundLevel(code).bg;
}

/** Resolves what to actually draw for a tile, folding in per-cell height for ground tiles and the base under objects. */
export function visualFor(id: string, height: number): TileVisual {
  const def = tileDef(id);
  if (def.isGround) {
    const level = def.levels
      ? def.levels[Math.max(0, Math.min(def.levels.length - 1, height))]!
      : groundLevel(height);
    return { glyph: level.glyph, fg: level.fg, bg: level.bg };
  }
  if (def.overlay) {
    return { glyph: def.glyph ?? '?', fg: def.fg ?? '#ffffff', bg: baseBackground(height) };
  }
  return { glyph: def.glyph ?? '?', fg: def.fg ?? '#ffffff', bg: def.bg ?? '#000000' };
}

/**
 * Stable numeric ids for tiles, so maps can store one byte per cell. The order is a runtime detail
 * only: chunk files store tile *names* in a per-file palette (see ChunkCodec), so reordering or
 * inserting here never breaks saved maps. Index 0 must stay 'void'.
 */
export const TILE_ORDER: readonly string[] = [
  'void',
  'ground',
  'rock',
  'wall',
  'door',
  'openDoor',
  'floor',
  'road',
];

const INDEX_BY_ID: Record<string, number> = Object.fromEntries(
  TILE_ORDER.map((id, i) => [id, i]),
);

export const VOID_TILE = 0;
export const GROUND_TILE = INDEX_BY_ID['ground']!;

export function tileIndex(id: string): number {
  const index = INDEX_BY_ID[id];
  if (index === undefined) throw new Error(`Unknown tile id "${id}"`);
  return index;
}

export function tileIdOf(index: number): string {
  return TILE_ORDER[index] ?? 'void';
}

/** Per-index lookups for hot paths: walkability/opacity are asked thousands of times a turn. */
const WALKABLE_BY_INDEX: boolean[] = TILE_ORDER.map((id) => tileDef(id).walkable);
const OPAQUE_BY_INDEX: boolean[] = TILE_ORDER.map((id) => tileDef(id).opaque);

const OVERLAY_BY_INDEX: boolean[] = TILE_ORDER.map((id) => tileDef(id).overlay === true);

const GROUND_LIKE_BY_INDEX: boolean[] = TILE_ORDER.map((id) => tileDef(id).isGround === true);

/** Ground or anything that behaves like it (road): open terrain that carries a height. */
export function tileIsGround(index: number): boolean {
  return GROUND_LIKE_BY_INDEX[index] ?? false;
}

/** An object drawn over a base (rock, wall...): its height byte is a base code, not a terrain height. */
export function tileIsOverlay(index: number): boolean {
  return OVERLAY_BY_INDEX[index] ?? false;
}

export function tileWalkable(index: number): boolean {
  return WALKABLE_BY_INDEX[index] ?? false;
}

export function tileOpaque(index: number): boolean {
  return OPAQUE_BY_INDEX[index] ?? true;
}
