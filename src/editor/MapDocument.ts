import { MAX_GROUND_HEIGHT } from '../config/palette';
import type { Point } from '../utils/geometry';
import type { MapGrid } from '../world/GameMap';
import type { SpaceJSON } from '../world/MapLoader';

/**
 * The map editor's in-memory model of one space: the tile grid, the height grid, NPCs and
 * transitions, plus the paint/undo operations that mutate them.
 *
 * Deliberately DOM-free and dependency-free (besides the on-disk `SpaceJSON` shape it reads and
 * writes), mirroring rogueout's `PlanDocument` — the editing logic is testable without a browser,
 * and `main.ts` is only responsible for turning mouse/keyboard events into calls on this class.
 */
export interface EditableNpc {
  id: string;
  name: string;
  x: number;
  y: number;
  /** One or more lines; an NPC with several cycles through them one bump at a time in-game. */
  dialogue: string[];
  fg?: string;
}

export interface EditableTransition {
  x: number;
  y: number;
  toSpace: string;
}

interface Snapshot {
  tiles: string[];
  heights: number[];
  npcs: EditableNpc[];
  transitions: EditableTransition[];
  playerStart: Point | undefined;
}

/** Matches PlanDocument's cap: deep enough to be useful, shallow enough not to accumulate forever. */
const MAX_UNDO = 40;

export class MapDocument {
  id: string;
  name: string;
  indoor: boolean;
  worldOrigin: Point;
  readonly width: number;
  readonly height: number;
  npcs: EditableNpc[];
  transitions: EditableTransition[];
  playerStart: Point | undefined;

  private tiles: string[];
  /** Row-major, 0..MAX_GROUND_HEIGHT. Meaningful only where the tile is 'ground', same as GameMap. */
  private heights: number[];
  private readonly undoStack: Snapshot[] = [];

  constructor(data: SpaceJSON) {
    const expected = data.width * data.height;
    if (data.tiles.length !== expected) {
      throw new Error(
        `Space "${data.id}": tiles length ${data.tiles.length} does not match ${data.width}x${data.height}`,
      );
    }
    if (data.heights.length !== expected) {
      throw new Error(
        `Space "${data.id}": heights length ${data.heights.length} does not match ${data.width}x${data.height}`,
      );
    }

    this.id = data.id;
    this.name = data.name;
    this.indoor = data.indoor;
    this.worldOrigin = { ...data.worldOrigin };
    this.width = data.width;
    this.height = data.height;
    this.tiles = [...data.tiles];
    this.heights = [...data.heights];
    this.npcs = data.npcs.map((n) => ({ ...n, dialogue: [...n.dialogue] }));
    this.transitions = data.transitions.map((t) => ({ ...t }));
    this.playerStart = data.playerStart ? { ...data.playerStart } : undefined;
  }

  toJSON(): SpaceJSON {
    const json: SpaceJSON = {
      id: this.id,
      name: this.name,
      indoor: this.indoor,
      worldOrigin: { ...this.worldOrigin },
      width: this.width,
      height: this.height,
      tiles: [...this.tiles],
      heights: [...this.heights],
      npcs: this.npcs.map((n) => ({ ...n, dialogue: [...n.dialogue] })),
      transitions: this.transitions.map((t) => ({ ...t })),
    };
    if (this.playerStart) json.playerStart = { ...this.playerStart };
    return json;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  private index(x: number, y: number): number {
    return y * this.width + x;
  }

  tileAt(x: number, y: number): string {
    if (!this.inBounds(x, y)) return 'rock';
    return this.tiles[this.index(x, y)]!;
  }

  heightAt(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    return this.heights[this.index(x, y)]!;
  }

  /**
   * A snapshot in the runtime `MapGrid` shape, so the editor's canvas can reuse the game's own
   * `wallGlyph`/`getTileId` helpers for connected wall rendering instead of re-deriving them.
   */
  toGrid(): MapGrid {
    return { width: this.width, height: this.height, tiles: [...this.tiles], heights: Uint8Array.from(this.heights) };
  }

  // --- undo -----------------------------------------------------------------------------------

  /** Call once before a stroke, not per tile — an undo should take back the whole drag. */
  beginStroke(): void {
    this.undoStack.push({
      tiles: [...this.tiles],
      heights: [...this.heights],
      npcs: this.npcs.map((n) => ({ ...n, dialogue: [...n.dialogue] })),
      transitions: this.transitions.map((t) => ({ ...t })),
      playerStart: this.playerStart ? { ...this.playerStart } : undefined,
    });
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
  }

  undo(): boolean {
    const previous = this.undoStack.pop();
    if (!previous) return false;
    this.tiles = previous.tiles;
    this.heights = previous.heights;
    this.npcs = previous.npcs;
    this.transitions = previous.transitions;
    this.playerStart = previous.playerStart;
    return true;
  }

  // --- tile painting ----------------------------------------------------------------------------

  paintTile(x: number, y: number, tileId: string): void {
    if (!this.inBounds(x, y)) return;
    this.tiles[this.index(x, y)] = tileId;
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

  /** Flood fill, 4-connected. */
  fillTile(from: Point, tileId: string): void {
    const target = this.tileAt(from.x, from.y);
    if (target === tileId || !this.inBounds(from.x, from.y)) return;

    const stack: Point[] = [from];
    while (stack.length > 0) {
      const { x, y } = stack.pop()!;
      if (!this.inBounds(x, y) || this.tileAt(x, y) !== target) continue;
      this.paintTile(x, y, tileId);
      stack.push({ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 });
    }
  }

  // --- height painting --------------------------------------------------------------------------

  /** Paints an absolute height level (clamped 0..MAX_GROUND_HEIGHT). */
  setHeight(x: number, y: number, level: number): void {
    if (!this.inBounds(x, y)) return;
    this.heights[this.index(x, y)] = Math.max(0, Math.min(MAX_GROUND_HEIGHT, level));
  }

  /** Raises (positive delta) or lowers (negative delta) height by one rung, clamped. */
  adjustHeight(x: number, y: number, delta: number): void {
    this.setHeight(x, y, this.heightAt(x, y) + delta);
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
    const npc: EditableNpc = { id: `npc-${n}`, name: 'New NPC', x, y, dialogue: [''] };
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
