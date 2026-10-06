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
  door: {
    id: 'door',
    walkable: true,
    opaque: true, // can't see a saloon interior through the doorway from the street
    glyph: '+',
    fg: PALETTE.doorFg,
    bg: PALETTE.doorBg,
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
