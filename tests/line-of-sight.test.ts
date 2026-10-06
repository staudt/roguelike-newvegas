import { describe, expect, it } from 'vitest';
import { hasLineOfSight } from '../src/fov/LineOfSight';
import { createEmptyGrid, setHeight, setTileId } from '../src/world/GameMap';

describe('hasLineOfSight', () => {
  it('(a) sees clearly across flat open ground', () => {
    const grid = createEmptyGrid(5, 5, 'ground');
    expect(hasLineOfSight(grid, { x: 0, y: 2 }, { x: 4, y: 2 })).toBe(true);
  });

  it('(b) is blocked by a single ridge cell strictly between two low points, taller than the interpolated sightline', () => {
    const grid = createEmptyGrid(5, 1, 'ground');
    // from (0,0) height 0 to (4,0) height 0 -> interpolated sightline height is 0 the whole way.
    // A ridge of height 2 sitting at the midpoint is strictly taller than that, so it blocks.
    setHeight(grid, 2, 0, 2);
    expect(hasLineOfSight(grid, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false);
  });

  it('(c) sees from a peak down to low ground with nothing tall intervening (asymmetric: high -> low)', () => {
    const grid = createEmptyGrid(5, 1, 'ground');
    setHeight(grid, 0, 0, 4); // peak
    // (1,0)..(3,0) and (4,0) stay at height 0 — flat, nothing rises above the interpolated line.
    expect(hasLineOfSight(grid, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
  });

  it('(c cont.) the reverse direction (low -> high) is also clear when nothing tall intervenes', () => {
    const grid = createEmptyGrid(5, 1, 'ground');
    setHeight(grid, 4, 0, 4); // peak at the far end this time
    expect(hasLineOfSight(grid, { x: 4, y: 0 }, { x: 0, y: 0 })).toBe(true);
  });

  it('standing on a peak is not itself protection — a ridge between two peaks can still block', () => {
    const grid = createEmptyGrid(5, 1, 'ground');
    setHeight(grid, 0, 0, 4);
    setHeight(grid, 4, 0, 4);
    // Interpolated sightline between two height-4 points is flat at 4. A ridge of height 4 is NOT
    // taller than that (not > ), so by itself this should still be visible...
    setHeight(grid, 2, 0, 4);
    expect(hasLineOfSight(grid, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
    // ...but push the intervening cell one rung higher than both peaks and it blocks.
    // (MAX_GROUND_HEIGHT is 4, so simulate "taller" by lowering the peaks instead.)
    setHeight(grid, 0, 0, 2);
    setHeight(grid, 4, 0, 2);
    setHeight(grid, 2, 0, 4);
    expect(hasLineOfSight(grid, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false);
  });

  it('(d) a wall cell as the endpoint is visible — you can see its surface', () => {
    const grid = createEmptyGrid(5, 1, 'ground');
    setTileId(grid, 4, 0, 'wall');
    expect(hasLineOfSight(grid, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
  });

  it('(e) a wall cell before the endpoint blocks everything past it', () => {
    const grid = createEmptyGrid(5, 1, 'ground');
    setTileId(grid, 2, 0, 'wall');
    // The wall itself, as the endpoint, is visible...
    expect(hasLineOfSight(grid, { x: 0, y: 0 }, { x: 2, y: 0 })).toBe(true);
    // ...but anything strictly beyond it on the same line is not.
    expect(hasLineOfSight(grid, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false);
  });

  it('(e cont.) rock before the endpoint also blocks everything past it', () => {
    const grid = createEmptyGrid(5, 1, 'ground');
    setTileId(grid, 2, 0, 'rock');
    expect(hasLineOfSight(grid, { x: 0, y: 0 }, { x: 2, y: 0 })).toBe(true);
    expect(hasLineOfSight(grid, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false);
  });

  it('(e cont.) a door before the endpoint blocks everything past it too', () => {
    const grid = createEmptyGrid(5, 1, 'ground');
    setTileId(grid, 2, 0, 'door');
    expect(hasLineOfSight(grid, { x: 0, y: 0 }, { x: 2, y: 0 })).toBe(true);
    expect(hasLineOfSight(grid, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false);
  });

  it('(f) the same point as both from and to is trivially visible', () => {
    const grid = createEmptyGrid(3, 3, 'ground');
    expect(hasLineOfSight(grid, { x: 1, y: 1 }, { x: 1, y: 1 })).toBe(true);
  });

  it('(f cont.) is trivially visible even when that single point is opaque', () => {
    const grid = createEmptyGrid(3, 3, 'ground');
    setTileId(grid, 1, 1, 'wall');
    expect(hasLineOfSight(grid, { x: 1, y: 1 }, { x: 1, y: 1 })).toBe(true);
  });
});
