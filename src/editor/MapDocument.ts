import { MAX_GROUND_HEIGHT } from '../config/palette';
import type { Point, Rect } from '../utils/geometry';
import type { InteractionId } from '../entities/Npc';
import type { BuildingPatch } from '../world/buildingTemplate';
import { ChunkedMap, chunkKey, createChunk, type Chunk } from '../world/ChunkedMap';
import { chunkToText, decodeChunk, encodeChunk, type ChunkJSON } from '../world/ChunkCodec';
import { FlatMap } from '../world/FlatMap';
import { GROUND_TILE, VOID_TILE, tileIdOf, tileIndex } from '../world/Tile';
import type { TileMap } from '../world/TileMap';

/**
 * The map editor's in-memory model of one space: a `TileMap` (the chunked world, or a small flat
 * space such as an extra floor) plus the entity lists, and the paint/undo/expand/save-plan
 * operations that mutate them. Every coordinate is a WORLD coordinate.
 *
 * Deliberately DOM-free, so the editing logic is testable without a browser; `main.ts` only turns
 * mouse/keyboard events into calls on this class.
 *
 * Undo is delta based: a stroke records `{x, y, oldTile, oldHeight}` for each cell it first
 * touches (plus the entity lists, which are tiny), never a copy of the map — the world can be
 * arbitrarily large.
 */
export interface EditableNpc {
  id: string;
  name: string;
  x: number;
  y: number;
  /** One or more lines; an NPC with several cycles through them one bump at a time in-game. */
  dialogue: string[];
  fg?: string;
  /** What a bump offers; ['talk'] is the default and is omitted on save. */
  interactions: InteractionId[];
}

export interface EditableMonster {
  defId: string;
  x: number;
  y: number;
}

export interface EditablePlace {
  name: string;
  rect: Rect;
}

export interface EditableTransition {
  x: number;
  y: number;
  toSpace: string;
}

export interface NpcJson {
  id: string;
  name: string;
  x: number;
  y: number;
  dialogue: string[];
  fg?: string;
  interactions?: InteractionId[];
}

/** world.json: everything about the world except its cells (those live in chunk files). */
export interface WorldMetaJSON {
  kind: 'chunked';
  id: string;
  name: string;
  playerStart?: Point;
  npcs: NpcJson[];
  monsters?: Array<{ defId: string; x: number; y: number }>;
  transitions: Array<{ x: number; y: number; toSpace: string }>;
  places?: Array<{ name: string; rect: Rect }>;
}

/** A flat space file (an extra floor of a building): the pre-chunk `SpaceJSON` shape. */
export interface FlatSpaceJSON {
  id: string;
  name: string;
  indoor: boolean;
  worldOrigin: Point;
  width: number;
  height: number;
  tiles: string[];
  heights: number[];
  npcs: NpcJson[];
  monsters?: Array<{ defId: string; x: number; y: number }>;
  transitions: Array<{ x: number; y: number; toSpace: string }>;
  places?: Array<{ name: string; rect: Rect }>;
  playerStart?: Point;
  building?: string;
  floor?: number;
}

export type ExpandSide = 'N' | 'S' | 'E' | 'W';
export type ExpandFill = 'ground' | 'rock' | 'void';

/** Flood fills stop here: void is infinite, so an unbounded fill would never finish. */
export const FILL_CAP = 20_000;

interface CellDelta {
  x: number;
  y: number;
  oldTile: number;
  oldHeight: number;
}

interface Stroke {
  cells: CellDelta[];
  seen: Set<string>;
  addedChunks: Chunk[];
  removedChunks: Chunk[];
  npcs: EditableNpc[];
  monsters: EditableMonster[];
  transitions: EditableTransition[];
  places: EditablePlace[];
  playerStart: Point | undefined;
}

export interface SavePlan {
  /** Chunk files to write (dirty or new, and not entirely void). */
  writes: Array<{ cx: number; cy: number; text: string }>;
  /** Chunk files to remove: removed from the doc, or now entirely void. */
  deletes: Array<{ cx: number; cy: number }>;
  /** world.json text (null for a flat doc). */
  metaText: string | null;
  /** The whole file for a flat doc (null for the world). */
  flatText: string | null;
}

function copyNpc(n: EditableNpc): EditableNpc {
  return { ...n, dialogue: [...n.dialogue], interactions: [...n.interactions] };
}

function npcFromJson(n: NpcJson): EditableNpc {
  return { ...n, dialogue: [...n.dialogue], interactions: n.interactions ? [...n.interactions] : ['talk'] };
}

/** Writes `interactions` only when it differs from the default, keeping files that never used it unchanged. */
function npcToJson(n: EditableNpc): NpcJson {
  // Explicit key order (matches the hand-authored files) so a no-op save produces no diff.
  const custom = n.interactions.length !== 1 || n.interactions[0] !== 'talk';
  return {
    id: n.id,
    name: n.name,
    x: n.x,
    y: n.y,
    ...(n.fg !== undefined ? { fg: n.fg } : {}),
    ...(custom ? { interactions: [...n.interactions] } : {}),
    dialogue: [...n.dialogue],
  };
}

function copyPlaces(places: readonly EditablePlace[]): EditablePlace[] {
  return places.map((p) => ({ name: p.name, rect: { ...p.rect } }));
}

/** Deep enough to be useful; each entry is only the cells a stroke changed, so this is cheap. */
const MAX_UNDO = 200;

function chunkIsVoid(chunk: Chunk): boolean {
  return chunk.tiles.every((t) => t === VOID_TILE);
}

export class MapDocument {
  readonly kind: 'world' | 'flat';
  id: string;
  name: string;
  readonly map: TileMap;
  npcs: EditableNpc[];
  monsters: EditableMonster[];
  transitions: EditableTransition[];
  places: EditablePlace[];
  playerStart: Point | undefined;
  /** Flat spaces only: metadata carried through untouched so a save never drops it. */
  readonly flatExtras: { indoor: boolean; building: string | undefined; floor: number | undefined };
  /** World only: whether the loaded file had a `places` key, so a no-op save keeps its shape. */
  private readonly hadPlacesKey: boolean;
  /** Chunk files believed to exist on disk, keyed by chunkKey. */
  private readonly onDisk = new Map<number, { cx: number; cy: number }>();
  private readonly undoStack: Stroke[] = [];

  private constructor(
    kind: 'world' | 'flat',
    map: TileMap,
    data: WorldMetaJSON | FlatSpaceJSON,
  ) {
    this.kind = kind;
    this.map = map;
    this.id = data.id;
    this.name = data.name;
    this.npcs = data.npcs.map(npcFromJson);
    this.monsters = (data.monsters ?? []).map((m) => ({ ...m }));
    this.transitions = data.transitions.map((t) => ({ ...t }));
    this.places = copyPlaces(data.places ?? []);
    this.playerStart = data.playerStart ? { ...data.playerStart } : undefined;
    this.hadPlacesKey = data.places !== undefined;
    const flat = kind === 'flat' ? (data as FlatSpaceJSON) : undefined;
    this.flatExtras = { indoor: flat?.indoor ?? false, building: flat?.building, floor: flat?.floor };
  }

  static fromWorld(meta: WorldMetaJSON, chunks: ChunkJSON[]): MapDocument {
    const map = new ChunkedMap();
    const doc = new MapDocument('world', map, meta);
    for (const json of chunks) {
      const chunk = decodeChunk(json);
      map.addChunk(chunk);
      doc.onDisk.set(chunkKey(chunk.cx, chunk.cy), { cx: chunk.cx, cy: chunk.cy });
    }
    return doc;
  }

  static fromFlat(data: FlatSpaceJSON): MapDocument {
    const expected = data.width * data.height;
    if (data.tiles.length !== expected || data.heights.length !== expected) {
      throw new Error(`Space "${data.id}": tiles/heights length does not match ${data.width}x${data.height}`);
    }
    const map = new FlatMap(
      data.width,
      data.height,
      data.worldOrigin,
      Uint8Array.from(data.tiles, (t) => tileIndex(t)),
      Uint8Array.from(data.heights),
    );
    return new MapDocument('flat', map, data);
  }

  // --- reading -------------------------------------------------------------------------------

  tileAt(x: number, y: number): string {
    return tileIdOf(this.map.getTile(x, y));
  }

  heightAt(x: number, y: number): number {
    return this.map.getHeight(x, y);
  }

  /** The chunked map, if this is the world. */
  chunked(): ChunkedMap | null {
    return this.map instanceof ChunkedMap ? this.map : null;
  }

  chunkCount(): number {
    return this.chunked()?.chunkList().length ?? 0;
  }

  // --- undo -----------------------------------------------------------------------------------

  /** Call once before a stroke, not per tile — an undo should take back the whole drag. */
  beginStroke(): void {
    this.undoStack.push({
      cells: [],
      seen: new Set(),
      addedChunks: [],
      removedChunks: [],
      npcs: this.npcs.map(copyNpc),
      monsters: this.monsters.map((m) => ({ ...m })),
      transitions: this.transitions.map((t) => ({ ...t })),
      places: copyPlaces(this.places),
      playerStart: this.playerStart ? { ...this.playerStart } : undefined,
    });
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
  }

  undo(): boolean {
    const stroke = this.undoStack.pop();
    if (!stroke) return false;
    for (let i = stroke.cells.length - 1; i >= 0; i--) {
      const c = stroke.cells[i]!;
      this.map.setTile(c.x, c.y, c.oldTile);
      this.map.setHeight(c.x, c.y, c.oldHeight);
    }
    const chunked = this.chunked();
    if (chunked) {
      for (const c of stroke.addedChunks) chunked.removeChunk(c.cx, c.cy);
      for (const c of stroke.removedChunks) {
        c.dirty = true;
        chunked.addChunk(c);
      }
    }
    this.npcs = stroke.npcs;
    this.monsters = stroke.monsters;
    this.transitions = stroke.transitions;
    this.places = stroke.places;
    this.playerStart = stroke.playerStart;
    return true;
  }

  private stroke(): Stroke {
    if (this.undoStack.length === 0) this.beginStroke();
    return this.undoStack[this.undoStack.length - 1]!;
  }

  /** Records a cell's old values the first time a stroke touches it. */
  private record(x: number, y: number): void {
    const s = this.stroke();
    const key = `${x},${y}`;
    if (s.seen.has(key)) return;
    s.seen.add(key);
    s.cells.push({ x, y, oldTile: this.map.getTile(x, y), oldHeight: this.map.getHeight(x, y) });
  }

  // --- tile painting ----------------------------------------------------------------------------

  /** Whether painting at (x, y) can do anything: the world grows on demand, a flat space does not. */
  canPaint(x: number, y: number): boolean {
    return this.kind === 'world' || this.map.has(x, y);
  }

  paintTile(x: number, y: number, tileId: string): boolean {
    if (!this.canPaint(x, y)) return false;
    const tile = tileIndex(tileId);
    if (this.map.getTile(x, y) === tile && (tile === VOID_TILE || this.map.has(x, y))) return false;
    this.record(x, y);
    this.map.setTile(x, y, tile);
    return true;
  }

  /** Bresenham, so a fast drag doesn't leave gaps between mousemove samples. */
  lineTile(from: Point, to: Point, tileId: string): void {
    let x = from.x;
    let y = from.y;
    const dx = Math.abs(to.x - x);
    const dy = -Math.abs(to.y - y);
    const stepX = x < to.x ? 1 : -1;
    const stepY = y < to.y ? 1 : -1;
    let error = dx + dy;

    for (;;) {
      this.paintTile(x, y, tileId);
      if (x === to.x && y === to.y) break;
      const doubled = 2 * error;
      if (doubled >= dy) {
        error += dy;
        x += stepX;
      }
      if (doubled <= dx) {
        error += dx;
        y += stepY;
      }
    }
  }

  /** A filled rectangle between two corners, in either order. */
  rectTile(from: Point, to: Point, tileId: string): void {
    const x0 = Math.min(from.x, to.x);
    const x1 = Math.max(from.x, to.x);
    const y0 = Math.min(from.y, to.y);
    const y1 = Math.max(from.y, to.y);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.paintTile(x, y, tileId);
  }

  /** Just the outline of a rectangle between two corners — the shape of a building's walls. */
  boxTile(from: Point, to: Point, tileId: string): void {
    const x0 = Math.min(from.x, to.x);
    const x1 = Math.max(from.x, to.x);
    const y0 = Math.min(from.y, to.y);
    const y1 = Math.max(from.y, to.y);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (x === x0 || x === x1 || y === y0 || y === y1) this.paintTile(x, y, tileId);
      }
    }
  }

  /**
   * Applies a building's patch (footprint tiles + named place, in world coordinates) as ONE undo
   * step. Heights under the footprint are reset to 0 so it is flat.
   */
  applyBuildingPatch(patch: BuildingPatch): void {
    this.beginStroke();
    for (const t of patch.tiles) {
      this.paintTile(t.x, t.y, t.id);
      this.setHeight(t.x, t.y, 0);
    }
    this.places.push({ name: patch.place.name, rect: { ...patch.place.rect } });
  }

  /**
   * Flood fill, 4-connected, from `from`. Void is infinite, so the flood is capped at `cap` cells;
   * `capped` tells the caller it stopped early.
   */
  fillTile(from: Point, tileId: string, cap = FILL_CAP): { filled: number; capped: boolean } {
    const target = this.map.getTile(from.x, from.y);
    const next = tileIndex(tileId);
    if (target === next || !this.canPaint(from.x, from.y)) return { filled: 0, capped: false };

    // Painting as we go makes the new tile the "visited" mark: a painted cell no longer reads
    // `target`, so it is never filled twice.
    let filled = 0;
    const stack: Point[] = [from];
    while (stack.length > 0) {
      const { x, y } = stack.pop()!;
      if (this.map.getTile(x, y) !== target || !this.canPaint(x, y)) continue;
      if (filled >= cap) return { filled, capped: true };
      this.paintTile(x, y, tileId);
      filled++;
      stack.push({ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 });
    }
    return { filled, capped: false };
  }

  // --- height painting --------------------------------------------------------------------------

  /** Paints an absolute height level (clamped 0..MAX_GROUND_HEIGHT). */
  setHeight(x: number, y: number, level: number): void {
    if (!this.canPaint(x, y)) return;
    const clamped = Math.max(0, Math.min(MAX_GROUND_HEIGHT, level));
    if (this.map.getHeight(x, y) === clamped) return;
    this.record(x, y);
    this.map.setHeight(x, y, clamped);
  }

  /** Raises (positive delta) or lowers (negative delta) height by one rung, clamped. */
  adjustHeight(x: number, y: number, delta: number): void {
    this.setHeight(x, y, this.heightAt(x, y) + delta);
  }

  // --- world size -------------------------------------------------------------------------------

  /** Bounds of the world in chunk coordinates, or null when it has no chunks. */
  chunkBounds(): { cx0: number; cy0: number; cx1: number; cy1: number } | null {
    const chunked = this.chunked();
    if (!chunked) return null;
    const list = chunked.chunkList();
    if (list.length === 0) return null;
    let cx0 = Infinity;
    let cy0 = Infinity;
    let cx1 = -Infinity;
    let cy1 = -Infinity;
    for (const c of list) {
      cx0 = Math.min(cx0, c.cx);
      cy0 = Math.min(cy0, c.cy);
      cx1 = Math.max(cx1, c.cx);
      cy1 = Math.max(cy1, c.cy);
    }
    return { cx0, cy0, cx1, cy1 };
  }

  /** Adds one empty chunk into the current stroke. False if it exists already or this isn't the world. */
  private addChunkInStroke(cx: number, cy: number, fill: ExpandFill): boolean {
    const chunked = this.chunked();
    if (!chunked || chunked.getChunk(cx, cy)) return false;
    const chunk = createChunk(cx, cy, fill === 'void' ? VOID_TILE : fill === 'rock' ? tileIndex('rock') : GROUND_TILE);
    chunk.dirty = true;
    chunked.addChunk(chunk);
    this.stroke().addedChunks.push(chunk);
    return true;
  }

  /** Adds one chunk (an undoable step). Returns false if it exists already or this isn't the world. */
  addChunk(cx: number, cy: number, fill: ExpandFill): boolean {
    const chunked = this.chunked();
    if (!chunked || chunked.getChunk(cx, cy)) return false;
    this.beginStroke();
    return this.addChunkInStroke(cx, cy, fill);
  }

  /** Adds one chunk-thick strip along a side of the current bounds (one undo step). Returns the chunks added. */
  expand(side: ExpandSide, fill: ExpandFill): Point[] {
    const b = this.chunkBounds();
    if (!b) return [];
    this.beginStroke();
    const coords: Point[] = [];
    if (side === 'N' || side === 'S') {
      const cy = side === 'N' ? b.cy0 - 1 : b.cy1 + 1;
      for (let cx = b.cx0; cx <= b.cx1; cx++) coords.push({ x: cx, y: cy });
    } else {
      const cx = side === 'W' ? b.cx0 - 1 : b.cx1 + 1;
      for (let cy = b.cy0; cy <= b.cy1; cy++) coords.push({ x: cx, y: cy });
    }
    return coords.filter((c) => this.addChunkInStroke(c.x, c.y, fill));
  }

  /** Removes a chunk from the doc (its file is deleted on save). Undoable. */
  removeChunk(cx: number, cy: number): boolean {
    const chunked = this.chunked();
    if (!chunked || !chunked.getChunk(cx, cy)) return false;
    this.beginStroke();
    const removed = chunked.removeChunk(cx, cy)!;
    this.stroke().removedChunks.push(removed);
    return true;
  }

  // --- save -------------------------------------------------------------------------------------

  /** Meta in the on-disk shape and key order of world.json, with a trailing newline. */
  metaText(): string {
    const meta: WorldMetaJSON = {
      kind: 'chunked',
      id: this.id,
      name: this.name,
      ...(this.playerStart ? { playerStart: { ...this.playerStart } } : {}),
      npcs: this.npcs.map(npcToJson),
      monsters: this.monsters.map((m) => ({ ...m })),
      transitions: this.transitions.map((t) => ({ ...t })),
      ...(this.places.length > 0 || this.hadPlacesKey ? { places: copyPlaces(this.places) } : {}),
    };
    return JSON.stringify(meta, null, 2) + '\n';
  }

  flatText(): string {
    const b = this.map.bounds();
    const tiles: string[] = [];
    const heights: number[] = [];
    for (let y = b.y; y < b.y + b.height; y++) {
      for (let x = b.x; x < b.x + b.width; x++) {
        tiles.push(this.tileAt(x, y));
        heights.push(this.heightAt(x, y));
      }
    }
    const json: FlatSpaceJSON = {
      id: this.id,
      name: this.name,
      indoor: this.flatExtras.indoor,
      worldOrigin: { x: b.x, y: b.y },
      width: b.width,
      height: b.height,
      tiles,
      heights,
      npcs: this.npcs.map(npcToJson),
      monsters: this.monsters.map((m) => ({ ...m })),
      transitions: this.transitions.map((t) => ({ ...t })),
    };
    if (this.places.length > 0) json.places = copyPlaces(this.places);
    if (this.playerStart) json.playerStart = { ...this.playerStart };
    if (this.flatExtras.building !== undefined) json.building = this.flatExtras.building;
    if (this.flatExtras.floor !== undefined) json.floor = this.flatExtras.floor;
    return JSON.stringify(json, null, 2) + '\n';
  }

  /** What a save has to do: only dirty chunks are written, vanished or all-void ones are deleted. */
  savePlan(): SavePlan {
    const chunked = this.chunked();
    if (!chunked) return { writes: [], deletes: [], metaText: null, flatText: this.flatText() };
    const writes: SavePlan['writes'] = [];
    const deletes: SavePlan['deletes'] = [];
    const present = new Set<number>();
    for (const chunk of chunked.chunkList()) {
      if (chunkIsVoid(chunk)) continue; // never written; deleted below if a file exists
      const key = chunkKey(chunk.cx, chunk.cy);
      present.add(key);
      if (chunk.dirty || !this.onDisk.has(key)) {
        writes.push({ cx: chunk.cx, cy: chunk.cy, text: chunkToText(encodeChunk(chunk)) });
      }
    }
    for (const [key, c] of this.onDisk) if (!present.has(key)) deletes.push({ ...c });
    return { writes, deletes, metaText: this.metaText(), flatText: null };
  }

  /** Call after the plan was written: clears dirty flags and forgets chunks that are gone. */
  commitSave(plan: SavePlan): void {
    const chunked = this.chunked();
    if (!chunked) return;
    for (const w of plan.writes) {
      const chunk = chunked.getChunk(w.cx, w.cy);
      if (chunk) chunk.dirty = false;
      this.onDisk.set(chunkKey(w.cx, w.cy), { cx: w.cx, cy: w.cy });
    }
    for (const d of plan.deletes) this.onDisk.delete(chunkKey(d.cx, d.cy));
    for (const chunk of chunked.chunkList()) {
      if (chunkIsVoid(chunk)) chunked.removeChunk(chunk.cx, chunk.cy);
    }
  }

  // --- npcs ---------------------------------------------------------------------------------

  npcAt(x: number, y: number): EditableNpc | undefined {
    return this.npcs.find((n) => n.x === x && n.y === y);
  }

  npcById(id: string): EditableNpc | undefined {
    return this.npcs.find((n) => n.id === id);
  }

  /** Adds a fresh NPC at (x, y) with a generated unique id, and returns it for the caller to select. */
  addNpc(x: number, y: number): EditableNpc {
    let n = 1;
    while (this.npcById(`npc-${n}`)) n++;
    const npc: EditableNpc = { id: `npc-${n}`, name: 'New NPC', x, y, dialogue: [''], interactions: ['talk'] };
    this.npcs.push(npc);
    return npc;
  }

  moveNpc(id: string, x: number, y: number): void {
    const npc = this.npcById(id);
    if (!npc) return;
    npc.x = x;
    npc.y = y;
  }

  updateNpc(id: string, patch: Partial<Omit<EditableNpc, 'id'>>): void {
    const npc = this.npcById(id);
    if (!npc) return;
    Object.assign(npc, patch);
  }

  removeNpc(id: string): void {
    this.npcs = this.npcs.filter((n) => n.id !== id);
  }

  // --- monsters ---------------------------------------------------------------------------------

  monsterAt(x: number, y: number): EditableMonster | undefined {
    return this.monsters.find((m) => m.x === x && m.y === y);
  }

  addMonster(defId: string, x: number, y: number): EditableMonster {
    const monster: EditableMonster = { defId, x, y };
    this.monsters.push(monster);
    return monster;
  }

  moveMonster(monster: EditableMonster, x: number, y: number): void {
    monster.x = x;
    monster.y = y;
  }

  updateMonster(monster: EditableMonster, patch: Partial<EditableMonster>): void {
    Object.assign(monster, patch);
  }

  removeMonster(monster: EditableMonster): void {
    this.monsters = this.monsters.filter((m) => m !== monster);
  }

  // --- places ------------------------------------------------------------------------------------

  /** Adds a named rectangle (undoable). */
  addPlace(name: string, rect: Rect): EditablePlace {
    this.beginStroke();
    const place: EditablePlace = { name, rect: { ...rect } };
    this.places.push(place);
    return place;
  }

  renamePlace(place: EditablePlace, name: string): void {
    place.name = name;
  }

  removePlace(place: EditablePlace): void {
    this.beginStroke();
    this.places = this.places.filter((p) => p !== place);
  }

  // --- transitions ----------------------------------------------------------------------------

  transitionAt(x: number, y: number): EditableTransition | undefined {
    return this.transitions.find((t) => t.x === x && t.y === y);
  }

  addTransition(x: number, y: number, toSpace = ''): EditableTransition {
    const transition: EditableTransition = { x, y, toSpace };
    this.transitions.push(transition);
    return transition;
  }

  moveTransition(transition: EditableTransition, x: number, y: number): void {
    transition.x = x;
    transition.y = y;
  }

  updateTransition(transition: EditableTransition, toSpace: string): void {
    transition.toSpace = toSpace;
  }

  removeTransition(transition: EditableTransition): void {
    this.transitions = this.transitions.filter((t) => t !== transition);
  }
}
