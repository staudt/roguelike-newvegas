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

  it('flat ground keeps its old overall tone under a texture you can actually see', () => {
    const tone = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const average = (v: { fg: string; bg: string }): number[] =>
      tone(v.fg).map((c, i) => (c + tone(v.bg)[i]!) / 2);
    const flat = visualFor('ground', 0);
    expect(flat.glyph).toBe('▒');
    // The old flat ground was its background alone: #4a3826 (road: #3b3a37).
    average(flat).forEach((c, i) => expect(Math.abs(c - tone('#4a3826')[i]!)).toBeLessThanOrEqual(1));
    average(visualFor('road', 0)).forEach((c, i) => expect(Math.abs(c - tone('#3b3a37')[i]!)).toBeLessThanOrEqual(1));
    // The texture is visible (a clear gap between glyph and ground) without being loud.
    tone(flat.fg).forEach((c, i) => {
      const gap = c - tone(flat.bg)[i]!;
      expect(gap).toBeGreaterThanOrEqual(20);
      expect(gap).toBeLessThanOrEqual(40);
    });
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
