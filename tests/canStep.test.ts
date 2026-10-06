import { describe, expect, it } from 'vitest';
import { canStep, createEmptyGrid, setHeight, setTileId } from '../src/world/GameMap';

describe('canStep', () => {
  it('allows a same-height step between two ground cells', () => {
    const grid = createEmptyGrid(3, 1, 'ground');
    // Both (0,0) and (1,0) are ground at height 0 by default.
    expect(canStep(grid, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(true);
  });

  it('allows a one-level-up step between ground cells', () => {
    const grid = createEmptyGrid(3, 1, 'ground');
    setHeight(grid, 1, 0, 1);
    expect(canStep(grid, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(true);
  });

  it('allows a one-level-down step between ground cells', () => {
    const grid = createEmptyGrid(3, 1, 'ground');
    setHeight(grid, 0, 0, 1);
    expect(canStep(grid, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(true);
  });

  it('blocks a two-level jump between ground cells', () => {
    const grid = createEmptyGrid(3, 1, 'ground');
    setHeight(grid, 1, 0, 2);
    expect(canStep(grid, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(false);
  });

  it('blocks a two-level drop between ground cells', () => {
    const grid = createEmptyGrid(3, 1, 'ground');
    setHeight(grid, 0, 0, 2);
    expect(canStep(grid, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(false);
  });

  it('blocks stepping onto rock regardless of height', () => {
    const grid = createEmptyGrid(3, 1, 'ground');
    setTileId(grid, 1, 0, 'rock');
    // Even same "height" (both default 0) the destination is a hard barrier.
    expect(canStep(grid, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(false);
  });

  it('blocks stepping onto wall regardless of height', () => {
    const grid = createEmptyGrid(3, 1, 'ground');
    setTileId(grid, 1, 0, 'wall');
    setHeight(grid, 0, 0, 4);
    expect(canStep(grid, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(false);
  });

  it('skips the height-delta check when the destination is not ground (door)', () => {
    const grid = createEmptyGrid(3, 1, 'ground');
    setHeight(grid, 0, 0, 4);
    setTileId(grid, 1, 0, 'door');
    // Door carries no meaningful height, so a 4-level "delta" to it is irrelevant.
    expect(canStep(grid, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(true);
  });

  it('skips the height-delta check when the origin is not ground (door)', () => {
    const grid = createEmptyGrid(3, 1, 'ground');
    setTileId(grid, 0, 0, 'door');
    setHeight(grid, 1, 0, 4);
    expect(canStep(grid, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(true);
  });

  it('skips the height-delta check between two non-ground walkable tiles (floor to floor)', () => {
    const grid = createEmptyGrid(3, 1, 'ground');
    setTileId(grid, 0, 0, 'floor');
    setTileId(grid, 1, 0, 'floor');
    expect(canStep(grid, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(true);
  });

  it('blocks stepping out of bounds', () => {
    const grid = createEmptyGrid(2, 1, 'ground');
    expect(canStep(grid, { x: 0, y: 0 }, { x: -1, y: 0 })).toBe(false);
  });
});
