import { effectiveSpeed } from '../combat/CombatFormulas';
import {
  FLEE_SCREAM_CHANCE,
  GUN_KEEP_DISTANCE,
  LOSE_TRACK_FACTOR,
  MAX_ACTIONS_PER_TURN,
  NORMAL_SPEED,
  NPC_WANDER_CHANCE,
  NPC_WANDER_RADIUS,
  PEACEFUL_WANDER_CHANCE,
  SIM_RADIUS,
} from '../config/constants';
import { GUN_KITE_CHANCE, UNARMED_FLEE_CHANCE, hostileToPlayer } from '../entities/Factions';
import { theName, type Creature } from '../entities/Creature';
import { capitalize } from '../combat/Narration';
import { creatureAttacks, fireProjectile, shotPath } from '../engine/Combat';
import { emitSound, relayAlarm } from '../engine/Sound';
import type { EventBus, GameEvents } from '../engine/EventBus';
import { addMessage, getActiveSpace, type GameState } from '../engine/GameState';
import { canFire, consumeRound, findItem, readiedStack, wieldedGun, wieldedItem } from '../items/Carrying';
import { itemCount, type Item } from '../items/Item';
import { itemDef, type GunDef } from '../items/ItemData';
import { creatureAt } from '../entities/Creature';
import { hasLineOfSight } from '../fov/LineOfSight';
import { chebyshevDistance, DIRECTION_VECTORS, type Point } from '../utils/geometry';
import { randomInt, type RNG } from '../utils/RNG';
import { canStep, getTileId, setTileId } from '../world/GameMap';
import { cellKey, fleeStep, nextStepToward } from './Pathfinding';

const STEP_VECTORS = Object.values(DIRECTION_VECTORS);

/** Cells (-> creature) occupied this tick, kept current as creatures move. */
type Occupancy = Map<number, Creature>;

/**
 * Runs the creature turns for one world tick, NetHack-style: each banks its speed in movement
 * points and spends NORMAL_SPEED per action, so a fast creature takes several steps or strikes in
 * a single turn and a slow one acts only on some turns. Leftover energy carries over.
 *
 * Only creatures within SIM_RADIUS of the player act (the rest of the world is asleep and banks
 * nothing), and 'is this cell taken?' is a lookup in an occupancy index built once per tick.
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
      turnOnIfDisliked(state, creature);

      if (creature.hostile) {
        actAsHostile(state, creature, rng, events, occupancy);
      } else if (creature.kind === 'monster') {
        wander(state, creature, rng, occupancy);
      } else if (!joinsTrouble(state, creature)) {
        if (creature.alarm === 'pending') relayAlarm(state, creature);
        else if (creature.investigate) investigateNoise(state, creature, occupancy);
        else wander(state, creature, rng, occupancy);
      }
    }

    // An idle creature doesn't hoard turns to unleash later.
    if (creature.energy > NORMAL_SPEED) creature.energy = NORMAL_SPEED;
  }
}

/** A faction the player has fallen out with attacks on sight, even creatures that were calm a turn ago. */
function turnOnIfDisliked(state: GameState, creature: Creature): void {
  if (creature.hostile) return;
  if (hostileToPlayer(creature.faction, creature.temperament, state.standing)) creature.hostile = true;
}

function moveTo(occupancy: Occupancy, creature: Creature, x: number, y: number): void {
  occupancy.delete(cellKey(creature.x, creature.y));
  creature.x = x;
  creature.y = y;
  occupancy.set(cellKey(x, y), creature);
}

/**
 * Takes the step a path search chose. People open a closed door in their way, which costs the action
 * and leaves them where they were; animals never get that far (their paths don't go through doors).
 */
function takeStep(state: GameState, creature: Creature, step: Point, occupancy: Occupancy): void {
  const grid = getActiveSpace(state).grid;
  if (creature.kind === 'npc' && getTileId(grid, step.x, step.y) === 'door') {
    setTileId(grid, step.x, step.y, 'openDoor');
    if (canSee(state, creature)) addMessage(state, `${capitalize(theName(creature))} opens the door.`);
    return;
  }
  moveTo(occupancy, creature, step.x, step.y);
}

/** Cells creatures may not path into: anyone's feet. (Closed doors already fail `canStep`.) */
function isOccupied(state: GameState, occupancy: Occupancy, x: number, y: number): boolean {
  return (state.player.x === x && state.player.y === y) || occupancy.has(cellKey(x, y));
}

/**
 * A peaceful person who can see a provoked neighbour fighting the player turns on the player too.
 * Only provoked people count: a gecko that was always hostile says nothing about whose side anyone
 * is on. Returns whether they joined in (which takes their action).
 */
function joinsTrouble(state: GameState, npc: Creature): boolean {
  const space = getActiveSpace(state);
  const sees = space.npcs.some(
    (other) =>
      other !== npc &&
      other.hostile &&
      other.provoked &&
      chebyshevDistance(npc, other) <= npc.awareness &&
      hasLineOfSight(space.grid, npc, other),
  );
  if (!sees) return false;

  npc.hostile = true;
  npc.provoked = true;
  npc.alerted = true;
  npc.investigate = null;
  npc.alarm = null;
  if (canSee(state, npc)) addMessage(state, `${capitalize(theName(npc))} joins the fight!`);
  return true;
}

/** Walks toward a noise and stops next to where it came from; gives up if there is no way there. */
function investigateNoise(state: GameState, npc: Creature, occupancy: Occupancy): void {
  const goal = npc.investigate!;
  const step =
    chebyshevDistance(npc, goal) <= 1
      ? null
      : nextStepToward(getActiveSpace(state).grid, npc, goal, (x, y) => isOccupied(state, occupancy, x, y), undefined, true);
  if (!step) {
    npc.investigate = null;
    npc.alarm = null;
    return;
  }
  takeStep(state, npc, step, occupancy);
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
    if (distance > creature.awareness || !hasLineOfSight(space.grid, here, state.player)) {
      // Not noticed anyone, but a noise may be worth a look.
      if (creature.investigate) investigateNoise(state, creature, occupancy);
      return;
    }
    creature.alerted = true;
    creature.investigate = null;
  } else if (distance > creature.awareness * LOSE_TRACK_FACTOR) {
    creature.alerted = false;
    return;
  }

  if (creature.kind === 'npc' && creature.provoked) {
    creature.stance ??= chooseStance(creature, rng);
    if (creature.stance === 'flee') {
      flee(state, creature, rng, events, occupancy, distance);
      return;
    }
  }

  if (actWithGun(state, creature, rng, events, occupancy)) return;

  if (distance <= 1) {
    creatureAttacks(state, creature, rng, events);
    return;
  }

  const step = nextStepToward(
    space.grid,
    here,
    state.player,
    (x, y) => isOccupied(state, occupancy, x, y),
    undefined,
    creature.kind === 'npc',
  );
  if (!step) return;

  takeStep(state, creature, step, occupancy);
}

/** What a creature fights with: a gun it can fire, a wielded melee weapon, or nothing. */
function armament(creature: Creature): 'gun' | 'melee' | 'none' {
  if (findUsableGun(creature)) return 'gun';
  const wielded = wieldedItem(creature);
  return wielded && itemDef(wielded.defId).kind === 'weapon' ? 'melee' : 'none';
}

/**
 * Armed people stand and fight (a gun keeps its distance, see `actWithGun`; a melee weapon closes
 * in). The unarmed mostly run, and a few brawl bare-handed.
 */
function chooseStance(creature: Creature, rng: RNG): 'flee' | 'fight' {
  if (armament(creature) !== 'none') return 'fight';
  return randomInt(rng, 1, 100) <= UNARMED_FLEE_CHANCE[creature.nerve] ? 'flee' : 'fight';
}

/**
 * One step toward safety from the player (see `fleeStep`). Returns false when every neighbouring
 * cell is no safer: cornered, or boxed in by other creatures.
 */
function stepAway(state: GameState, creature: Creature, occupancy: Occupancy): boolean {
  const step = fleeStep(getActiveSpace(state).grid, creature, state.player, (x, y) =>
    isOccupied(state, occupancy, x, y),
  );
  if (!step) return false;
  moveTo(occupancy, creature, step.x, step.y);
  return true;
}

/**
 * The provoked unarmed run from the player, and now and then scream again while they can see them, so
 * the alarm keeps drawing people. Cornered, they lash out.
 */
function flee(
  state: GameState,
  creature: Creature,
  rng: RNG,
  events: EventBus<GameEvents>,
  occupancy: Occupancy,
  distance: number,
): void {
  const space = getActiveSpace(state);
  const seesPlayer = distance <= creature.awareness && hasLineOfSight(space.grid, creature, state.player);
  if (seesPlayer && randomInt(rng, 1, 100) <= FLEE_SCREAM_CHANCE) {
    if (canSee(state, creature)) addMessage(state, `${capitalize(theName(creature))} screams!`);
    emitSound(state, creature, 'scream', creature);
    return;
  }
  if (stepAway(state, creature, occupancy)) return;
  if (distance <= 1) creatureAttacks(state, creature, rng, events);
}

interface UsableGun {
  item: Item;
  def: GunDef;
}

/** A gun in the pack that has matching ammunition in the pack too. Prefers the wielded one. */
function findUsableGun(creature: Creature): UsableGun | null {
  const candidates = creature.inventory
    .filter((i) => itemDef(i.defId).kind === 'gun')
    .sort((a, b) => Number(b.id === creature.wielded) - Number(a.id === creature.wielded));
  for (const item of candidates) {
    const def = itemDef(item.defId) as GunDef;
    if (matchingAmmo(creature, def)) return { item, def };
  }
  return null;
}

function matchingAmmo(creature: Creature, gun: GunDef): Item | undefined {
  return creature.inventory.find((i) => {
    const d = itemDef(i.defId);
    return d.kind === 'ammo' && d.ammoType === gun.ammoType && itemCount(i) > 0;
  });
}

/** Quivers matching ammunition if nothing usable is readied. Free: part of whatever it does next. */
function ensureReadied(creature: Creature, gun: GunDef): void {
  const ready = readiedStack(creature);
  if (ready) {
    const d = itemDef(ready.defId);
    if (d.kind === 'ammo' && d.ammoType === gun.ammoType) return;
  }
  const ammo = matchingAmmo(creature, gun);
  if (ammo) creature.readied = ammo.id;
}

function canSee(state: GameState, creature: Creature): boolean {
  return getActiveSpace(state).visible.has(creature.x, creature.y);
}

function possessive(creature: Creature): string {
  return creature.proper ? 'their' : 'its';
}

/**
 * Is there a clear shot from `from` to the player? Both must be on one of the 8 straight lines,
 * within the gun's range; walls and cover (the sight rule) and any other creature in between
 * spoil it.
 */
function clearShot(state: GameState, creature: Creature, from: Point, range: number): Point | null {
  const dx = state.player.x - from.x;
  const dy = state.player.y - from.y;
  const dist = Math.max(Math.abs(dx), Math.abs(dy));
  if (dist < 1 || dist > range) return null;
  if (!(dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy))) return null;

  const step = { x: Math.sign(dx), y: Math.sign(dy) };
  const space = getActiveSpace(state);
  const path = shotPath(state, from, step, dist);
  if (path.length < dist) return null;
  for (let i = 0; i < dist - 1; i++) {
    const cell = path[i]!;
    const other = creatureAt(space, cell.x, cell.y);
    if (other && other !== creature) return null;
  }
  return step;
}

/**
 * The armed hostile's turn: draw the gun, shoot, or line up a shot. Returns whether it used the
 * action; false means 'carry on with ordinary hunting/melee'.
 */
function actWithGun(
  state: GameState,
  creature: Creature,
  rng: RNG,
  events: EventBus<GameEvents>,
  occupancy: Occupancy,
): boolean {
  const space = getActiveSpace(state);
  const wielded = wieldedGun(creature);

  // 1. Armed but holstered: spend the action drawing.
  if (!wielded) {
    const usable = findUsableGun(creature);
    if (!usable) return false;
    creature.wielded = usable.item.id;
    ensureReadied(creature, usable.def);
    if (canSee(state, creature)) {
      addMessage(state, `${capitalize(theName(creature))} wields ${possessive(creature)} ${usable.def.name}!`);
    }
    return true;
  }

  ensureReadied(creature, wielded);
  const check = canFire(creature);

  // 2. Out of ammunition: put the gun away and fall back on the next best thing.
  if (!check.ok) {
    const gun = findItem(creature, creature.wielded)!;
    const melee = creature.inventory.find((i) => i !== gun && itemDef(i.defId).kind === 'weapon');
    creature.wielded = melee ? melee.id : null;
    if (canSee(state, creature)) {
      addMessage(state, `${capitalize(theName(creature))}'s ${wielded.name} is out of ammo.`);
    }
    return true;
  }

  // 3. A person with a gun keeps their distance from someone closing in, but not every turn.
  if (
    creature.kind === 'npc' &&
    chebyshevDistance(creature, state.player) < GUN_KEEP_DISTANCE &&
    randomInt(rng, 1, 100) <= GUN_KITE_CHANCE[creature.nerve] &&
    stepAway(state, creature, occupancy)
  ) {
    return true;
  }

  // 3b. A clear shot: take it.
  const step = clearShot(state, creature, creature, check.gun.range);
  if (step) {
    consumeRound(creature);
    fireProjectile(state, creature, check.gun, step, rng, events);
    return true;
  }

  // 4. Line up: one step that gives a clear shot, the farthest such cell; else close in.
  let best: { p: Point; dist: number } | null = null;
  for (const v of STEP_VECTORS) {
    const p = { x: creature.x + v.x, y: creature.y + v.y };
    if (!canStep(space.grid, creature, p) || isOccupied(state, occupancy, p.x, p.y)) continue;
    if (!clearShot(state, creature, p, check.gun.range)) continue;
    const dist = chebyshevDistance(p, state.player);
    if (!best || dist > best.dist) best = { p, dist };
  }
  if (best) {
    moveTo(occupancy, creature, best.p.x, best.p.y);
    return true;
  }
  const approach = nextStepToward(
    space.grid,
    creature,
    state.player,
    (x, y) => isOccupied(state, occupancy, x, y),
    undefined,
    creature.kind === 'npc',
  );
  if (approach) takeStep(state, creature, approach, occupancy);
  return true;
}

/**
 * Idle creatures drift about now and then; they never leave their space. Animals roam freely; a
 * person keeps within a few cells of home, so Doc is still by his bed and nobody wanders out of town.
 */
function wander(state: GameState, creature: Creature, rng: RNG, occupancy: Occupancy): void {
  if (randomInt(rng, 1, 100) > (creature.kind === 'npc' ? NPC_WANDER_CHANCE : PEACEFUL_WANDER_CHANCE)) return;

  const space = getActiveSpace(state);
  const v = STEP_VECTORS[randomInt(rng, 0, STEP_VECTORS.length - 1)]!;
  const to = { x: creature.x + v.x, y: creature.y + v.y };

  if (!canStep(space.grid, creature, to) || isOccupied(state, occupancy, to.x, to.y)) return;
  if (creature.kind === 'npc' && chebyshevDistance(to, creature.home) > NPC_WANDER_RADIUS) return;
  moveTo(occupancy, creature, to.x, to.y);
}
