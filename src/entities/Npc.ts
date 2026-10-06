import { PALETTE } from '../config/palette';
import type { Entity } from './Entity';

/**
 * NPCs are pure monologue: `dialogue` is one or more lines, spoken in full whenever the player
 * bumps into them. There is no dialogue tree and the player never has lines — per the design
 * goal, any quest-relevant information is something you pick up by listening, not by choosing a
 * topic. An NPC with several lines cycles through them one bump at a time (see
 * `TurnManager.speakTo`), wrapping back to the first after the last.
 */
export interface Npc extends Entity {
  kind: 'npc';
  name: string;
  dialogue: string[];
  /** Index into `dialogue` of the next line to speak. Runtime-only, not persisted. */
  dialogueIndex: number;
}

export function createNpc(
  id: string,
  name: string,
  x: number,
  y: number,
  dialogue: string[],
  fg: string = PALETTE.npcFg,
): Npc {
  return { id, kind: 'npc', glyph: '@', fg, x, y, name, dialogue, dialogueIndex: 0 };
}
