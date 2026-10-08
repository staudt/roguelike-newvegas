import { searchPath } from '../ai/Pathfinding';
import {
  RUN_MAX_STEPS,
  TRAVEL_DANGER_RADIUS,
  TRAVEL_NODE_BUDGET,
  TRAVEL_PROBE_STEPS,
} from '../config/constants';
import { creatureAt, theName, type Creature } from '../entities/Creature';
import type { Npc } from '../entities/Npc';
import {
  chebyshevDistance,
  DIRECTION_VECTORS,
  linePoints,
  type Direction,
  type Point,
} from '../utils/geometry';
import { canStep, isWalkable } from '../world/GameMap';
import { tileOpenable } from '../world/Tile';
import { groundItemsAt } from './GroundItems';
import { getActiveSpace, placeAt, type GameState } from './GameState';

/**
 * Click-to-travel and `g` (run), as pure planning and judgement. The Game owns the timer that takes
 * one step at a time; this module decides where the steps go and when a walk must stop.
 */

export interface TravelPlan {
  /** The steps still to take, one cell each, nearest first. May be empty (already next to the target). */
  path: Point[];
  /** Someone to bump into on arrival: a person with something to say or offer. */
  interact: Npc | null;
}

export type PlanResult = { plan: TravelPlan } | { refusal: string | null };

/** What a click on the map does about walking: where to, or why not (null: say nothing). */
export function planTravel(state: GameState, target: Point): PlanResult {
  const player = state.player;
  if (target.x === player.x && target.y === player.y) return { refusal: null };

  const space = getActiveSpace(state);
  const grid = space.grid;
  const known = (p: Point): boolean => space.visible.has(p.x, p.y) || grid.isExplored(p.x, p.y);
  // Closed doors are routable: the walk opens each one in passing (that costs a step, not the walk).
  const canMove = (from: Point, to: Point): boolean =>
    known(to) &&
    !creatureAt(space, to.x, to.y) &&
    (tileOpenable(grid.getTile(to.x, to.y)) || canStep(grid, from, to));

  const creature = creatureAt(space, target.x, target.y);
  if (creature) {
    const interact = creature.kind === 'npc' && !creature.hostile && creature.interactions.length > 0 ? creature : null;
    if (chebyshevDistance(player, target) <= 1) return { plan: { path: [], interact } };
    const found = searchPath(
      player,
      (p) => chebyshevDistance(p, target) <= 1,
      canMove,
      target,
      TRAVEL_NODE_BUDGET,
    );
    if (!found.path) return { refusal: "You can't find a way there." };
    return { plan: { path: found.path, interact } };
  }

  if (known(target)) {
    if (!isWalkable(grid, target.x, target.y) && !tileOpenable(grid.getTile(target.x, target.y))) {
      return { refusal: null }; // a deliberate click on a wall: nothing to say
    }
    const found = searchPath(
      player,
      (p) => p.x === target.x && p.y === target.y,
      canMove,
      target,
      TRAVEL_NODE_BUDGET,
    );
    if (!found.path) return { refusal: "You can't find a way there." };
    return { plan: { path: found.path, interact: null } };
  }

  // Somewhere never seen. Head for the nearest known cell toward it, then a short way straight on
  // into the unknown: far enough to find out, not so far as to march into the middle of nowhere.
  const toEdge = searchPath(player, () => false, canMove, target, TRAVEL_NODE_BUDGET).nearest;
  const edge = toEdge[toEdge.length - 1] ?? { x: player.x, y: player.y };
  const probe = probeToward(state, edge, target, TRAVEL_PROBE_STEPS);
  const path = [...toEdge, ...probe];
  return path.length > 0 ? { plan: { path, interact: null } } : { refusal: "You can't go that way." };
}

/** Up to `limit` steps straight from `from` toward `target`, through cells that exist and can be walked. */
function probeToward(state: GameState, from: Point, target: Point, limit: number): Point[] {
  const space = getActiveSpace(state);
  const steps: Point[] = [];
  let at = from;
  for (const p of linePoints(from, target)) {
    if (steps.length >= limit) break;
    if (p.x === from.x && p.y === from.y) continue;
    if (!canStep(space.grid, at, p) || creatureAt(space, p.x, p.y)) break;
    steps.push(p);
    at = p;
  }
  return steps;
}

/** `g` + direction: the cells you can walk straight that way, up to `RUN_MAX_STEPS`. */
export function planRun(state: GameState, direction: Direction): Point[] {
  const space = getActiveSpace(state);
  const v = DIRECTION_VECTORS[direction];
  const steps: Point[] = [];
  let at: Point = { x: state.player.x, y: state.player.y };
  while (steps.length < RUN_MAX_STEPS) {
    const next = { x: at.x + v.x, y: at.y + v.y };
    const door = tileOpenable(space.grid.getTile(next.x, next.y));
    if (creatureAt(space, next.x, next.y) || (!door && !canStep(space.grid, at, next))) break;
    steps.push(next);
    at = next;
    if (door) break; // opening it is the step; what lies beyond is for the next run
  }
  return steps;
}

/** What the world looked like before a step, to tell what changed because of it. */
export interface TravelSnapshot {
  hp: number;
  seen: Set<string>;
  /** Hostiles that were already within `TRAVEL_DANGER_RADIUS`. */
  near: Set<string>;
  noises: number;
  place: string | undefined;
}

function visibleCreatures(state: GameState): Creature[] {
  const space = getActiveSpace(state);
  return [...space.monsters, ...space.npcs].filter((c) => space.visible.has(c.x, c.y));
}

export function snapshotTravel(state: GameState): TravelSnapshot {
  const space = getActiveSpace(state);
  const seen = new Set<string>();
  const near = new Set<string>();
  for (const c of visibleCreatures(state)) {
    seen.add(c.id);
    if (c.hostile && chebyshevDistance(c, state.player) <= TRAVEL_DANGER_RADIUS) near.add(c.id);
  }
  return {
    hp: state.player.hp,
    seen,
    near,
    noises: state.noisesHeard,
    place: placeAt(space, state.player)?.name,
  };
}

export interface Interruption {
  /** A line for the log, or null when what happened already said it. */
  message: string | null;
}

/**
 * Should the walk stop after the step just taken? Yes when anything significant changed: a hostile
 * came into view, a hostile got close, you were hurt, you heard a cry, you stepped on
 * something lying there, or you crossed into or out of a named place.
 */
export function travelInterruption(state: GameState, before: TravelSnapshot): Interruption | null {
  if (state.player.hp < before.hp) return { message: null };

  const space = getActiveSpace(state);
  const fresh: Creature[] = [];
  let closeIn: Creature | null = null;
  for (const c of visibleCreatures(state)) {
    if (!before.seen.has(c.id)) {
      if (c.hostile) fresh.push(c); // a peaceful passer-by (a brahmin, a townsperson) is no reason to stop
    }
    else if (c.hostile && !before.near.has(c.id) && chebyshevDistance(c, state.player) <= TRAVEL_DANGER_RADIUS) {
      closeIn = c;
    }
  }
  if (fresh.length > 0) {
    const names = fresh.map((c) => theName(c));
    return { message: `You see ${joinNames(names)}. You stop.` };
  }
  if (closeIn) return { message: `${cap(theName(closeIn))} is closing in. You stop.` };

  if (state.noisesHeard > before.noises) return { message: null };
  if (placeAt(space, state.player)?.name !== before.place) return { message: null };
  if (groundItemsAt(state, state.player.x, state.player.y).length > 0) return { message: null };
  return null;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
