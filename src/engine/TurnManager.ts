import { runCreatureTurns } from '../ai/AIScheduler';
import { effectiveSpeed } from '../combat/CombatFormulas';
import { healLimbs } from '../combat/Limbs';
import { BALLOON_TURNS, NORMAL_SPEED } from '../config/constants';
import { creatureAt, theName, type Creature } from '../entities/Creature';
import type { InteractionId, Npc } from '../entities/Npc';
import { computeVisible, markExplored } from '../fov/Visibility';
import { itemWithArticle } from '../items/Item';
import { isWieldable, itemDef } from '../items/ItemData';
import { addPoints, type Direction, DIRECTION_VECTORS } from '../utils/geometry';
import { defaultRNG, type RNG } from '../utils/RNG';
import { canStep, getTileId, setTileId } from '../world/GameMap';
import { playerAttacks } from './Combat';
import { describeGroundHere } from './GroundItems';
import type { EventBus, GameEvents } from './EventBus';
import {
  addMessage,
  getActiveSpace,
  placeAt,
  sightRadiusFor,
  type GameState,
} from './GameState';

/** Recomputes the active space's visible/explored sets around the player. Also used on setup. */
export function recomputeVisibility(state: GameState): void {
  const space = getActiveSpace(state);
  space.visible = computeVisible(space.grid, state.player, sightRadiusFor(space));
  markExplored(space.grid, space.visible);
}

/** Says the NPC's next line, in the log and in a balloon, then moves them on to the line after. */
export function speakTo(state: GameState, npc: Npc): void {
  const line = npc.dialogue[npc.dialogueIndex % npc.dialogue.length]!;
  npc.dialogueIndex = (npc.dialogueIndex + 1) % npc.dialogue.length;

  addMessage(state, `${npc.name}: "${line}"`);
  // Replace rather than stack: talking again just refreshes their balloon.
  state.balloons = state.balloons.filter((b) => b.entityId !== npc.id);
  state.balloons.push({
    entityId: npc.id,
    text: line,
    x: npc.x,
    y: npc.y,
    turnsLeft: BALLOON_TURNS,
  });
}

/**
 * What bumping into a creature means, NetHack-style: a hostile gets hit; someone with a single
 * thing to say talks; someone with several things to offer opens a menu; anything that can't
 * talk and isn't hostile (a brahmin) asks before you start a fight. Returns whether a turn passed.
 */
function bumpCreature(
  state: GameState,
  creature: Creature,
  events: EventBus<GameEvents>,
  rng: RNG,
): boolean {
  if (creature.hostile) {
    playerAttacks(state, creature, rng);
    advanceTurn(state, events, rng);
    return true;
  }

  if (creature.kind === 'npc') {
    if (creature.interactions.length === 1 && creature.interactions[0] === 'talk') {
      speakTo(state, creature);
      events.emit('npc-interacted', { npc: creature });
      return false;
    }
    if (creature.interactions.length > 1) {
      events.emit('npc-menu', { npc: creature });
      return false;
    }
  }

  events.emit('attack-prompted', { target: creature });
  return false;
}

/**
 * Attempts to move the player one step. Returns whether a turn was spent — bumping a wall, a
 * barrier, or someone friendly (who talks, or prompts) is free, exactly like NetHack's bump rules.
 */
export function tryMovePlayer(
  state: GameState,
  direction: Direction,
  events: EventBus<GameEvents>,
  rng: RNG = defaultRNG,
): boolean {
  if (state.gameOver) return false;

  const space = getActiveSpace(state);
  const target = addPoints(state.player, DIRECTION_VECTORS[direction]);

  const creature = creatureAt(space, target.x, target.y);
  if (creature) return bumpCreature(state, creature, events, rng);

  // Walking into a closed door opens it (takes the turn, and you stay put) — NetHack's rule.
  if (getTileId(space.grid, target.x, target.y) === 'door') {
    setTileId(space.grid, target.x, target.y, 'openDoor');
    addMessage(state, 'You open the door.');
    advanceTurn(state, events, rng);
    return true;
  }

  if (!canStep(space.grid, state.player, target)) return false;

  const placeBefore = placeAt(space, state.player)?.name;

  // Actually moving (as opposed to bumping) ends any conversation in progress — a lingering
  // balloon over your shoulder as you walk away reads as stale, not as "still talking."
  state.balloons = [];

  state.player.x = target.x;
  state.player.y = target.y;

  const transition = space.transitions.find((t) => t.x === target.x && t.y === target.y);
  if (transition) {
    state.activeSpaceId = transition.toSpace;
    events.emit('space-changed', { spaceId: transition.toSpace });
  }

  const placeAfter = placeAt(getActiveSpace(state), state.player)?.name;
  if (placeAfter !== placeBefore) {
    if (placeAfter) addMessage(state, `You enter ${placeAfter}.`);
    else if (placeBefore) addMessage(state, `You leave ${placeBefore}.`);
  }

  const seen = describeGroundHere(state, target.x, target.y);
  if (seen) addMessage(state, seen);

  advanceTurn(state, events, rng);
  return true;
}

/**
 * `F` + direction: attack that square deliberately. A peaceful target asks for confirmation first
 * (unless `confirmed`); an empty square costs a turn, like swinging at thin air in NetHack.
 */
export function fightDirection(
  state: GameState,
  direction: Direction,
  events: EventBus<GameEvents>,
  rng: RNG = defaultRNG,
  confirmed = false,
): boolean {
  if (state.gameOver) return false;

  const space = getActiveSpace(state);
  const target = addPoints(state.player, DIRECTION_VECTORS[direction]);
  const creature = creatureAt(space, target.x, target.y);

  if (!creature) {
    addMessage(state, 'You attack thin air.');
    advanceTurn(state, events, rng);
    return true;
  }

  if (!creature.hostile && !confirmed) {
    events.emit('attack-prompted', { target: creature });
    return false;
  }

  playerAttacks(state, creature, rng);
  advanceTurn(state, events, rng);
  return true;
}

/** The player said yes to "Really attack?" — the prompt is the UI's, the consequences are ours. */
export function confirmAttack(
  state: GameState,
  target: Creature,
  events: EventBus<GameEvents>,
  rng: RNG = defaultRNG,
): boolean {
  if (state.gameOver) return false;
  addMessage(state, `You attack ${theName(target)}!`);
  playerAttacks(state, target, rng);
  advanceTurn(state, events, rng);
  return true;
}

/** Picks an option from an NPC's menu. Talking is free; healing takes a turn. */
export function useInteraction(
  state: GameState,
  npc: Npc,
  interaction: InteractionId,
  events: EventBus<GameEvents>,
  rng: RNG = defaultRNG,
): boolean {
  if (state.gameOver) return false;

  if (interaction === 'talk') {
    speakTo(state, npc);
    events.emit('npc-interacted', { npc });
    return false;
  }

  state.player.hp = state.player.maxHp;
  healLimbs(state.player.limbs);
  addMessage(state, `${npc.name} patches you up. You feel much better.`);
  advanceTurn(state, events, rng);
  return true;
}

/** `w`: wield an item from the pack, or pass null for bare hands. Takes a turn. */
export function wieldItem(
  state: GameState,
  itemId: string | null,
  events: EventBus<GameEvents>,
  rng: RNG = defaultRNG,
): boolean {
  if (state.gameOver) return false;

  if (itemId === null) {
    if (state.player.wielded === null) {
      addMessage(state, 'You are already empty handed.');
      return false;
    }
    state.player.wielded = null;
    addMessage(state, 'You are now empty handed.');
  } else {
    const item = state.player.inventory.find((i) => i.id === itemId);
    if (!item) return false;
    if (!isWieldable(itemDef(item.defId))) {
      addMessage(state, `You can't wield ${itemWithArticle(item)}.`);
      return false;
    }
    if (state.player.wielded === item.id) {
      addMessage(state, `You are already wielding the ${itemDef(item.defId).name}.`);
      return false;
    }
    state.player.wielded = item.id;
    addMessage(state, `You are now wielding the ${itemDef(item.defId).name}.`);
  }

  advanceTurn(state, events, rng);
  return true;
}

/**
 * The player has spent an action: pay for it, then let the world tick until the player has
 * banked enough movement to act again. At normal speed that is exactly one tick; a crippled leg
 * means several ticks pass (everyone else gets extra moves), and a speed-24 player would pass
 * none, acting twice before anything else does.
 */
export function advanceTurn(
  state: GameState,
  events: EventBus<GameEvents>,
  rng: RNG = defaultRNG,
): void {
  if (state.gameOver) return;

  state.player.energy -= NORMAL_SPEED;
  while (state.player.energy < NORMAL_SPEED && !state.gameOver) {
    worldTick(state, events, rng);
  }

  recomputeVisibility(state);
  events.emit('turn-ended', { turnCount: state.turnCount });
}

function worldTick(state: GameState, events: EventBus<GameEvents>, rng: RNG): void {
  state.turnCount += 1;
  state.player.energy += effectiveSpeed(state.player);

  for (const balloon of state.balloons) balloon.turnsLeft -= 1;
  state.balloons = state.balloons.filter((b) => b.turnsLeft > 0);

  runCreatureTurns(state, rng, events);
}
