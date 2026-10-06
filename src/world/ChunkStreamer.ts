import type { Point } from '../utils/geometry';
import { CHUNK_SHIFT, chunkKey, type ChunkedMap } from './ChunkedMap';
import { decodeChunk, type ChunkJSON } from './ChunkCodec';

export interface ChunkCoord {
  cx: number;
  cy: number;
}

export interface ChunkStats {
  loaded: number;
  total: number;
  dirty: number;
}

/** Parses `<cx>_<cy>.json` (negatives allowed) at the end of a file path; null if it doesn't match. */
export function parseChunkPath(path: string): ChunkCoord | null {
  const m = /(-?\d+)_(-?\d+)\.json$/.exec(path);
  return m ? { cx: Number(m[1]), cy: Number(m[2]) } : null;
}

/**
 * Keeps the right chunks of a ChunkedMap in memory around the player. It knows which chunks exist
 * (one file each) and loads them on demand through an injected loader, so the world can be as big
 * as the disk without the game ever holding more than a few chunks.
 *
 * Unloading never loses anything the player did: a dirty chunk (a door opened in play) is kept, and
 * the explored flags of an unloaded chunk are remembered and restored when it loads again.
 */
export class ChunkStreamer {
  private readonly existing = new Set<number>();
  private readonly loading = new Map<number, Promise<void>>();
  private readonly rememberedExplored = new Map<number, Uint8Array>();
  private readonly map: ChunkedMap;
  private readonly load: (cx: number, cy: number) => Promise<ChunkJSON>;

  constructor(
    map: ChunkedMap,
    existing: Iterable<ChunkCoord>,
    load: (cx: number, cy: number) => Promise<ChunkJSON>,
  ) {
    this.map = map;
    this.load = load;
    for (const { cx, cy } of existing) this.existing.add(chunkKey(cx, cy));
  }

  static chunkOf(point: Point): ChunkCoord {
    return { cx: Math.floor(point.x) >> CHUNK_SHIFT, cy: Math.floor(point.y) >> CHUNK_SHIFT };
  }

  /** Loads every existing, not-yet-loaded chunk within `ring` chunks of `center` (1 = the 3x3). */
  ensureAround(center: Point, ring = 1): Promise<void> {
    const { cx, cy } = ChunkStreamer.chunkOf(center);
    const pending: Promise<void>[] = [];
    for (let y = cy - ring; y <= cy + ring; y++) {
      for (let x = cx - ring; x <= cx + ring; x++) {
        const p = this.ensureChunk(x, y);
        if (p) pending.push(p);
      }
    }
    return Promise.all(pending).then(() => undefined);
  }

  private ensureChunk(cx: number, cy: number): Promise<void> | null {
    const key = chunkKey(cx, cy);
    if (!this.existing.has(key) || this.map.getChunk(cx, cy)) return null;
    let inFlight = this.loading.get(key);
    if (!inFlight) {
      inFlight = this.load(cx, cy)
        .then((json) => {
          const chunk = decodeChunk(json);
          const explored = this.rememberedExplored.get(key);
          if (explored) {
            chunk.explored.set(explored);
            this.rememberedExplored.delete(key);
          }
          this.map.addChunk(chunk);
        })
        .finally(() => this.loading.delete(key));
      this.loading.set(key, inFlight);
    }
    return inFlight;
  }

  /** Drops clean chunks further than `keepRing` chunks from `center`. Returns how many went. */
  unloadFar(center: Point, keepRing = 2): number {
    const { cx, cy } = ChunkStreamer.chunkOf(center);
    let dropped = 0;
    for (const chunk of this.map.chunkList()) {
      if (Math.max(Math.abs(chunk.cx - cx), Math.abs(chunk.cy - cy)) <= keepRing) continue;
      if (chunk.dirty) continue;
      if (chunk.explored.some((v) => v !== 0)) {
        this.rememberedExplored.set(chunkKey(chunk.cx, chunk.cy), chunk.explored);
      }
      this.map.removeChunk(chunk.cx, chunk.cy);
      dropped++;
    }
    return dropped;
  }

  stats(): ChunkStats {
    const chunks = this.map.chunkList();
    return {
      loaded: chunks.length,
      total: this.existing.size,
      dirty: chunks.filter((c) => c.dirty).length,
    };
  }
}
