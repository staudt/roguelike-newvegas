import { createLimbs } from '../combat/Limbs';
import { NORMAL_SPEED } from '../config/constants';
import { PALETTE } from '../config/palette';
import { BARE_HANDS } from '../items/ItemData';
import type { CreatureStats } from './Creature';
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
}

const NPC_HP = 24;

export function createNpc(
  id: string,
  name: string,
  x: number,
  y: number,
  dialogue: string[],
  fg: string = PALETTE.npcFg,
  interactions: InteractionId[] = ['talk'],
): Npc {
  return {
    id,
    kind: 'npc',
    glyph: '@',
    fg,
    x,
    y,
    name,
    proper: true,
    hostile: false,
    awareness: 8,
    alerted: false,
    provoked: false,
    investigate: null,
    alarm: null,
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
  };
}
