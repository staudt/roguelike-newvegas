import { describe, expect, it } from 'vitest';
import { GROUND_LEVELS, PALETTE, ROAD_LEVELS } from '../src/config/palette';
import { BASE_FLOOR, BASE_ROAD, baseCodeOf, baseGroundHeight, perceivedColour, visualFor } from '../src/world/Tile';

describe('rocks', () => {
  it('are drawn as * in the brown of the high ground, dark where the ground is too close to that brown', () => {
    for (let h = 0; h < GROUND_LEVELS.length; h++) {
      const rock = visualFor('rock', h);
      expect(rock.glyph).toBe('*');
      expect(rock.fg).not.toBe(rock.bg);
    }
    expect(visualFor('rock', 0).fg).toBe(PALETTE.rockFg);
    expect(visualFor('rock', GROUND_LEVELS.length - 1).fg).not.toBe(PALETTE.rockFg); // the ridge is the same brown
    expect(PALETTE.rockFg).toBe(GROUND_LEVELS[GROUND_LEVELS.length - 1]!.fg);
  });

  it('sit on the colour the ground of their stored height looks like, glyph texture included', () => {
    for (let h = 0; h < GROUND_LEVELS.length; h++) {
      expect(visualFor('rock', h).bg).toBe(perceivedColour(GROUND_LEVELS[h]!));
    }
  });

  it('are never darker than the near-solid ground they stand on (the ▓ and █ rungs read light)', () => {
    const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    for (const h of [2, 3]) expect(lum(visualFor('rock', h).bg)).toBeGreaterThan(lum(GROUND_LEVELS[h]!.bg) + 100);
  });

  it('other tiles keep their own look', () => {
    expect(visualFor('wall', 0).glyph).not.toBe('*');
    expect(visualFor('door', 0)).toEqual(visualFor('door', 3));
  });
});

describe('objects take the base under them', () => {
  it('a wall or rock over floor, road or ground wears that background', () => {
    for (const id of ['wall', 'rock']) {
      expect(visualFor(id, BASE_FLOOR).bg).toBe(visualFor('floor', 0).bg);
      for (let h = 0; h < GROUND_LEVELS.length; h++) {
        expect(visualFor(id, BASE_ROAD + h).bg).toBe(perceivedColour(ROAD_LEVELS[h]!));
        expect(visualFor(id, h).bg).toBe(perceivedColour(GROUND_LEVELS[h]!));
      }
    }
  });

  it('the base code of a cell is what an object painted over it keeps', () => {
    expect(baseCodeOf('ground', 2)).toBe(2);
    expect(baseCodeOf('road', 1)).toBe(BASE_ROAD + 1);
    expect(baseCodeOf('floor', 0)).toBe(BASE_FLOOR);
    expect(baseCodeOf('openDoor', 0)).toBe(BASE_FLOOR);
    expect(baseCodeOf('wall', BASE_ROAD + 2)).toBe(BASE_ROAD + 2);
  });

  it('the terrain height under a base is its ground or road height, and 0 for floor', () => {
    expect(baseGroundHeight(3)).toBe(3);
    expect(baseGroundHeight(BASE_ROAD + 2)).toBe(2);
    expect(baseGroundHeight(BASE_FLOOR)).toBe(0);
  });
});
