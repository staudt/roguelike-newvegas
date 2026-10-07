/**
 * Shared Mojave art direction — the one deliberate break from NetHack's black-void look.
 *
 * Every cell (not just unexplored ones) gets a warm desert background, and that background
 * deepens as terrain height rises, so elevation reads at a glance before you even parse the
 * glyph. UI chrome borrows Pip-Boy amber/green. Both the game renderer and the map editor import
 * this module so retuning a color never means hunting through two files.
 */

/** One rung of the ground height ladder: the lightest texture at ground level up to a solid `█` on a ridge. */
export interface GroundLevel {
  glyph: string;
  fg: string;
  bg: string;
}

export const GROUND_LEVELS: readonly GroundLevel[] = [
  // 0 — flat ground: the old scrub texture, with fg and bg centred on the old flat colour (#4a3826),
  // so the overall tone is unchanged. Widen or narrow the gap to make the texture louder or quieter.
  { glyph: '▒', fg: '#5a4630', bg: '#3a2a1c' },
  { glyph: '░', fg: '#c9ad73', bg: '#42311f' }, // 1 — rising dust
  { glyph: '▓', fg: '#a37f41', bg: '#322313' }, // 2 — rocky rise
  { glyph: '█', fg: '#8a6a37', bg: '#2a1d0f' }, // 3 — ridge top, highest walkable ground
];

/**
 * Road: the ground's own height glyphs in asphalt greys, so height reads exactly as on the desert
 * ground (`▒` at level 0, then `░ ▓ █`); only the colors say "paved".
 */
export const ROAD_LEVELS: readonly GroundLevel[] = [
  { glyph: '▒', fg: '#494845', bg: '#2d2c29' }, // same idea, centred on the old flat road (#3b3a37)
  { glyph: '░', fg: '#8d887d', bg: '#353431' },
  { glyph: '▓', fg: '#736f66', bg: '#292825' },
  { glyph: '█', fg: '#66625a', bg: '#232220' },
];

export const MAX_GROUND_HEIGHT = GROUND_LEVELS.length - 1;

export const PALETTE = {
  ground: GROUND_LEVELS,

  // Hard barriers.
  rockFg: '#8a8a86',
  rockBg: '#1f1b16',
  wallFg: '#b0845a',
  wallBg: '#241a10',
  doorFg: '#e8c84a',
  doorBg: '#241a10',

  // Indoor floor — warm lamplight rather than outdoor dust.
  floorFg: '#d9bb86',
  floorBg: '#3f2c18',

  // Fog of war.
  unexplored: '#000000',
  rememberedOverlay: 'rgba(10, 8, 4, 0.62)',

  // Entities.
  playerFg: '#fff2cc',
  npcFg: '#e0c08a',
  interactableFg: '#ffd94d',
  hostileRing: '#e05252',
  alliedRing: '#6fd3a0',

  // UI chrome (Pip-Boy amber/green on near-black green).
  uiBg: '#081009',
  uiBorder: '#2b3a1e',
  uiAmber: '#ffb000',
  uiGreen: '#33ff66',
  uiDim: '#7a8f6e',
  uiDanger: '#ff5555',

  // Monologue balloons.
  balloonBg: '#1c140d',
  balloonBorder: '#ffb000',
  balloonText: '#ecdfc0',
} as const;

export function groundLevel(height: number): GroundLevel {
  const clamped = Math.max(0, Math.min(MAX_GROUND_HEIGHT, height));
  return GROUND_LEVELS[clamped]!;
}
