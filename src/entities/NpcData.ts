import type { CreatureId } from './CreatureData';
import type { NpcProfile } from './Npc';

/**
 * What sets named people apart, by NPC id (the map file only places them). Anyone not listed is a
 * steady, peaceful civilian. A map entry may also carry `faction`, `temperament` or `nerve`, which win.
 */
export const NPC_PROFILES: Record<string, NpcProfile & { kind?: CreatureId }> = {
  // A warrior: provoked, she goes straight for you, bare-handed if she has to, and still calls for help.
  'sunny-smiles': { nerve: 'bold' },
  // A doctor: he fights if he has the means, but backs off and keeps calling for help.
  'doc-mitchell': { nerve: 'timid' },
};

export function npcProfile(id: string): NpcProfile {
  return NPC_PROFILES[id] ?? {};
}
