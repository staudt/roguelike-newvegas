/**
 * Who stands against whom. Goodsprings' townsfolk are individuals, not a faction: they have none
 * (`null`, written 'civilian' in relations). Factions are for the organised and the inhuman.
 */
export type FactionId = 'wildlife' | 'ghouls' | 'powder-gangers' | 'ncr' | 'legion';

/** How a creature treats strangers it has not been provoked by. */
export type Temperament = 'aggressive' | 'territorial' | 'peaceful';

/** How a provoked creature stands up to a fight. Orthogonal to temperament: Sunny is peaceful but bold. */
export type Nerve = 'bold' | 'steady' | 'timid';

export type Relation = 'hostile' | 'neutral' | 'friendly';

/** A faction, or 'civilian' for people who have none. */
export type Party = FactionId | 'civilian';

export interface FactionDef {
  id: FactionId;
  name: string;
  /** The player's standing with them at the start of a run: -100 (enemies) to 100. */
  startingStanding: number;
  /** Beasts are hostile to everything that is not a beast, and neutral to each other. */
  beast?: boolean;
  /**
   * Parties this faction is at war with, whoever the player is. List each pair on one side only:
   * relations are symmetric. Anything not listed is neutral.
   */
  enemies?: Party[];
}

export const FACTIONS: Record<FactionId, FactionDef> = {
  wildlife: { id: 'wildlife', name: 'Wildlife', startingStanding: -100, beast: true },
  ghouls: { id: 'ghouls', name: 'Feral ghouls', startingStanding: -100, beast: true },
  'powder-gangers': {
    id: 'powder-gangers',
    name: 'Powder Gangers',
    startingStanding: -100,
    enemies: ['civilian'],
  },
  ncr: {
    id: 'ncr',
    name: 'New California Republic',
    startingStanding: 0,
    enemies: ['legion', 'powder-gangers'],
  },
  legion: { id: 'legion', name: "Caesar's Legion", startingStanding: 0 },
};

/** At or below this standing a faction's members attack the player on sight. */
export const HOSTILE_STANDING = -50;

export type Standing = Record<FactionId, number>;

export function startingStanding(): Standing {
  const standing = {} as Standing;
  for (const f of Object.values(FACTIONS)) standing[f.id] = f.startingStanding;
  return standing;
}

/** Every party, civilians last. */
export const PARTIES: readonly Party[] = [...(Object.keys(FACTIONS) as FactionId[]), 'civilian'];

/** Relation of every party to every other, built once from the faction data: `TABLE[x][y]`. */
const TABLE: Record<Party, Record<Party, Relation>> = (() => {
  const isBeast = (p: Party): boolean => p !== 'civilian' && FACTIONS[p].beast === true;
  const atWar = (x: Party, y: Party): boolean =>
    (x !== 'civilian' && FACTIONS[x].enemies?.includes(y) === true) ||
    (y !== 'civilian' && FACTIONS[y].enemies?.includes(x) === true);
  const table = {} as Record<Party, Record<Party, Relation>>;
  for (const x of PARTIES) {
    const row = {} as Record<Party, Relation>;
    for (const y of PARTIES) {
      if (x === y) row[y] = 'friendly';
      else if (isBeast(x) || isBeast(y)) row[y] = isBeast(x) && isBeast(y) ? 'neutral' : 'hostile';
      else row[y] = atWar(x, y) ? 'hostile' : 'neutral';
    }
    table[x] = row;
  }
  return table;
})();

/** How two creatures' factions regard each other (`null` = no faction, an ordinary civilian). */
export function factionRelation(a: FactionId | null, b: FactionId | null): Relation {
  return TABLE[a ?? 'civilian'][b ?? 'civilian'];
}

/**
 * Does a creature that has not been provoked attack the player on sight? Peaceful ones never do. The
 * rest do when they have no faction, or their faction's standing with the player is at the line.
 */
export function hostileToPlayer(
  faction: FactionId | null,
  temperament: Temperament,
  standing: Standing,
): boolean {
  if (temperament === 'peaceful') return false;
  return faction === null ? true : standing[faction] <= HOSTILE_STANDING;
}

/** Per-nerve chance (percent) that a provoked, unarmed person runs rather than brawls. */
export const UNARMED_FLEE_CHANCE: Record<Nerve, number> = { bold: 0, steady: 75, timid: 100 };

/** Per-nerve chance (percent) per action that a provoked person with a gun backs off from someone close. */
export const GUN_KITE_CHANCE: Record<Nerve, number> = { bold: 20, steady: 60, timid: 90 };
