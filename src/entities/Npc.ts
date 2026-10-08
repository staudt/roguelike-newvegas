import { creatureStatsFrom, type CreatureStats } from './Creature';
import { creatureDef } from './CreatureData';
import { hostileToPlayer, startingStanding, type FactionId, type Nerve, type Temperament } from './Factions';
import type { Entity } from './Entity';

/** What you can do by bumping into someone. One option means bump-to-talk; several open a menu. */
export type InteractionId = 'talk' | 'heal';

export const INTERACTION_LABELS: Record<InteractionId, string> = {
  talk: 'Talk',
  heal: 'Heal',
};

/**
 * NPCs are pure monologue: `dialogue` is one or more lines, spoken in full whenever you talk to
 * them. There is no dialogue tree and the player never has lines — per the design goal, any
 * quest-relevant information is something you pick up by listening, not by choosing a topic. An
 * NPC with several lines cycles through them one at a time, wrapping after the last.
 *
 * A named NPC is a creature kind (`townsperson` unless their profile says otherwise) plus a name,
 * lines and things to offer: stats, traits and loot all come from the kind.
 */
export interface Npc extends Entity, CreatureStats {
  kind: 'npc';
  dialogue: string[];
  /** Index into `dialogue` of the next line to speak. Runtime-only, not persisted. */
  dialogueIndex: number;
  interactions: InteractionId[];
}

/** What sets a person apart toward strangers and in a fight. Everyone defaults to their kind's (a peaceful civilian). */
export interface NpcProfile {
  /** The creature kind they are (see CreatureData); default 'townsperson'. */
  kind?: string;
  faction?: FactionId;
  temperament?: Temperament;
  nerve?: Nerve;
}

export function createNpc(
  id: string,
  name: string,
  x: number,
  y: number,
  dialogue: string[],
  fg?: string,
  interactions: InteractionId[] = ['talk'],
  profile: NpcProfile = {},
): Npc {
  const base = creatureStatsFrom(creatureDef(profile.kind ?? 'townsperson'), x, y);
  const faction = profile.faction !== undefined ? profile.faction : base.faction;
  const temperament = profile.temperament ?? base.temperament;
  return {
    ...base,
    id,
    kind: 'npc',
    fg: fg ?? base.fg,
    name,
    proper: true,
    hostile: hostileToPlayer(faction, temperament, startingStanding()),
    faction,
    temperament,
    nerve: profile.nerve ?? base.nerve,
    dialogue,
    dialogueIndex: 0,
    interactions,
  };
}
