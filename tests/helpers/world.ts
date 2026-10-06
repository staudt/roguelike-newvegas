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
