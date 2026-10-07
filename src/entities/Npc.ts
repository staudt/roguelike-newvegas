import { createLimbs } from '../combat/Limbs';
import { NORMAL_SPEED } from '../config/constants';
import { PALETTE } from '../config/palette';
import { BARE_HANDS } from '../items/ItemData';
import type { CreatureStats } from './Creature';
import { hostileToPlayer, startingStanding, type FactionId, type Nerve, type Temperament } from './Factions';
import type { Point } from '../utils/geometry';
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
 * Peaceful by default and able to fight like anyone else; attack one and they turn hostile.
 */
export interface Npc extends Entity, CreatureStats {
  kind: 'npc';
  dialogue: string[];
  /** Index into `dialogue` of the next line to speak. Runtime-only, not persisted. */
  dialogueIndex: number;
  interactions: InteractionId[];
  /** Where the map put them: idle wandering stays within `NPC_WANDER_RADIUS` of it. Runtime-only. */
  home: Point;
}

const NPC_HP = 24;

/** What sets a person apart toward strangers and in a fight. Everyone defaults to a steady, peaceful civilian. */
export interface NpcProfile {
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
  fg: string = PALETTE.npcFg,
  interactions: InteractionId[] = ['talk'],
  profile: NpcProfile = {},
): Npc {
  const faction = profile.faction ?? null;
  const temperament = profile.temperament ?? 'peaceful';
  return {
    id,
    kind: 'npc',
    glyph: '@',
    fg,
    x,
    y,
    name,
    proper: true,
    hostile: hostileToPlayer(faction, temperament, startingStanding()),
    faction,
    temperament,
    nerve: profile.nerve ?? 'steady',
    awareness: 8,
    alerted: false,
    provoked: false,
    investigate: null,
    alarm: null,
    stance: null,
    attack: { ...BARE_HANDS, damage: { ...BARE_HANDS.damage }, hitProfile: { ...BARE_HANDS.hitProfile } },
    hp: NPC_HP,
    maxHp: NPC_HP,
    ac: 7,
    agility: 5,
    strength: 5,
    speed: NORMAL_SPEED,
    energy: 0,
    limbs: createLimbs('humanoid', NPC_HP),
    inventory: [],
    wielded: null,
    readied: null,
    dialogue,
    dialogueIndex: 0,
    interactions,
    home: { x, y },
  };
}
