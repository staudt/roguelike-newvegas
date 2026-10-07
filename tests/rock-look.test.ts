import { describe, expect, it } from 'vitest';
import { GROUND_LEVELS, PALETTE } from '../src/config/palette';
import { createEmptyGrid, setHeight, setTileId, surroundingGroundHeight, visualAt } from '../src/world/GameMap';
import { visualFor } from '../src/world/Tile';

describe('rocks', () => {
  it('are drawn as * in the brown of the high ground, on the colour of the ground beneath', () => {
    for (let h = 0; h < GROUND_LEVELS.length; h++) {
      const rock = visualFor('rock', h);
      expect(rock.glyph).toBe('*');
      expect(rock.fg).toBe(PALETTE.rockFg);
      expect(rock.bg).toBe(GROUND_LEVELS[h]!.bg);
    }
    expect(PALETTE.rockFg).toBe(GROUND_LEVELS[GROUND_LEVELS.length - 1]!.fg);
  });

  it('take the ground colour of their surroundings, not their own stored height', () => {
    const grid = createEmptyGrid(5, 5, 'ground');
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) setHeight(grid, x, y, 2);
    setTileId(grid, 2, 2, 'rock');
    setHeight(grid, 2, 2, 0); // painted on a hill without lifting it
    expect(surroundingGroundHeight(grid, 2, 2)).toBe(2);
    expect(visualAt(grid, 2, 2).bg).toBe(GROUND_LEVELS[2]!.bg);
  });

  it('use the most common neighbouring height, the higher on a tie, and their own with no ground around', () => {
    const grid = createEmptyGrid(5, 5, 'ground');
    setTileId(grid, 2, 2, 'rock');
    setHeight(grid, 1, 1, 1);
    setHeight(grid, 2, 1, 1);
    setHeight(grid, 3, 1, 1);
    expect(surroundingGroundHeight(grid, 2, 2)).toBe(0); // five at 0 beat three at 1
    for (const [x, y] of [[1, 2], [3, 2], [1, 3], [2, 3], [3, 3], [1, 1], [2, 1], [3, 1]]) setHeight(grid, x!, y!, x === 1 ? 1 : 2);
    expect(surroundingGroundHeight(grid, 2, 2)).toBe(2);

    const walled = createEmptyGrid(3, 3, 'wall');
    setTileId(walled, 1, 1, 'rock');
    setHeight(walled, 1, 1, 1);
    expect(surroundingGroundHeight(walled, 1, 1)).toBe(1);
  });

  it('other tiles are unaffected', () => {
    const grid = createEmptyGrid(3, 3, 'ground');
    setTileId(grid, 1, 1, 'wall');
    expect(visualAt(grid, 1, 1)).toEqual(visualFor('wall', 0));
    expect(visualAt(grid, 0, 0)).toEqual(visualFor('ground', 0));
  });
});
