import { describe, expect, it } from 'vitest';
import { MapDocument, type FlatSpaceJSON, type WorldMetaJSON } from '../src/editor/MapDocument';
import { encodeChunk } from '../src/world/ChunkCodec';
import { createChunk } from '../src/world/ChunkedMap';
import { GROUND_TILE } from '../src/world/Tile';
import { readWorldChunks } from './helpers/world';

const RAW_META = import.meta.glob<string>('../src/world/goodsprings/world.json', {
  eager: true,
  query: '?raw',
  import: 'default',
});

/** A meta using every new field, with unknown extra keys and non-canonical key orders. */
const META = {
  kind: 'chunked',
  id: 'world',
  name: 'Test',
  playerStart: { x: 1, y: 1 },
  npcs: [
    {
      id: 'ringo',
      name: 'Ringo',
      x: 3,
      y: 3,
      fg: '#c97b5a',
      interactions: ['talk', 'heal'],
      inventory: ['9mm-pistol', { defId: '9mm-round', count: 12 }, 'stimpak'],
      wield: '9mm-pistol',
      ready: '9mm-round',
      mood: { hostile: false, tags: ['a', 'b'] },
      dialogue: ['Hi.'],
    },
    // dialogue before inventory: an order the editor would not choose itself
    { id: 'bob', name: 'Bob', x: 4, y: 4, dialogue: ['Yo.'], inventory: ['combat-knife'], wield: 'combat-knife', extra: 7 },
  ],
  monsters: [
    { defId: 'gecko', x: 5, y: 5, inventory: ['gecko-hide'], loot: 'x', wield: undefined },
    { defId: 'gecko', x: 6, y: 5 },
  ],
  transitions: [],
  places: [{ name: 'Hut', rect: { x: 1, y: 1, width: 3, height: 3 } }],
  items: [
    { defId: 'stimpak', x: 2, y: 2 },
    { defId: '9mm-round', x: 2, y: 2, count: 12, note: 'x' },
  ],
} as unknown as WorldMetaJSON;

function textOf(meta: WorldMetaJSON): string {
  return JSON.stringify(meta, null, 2) + '\n';
}

function world(meta: WorldMetaJSON = META): MapDocument {
  // JSON round trip drops undefined, like a real file read.
  const parsed = JSON.parse(JSON.stringify(meta)) as WorldMetaJSON;
  return MapDocument.fromWorld(parsed, [encodeChunk(createChunk(0, 0, GROUND_TILE))]);
}

describe('item and loadout fields round-trip', () => {
  it('reproduces ground items and loadouts, with unknown keys and key order, exactly', () => {
    const parsed = JSON.parse(JSON.stringify(META)) as WorldMetaJSON;
    expect(world().metaText()).toBe(textOf(parsed));
  });

  it('places items after places in the meta and loadout keys after interactions in a new NPC entry', () => {
    const doc = world(JSON.parse(JSON.stringify({ ...META, items: undefined })) as WorldMetaJSON);
    doc.beginStroke();
    doc.addItem('stimpak', 1, 1);
    const meta = JSON.parse(doc.metaText()) as Record<string, unknown>;
    expect(Object.keys(meta).slice(-2)).toEqual(['places', 'items']);

    const npc = doc.addNpc(9, 9);
    doc.updateNpc(npc.id, { interactions: ['talk', 'heal'] });
    doc.addCarried(npc, '9mm-pistol');
    doc.setWield(npc, '9mm-pistol');
    const entry = (JSON.parse(doc.metaText()) as { npcs: Array<Record<string, unknown>> }).npcs.at(-1)!;
    expect(Object.keys(entry)).toEqual(['id', 'name', 'x', 'y', 'interactions', 'inventory', 'wield', 'dialogue']);
  });

  it('puts monster loadout keys after y', () => {
    const doc = world();
    const gecko = doc.monsterAt(6, 5)!;
    doc.addCarried(gecko, 'gecko-hide');
    const m = (JSON.parse(doc.metaText()) as { monsters: Array<Record<string, unknown>> }).monsters[1]!;
    expect(Object.keys(m)).toEqual(['defId', 'x', 'y', 'inventory']);
  });

  it('keeps a no-op save of flat spaces carrying items byte-identical', () => {
    const flat: FlatSpaceJSON = {
      id: 'shed',
      name: 'Shed',
      indoor: true,
      worldOrigin: { x: 0, y: 0 },
      width: 1,
      height: 1,
      tiles: ['floor'],
      heights: [0],
      npcs: [],
      monsters: [{ defId: 'gecko', x: 0, y: 0, inventory: ['gecko-hide'] }],
      transitions: [],
      items: [{ defId: 'stimpak', x: 0, y: 0 }],
    };
    const text = JSON.stringify(flat, null, 2) + '\n';
    expect(MapDocument.fromFlat(flat).flatText()).toBe(text);
  });

  it('deep-copies: mutating the source JSON afterwards does not touch the document', () => {
    const source = JSON.parse(JSON.stringify(META)) as WorldMetaJSON;
    const doc = MapDocument.fromWorld(source, [encodeChunk(createChunk(0, 0, GROUND_TILE))]);
    const before = doc.metaText();
    (source.npcs[0]!.inventory as unknown[]).push('x');
    (source.items as unknown[]).length = 0;
    (source.npcs[0] as unknown as { mood: { tags: string[] } }).mood.tags.push('c');
    expect(doc.metaText()).toBe(before);
  });

  it('the real world.json (whatever fields it has now) round-trips byte for byte', () => {
    const rawMeta = Object.values(RAW_META)[0]!;
    const doc = MapDocument.fromWorld(JSON.parse(rawMeta) as WorldMetaJSON, readWorldChunks());
    expect(doc.metaText()).toBe(rawMeta);
    // ...and survives an undoable edit followed by undo.
    doc.beginStroke();
    doc.addItem('stimpak', 0, 0);
    doc.undo();
    expect(doc.metaText()).toBe(rawMeta);
  });
});

describe('ground items', () => {
  it('adds several to one cell, moves, removes, and undoes each', () => {
    const doc = world();
    doc.beginStroke();
    const a = doc.addItem('stimpak', 7, 7);
    expect(a.count).toBeUndefined();
    doc.beginStroke();
    const b = doc.addItem('9mm-round', 7, 7, 12);
    expect(doc.itemsAt(7, 7)).toEqual([a, b]);

    doc.beginStroke();
    doc.moveItem(b, 8, 7);
    expect(doc.itemsAt(7, 7)).toEqual([a]);
    expect(doc.itemsAt(8, 7)).toEqual([b]);

    doc.beginStroke();
    doc.removeItem(a);
    expect(doc.itemsAt(7, 7)).toEqual([]);

    expect(doc.undo()).toBe(true); // remove
    expect(doc.itemsAt(7, 7)).toHaveLength(1);
    expect(doc.undo()).toBe(true); // move
    expect(doc.itemsAt(8, 7)).toEqual([]);
    expect(doc.itemsAt(7, 7)).toHaveLength(2);
    expect(doc.undo()).toBe(true); // add ammo
    expect(doc.itemsAt(7, 7)).toHaveLength(1);
    expect(doc.undo()).toBe(true); // add stimpak
    expect(doc.itemsAt(7, 7)).toHaveLength(0);
    expect(doc.items).toHaveLength(2); // the two from META
  });

  it('writes a count only when given, and saves into meta.items', () => {
    const doc = world();
    doc.beginStroke();
    doc.addItem('9mm-round', 9, 9, 20);
    const items = (JSON.parse(doc.metaText()) as { items: unknown[] }).items;
    expect(items.at(-1)).toEqual({ defId: '9mm-round', x: 9, y: 9, count: 20 });
  });
});

describe('loadouts', () => {
  it('undo restores loadout edits (deep)', () => {
    const doc = world();
    const before = doc.metaText();
    const ringo = doc.npcById('ringo')!;
    doc.beginStroke();
    doc.addCarried(ringo, 'baseball-bat');
    doc.removeCarried(ringo, 0); // the pistol: clears wield
    expect(ringo.wield).toBeUndefined();
    expect(doc.metaText()).not.toBe(before);
    doc.undo();
    expect(doc.metaText()).toBe(before);
    expect(doc.npcById('ringo')!.wield).toBe('9mm-pistol');
  });

  it('merges ammo stacks and keeps other items as bare ids', () => {
    const doc = world();
    const bob = doc.npcById('bob')!;
    doc.addCarried(bob, '9mm-round', 5);
    doc.addCarried(bob, '9mm-round', 7);
    doc.addCarried(bob, 'stimpak');
    expect(bob.inventory).toEqual(['combat-knife', { defId: '9mm-round', count: 12 }, 'stimpak']);
  });

  it('wield offers only carried weapons/guns, ready only carried ammo', () => {
    const doc = world();
    const bob = doc.npcById('bob')!;
    expect(doc.setWield(bob, 'baseball-bat')).toBe(false); // not carried
    expect(doc.setWield(bob, 'stimpak')).toBe(false);
    doc.addCarried(bob, 'stimpak');
    expect(doc.setWield(bob, 'stimpak')).toBe(false); // carried but not wieldable
    expect(bob.wield).toBe('combat-knife');
    expect(doc.setReady(bob, '9mm-round')).toBe(false); // not carried
    doc.addCarried(bob, '9mm-round', 3);
    expect(doc.setReady(bob, 'combat-knife')).toBe(false); // not ammo
    expect(doc.setReady(bob, '9mm-round')).toBe(true);
    expect(bob.ready).toBe('9mm-round');
    expect(doc.setWield(bob, undefined)).toBe(true);
    expect(bob.wield).toBeUndefined();
  });

  it('removing the wielded/readied item clears the field; a duplicate keeps it', () => {
    const doc = world();
    const ringo = doc.npcById('ringo')!;
    doc.addCarried(ringo, '9mm-pistol'); // a second pistol
    doc.removeCarried(ringo, 0); // the original pistol
    expect(ringo.wield).toBe('9mm-pistol'); // the second one is still carried
    expect(ringo.inventory).toEqual([{ defId: '9mm-round', count: 12 }, 'stimpak', '9mm-pistol']);
    const at = ringo.inventory!.indexOf('9mm-pistol');
    doc.removeCarried(ringo, at);
    expect(ringo.wield).toBeUndefined();
    doc.removeCarried(ringo, 0); // the ammo
    expect(ringo.ready).toBeUndefined();
  });

  it('dropping the last item removes the inventory key, and extras survive the whole dance', () => {
    const doc = world();
    const bob = doc.npcById('bob')!;
    doc.removeCarried(bob, 0);
    const entry = (JSON.parse(doc.metaText()) as { npcs: Array<Record<string, unknown>> }).npcs[1]!;
    expect(entry).toEqual({ id: 'bob', name: 'Bob', x: 4, y: 4, dialogue: ['Yo.'], extra: 7 });
  });

  it('monsters carry too, and undo of monster edits restores them', () => {
    const doc = world();
    const before = doc.metaText();
    doc.beginStroke();
    doc.addCarried(doc.monsterAt(5, 5)!, 'stimpak');
    doc.undo();
    expect(doc.metaText()).toBe(before);
  });
});
