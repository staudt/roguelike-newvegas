import { describe, expect, it } from 'vitest';
import { GROUND_LEVELS, PALETTE } from '../src/config/palette';
import { visualFor } from '../src/world/Tile';

describe('rocks', () => {
  it('are drawn as * in the brown of the high ground', () => {
    for (let h = 0; h < GROUND_LEVELS.length; h++) {
      const rock = visualFor('rock', h);
      expect(rock.glyph).toBe('*');
      expect(rock.fg).toBe(PALETTE.rockFg);
    }
    expect(PALETTE.rockFg).toBe(GROUND_LEVELS[GROUND_LEVELS.length - 1]!.fg);
  });

  it('sit on the ground colour of their own stored height, the way a road follows its height', () => {
    for (let h = 0; h < GROUND_LEVELS.length; h++) {
      expect(visualFor('rock', h).bg).toBe(GROUND_LEVELS[h]!.bg);
      expect(visualFor('rock', h).bg).toBe(visualFor('ground', h).bg);
    }
  });

  it('other tiles keep their own look', () => {
    expect(visualFor('wall', 0).glyph).not.toBe('*');
    expect(visualFor('wall', 3)).toEqual(visualFor('wall', 0));
  });
});
