import { BALLOON_TURNS } from '../config/constants';
import type { Npc } from '../entities/Npc';
import { computeVisible, markExplored } from '../fov/Visibility';
import { addPoints, type Direction, DIRECTION_VECTORS } from '../utils/geometry';
import { canStep } from '../world/GameMap';
import type { GameEvents } from './EventBus';
import type { EventBus } from './EventBus';
import {
  addMessage,
  getActiveSpace,
  sightRadiusFor,
  worldToLocal,
  type GameState,
  type Space,
} from './GameState';

/** Recomputes the active space's visible/explored sets around the player. Also used on setup. */
export function recomputeVisibility(state: GameState): void {
  const space = getActiveSpace(state);
  const origin = worldToLocal(space, state.player);
  space.visible = computeVisible(space.grid, origin, sightRadiusFor(space));
  markExplored(space.explored, space.visible);
}

function npcAt(space: Space, x: number, y: number): Npc | undefined {
  return space.npcs.find((n) => n.x === x && n.y === y);
}

function speakTo(state: GameState, npc: Npc): void {
  const line = npc.dialogue[npc.dialogueIndex % npc.dialogue.length]!;
  npc.dialogueIndex = (npc.dialogueIndex + 1) % npc.dialogue.length;

  addMessage(state, `${npc.name}: "${line}"`);
  // Replace rather than stack: bumping the same NPC again just refreshes their balloon.
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
 * Attempts to move the player one step. Returns whether a turn was actually spent — bumping a
 * wall, a barrier, or an NPC (which talks instead of attacking — there's no combat yet) is free,
 * exactly like NetHack's bump rules, so the caller knows whether to advance the turn.
 */
export function tryMovePlayer(
  state: GameState,
  direction: Direction,
  events: EventBus<GameEvents>,
): boolean {
  const space = getActiveSpace(state);
  const target = addPoints(state.player, DIRECTION_VECTORS[direction]);

  const targetNpc = npcAt(space, target.x, target.y);
  if (targetNpc) {
    speakTo(state, targetNpc);
    events.emit('npc-interacted', { npc: targetNpc });
    return false;
  }

  const fromLocal = worldToLocal(space, state.player);
  const toLocal = worldToLocal(space, target);
  if (!canStep(space.grid, fromLocal, toLocal)) return false;

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

  advanceTurn(state, events);
  return true;
}

/** Ticks the turn counter, expires balloons, and recomputes sight. Called after any costed action. */
export function advanceTurn(state: GameState, events: EventBus<GameEvents>): void {
  state.turnCount += 1;

  for (const balloon of state.balloons) balloon.turnsLeft -= 1;
  state.balloons = state.balloons.filter((b) => b.turnsLeft > 0);

  recomputeVisibility(state);

  events.emit('turn-ended', { turnCount: state.turnCount });
}
