import {
  GUN_NOISE_RADIUS,
  SCREAM_NOISE_RADIUS,
  SHOUT_NOISE_RADIUS,
} from '../config/constants';
import { capitalize } from '../combat/Narration';
import { theName, type Creature } from '../entities/Creature';
import type { Player } from '../entities/Player';
import { chebyshevDistance, type Point } from '../utils/geometry';
import { addMessage, getActiveSpace, type GameState } from './GameState';

/**
 * What a noise is. Each kind has a radius (Chebyshev cells) and says who it draws:
 * - `gunshot`: every hostile within range knows where the trouble is (peacefuls stay put).
 * - `scream`: a pained cry. Peaceful people within range come and look.
 * - `shout`: a deliberate call for help or to arms. Same listeners, further reach.
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
 * Makes a noise at `at` and lets everyone in range react to it. `source` never hears itself.
 * Only creatures in the active space are touched, and the creature loop already ignores anyone far
 * from the player, so distant parts of the world never join in.
 */
export function emitSound(
  state: GameState,
  at: Point,
  kind: SoundKind,
  source?: Creature | Player,
): void {
  const space = getActiveSpace(state);
  const radius = SOUND_RADIUS[kind];

  for (const list of [space.monsters, space.npcs] as Creature[][]) {
    for (const c of list) {
      if (c === source || chebyshevDistance(c, at) > radius) continue;
      if (kind === 'gunshot') {
        if (c.hostile) c.alerted = true;
      } else if (!c.hostile && c.kind === 'npc' && !c.investigate) {
        c.investigate = { x: at.x, y: at.y };
      }
    }
  }

  if (kind !== 'gunshot' && !space.visible.has(at.x, at.y)) addMessage(state, HEARD[kind]);
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
