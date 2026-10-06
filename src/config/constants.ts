/**
 * Base font size in CSS pixels for the map glyph grid. Actual cell width/height are measured from
 * this font's real metrics at runtime (see Renderer) rather than forced into a square — we want
 * ordinary terminal proportions, not rogueout's stretched-to-square cells.
 */
export const BASE_FONT_SIZE = 20;

/**
 * A monospace stack that renders box-drawing and block-fill characters (─ │ ░ ▒ ▓ █) with
 * consistent full-cell advance widths across platforms, falling back gracefully.
 */
export const FONT_FAMILY = '"Cascadia Mono", "DejaVu Sans Mono", Consolas, monospace';

/**
 * Fallback viewport size in cells. The real size is measured from the window at runtime (see
 * Renderer.resize) so the map fills whatever space the page has; these only apply when there's
 * nothing to measure yet — jsdom in tests, or a layout that hasn't happened.
 */
export const MIN_VIEWPORT_COLS = 40;
export const MIN_VIEWPORT_ROWS = 25;

/** Max gap (ms) between the first and second arrow-key press to count as a diagonal chord. */
export const DIAGONAL_CHORD_WINDOW_MS = 45;

/**
 * Terrain height is climbable only one rung at a time (see world/GameMap.canStep) — you can't
 * step straight from flat ground onto a ridge top, you have to cross the slope in between.
 */
export const MAX_STEP_HEIGHT_DELTA = 1;

/** How far you can see in the open under a hard desert sun, in tiles. Still blocked by LOS. */
export const DAYLIGHT_SIGHT_RADIUS = 24;

/** How far you can see indoors without a window — short, so a lit doorway matters. */
export const INDOOR_SIGHT_RADIUS = 10;

/** How many player turns a monologue balloon stays on screen after an NPC speaks. */
export const BALLOON_TURNS = 4;
