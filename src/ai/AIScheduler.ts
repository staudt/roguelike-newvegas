import { effectiveSpeed } from '../combat/CombatFormulas';
import {
  LOSE_TRACK_FACTOR,
  MAX_ACTIONS_PER_TURN,
  NORMAL_SPEED,
  PEACEFUL_WANDER_CHANCE,
} from '../config/constants';
import type { Creature } from '../entities/Creature';
import { creatureAttacks } from '../engine/Combat';
import type { EventBus, GameEvents } from '../engine/EventBus';
import { getActiveSpace, worldToLocal, type GameState, type Space } from '../engine/GameState';
import { hasLineOfSight } from '../fov/LineOfSight';
import { chebyshevDistance, DIRECTION_VECTORS, type Point } from '../utils/geometry';
import { randomInt, type RNG } from '../utils/RNG';
import { canStep, getTileId } from '../world/GameMap';
import { nextStepToward } from './Pathfinding';

const STEP_VECTORS = Object.values(DIRECTION_VECTORS);

/**
 * Runs every creature's turn for one world tick, NetHack-style: each banks its speed in movement
 * points and spends NORMAL_SPEED per action, so a fast creature takes several steps or strikes in
 * a single turn and a slow one acts only on some turns. Leftover energy carries over, which is
 * what makes speeds like 18 (one action, then two) or 8 (two actions every three turns) work.
 */
export function runCreatureTurns(state: GameState, rng: RNG, events: EventBus<GameEvents>): void {
  const space = getActiveSpace(state);
  const creatures: Creature[] = [...space.monsters, ...space.npcs];

  for (const creature of creatures) {
    // May have died or left the space earlier this tick.
    if (!isPresent(space, creature)) continue;

    creature.energy += effectiveSpeed(creature);
    let actions = 0;

    while (creature.energy >= NORMAL_SPEED && actions < MAX_ACTIONS_PER_TURN && !state.gameOver) {
      creature.energy -= NORMAL_SPEED;
      actions++;

      if (creature.hostile) {
        actAsHostile(state, creature, rng, events);
      } else if (creature.kind === 'monster') {
        wander(state, creature, rng);
      }
    }

    // An idle creature doesn't hoard turns to unleash later.
    if (creature.energy > NORMAL_SPEED) creature.energy = NORMAL_SPEED;
  }
}

function isPresent(space: Space, creature: Creature): boolean {
  return space.monsters.some((m) => m === creature) || space.npcs.some((n) => n === creature);
}

function actAsHostile(
  state: GameState,
  creature: Creature,
  rng: RNG,
  events: EventBus<GameEvents>,
): void {
  const space = getActiveSpace(state);
  const here: Point = creature;
  const distance = chebyshevDistance(here, state.player);

  if (!creature.alerted) {
    if (distance > creature.awareness) return;
    const from = worldToLocal(space, here);
    const to = worldToLocal(space, state.player);
    if (!hasLineOfSight(space.grid, from, to)) return;
    creature.alerted = true;
  } else if (distance > creature.awareness * LOSE_TRACK_FACTOR) {
    creature.alerted = false;
    return;
  }

  if (distance <= 1) {
    creatureAttacks(state, creature, rng, events);
    return;
  }

  const step = nextStepToward(
    space.grid,
    worldToLocal(space, here),
    worldToLocal(space, state.player),
    (lx, ly) => isOccupiedOrDoor(state, lx, ly),
  );
  if (!step) return;

  creature.x = step.x + space.worldOrigin.x;
  creature.y = step.y + space.worldOrigin.y;
}

/** Peaceful creatures (a brahmin) drift about now and then; they never leave their space. */
function wander(state: GameState, creature: Creature, rng: RNG): void {
  if (randomInt(rng, 1, 100) > PEACEFUL_WANDER_CHANCE) return;

  const space = getActiveSpace(state);
  const v = STEP_VECTORS[randomInt(rng, 0, STEP_VECTORS.length - 1)]!;
  const from = worldToLocal(space, creature);
  const to = { x: from.x + v.x, y: from.y + v.y };

  if (!canStep(space.grid, from, to) || isOccupiedOrDoor(state, to.x, to.y)) return;
  creature.x = to.x + space.worldOrigin.x;
  creature.y = to.y + space.worldOrigin.y;
}

/** Cells creatures may not path into: doors (they never change space), and anyone's feet. */
function isOccupiedOrDoor(state: GameState, localX: number, localY: number): boolean {
  const space = getActiveSpace(state);
  if (getTileId(space.grid, localX, localY) === 'door') return true;

  const wx = localX + space.worldOrigin.x;
  const wy = localY + space.worldOrigin.y;
  if (state.player.x === wx && state.player.y === wy) return true;
  return (
    space.monsters.some((m) => m.x === wx && m.y === wy) ||
    space.npcs.some((n) => n.x === wx && n.y === wy)
  );
}
