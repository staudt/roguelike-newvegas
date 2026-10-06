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
/** Cell height as a multiple of the font size. Shared with the map editor so it matches the game. */
export const LINE_HEIGHT_RATIO = 1.2;

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

/**
 * The cost of one action, and therefore the speed of an ordinary creature (NetHack's model): each
 * creature banks its speed in movement points every turn and spends NORMAL_SPEED per action, so
 * speed 24 acts twice per turn, speed 18 alternates one and two, and speed 6 acts every other turn.
 */
export const NORMAL_SPEED = 12;

/** A hard stop on actions per creature per turn, so a silly speed value can't hang the game. */
export const MAX_ACTIONS_PER_TURN = 8;

/** Percent chance per action that an idle peaceful creature (a brahmin) takes a step. */
export const PEACEFUL_WANDER_CHANCE = 20;

/** Budget for path searches — enough to route round a building, small enough to run every turn. */
export const PATH_NODE_BUDGET = 600;

/** A hostile that has noticed you keeps hunting until you are this many times its awareness away. */
export const LOSE_TRACK_FACTOR = 2.5;

/**
 * Only creatures within this many cells (Chebyshev) of the player act. The world is huge and
 * everything beyond sight is asleep: it neither moves nor banks energy, so a tick costs the same
 * however many creatures the world holds.
 */
export const SIM_RADIUS = 40;

/** Gun to-hit modifier (percentage points) by target size. Melee ignores it. */
export const SIZE_TO_HIT_MODIFIER = { tiny: -20, small: -8, medium: 0, large: 8 } as const;

/** How hard a body is to knock back with a kick, by size. A creature may override with `mass`. */
export const SIZE_MASS = { tiny: 1.5, small: 2, medium: 5, large: 12 } as const;

/** Kick force (2 x Strength + 0-6) divided by this and the target's mass is the squares it flies. */
export const KICK_FORCE_DIVISOR = 2;

/** A knocked-back creature loses this many actions per square it flew (at least one) getting up. */
export const KICK_STAGGER_PER_SQUARE = 0.5;

/**
 * Where a shot tends to land, by distance as a fraction of the gun's effective range. Each value
 * multiplies the head/arm/leg hit weights (the torso weight never changes): below 1 the hit is
 * likely the torso, above 1 a head or limb is likelier. Every gun shares it.
 */
export const AIM_ZONES = {
  /** Up to 1/3 of the range: too close to place a shot. */
  point: 0.5,
  /** Up to 2/3: the sweet spot for aimed shots. */
  sweet: 1.5,
  /** Up to the full range: accurate, but the hit lands on the torso more often. */
  far: 0.7,
  /** Beyond it. */
  beyond: 0.4,
} as const;

/** Each hostile next to the shooter costs this many to-hit points on shots at range, up to the cap. */
export const CROWD_PENALTY_PER_HOSTILE = 10;
export const CROWD_PENALTY_MAX = 30;

/** Targets faster than this are harder to shoot... */
export const EVASION_SPEED_THRESHOLD = 12;
/** ...by this many points per point of speed above the threshold. */
export const EVASION_PER_SPEED = 0.5;

/** A gunshot alerts every hostile creature within this many cells (Chebyshev) of the shooter. */
export const GUN_NOISE_RADIUS = 14;

/** A scream (a peaceful hurt or killed) makes bystanders within this many cells come and look. */
export const SCREAM_NOISE_RADIUS = 12;

/** A call for help carries further than a scream: it is shouted on purpose. */
export const SHOUT_NOISE_RADIUS = 16;
