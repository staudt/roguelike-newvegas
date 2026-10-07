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
  it('has four rungs: two tones of one texture (flat, dust), then rock and ridge', () => {
    expect(MAX_GROUND_HEIGHT).toBe(3);
    expect(GROUND_LEVELS.map((l) => l.glyph)).toEqual(['▒', '▒', '▓', '█']);
    expect(ROAD_LEVELS.map((l) => l.glyph)).toEqual(GROUND_LEVELS.map((l) => l.glyph));
  });

  it('flat ground is a little brighter than it used to be, with a gentle texture', () => {
    const tone = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const average = (v: { fg: string; bg: string }): number[] =>
      tone(v.fg).map((c, i) => (c + tone(v.bg)[i]!) / 2);
    const flat = visualFor('ground', 0);
    expect(flat.glyph).toBe('▒');
    // The old flat ground was its background alone, #4a3826 (road: #3b3a37): now a touch lighter, not much.
    for (const [v, old] of [[flat, '#4a3826'], [visualFor('road', 0), '#3b3a37']] as const) {
      average(v).forEach((c, i) => {
        const lift = c - tone(old)[i]!;
        expect(lift).toBeGreaterThanOrEqual(0);
        expect(lift).toBeLessThanOrEqual(24);
      });
    }
    // The texture shows without shouting: a modest gap between glyph and ground.
    const gaps = tone(flat.fg).map((c, i) => c - tone(flat.bg)[i]!);
    expect(Math.max(...gaps)).toBeGreaterThanOrEqual(14);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(32);
    gaps.forEach((g) => expect(g).toBeGreaterThanOrEqual(8));
  });

  it('each rung is brighter overall than the one below, so height still reads at a glance', () => {
    const lum = (hex: string): number => [1, 3, 5].reduce((n, i) => n + parseInt(hex.slice(i, i + 2), 16), 0);
    for (const levels of [GROUND_LEVELS, ROAD_LEVELS]) {
      // Average tone of the glyph cell (the shades cover about half, three quarters, or all of it).
      const cover = [0.5, 0.5, 0.75, 1];
      const tone = levels.map((l, i) => lum(l.fg) * cover[i]! + lum(l.bg) * (1 - cover[i]!));
      for (let i = 1; i < tone.length; i++) expect(tone[i]!).toBeGreaterThan(tone[i - 1]!);
    }
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
