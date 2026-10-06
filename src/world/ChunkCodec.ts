import { CHUNK_SIZE, createChunk, type Chunk } from './ChunkedMap';
import { TILE_ORDER, tileIndex } from './Tile';

/**
 * On-disk shape of one chunk. Compact and diff-friendly: tile names live in a per-file palette
 * (so adding or reordering tiles in code never invalidates saved chunks), and both layers are
 * run-length encoded as flat [count, value, count, value, ...] arrays in row-major order. A chunk
 * that is mostly open ground is a few dozen numbers instead of 4096 strings.
 */
export interface ChunkJSON {
  cx: number;
  cy: number;
  /** Tile names used by this chunk; `tiles` run values index into it. */
  palette: string[];
  tiles: number[];
  heights: number[];
}

function rleEncode(data: Uint8Array): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const value = data[i]!;
    let run = 1;
    while (i + run < data.length && data[i + run] === value) run++;
    out.push(run, value);
    i += run;
  }
  return out;
}

function rleDecode(pairs: number[], length: number, what: string): Uint8Array {
  const out = new Uint8Array(length);
  let at = 0;
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    const run = pairs[i]!;
    const value = pairs[i + 1]!;
    if (at + run > length) throw new Error(`Chunk ${what} data overruns ${length} cells`);
    out.fill(value, at, at + run);
    at += run;
  }
  if (at !== length) throw new Error(`Chunk ${what} data covers ${at} of ${length} cells`);
  return out;
}

export function encodeChunk(chunk: Chunk): ChunkJSON {
  // Palette in first-use order keeps the file stable across edits that don't introduce new tiles.
  const used: number[] = [];
  for (const t of chunk.tiles) if (!used.includes(t)) used.push(t);
  const paletteIndex = new Map(used.map((t, i) => [t, i]));
  const mapped = Uint8Array.from(chunk.tiles, (t) => paletteIndex.get(t)!);

  return {
    cx: chunk.cx,
    cy: chunk.cy,
    palette: used.map((t) => TILE_ORDER[t] ?? 'void'),
    tiles: rleEncode(mapped),
    heights: rleEncode(chunk.heights),
  };
}

export function decodeChunk(json: ChunkJSON): Chunk {
  const cells = CHUNK_SIZE * CHUNK_SIZE;
  const where = `(${json.cx},${json.cy})`;
  const paletteToIndex = json.palette.map((name) => tileIndex(name));
  const local = rleDecode(json.tiles, cells, `${where} tile`);
  const chunk = createChunk(json.cx, json.cy);
  for (let i = 0; i < cells; i++) {
    const mapped = paletteToIndex[local[i]!];
    if (mapped === undefined) {
      throw new Error(`Chunk ${where} uses palette index ${local[i]} out of range`);
    }
    chunk.tiles[i] = mapped;
  }
  chunk.heights.set(rleDecode(json.heights, cells, `${where} height`));
  return chunk;
}

/** Serialization with each array on one line, so a chunk file stays small and diffs sensibly. */
export function chunkToText(json: ChunkJSON): string {
  return (
    `{\n  "cx": ${json.cx},\n  "cy": ${json.cy},\n  "palette": ${JSON.stringify(json.palette)},\n` +
    `  "tiles": ${JSON.stringify(json.tiles)},\n  "heights": ${JSON.stringify(json.heights)}\n}\n`
  );
}
