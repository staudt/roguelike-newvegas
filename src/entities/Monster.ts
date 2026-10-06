import { createLimbs } from '../combat/Limbs';
import type { CreatureStats } from './Creature';
import type { Entity } from './Entity';
import { monsterDef } from './MonsterData';

export interface Monster extends Entity, CreatureStats {
  kind: 'monster';
  defId: string;
}

export function createMonster(id: string, defId: string, x: number, y: number): Monster {
  const def = monsterDef(defId);
  return {
    id,
    kind: 'monster',
    glyph: def.glyph,
    fg: def.fg,
    x,
    y,
    defId,
    name: def.name,
    proper: false,
    hostile: def.hostile,
    awareness: def.awareness,
    alerted: false,
    attack: {
      ...def.attack,
      damage: { ...def.attack.damage },
      hitProfile: { ...def.attack.hitProfile },
    },
    hp: def.hp,
    maxHp: def.hp,
    ac: def.ac,
    agility: def.agility,
    strength: def.strength,
    speed: def.speed,
    size: def.size ?? 'medium',
    ...(def.mass !== undefined ? { mass: def.mass } : {}),
    // Empty bank: a fresh monster waits for its first tick like everyone else, so a normal-speed
    // creature gets exactly one action per turn (a full bank gave it a free extra swing).
    energy: 0,
    limbs: createLimbs(def.bodyPlan, def.hp),
    inventory: [],
    wielded: null,
    readied: null,
  };
}
