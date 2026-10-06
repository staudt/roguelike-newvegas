import { effectiveSpeed } from '../combat/CombatFormulas';
import {
  LOSE_TRACK_FACTOR,
  MAX_ACTIONS_PER_TURN,
  NORMAL_SPEED,
  PEACEFUL_WANDER_CHANCE,
  SIM_RADIUS,
} from '../config/constants';
import type { Creature } from '../entities/Creature';
import { creatureAttacks } from '../engine/Combat';
import type { EventBus, GameEvents } from '../engine/EventBus';
import { getActiveSpace, type GameState } from '../engine/GameState';
import { hasLineOfSight } from '../fov/LineOfSight';
import { chebyshevDistance, DIRECTION_VECTORS, type Point } from '../utils/geometry';
import { randomInt, type RNG } from '../utils/RNG';
import { canStep } from '../world/GameMap';
import { cellKey, nextStepToward } from './Pathfinding';

const STEP_VECTORS = Object.values(DIRECTION_VECTORS);

/** Cells (-> creature) occupied this tick, kept current as creatures move. */
type Occupancy = Map<number, Creature>;

/**
 * Runs the creature turns for one world tick, NetHack-style: each banks its speed in movement
 * points and spends NORMAL_SPEED per action, so a fast creature takes several steps or strikes in
 * a single turn and a slow one acts only on some turns. Leftover energy carries over.
 *
 * Only creatures within SIM_RADIUS of the player act (the rest of the world is asleep and banks
 * nothing), and "is this cell taken?" is a lookup in an occupancy index built once per tick.
 */
export function runCreatureTurns(state: GameState, rng: RNG, events: EventBus<GameEvents>): void {
  const space = getActiveSpace(state);
  const player = state.player;

  const active: Creature[] = [];
  const occupancy: Occupancy = new Map();
  const nearby = (c: Creature, radius: number): boolean =>
    Math.abs(c.x - player.x) <= radius && Math.abs(c.y - player.y) <= radius;

  for (const list of [space.monsters, space.npcs] as Creature[][]) {
    for (const c of list) {
      if (!nearby(c, SIM_RADIUS + 2)) continue;
      occupancy.set(cellKey(c.x, c.y), c);
      if (nearby(c, SIM_RADIUS)) active.push(c);
    }
  }

  for (const creature of active) {
    creature.energy += effectiveSpeed(creature);
    let actions = 0;

    while (creature.energy >= NORMAL_SPEED && actions < MAX_ACTIONS_PER_TURN && !state.gameOver) {
      creature.energy -= NORMAL_SPEED;
      actions++;

      if (creature.hostile) {
        actAsHostile(state, creature, rng, events, occupancy);
      } else if (creature.kind === 'monster') {
        wander(state, creature, rng, occupancy);
      }
    }

    // An idle creature doesn't hoard turns to unleash later.
    if (creature.energy > NORMAL_SPEED) creature.energy = NORMAL_SPEED;
  }
}

function moveTo(occupancy: Occupancy, creature: Creature, x: number, y: number): void {
  occupancy.delete(cellKey(creature.x, creature.y));
  creature.x = x;
  creature.y = y;
  occupancy.set(cellKey(x, y), creature);
}

/** Cells creatures may not path into: anyone's feet. (Closed doors already fail `canStep`.) */
function isOccupied(state: GameState, occupancy: Occupancy, x: number, y: number): boolean {
  return (state.player.x === x && state.player.y === y) || occupancy.has(cellKey(x, y));
}

function actAsHostile(
  state: GameState,
  creature: Creature,
  rng: RNG,
  events: EventBus<GameEvents>,
  occupancy: Occupancy,
): void {
  const space = getActiveSpace(state);
  const here: Point = creature;
  const distance = chebyshevDistance(here, state.player);

  if (!creature.alerted) {
    if (distance > creature.awareness) return;
    if (!hasLineOfSight(space.grid, here, state.player)) return;
    creature.alerted = true;
  } else if (distance > creature.awareness * LOSE_TRACK_FACTOR) {
    creature.alerted = false;
    return;
  }

  if (distance <= 1) {
    creatureAttacks(state, creature, rng, events);
    return;
  }

  const step = nextStepToward(space.grid, here, state.player, (x, y) =>
    isOccupied(state, occupancy, x, y),
  );
  if (!step) return;

  moveTo(occupancy, creature, step.x, step.y);
}

/** Peaceful creatures (a brahmin) drift about now and then; they never leave their space. */
function wander(state: GameState, creature: Creature, rng: RNG, occupancy: Occupancy): void {
  if (randomInt(rng, 1, 100) > PEACEFUL_WANDER_CHANCE) return;

  const space = getActiveSpace(state);
  const v = STEP_VECTORS[randomInt(rng, 0, STEP_VECTORS.length - 1)]!;
  const to = { x: creature.x + v.x, y: creature.y + v.y };

  if (!canStep(space.grid, creature, to) || isOccupied(state, occupancy, to.x, to.y)) return;
  moveTo(occupancy, creature, to.x, to.y);
}
