import { describe, expect, it } from 'vitest';
import { FILL_CAP, MapDocument, type FlatSpaceJSON, type WorldMetaJSON } from '../src/editor/MapDocument';
import { encodeChunk } from '../src/world/ChunkCodec';
import { createChunk } from '../src/world/ChunkedMap';
import { GROUND_TILE } from '../src/world/Tile';
import { readWorldChunks } from './helpers/world';

const RAW_META = import.meta.glob<string>('../src/world/goodsprings/world.json', {
  eager: true,
  query: '?raw',
  import: 'default',
});
const RAW_CHUNKS = import.meta.glob<string>('../src/world/goodsprings/chunks/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
});

const META: WorldMetaJSON = {
  kind: 'chunked',
  id: 'world',
  name: 'Test',
  playerStart: { x: 1, y: 1 },
  npcs: [],
  monsters: [],
  transitions: [],
};

/** A world of the single ground chunk (0,0). */
function groundWorld(): MapDocument {
  return MapDocument.fromWorld(META, [encodeChunk(createChunk(0, 0, GROUND_TILE))]);
}

describe('MapDocument delta undo', () => {
  it('undoes a stroke across a chunk seam and at negative coordinates', () => {
    const doc = groundWorld();
    doc.beginStroke();
    doc.lineTile({ x: -3, y: 0 }, { x: 66, y: 0 }, 'wall'); // spans chunks (-1,0), (0,0), (1,0)
    expect(doc.tileAt(-3, 0)).toBe('wall');
    expect(doc.tileAt(63, 0)).toBe('wall');
    expect(doc.tileAt(64, 0)).toBe('wall');
    expect(doc.chunkCount()).toBeGreaterThan(1);

    expect(doc.undo()).toBe(true);
    expect(doc.tileAt(-3, 0)).toBe('void');
    expect(doc.tileAt(63, 0)).toBe('ground');
    expect(doc.tileAt(64, 0)).toBe('void');
    expect(doc.undo()).toBe(false);
  });

  it('records one delta per touched cell and restores heights too', () => {
    const doc = groundWorld();
    doc.beginStroke();
    doc.setHeight(5, 5, 3);
    doc.paintTile(5, 5, 'rock');
    doc.paintTile(5, 5, 'wall');
    doc.undo();
    expect(doc.tileAt(5, 5)).toBe('ground');
    expect(doc.heightAt(5, 5)).toBe(0);
  });

  it('undoes entity edits and building patches as one step', () => {
    const doc = groundWorld();
    doc.beginStroke();
    doc.addNpc(2, 2);
    doc.undo();
    expect(doc.npcs).toHaveLength(0);

    doc.applyBuildingPatch({
      tiles: [{ x: 70, y: 3, id: 'wall' }],
      place: { name: 'Hut', rect: { x: 70, y: 3, width: 1, height: 1 } },
    });
    expect(doc.places).toHaveLength(1);
    doc.undo();
    expect(doc.places).toHaveLength(0);
    expect(doc.tileAt(70, 3)).toBe('void');
  });

  it('painting void onto a missing area creates no chunk', () => {
    const doc = groundWorld();
    doc.beginStroke();
    doc.paintTile(500, 500, 'void');
    expect(doc.chunkCount()).toBe(1);
  });
});

describe('fill', () => {
  it('is bounded: filling void stops at the cap and says so', () => {
    const doc = groundWorld();
    doc.beginStroke();
    const result = doc.fillTile({ x: 200, y: 200 }, 'rock');
    expect(result).toEqual({ filled: FILL_CAP, capped: true });
    expect(doc.tileAt(200, 200)).toBe('rock');
    doc.undo();
    expect(doc.tileAt(200, 200)).toBe('void');
  });

  it('fills a closed region fully without hitting the cap', () => {
    const doc = groundWorld();
    doc.beginStroke();
    doc.boxTile({ x: 10, y: 10 }, { x: 14, y: 14 }, 'wall');
    const result = doc.fillTile({ x: 12, y: 12 }, 'floor');
    expect(result).toEqual({ filled: 9, capped: false });
    expect(doc.tileAt(11, 11)).toBe('floor');
    expect(doc.tileAt(9, 9)).toBe('ground');
  });
});

describe('expanding the world', () => {
  it('adds a strip of chunks along each side of the bounds, in chunk coordinates', () => {
    const doc = groundWorld();
    expect(doc.expand('E', 'ground')).toEqual([{ x: 1, y: 0 }]);
    expect(doc.expand('N', 'rock').map((c) => `${c.x},${c.y}`)).toEqual(['0,-1', '1,-1']);
    expect(doc.expand('W', 'void').map((c) => `${c.x},${c.y}`)).toEqual(['-1,-1', '-1,0']);
    expect(doc.expand('S', 'ground').map((c) => `${c.x},${c.y}`)).toEqual(['-1,1', '0,1', '1,1']);
    expect(doc.chunkCount()).toBe(1 + 1 + 2 + 2 + 3);
    expect(doc.map.bounds()).toEqual({ x: -64, y: -64, width: 192, height: 192 });
    // Nothing shifted, and the fill was applied.
    expect(doc.tileAt(10, 10)).toBe('ground');
    expect(doc.tileAt(70, 5)).toBe('ground');
    expect(doc.tileAt(10, -10)).toBe('rock');
  });

  it('marks new chunks dirty so a save writes them (void-filled ones are not written)', () => {
    const doc = groundWorld();
    doc.expand('E', 'ground');
    doc.expand('S', 'void');
    const plan = doc.savePlan();
    expect(plan.writes.map((w) => `${w.cx},${w.cy}`)).toEqual(['1,0']);
    expect(plan.deletes).toEqual([]);
  });

  it('adds a chunk at a position and refuses duplicates', () => {
    const doc = groundWorld();
    expect(doc.addChunk(-3, 2, 'ground')).toBe(true);
    expect(doc.addChunk(-3, 2, 'ground')).toBe(false);
    expect(doc.tileAt(-3 * 64 + 5, 2 * 64 + 5)).toBe('ground');
    doc.undo();
    expect(doc.chunkCount()).toBe(1);
  });

  it('removes a chunk, deletes its file on save, and undo brings it back', () => {
    const doc = groundWorld();
    doc.expand('E', 'ground');
    doc.commitSave(doc.savePlan());
    expect(doc.removeChunk(1, 0)).toBe(true);
    expect(doc.removeChunk(1, 0)).toBe(false);
    expect(doc.tileAt(70, 5)).toBe('void');
    const plan = doc.savePlan();
    expect(plan.deletes).toEqual([{ cx: 1, cy: 0 }]);
    expect(plan.writes).toEqual([]);

    doc.undo();
    expect(doc.tileAt(70, 5)).toBe('ground');
    expect(doc.savePlan().deletes).toEqual([]);
  });
});

describe('save plan', () => {
  it('writes only dirty chunks; a chunk that became entirely void is deleted instead', () => {
    const doc = MapDocument.fromWorld(META, [
      encodeChunk(createChunk(0, 0, GROUND_TILE)),
      encodeChunk(createChunk(1, 0, GROUND_TILE)),
      encodeChunk(createChunk(2, 0, GROUND_TILE)),
    ]);
    expect(doc.savePlan().writes).toEqual([]);

    doc.beginStroke();
    doc.paintTile(3, 3, 'rock'); // chunk (0,0)
    doc.rectTile({ x: 128, y: 0 }, { x: 191, y: 63 }, 'void'); // erases chunk (2,0)
    const plan = doc.savePlan();
    expect(plan.writes.map((w) => `${w.cx},${w.cy}`)).toEqual(['0,0']);
    expect(plan.deletes).toEqual([{ cx: 2, cy: 0 }]);

    doc.commitSave(plan);
    expect(doc.chunkCount()).toBe(2);
    const after = doc.savePlan();
    expect(after.writes).toEqual([]);
    expect(after.deletes).toEqual([]);
  });

  it('paint then undo of a brand-new area leaves nothing to write', () => {
    const doc = groundWorld();
    doc.beginStroke();
    doc.paintTile(300, 300, 'rock');
    doc.undo();
    const plan = doc.savePlan();
    expect(plan.writes).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });
});

describe('serialization keeps the on-disk shape', () => {
  it('a no-op save of the real world reproduces world.json and the chunk files byte for byte', () => {
    const rawMeta = Object.values(RAW_META)[0]!;
    const doc = MapDocument.fromWorld(JSON.parse(rawMeta) as WorldMetaJSON, readWorldChunks());
    expect(doc.metaText()).toBe(rawMeta);
    expect(doc.savePlan().writes).toEqual([]);
    // Force-encode every chunk: re-encoding what was decoded must be identical to the file.
    for (const chunk of doc.chunked()!.chunkList()) chunk.dirty = true;
    const texts = Object.values(RAW_CHUNKS).sort();
    expect(doc.savePlan().writes.map((w) => w.text).sort()).toEqual(texts);
  });

  it('keeps meta key order, monsters always present, places once there are any', () => {
    const doc = groundWorld();
    expect(Object.keys(JSON.parse(doc.metaText()) as object)).toEqual([
      'kind',
      'id',
      'name',
      'playerStart',
      'npcs',
      'monsters',
      'transitions',
    ]);
    doc.addPlace('Hut', { x: 1, y: 1, width: 5, height: 4 });
    expect(Object.keys(JSON.parse(doc.metaText()) as object).at(-1)).toBe('places');
    expect(doc.metaText().endsWith('}\n')).toBe(true);
  });
});

describe('flat spaces', () => {
  const flat: FlatSpaceJSON = {
    id: 'shed',
    name: 'Shed',
    indoor: true,
    worldOrigin: { x: 10, y: 20 },
    width: 3,
    height: 2,
    tiles: ['wall', 'floor', 'wall', 'wall', 'floor', 'wall'],
    heights: [0, 0, 0, 0, 0, 0],
    npcs: [],
    transitions: [],
    building: 'shed',
    floor: 1,
  };

  it('edits in world coordinates, ignores cells outside, and round-trips', () => {
    const doc = MapDocument.fromFlat(flat);
    expect(doc.tileAt(11, 20)).toBe('floor');
    doc.beginStroke();
    expect(doc.paintTile(11, 21, 'door')).toBe(true);
    expect(doc.paintTile(0, 0, 'door')).toBe(false);
    expect(doc.fillTile({ x: 5, y: 5 }, 'rock')).toEqual({ filled: 0, capped: false });
    doc.undo();
    expect(doc.tileAt(11, 21)).toBe('floor');
    expect(JSON.parse(doc.flatText())).toMatchObject({ ...flat, monsters: [] });
    expect(doc.expand('E', 'ground')).toEqual([]);
  });
});

describe('MapDocument objects keep their base', () => {
  it('a wall painted over floor or raised ground remembers it, and ground painted back restores the height', () => {
    const doc = groundWorld();
    doc.beginStroke();
    doc.paintTile(2, 2, 'floor');
    doc.paintTile(2, 2, 'wall');
    expect(doc.baseAt(2, 2)).toBe('floor');
    expect(doc.heightAt(2, 2)).toBe(0);

    doc.setHeight(3, 3, 2);
    doc.paintTile(3, 3, 'rock');
    expect(doc.baseAt(3, 3)).toBe('ground');
    expect(doc.heightAt(3, 3)).toBe(2);
    doc.paintTile(3, 3, 'wall'); // object over object keeps the base
    expect(doc.baseAt(3, 3)).toBe('ground');
    expect(doc.heightAt(3, 3)).toBe(2);
    doc.paintTile(3, 3, 'ground');
    expect(doc.baseAt(3, 3)).toBe('');
    expect(doc.heightAt(3, 3)).toBe(2);

    doc.paintTile(4, 4, 'road');
    doc.setHeight(4, 4, 1);
    doc.paintTile(4, 4, 'rock');
    expect(doc.baseAt(4, 4)).toBe('road');
    expect(doc.heightAt(4, 4)).toBe(1);

    doc.paintTile(5, 5, 'door');
    doc.paintTile(5, 5, 'wall');
    expect(doc.baseAt(5, 5)).toBe('floor');
  });

  it('undo gives an object back its base', () => {
    const doc = groundWorld();
    doc.beginStroke();
    doc.paintTile(2, 2, 'road');
    doc.paintTile(2, 2, 'rock');
    doc.beginStroke();
    doc.paintTile(2, 2, 'ground');
    expect(doc.baseAt(2, 2)).toBe('');
    doc.undo();
    expect(doc.tileAt(2, 2)).toBe('rock');
    expect(doc.baseAt(2, 2)).toBe('road');
  });
});
