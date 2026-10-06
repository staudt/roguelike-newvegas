import { resolveMelee } from '../combat/CombatResolver';
import type { AttackProfile } from '../combat/Combatant';
import { narrateAttack, type Party } from '../combat/Narration';
import { theName, type Creature } from '../entities/Creature';
import type { Player } from '../entities/Player';
import { attackProfileFor, BARE_HANDS, itemDef } from '../items/ItemData';
import type { RNG } from '../utils/RNG';
import type { EventBus, GameEvents } from './EventBus';
import { addMessage, getActiveSpace, type GameState } from './GameState';

const YOU: Party = { name: 'you', isPlayer: true, possessive: 'your' };

function partyFor(creature: Creature): Party {
  return {
    name: theName(creature),
    isPlayer: false,
    possessive: creature.proper ? 'their' : 'its',
  };
}

/** What the player hits with: the wielded weapon, or bare hands. */
export function playerAttackProfile(player: Player): AttackProfile {
  const wielded = player.inventory.find((item) => item.id === player.wielded);
  return wielded ? attackProfileFor(itemDef(wielded.defId)) : BARE_HANDS;
}

function removeCreature(state: GameState, creature: Creature): void {
  const space = getActiveSpace(state);
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

  if (result.killed) {
    removeCreature(state, target);
    return;
  }
  target.hostile = true;
  target.alerted = true;
}

/** A hostile creature swings at the player. Death ends the run: permadeath, no reload. */
export function creatureAttacks(
  state: GameState,
  attacker: Creature,
  rng: RNG,
  events: EventBus<GameEvents>,
): void {
  const result = resolveMelee(rng, attacker, state.player, attacker.attack);
  for (const line of narrateAttack(partyFor(attacker), YOU, attacker.attack.weaponName, result)) {
    addMessage(state, line);
  }

  if (result.killed && !state.gameOver) {
    state.gameOver = true;
    events.emit('player-died', {});
  }
}
