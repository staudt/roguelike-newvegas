import { describe, expect, it } from 'vitest';
import { FACTIONS } from '../src/entities/Factions';
import { CREATURES } from '../src/entities/CreatureData';
import { NPC_PROFILES } from '../src/entities/NpcData';
import { BARE_HANDS, ITEMS } from '../src/items/ItemData';
import type { LoadoutJSON } from '../src/items/Loadout';
import { TILES, TILE_ORDER } from '../src/world/Tile';
import { readWorldMeta } from './helpers/world';

/** Cross-checks of the data tables and the real map, so a typo'd id fails here, not mid-game. */

type Weights = Record<string, number>;

/** Every hit profile in the data, labelled by where it lives. */
function hitProfiles(): Array<[string, Weights]> {
  const out: Array<[string, Weights]> = [['BARE_HANDS', BARE_HANDS.hitProfile]];
  for (const m of Object.values(CREATURES)) out.push([`creature ${m.id} attack`, m.attack.hitProfile]);
  for (const item of Object.values(ITEMS)) {
    if (item.kind === 'weapon') out.push([`weapon ${item.id} attack`, item.attack.hitProfile]);
    if (item.kind === 'gun') {
      out.push([`gun ${item.id} shot`, item.shot.hitProfile]);
      out.push([`gun ${item.id} butt`, item.butt.hitProfile]);
    }
  }
  return out;
}

function loadoutIds(l: LoadoutJSON): string[] {
  const ids = (l.inventory ?? []).map((e) => (typeof e === 'string' ? e : e.defId));
  if (l.wield !== undefined) ids.push(l.wield);
  if (l.ready !== undefined) ids.push(l.ready);
  return ids;
}

describe('table keys', () => {
  it.each([
    ['CREATURES', CREATURES],
    ['ITEMS', ITEMS],
    ['FACTIONS', FACTIONS],
    ['TILES', TILES],
  ] as Array<[string, Record<string, { id: string }>]>)('%s keys equal entry ids', (_name, table) => {
    for (const [key, entry] of Object.entries(table)) expect(entry.id, key).toBe(key);
  });

  it('TILE_ORDER lists every tile exactly once, void first', () => {
    expect(TILE_ORDER[0]).toBe('void');
    expect(new Set(TILE_ORDER).size).toBe(TILE_ORDER.length);
    expect([...TILE_ORDER].sort()).toEqual(Object.keys(TILES).sort());
  });
});

describe('loot', () => {
  const entries = Object.values(CREATURES).flatMap((m) => (m.loot ?? []).map((l) => ({ owner: m.id, ...l })));

  it('names existing items with a chance of 1..100', () => {
    for (const l of entries) {
      expect(ITEMS[l.defId], `${l.owner} loot ${l.defId}`).toBeDefined();
      expect(l.chance, `${l.owner} loot ${l.defId} chance`).toBeGreaterThanOrEqual(1);
      expect(l.chance, `${l.owner} loot ${l.defId} chance`).toBeLessThanOrEqual(100);
    }
  });

  it('gives a count only to ammo, with 1 <= min <= max', () => {
    for (const l of entries) {
      if (!l.count) continue;
      expect(ITEMS[l.defId]?.kind, `${l.owner} loot ${l.defId} count`).toBe('ammo');
      expect(l.count.min, `${l.owner} ${l.defId} min`).toBeGreaterThanOrEqual(1);
      expect(l.count.max, `${l.owner} ${l.defId} max`).toBeGreaterThanOrEqual(l.count.min);
    }
  });
});

describe('ammunition', () => {
  const items = Object.values(ITEMS);
  const ammoTypes = new Set(items.flatMap((i) => (i.kind === 'ammo' ? [i.ammoType] : [])));
  const gunTypes = new Set(items.flatMap((i) => (i.kind === 'gun' ? [i.ammoType] : [])));

  it('every gun has ammo that fits it', () => {
    for (const t of gunTypes) expect(ammoTypes.has(t), `ammo for "${t}"`).toBe(true);
  });

  it('every ammo type is used by some gun', () => {
    for (const t of ammoTypes) expect(gunTypes.has(t), `gun for "${t}"`).toBe(true);
  });
});

describe('factions and profiles', () => {
  it('every creature faction is a known faction', () => {
    for (const m of Object.values(CREATURES)) {
      expect(m.faction === null || m.faction in FACTIONS, `${m.id} faction ${m.faction}`).toBe(true);
    }
  });

  it('every NPC profile belongs to an NPC on the map', () => {
    const npcIds = new Set(readWorldMeta().npcs.map((n) => n.id));
    for (const id of Object.keys(NPC_PROFILES)) expect(npcIds.has(id), `profile "${id}"`).toBe(true);
  });

  it('every NPC profile kind is a creature kind', () => {
    for (const [id, p] of Object.entries(NPC_PROFILES)) {
      expect(p.kind === undefined || p.kind in CREATURES, `profile ${id} kind ${p.kind}`).toBe(true);
    }
  });

  it('every NPC profile faction is a known faction', () => {
    for (const [id, p] of Object.entries(NPC_PROFILES)) {
      expect(p.faction === undefined || p.faction in FACTIONS, `profile ${id}`).toBe(true);
    }
  });
});

describe('hit profiles', () => {
  it.each(hitProfiles())('%s has non-negative weights summing to 100', (_label, p) => {
    for (const w of Object.values(p)) expect(w).toBeGreaterThanOrEqual(0);
    expect(Object.values(p).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe('the map', () => {
  const meta = readWorldMeta();

  it('places only known creature kinds', () => {
    for (const m of meta.monsters ?? []) expect(CREATURES[m.defId], `monster at ${m.x},${m.y}: ${m.defId}`).toBeDefined();
  });

  it('gives NPCs only known creature kinds', () => {
    for (const n of meta.npcs) expect(n.kind === undefined || n.kind in CREATURES, `npc ${n.id} kind ${n.kind}`).toBe(true);
  });

  it('places only known ground items', () => {
    for (const i of meta.items ?? []) expect(ITEMS[i.defId], `item at ${i.x},${i.y}: ${i.defId}`).toBeDefined();
  });

  it('gives creatures only known loadout items', () => {
    const owners = [
      ...meta.npcs.map((n) => ({ label: `npc ${n.id}`, l: n as LoadoutJSON })),
      ...(meta.monsters ?? []).map((m) => ({ label: `monster ${m.defId} at ${m.x},${m.y}`, l: m as LoadoutJSON })),
    ];
    for (const { label, l } of owners) {
      for (const id of loadoutIds(l)) expect(ITEMS[id], `${label} carries ${id}`).toBeDefined();
    }
  });
});
