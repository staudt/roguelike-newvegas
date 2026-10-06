import { resolveMelee } from '../combat/CombatResolver';
import type { AttackProfile, Combatant } from '../combat/Combatant';
import { capitalize, narrateAttack } from '../combat/Narration';
import { KICK_FORCE_DIVISOR, KICK_STAGGER_PER_SQUARE, NORMAL_SPEED, SIZE_MASS } from '../config/constants';
import { creatureAt, theName, type Creature } from '../entities/Creature';
import { DIRECTION_VECTORS, addPoints, type Direction, type Point } from '../utils/geometry';
import { defaultRNG, randomInt, type RNG } from '../utils/RNG';
import { canStep, isWalkable } from '../world/GameMap';
import { tileIsGround } from '../world/Tile';
import { partyFor, removeCreature, YOU } from './Combat';
import type { EventBus, GameEvents } from './EventBus';
import { addMessage, getActiveSpace, type GameState } from './GameState';
import { advanceTurn } from './TurnManager';

/** A kick: about a punch's damage, but it shoves. Leans on the torso and legs. */
export const KICK: AttackProfile = {
  weaponName: 'foot',
  damage: { min: 1, max: 3 },
  accuracyBonus: 15,
  hitProfile: { head: 0, torso: 1, arm: 0, leg: 0 },
  strengthBonus: true,
};

/** Damage when a flying body hits a wall or another creature. */
const COLLISION_DAMAGE = { min: 1, max: 3 };

export function massOf(c: Pick<Combatant, 'size' | 'mass'>): number {
  return c.mass ?? SIZE_MASS[c.size ?? 'medium'];
}

/** Squares a landed kick sends `target` flying: force from Strength, resisted by mass. */
export function knockbackDistance(rng: RNG, kicker: Combatant, target: Combatant): number {
  const force = kicker.strength * 2 + randomInt(rng, 0, 6);
  return Math.floor(force / (massOf(target) * KICK_FORCE_DIVISOR));
}

function bruise(c: Creature, rng: RNG): number {
  const damage = randomInt(rng, COLLISION_DAMAGE.min, COLLISION_DAMAGE.max);
  c.hp -= damage;
  const torso = c.limbs.find((l) => l.kind === 'torso');
  if (torso) torso.hp = Math.max(0, torso.hp - damage);
  return damage;
}

/** Ground height of a cell; floors, doors and the like count as level. */
function groundHeight(state: GameState, p: Point): number {
  const grid = getActiveSpace(state).grid;
  return tileIsGround(grid.getTile(p.x, p.y)) ? grid.getHeight(p.x, p.y) : 0;
}

/** Cost, in squares of force, of one step up a rise: climbing is a lot harder than sliding. */
const UPHILL_COST = 2;
/** A tumble down a slope can't go on forever. */
const MAX_SLIDE = 12;

function hurtByFlight(state: GameState, c: Creature, rng: RNG): void {
  bruise(c, rng);
  if (c.hp <= 0) {
    addMessage(state, `${capitalize(theName(c))} dies!`);
    removeCreature(state, c, rng);
  } else {
    c.hostile = true;
    c.alerted = true;
  }
}

/**
 * Slides `target` along `step` with `force` squares to spend. A level square costs 1, a rise costs
 * more (so uphill kicks barely move anyone), and a drop is free: someone sent down a slope keeps
 * tumbling to the bottom. Stops at walls, bodies and the player; the latter two and walls hurt.
 */
function knockBack(state: GameState, target: Creature, step: Point, force: number, rng: RNG): void {
  const space = getActiveSpace(state);
  let budget = force;
  let moved = 0;
  let tumbled = false;
  let rolling = false;

  for (let i = 0; i < MAX_SLIDE; i++) {
    if (budget <= 0 && !rolling) break;
    const next = { x: target.x + step.x, y: target.y + step.y };
    const blocker = creatureAt(space, next.x, next.y);
    const playerThere = state.player.x === next.x && state.player.y === next.y;
    const climb = groundHeight(state, next) - groundHeight(state, target);
    if (budget <= 0 && climb >= 0) break; // the tumble ends where the slope does

    if (blocker || playerThere || !canStep(space.grid, target, next)) {
      if (blocker) {
        addMessage(state, `${capitalize(theName(target))} slams into ${theName(blocker)}!`);
        hurtByFlight(state, target, rng);
        hurtByFlight(state, blocker, rng);
      } else if (!playerThere && !isWalkable(space.grid, next.x, next.y)) {
        addMessage(state, `${capitalize(theName(target))} slams into the wall!`);
        hurtByFlight(state, target, rng);
      }
      break;
    }

    const cost = climb > 0 ? UPHILL_COST + climb : climb < 0 ? 0 : 1;
    if (cost > budget && climb > 0) break; // can't be shoved up that rise
    budget -= cost;
    rolling = climb < 0;
    if (rolling) tumbled = true;
    target.x = next.x;
    target.y = next.y;
    moved++;
  }

  if (moved > 0) {
    // Landing hard costs a moment to get up, however fast the creature is: it buys the kicker room.
    target.energy -= Math.max(1, moved * KICK_STAGGER_PER_SQUARE) * NORMAL_SPEED;
    addMessage(state, `${capitalize(theName(target))} ${tumbled ? 'tumbles down the slope' : 'is knocked back'}.`);
  }
}

/**
 * `k` + direction: kick the adjacent square. A landed kick does a punch's damage and may shove the
 * target back by Strength against its mass; a survivor turns hostile. Always costs a turn.
 */
export function kickDirection(
  state: GameState,
  direction: Direction,
  events: EventBus<GameEvents>,
  rng: RNG = defaultRNG,
): boolean {
  if (state.gameOver) return false;
  const step = DIRECTION_VECTORS[direction];
  const space = getActiveSpace(state);
  const spot = addPoints(state.player, step);
  const target = creatureAt(space, spot.x, spot.y);

  if (!target) {
    addMessage(state, 'You kick at thin air.');
    advanceTurn(state, events, rng);
    return true;
  }

  const result = resolveMelee(rng, state.player, target, KICK);
  for (const line of narrateAttack(YOU, partyFor(target), KICK.weaponName, result, { hit: 'kick', hits: 'kicks' })) {
    addMessage(state, line);
  }

  if (result.killed) {
    removeCreature(state, target, rng);
  } else {
    target.hostile = true;
    target.alerted = true;
    if (result.hit) {
      const distance = knockbackDistance(rng, state.player, target);
      if (distance > 0) knockBack(state, target, step, distance, rng);
      else addMessage(state, `${capitalize(theName(target))} doesn't budge.`);
    }
  }

  advanceTurn(state, events, rng);
  return true;
}
