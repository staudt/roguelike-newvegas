import { describe, expect, it } from 'vitest';
import { computeVisible, isVisible, markExplored } from '../src/fov/Visibility';
import { createEmptyGrid, setTileId } from '../src/world/GameMap';

describe('computeVisible', () => {
  it('limits visibility to the Euclidean radius on open ground', () => {
    const grid = createEmptyGrid(21, 21, 'ground');
    const origin = { x: 10, y: 10 };
    const visible = computeVisible(grid, origin, 5);

    // Straight out along an axis, 5 tiles away is in range, 6 is not.
    expect(isVisible(visible, grid, 15, 10)).toBe(true);
    expect(isVisible(visible, grid, 16, 10)).toBe(false);

    // Diagonally, Euclidean distance shrinks what's visible compared to Chebyshev.
    // (10,10) -> (14,14) is distance sqrt(32) ≈ 5.66 > 5, so it must be excluded even though
    // it's within a 5-cell Chebyshev box.
    expect(isVisible(visible, grid, 14, 14)).toBe(false);
    // (10,10) -> (13,13) is distance sqrt(18) ≈ 4.24 <= 5, so it is included.
    expect(isVisible(visible, grid, 13, 13)).toBe(true);
  });

  it('respects line-of-sight blocking within the radius', () => {
    const grid = createEmptyGrid(11, 1, 'ground');
    setTileId(grid, 5, 0, 'wall');
    const visible = computeVisible(grid, { x: 0, y: 0 }, 10);

    // The wall itself is visible (it's the near face), but everything behind it is not, even
    // though it's well within the radius.
    expect(isVisible(visible, grid, 5, 0)).toBe(true);
    expect(isVisible(visible, grid, 6, 0)).toBe(false);
    expect(isVisible(visible, grid, 10, 0)).toBe(false);
  });

  it('the origin itself is always visible', () => {
    const grid = createEmptyGrid(5, 5, 'ground');
    const visible = computeVisible(grid, { x: 2, y: 2 }, 3);
    expect(isVisible(visible, grid, 2, 2)).toBe(true);
  });
});

describe('markExplored', () => {
  it('is monotonic — a cell stays explored after it leaves current visibility', () => {
    const grid = createEmptyGrid(11, 1, 'ground');
    const explored = new Uint8Array(grid.width * grid.height);

    // First look from the left end: (9,0) is within radius and in sight.
    const visibleFromLeft = computeVisible(grid, { x: 0, y: 0 }, 10);
    expect(isVisible(visibleFromLeft, grid, 9, 0)).toBe(true);
    markExplored(explored, visibleFromLeft);
    expect(explored[9]).toBe(1);

    // Now move the origin far away so (9,0) is no longer currently visible...
    const visibleFromRight = computeVisible(grid, { x: 10, y: 0 }, 1);
    expect(isVisible(visibleFromRight, grid, 9, 0)).toBe(true); // still adjacent, in range here
    // ...use a tighter radius so it genuinely drops out of the *current* visible set.
    const visibleTight = computeVisible(grid, { x: 10, y: 0 }, 0);
    expect(isVisible(visibleTight, grid, 9, 0)).toBe(false);

    markExplored(explored, visibleTight);
    // Explored must remain true even though it is no longer currently visible.
    expect(explored[9]).toBe(1);
  });

  it('only ORs in newly visible bits, never clears previously explored ones', () => {
    const grid = createEmptyGrid(5, 1, 'ground');
    const explored = new Uint8Array(grid.width);
    explored[0] = 1;
    explored[4] = 1;

    const visible = new Uint8Array(grid.width);
    visible[2] = 1;

    markExplored(explored, visible);

    expect(Array.from(explored)).toEqual([1, 0, 1, 0, 1]);
  });
});
