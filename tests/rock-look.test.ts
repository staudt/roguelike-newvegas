import { describe, expect, it } from 'vitest';
import { GROUND_LEVELS, PALETTE } from '../src/config/palette';
import { TILES, surfaceUnder, visualFor } from '../src/world/Tile';

describe('rocks', () => {
  it('are drawn as * in the brown of the high ground', () => {
    for (let h = 0; h < GROUND_LEVELS.length; h++) {
      const rock = visualFor('rock', h);
      expect(rock.glyph).toBe('*');
      expect(rock.fg).toBe(PALETTE.rockFg);
    }
    expect(PALETTE.rockFg).toBe(GROUND_LEVELS[GROUND_LEVELS.length - 1]!.fg);
  });

  it('with no base, sit on the ground colour of their height, the way a road follows its height', () => {
    for (let h = 0; h < GROUND_LEVELS.length; h++) {
      expect(visualFor('rock', h).bg).toBe(GROUND_LEVELS[h]!.bg);
      expect(visualFor('rock', h).bg).toBe(visualFor('ground', h).bg);
    }
  });

  it('other tiles keep their own look', () => {
    expect(visualFor('wall', 0).glyph).not.toBe('*');
    expect(visualFor('door', 0)).toEqual(visualFor('door', 3));
  });
});

describe('objects take the base under them', () => {
  it('a wall or rock over floor, road or ground wears that background at its height', () => {
    for (const id of ['wall', 'rock']) {
      expect(visualFor(id, 0, 'floor').bg).toBe(visualFor('floor', 0).bg);
      for (let h = 0; h < GROUND_LEVELS.length; h++) {
        expect(visualFor(id, h, 'road').bg).toBe(visualFor('road', h).bg);
        expect(visualFor(id, h, 'ground').bg).toBe(visualFor('ground', h).bg);
      }
    }
  });

  it('any plain tile can be a base, with no code to add for it', () => {
    for (const def of Object.values(TILES)) {
      if (def.overlay || def.id === 'void') continue;
      expect(visualFor('rock', 0, def.id).bg).toBe(visualFor(def.id, 0).bg);
    }
  });

  it('an object over a doorway stands on floor, over the void on ground, otherwise on the tile itself', () => {
    expect(surfaceUnder('door')).toBe('floor');
    expect(surfaceUnder('openDoor')).toBe('floor');
    expect(surfaceUnder('void')).toBe('ground');
    expect(surfaceUnder('road')).toBe('road');
    expect(surfaceUnder('floor')).toBe('floor');
  });
});
