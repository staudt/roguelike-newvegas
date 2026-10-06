import { PALETTE, groundLevel } from '../config/palette';

/**
 * Tiles are deliberately plain data: walkability and opacity live here, not on the map. The one
 * exception is `ground` — its glyph and colors are *not* fixed, they're derived from the per-cell
 * height stored on the map (see `visualFor`), which is how the `. ░ ▒ ▓ █` elevation ladder works.
 */
export interface TileDef {
  id: string;
  walkable: boolean;
  opaque: boolean;
  /** When true, glyph/fg/bg below are ignored — `visualFor` derives them from cell height. */
  isGround?: boolean;
  glyph?: string;
  fg?: string;
  bg?: string;
}

export const TILES: Record<string, TileDef> = {
  // Nothing is here: the edge of the known map. Unwalkable and opaque, drawn as black - the hard
  // stop where the world ends. Cells outside any chunk read as void too.
  void: { id: 'void', walkable: false, opaque: true, glyph: ' ', fg: '#000000', bg: '#000000' },
  ground: { id: 'ground', walkable: true, opaque: false, isGround: true },
  rock: {
    id: 'rock',
    walkable: false,
    opaque: true,
    glyph: '*',
    fg: PALETTE.rockFg,
    bg: PALETTE.rockBg,
  },
  wall: {
    id: 'wall',
    walkable: false,
    opaque: true,
    glyph: '#',
    fg: PALETTE.wallFg,
    bg: PALETTE.wallBg,
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
    glyph: '.',
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

/** Resolves what to actually draw for a tile, folding in per-cell height for ground tiles. */
export function visualFor(id: string, height: number): TileVisual {
  const def = tileDef(id);
  if (def.isGround) {
    const level = groundLevel(height);
    return { glyph: level.glyph, fg: level.fg, bg: level.bg };
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

export function tileWalkable(index: number): boolean {
  return WALKABLE_BY_INDEX[index] ?? false;
}

export function tileOpaque(index: number): boolean {
  return OPAQUE_BY_INDEX[index] ?? true;
}
