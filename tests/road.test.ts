import { describe, expect, it } from 'vitest';
import { MAX_GROUND_HEIGHT } from '../src/config/palette';
import { canStep, setHeight, setTileId } from '../src/world/GameMap';
import { tileDef, visualFor } from '../src/world/Tile';
import { hasLineOfSight } from '../src/fov/LineOfSight';
import { buildArena } from './helpers/fixtures';

describe('road tile', () => {
  it('is open, walkable terrain that reuses the ground height glyphs in grey', () => {
    expect(tileDef('road')).toMatchObject({ walkable: true, opaque: false });
    const shades = new Set<string>();
    for (let h = 0; h <= MAX_GROUND_HEIGHT; h++) {
      const v = visualFor('road', h);
      expect(v.glyph).toBe(visualFor('ground', h).glyph);
      shades.add(v.bg);
    }
    expect(shades.size).toBe(MAX_GROUND_HEIGHT + 1);
    expect(visualFor('ground', 0).glyph).toBe(' ');
    expect(visualFor('road', 0).bg).not.toBe(visualFor('ground', 0).bg);
  });

  it('obeys the height rules like ground: no climbing two rungs at once', () => {
    const { state } = buildArena({ width: 6, height: 1, player: { x: 0, y: 0 } });
    const grid = state.spaces[state.activeSpaceId]!.grid;
    for (let x = 1; x <= 3; x++) setTileId(grid, x, 0, 'road');
    setHeight(grid, 1, 0, 1);
    setHeight(grid, 2, 0, 3);
    expect(canStep(grid, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(true);
    expect(canStep(grid, { x: 1, y: 0 }, { x: 2, y: 0 })).toBe(false);
  });

  it('a raised road blocks sight like raised ground', () => {
    const { state } = buildArena({ width: 7, height: 1, player: { x: 0, y: 0 } });
    const grid = state.spaces[state.activeSpaceId]!.grid;
    setTileId(grid, 3, 0, 'road');
    setHeight(grid, 3, 0, 4);
    expect(hasLineOfSight(grid, { x: 0, y: 0 }, { x: 6, y: 0 })).toBe(false);
  });
});
