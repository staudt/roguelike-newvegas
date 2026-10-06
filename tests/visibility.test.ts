import { describe, expect, it } from 'vitest';
import { computeVisible, isVisible, markExplored } from '../src/fov/Visibility';
import { VisibleSet } from '../src/fov/VisibleSet';
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

    // First look from the left end: (9,0) is within radius and in sight.
    const visibleFromLeft = computeVisible(grid, { x: 0, y: 0 }, 10);
    expect(isVisible(visibleFromLeft, grid, 9, 0)).toBe(true);
    markExplored(grid, visibleFromLeft);
    expect(grid.isExplored(9, 0)).toBe(true);

    // Now a tighter radius so (9,0) genuinely drops out of the *current* visible set.
    const visibleTight = computeVisible(grid, { x: 10, y: 0 }, 0);
    expect(isVisible(visibleTight, grid, 9, 0)).toBe(false);

    markExplored(grid, visibleTight);
    // Explored must remain true even though it is no longer currently visible.
    expect(grid.isExplored(9, 0)).toBe(true);
  });

  it('only adds newly visible cells, never clears previously explored ones', () => {
    const grid = createEmptyGrid(5, 1, 'ground');
    grid.markExplored(0, 0);
    grid.markExplored(4, 0);

    const visible = new VisibleSet(0, 0, 5, 1);
    visible.add(2, 0);

    markExplored(grid, visible);

    expect([0, 1, 2, 3, 4].map((x) => (grid.isExplored(x, 0) ? 1 : 0))).toEqual([1, 0, 1, 0, 1]);
  });

  it('never marks cells that are not in the map', () => {
    const grid = createEmptyGrid(2, 1, 'ground');
    const visible = new VisibleSet(-2, 0, 6, 1);
    visible.add(-1, 0);
    visible.add(1, 0);
    markExplored(grid, visible);
    expect(grid.isExplored(-1, 0)).toBe(false);
    expect(grid.isExplored(1, 0)).toBe(true);
  });
});
