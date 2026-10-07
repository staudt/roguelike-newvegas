import type { Space } from '../../src/engine/GameState';
import type { ChunkJSON } from '../../src/world/ChunkCodec';
import { loadWorld, type WorldMetaJSON } from '../../src/world/MapLoader';

// Vite's glob (which vitest runs) rather than node `fs`: the project ships no node typings.
const CHUNKS = import.meta.glob<ChunkJSON>('../../src/world/goodsprings/chunks/*.json', {
  eager: true,
  import: 'default',
});
const META = import.meta.glob<WorldMetaJSON>('../../src/world/goodsprings/world.json', {
  eager: true,
  import: 'default',
});

export function readWorldMeta(): WorldMetaJSON {
  const meta = Object.values(META)[0];
  if (!meta) throw new Error('world.json not found');
  return meta;
}

export function readWorldChunks(): ChunkJSON[] {
  return Object.entries(CHUNKS)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, json]) => json);
}

/** The real Goodsprings world, every chunk loaded, exactly as the game assembles it. */
export function loadRealWorld(): Space {
  return loadWorld(readWorldMeta(), readWorldChunks());
}

/**
 * Ring cells of a place's rect that are neither wall nor its door. They are not leaks: each is
 * enclosed by walls just outside the rect, so the building stays sealed. They show that the
 * authored rect is not the true footprint there (worth tidying in the editor):
 *  - Prospector Saloon: three ground cells (33..35,9) behind a wall row at y=10; the rect's south edge is one row too far.
 *  - Goodspring Schoolhouse: a floor cell (7,28) with wall at (8,28), so the room bulges one column past the rect.
 * The "ring is wall except one door" test asserts exactly these cells, so fixing the map or the
 * rect makes it fail until this table is updated.
 */
export const RING_GAPS: Record<string, Array<{ x: number; y: number }>> = {
  'Prospector Saloon': [
    { x: 33, y: 9 },
    { x: 34, y: 9 },
    { x: 35, y: 9 },
  ],
  'Goodspring Schoolhouse': [{ x: 7, y: 28 }],
};
