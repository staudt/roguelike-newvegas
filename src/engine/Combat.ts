import { resolveMelee, resolveShot } from '../combat/CombatResolver';
import type { AttackProfile } from '../combat/Combatant';
import { narrateAttack, narrateShot, capitalize, type Party } from '../combat/Narration';
import { creatureAt, theName, type Creature } from '../entities/Creature';
import type { Player } from '../entities/Player';
import { hasLineOfSight } from '../fov/LineOfSight';
import { wieldedAttackProfile } from '../items/Carrying';
import type { GunDef } from '../items/ItemData';
import { BARE_HANDS } from '../items/ItemData';
import { chebyshevDistance, type Point } from '../utils/geometry';
import type { RNG } from '../utils/RNG';
import { isOpaque } from '../world/GameMap';
import type { EventBus, GameEvents } from './EventBus';
import { addMessage, getActiveSpace, type GameState } from './GameState';
import { dropCreatureItems } from './GroundItems';
import { emitSound, provoke } from './Sound';

export const YOU: Party = { name: 'you', isPlayer: true, possessive: 'your' };

export function partyFor(creature: Creature): Party {
  return {
    name: theName(creature),
    isPlayer: false,
    possessive: creature.proper ? 'their' : 'its',
  };
}

/** What the player hits with: the wielded weapon (or gun butt), or bare hands. */
export function playerAttackProfile(player: Player): AttackProfile {
  return wieldedAttackProfile(player) ?? BARE_HANDS;
}

/** What a creature hits with: what it wields, else its natural weapon (teeth, fists). */
export function creatureMeleeProfile(creature: Creature): AttackProfile {
  return wieldedAttackProfile(creature) ?? creature.attack;
}

/** Removes a dead creature from the world; whatever it carried (and its loot) hits the floor. */
export function removeCreature(state: GameState, creature: Creature, rng: RNG): void {
  const space = getActiveSpace(state);
  dropCreatureItems(state, creature, rng);
  space.monsters = space.monsters.filter((m) => m !== creature);
  space.npcs = space.npcs.filter((n) => n !== creature);
  state.balloons = state.balloons.filter((b) => b.entityId !== creature.id);
}

/** The player swings at a creature. Anything that survives a blow turns hostile and hunts you. */
export function playerAttacks(
  state: GameState,
  target: Creature,
  rng: RNG,
): void {
  const attack = playerAttackProfile(state.player);
  const result = resolveMelee(rng, state.player, target, attack);
  for (const line of narrateAttack(YOU, partyFor(target), attack.weaponName, result)) {
    addMessage(state, line);
  }

  provoke(state, target, result.killed);
  if (result.killed) removeCreature(state, target, rng);
}

function killPlayer(state: GameState, events: EventBus<GameEvents>): void {
  if (state.gameOver) return;
  state.gameOver = true;
  events.emit('player-died', {});
}

/** A hostile creature swings at the player. Death ends the run: permadeath, no reload. */
export function creatureAttacks(
  state: GameState,
  attacker: Creature,
  rng: RNG,
  events: EventBus<GameEvents>,
): void {
  const attack = creatureMeleeProfile(attacker);
  const result = resolveMelee(rng, attacker, state.player, attack);
  for (const line of narrateAttack(partyFor(attacker), YOU, attack.weaponName, result)) {
    addMessage(state, line);
  }

  if (result.killed) killPlayer(state, events);
}

/**
 * The cells a bullet fired from `origin` along the unit vector `step` crosses, in order, up to
 * `range`. It stops before a cell that is opaque, and before any cell that terrain height makes
 * cover (the same `hasLineOfSight` rule as sight). Creatures do not stop it here.
 */
export function shotPath(state: GameState, origin: Point, step: Point, range: number): Point[] {
  const grid = getActiveSpace(state).grid;
  const path: Point[] = [];
  for (let i = 1; i <= range; i++) {
    const cell = { x: origin.x + step.x * i, y: origin.y + step.y * i };
    if (isOpaque(grid, cell.x, cell.y)) break;
    if (!hasLineOfSight(grid, origin, cell)) break;
    path.push(cell);
  }
  return path;
}

/**
 * Hostiles right next to the shooter, which spoil aim at range: for the player, every adjacent
 * hostile creature; for a creature, the player when they are in its face.
 */
export function adjacentHostiles(state: GameState, shooter: Player | Creature): number {
  if (shooter.kind !== 'player') return chebyshevDistance(shooter, state.player) <= 1 ? 1 : 0;
  const space = getActiveSpace(state);
  let n = 0;
  for (const list of [space.monsters, space.npcs] as Creature[][]) {
    for (const c of list) if (c.hostile && chebyshevDistance(c, shooter) <= 1) n++;
  }
  return n;
}

export interface ShotOutcome {
  path: Point[];
  /** Id of whatever the bullet struck ('player' or a creature id). */
  hitId?: string;
}

/**
 * Fires one round from `shooter` along `step` (a unit vector). The caller has already checked and
 * spent the ammunition. A player's bullet rolls against each creature in its path in turn: a miss
 * flies on to the next, a hit stops it. A creature's bullet only ever rolls against the player.
 * Makes noise, narrates, and emits `shot-fired`.
 */
export function fireProjectile(
  state: GameState,
  shooter: Player | Creature,
  gun: GunDef,
  step: Point,
  rng: RNG,
  events: EventBus<GameEvents>,
): ShotOutcome {
  const space = getActiveSpace(state);
  const isPlayer = shooter.kind === 'player';
  const party = isPlayer ? YOU : partyFor(shooter as Creature);

  emitSound(state, shooter, 'gunshot', shooter);
  const crowd = adjacentHostiles(state, shooter);

  const flight = shotPath(state, shooter, step, gun.range);
  const path: Point[] = [];
  let hitId: string | undefined;
  let rolled = 0;

  let warned = false;

  for (let i = 0; i < flight.length && hitId === undefined; i++) {
    const cell = flight[i]!;
    path.push(cell);

    if (isPlayer) {
      const target = creatureAt(space, cell.x, cell.y);
      if (!target) continue;
      rolled++;
      if (crowd > 0 && i > 0 && !warned) {
        warned = true;
        addMessage(state, 'You are too hemmed in to aim.');
      }
      const result = resolveShot(rng, state.player, target, gun.shot, i + 1, crowd);
      for (const line of narrateShot(party, partyFor(target), gun.name, result)) addMessage(state, line);
      provoke(state, target, result.killed);
      if (result.killed) removeCreature(state, target, rng);
      if (result.hit) hitId = target.id;
    } else if (cell.x === state.player.x && cell.y === state.player.y) {
      rolled++;
      const result = resolveShot(rng, shooter, state.player, gun.shot, i + 1, crowd);
      for (const line of narrateShot(party, YOU, gun.name, result)) addMessage(state, line);
      if (result.killed) killPlayer(state, events);
      if (result.hit) hitId = state.player.id;
    }
  }

  if (rolled === 0) {
    addMessage(
      state,
      isPlayer
        ? `You fire your ${gun.name}.`
        : `${capitalize(party.name)} fires ${party.possessive} ${gun.name}.`,
    );
    addMessage(state, 'The shot whizzes away.');
  }

  events.emit('shot-fired', { path, shooterId: shooter.id, ...(hitId !== undefined ? { hitId } : {}) });
  return { path, ...(hitId !== undefined ? { hitId } : {}) };
}
