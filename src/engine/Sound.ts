import {
  GUN_NOISE_RADIUS,
  GUNSHOT_CURIOSITY_CHANCE,
  LOSE_TRACK_FACTOR,
  SCREAM_NOISE_RADIUS,
  SHOUT_NOISE_RADIUS,
} from '../config/constants';
import { capitalize } from '../combat/Narration';
import { theName, type Creature } from '../entities/Creature';
import type { Player } from '../entities/Player';
import { chebyshevDistance, type Point } from '../utils/geometry';
import { randomInt, type RNG } from '../utils/RNG';
import { addMessage, getActiveSpace, type GameState } from './GameState';

/**
 * What a noise is. Each kind has a radius (Chebyshev cells) and says who it draws:
 * - `gunshot`: every hostile within range (a territorial one only if the shot is within its awareness)
 *   comes: near ones hunt the player, far ones walk to where the shot was and notice on arrival. Peaceful people only
 *   sometimes go to see (GUNSHOT_CURIOSITY_CHANCE) and pass nothing on: a shot alone is no alarm.
 * - `scream`: a pained cry. Peaceful people in range are alerted at once and rush to the source;
 *   each passes the alarm on once with a shout, so it spreads through a settlement.
 * - `shout`: a deliberate call for help. Same listeners, further reach.
 */
export type SoundKind = 'gunshot' | 'scream' | 'shout';

export const SOUND_RADIUS: Record<SoundKind, number> = {
  gunshot: GUN_NOISE_RADIUS,
  scream: SCREAM_NOISE_RADIUS,
  shout: SHOUT_NOISE_RADIUS,
};

const HEARD: Record<Exclude<SoundKind, 'gunshot'>, string> = {
  scream: 'You hear a scream.',
  shout: 'You hear someone shouting.',
};

/**
 * Makes a noise at `from` and lets everyone in range react to it. `source` never hears itself, and
 * `goal` is where listeners go to look (the noise's own spot, unless a relayed call points back at
 * the original trouble). Only creatures in the active space are touched, and the creature loop
 * already ignores anyone far from the player, so distant parts of the world never join in.
 * Gunshot curiosity rolls on `rng`; with none given, peaceful people pay no attention.
 */
export function emitSound(
  state: GameState,
  from: Point,
  kind: SoundKind,
  source?: Creature | Player,
  rng?: RNG,
  goal: Point = from,
): void {
  const space = getActiveSpace(state);
  const radius = SOUND_RADIUS[kind];

  for (const list of [space.monsters, space.npcs] as Creature[][]) {
    for (const c of list) {
      if (c === source || chebyshevDistance(c, from) > radius) continue;
      if (kind === 'gunshot') {
        if (c.hostile) {
          // Hunters come to a shot from far off; a territorial creature only cares about its own patch.
          const distance = chebyshevDistance(c, from);
          if (c.temperament === 'territorial' && distance > c.awareness) continue;
          // Close enough to keep hunting by itself: alerted. Further off it only knows where the shot was.
          if (distance <= c.awareness * LOSE_TRACK_FACTOR) c.alerted = true;
          else if (!c.alerted) c.investigate = { x: goal.x, y: goal.y };
        } else if (c.kind === 'npc' && !c.investigate && rng && randomInt(rng, 1, 100) <= GUNSHOT_CURIOSITY_CHANCE) {
          c.investigate = { x: goal.x, y: goal.y };
        }
      } else if (!c.hostile && c.kind === 'npc' && c.alarm === null) {
        c.alarm = 'pending';
        c.investigate = { x: goal.x, y: goal.y };
      }
    }
  }

  if (kind !== 'gunshot' && !space.visible.has(from.x, from.y) && chebyshevDistance(state.player, from) <= radius) {
    addMessage(state, HEARD[kind]);
    state.noisesHeard++;
  }
}

/** A person who heard a scream passes it on with a shout of their own, pointing at the trouble. */
export function relayAlarm(state: GameState, relayer: Creature): void {
  relayer.alarm = 'done';
  if (!relayer.investigate) return;
  if (getActiveSpace(state).visible.has(relayer.x, relayer.y)) {
    addMessage(state, `${capitalize(theName(relayer))} shouts for help!`);
  }
  emitSound(state, relayer, 'shout', relayer, undefined, relayer.investigate);
}

/**
 * A creature takes a hit from the player (a blow, a bullet or a kick). Whoever survives turns
 * hostile and hunts the player; a peaceful *person* that was caught off guard also cries out, which
 * draws neighbours to come and see. A person killed outright still gets the cry out. Hostiles by
 * nature just keep coming: they had been hostile all along, so nothing is `provoked`.
 */
export function provoke(state: GameState, victim: Creature, killed: boolean): void {
  const wasPeaceful = !victim.hostile;

  if (!killed) {
    victim.hostile = true;
    victim.alerted = true;
    victim.investigate = null;
    victim.alarm = null;
    if (wasPeaceful) victim.provoked = true;
  }

  if (wasPeaceful && victim.kind === 'npc') {
    // Narrated here when we can see them; emitSound only adds 'you hear' for an unseen source.
    if (getActiveSpace(state).visible.has(victim.x, victim.y)) {
      addMessage(state, `${capitalize(theName(victim))} screams!`);
    }
    emitSound(state, victim, 'scream', victim);
  }
}
