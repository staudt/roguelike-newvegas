import { describe, expect, it } from 'vitest';
import { GROUND_LEVELS, MAX_GROUND_HEIGHT, ROAD_LEVELS } from '../src/config/palette';
import { createEmptyGrid, getHeight, setHeight } from '../src/world/GameMap';
import type { ChunkJSON } from '../src/world/ChunkCodec';
import { visualFor } from '../src/world/Tile';

const CHUNKS = import.meta.glob<ChunkJSON>('../src/world/goodsprings/chunks/*.json', {
  eager: true,
  import: 'default',
});

describe('the ground height ladder', () => {
  it('has four rungs: textured flat ground, then dust, rock and ridge', () => {
    expect(MAX_GROUND_HEIGHT).toBe(3);
    expect(GROUND_LEVELS.map((l) => l.glyph)).toEqual(['▒', '░', '▓', '█']);
    expect(ROAD_LEVELS.map((l) => l.glyph)).toEqual(GROUND_LEVELS.map((l) => l.glyph));
  });

  it('flat ground keeps its original colours under the new texture', () => {
    expect(visualFor('ground', 0)).toEqual({ glyph: '▒', fg: '#d9c48f', bg: '#4a3826' });
  });

  it('heights are clamped to the top rung', () => {
    const grid = createEmptyGrid(2, 1, 'ground');
    setHeight(grid, 0, 0, 9);
    expect(getHeight(grid, 0, 0)).toBe(3);
  });

  it('the floor inside buildings has no dot', () => {
    expect(visualFor('floor', 0).glyph).toBe(' ');
  });

  it('no stored map cell is taller than the top rung', () => {
    const chunks = Object.values(CHUNKS);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      for (let i = 1; i < chunk.heights.length; i += 2) {
        expect(chunk.heights[i]).toBeLessThanOrEqual(MAX_GROUND_HEIGHT);
      }
    }
  });
});
