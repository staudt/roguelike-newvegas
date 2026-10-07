import { BASE_FONT_SIZE, FONT_FAMILY, LINE_HEIGHT_RATIO } from '../config/constants';
import { PALETTE } from '../config/palette';
import type { GameState, GroundItem, Space } from '../engine/GameState';
import { getActiveSpace } from '../engine/GameState';
import { rectContains, type Rect } from '../utils/geometry';
import { VOID_TILE, tileIdOf, visualFor } from '../world/Tile';
import { itemDef } from '../items/ItemData';
import { drawBalloon } from './Balloon';
import { Camera } from './Camera';
import { isConnectedWall, wallGlyph } from './WallGlyphs';

/** A transient glyph drawn above everything (a bullet in flight, a hit flash). */
export interface Tracer {
  x: number;
  y: number;
  glyph: string;
  fg: string;
}

/** How the creatures and the player looked at some moment, so an animation can play before the outcome shows. */
export interface SceneView {
  player: { x: number; y: number };
  creatures: Array<{ x: number; y: number; glyph: string; fg: string; hostile: boolean }>;
}

export function captureScene(state: GameState): SceneView {
  const space = getActiveSpace(state);
  return {
    player: { x: state.player.x, y: state.player.y },
    creatures: [...space.npcs, ...space.monsters].map((c) => ({
      x: c.x,
      y: c.y,
      glyph: c.glyph,
      fg: c.fg,
      hostile: c.hostile,
    })),
  };
}

export class Renderer {
  /** Set by the game while a shot animates; drawn last by render(). */
  tracer: Tracer | null = null;
  /** While set, creatures and the player are drawn as they were in this view, not as they are now. */
  scene: SceneView | null = null;
  readonly camera = new Camera();
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
  }

  /** Measures the viewport and font, resizes the canvas to an exact cell multiple. Returns
   * whether anything actually changed, so callers can skip a redundant render. */
  resize(): boolean {
    const parent = this.canvas.parentElement;
    const availW = parent?.clientWidth ?? 0;
    const availH = parent?.clientHeight ?? 0;

    this.ctx.font = `${BASE_FONT_SIZE}px ${FONT_FAMILY}`;
    const cellW = Math.max(1, Math.ceil(this.ctx.measureText('M').width));
    const cellH = Math.max(1, Math.ceil(BASE_FONT_SIZE * LINE_HEIGHT_RATIO));

    const cols = availW > 0 ? Math.max(1, Math.floor(availW / cellW)) : this.camera.cols;
    const rows = availH > 0 ? Math.max(1, Math.floor(availH / cellH)) : this.camera.rows;

    const changed =
      cols !== this.camera.cols ||
      rows !== this.camera.rows ||
      cellW !== this.camera.cellW ||
      cellH !== this.camera.cellH;
    if (!changed) return false;

    this.camera.resize(cols, rows);
    this.camera.setCellSize(cellW, cellH);

    const pixelW = cols * cellW;
    const pixelH = rows * cellH;
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(pixelW * ratio);
    this.canvas.height = Math.round(pixelH * ratio);
    this.canvas.style.width = `${pixelW}px`;
    this.canvas.style.height = `${pixelH}px`;

    // Resizing a canvas resets its drawing context — re-apply what render() relies on.
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.ctx.font = `${BASE_FONT_SIZE}px ${FONT_FAMILY}`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    return true;
  }

  /**
   * A world cell as a pixel rect in the canvas's offset parent (#viewport) — the same space the
   * menu overlay is positioned in. The canvas is centred in that parent, so its offset is added.
   * Uses the camera from the last render().
   */
  cellRect(worldX: number, worldY: number): Rect {
    const s = this.camera.worldToScreen(worldX, worldY);
    return {
      x: this.canvas.offsetLeft + s.x,
      y: this.canvas.offsetTop + s.y,
      width: this.camera.cellW,
      height: this.camera.cellH,
    };
  }

  render(state: GameState): void {
    const ctx = this.ctx;
    const space = getActiveSpace(state);
    this.camera.centerOn(this.scene?.player ?? state.player);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${BASE_FONT_SIZE}px ${FONT_FAMILY}`;

    ctx.fillStyle = PALETTE.unexplored;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const footprint: Rect | null = space.indoor ? space.grid.bounds() : null;

    for (let sy = 0; sy < this.camera.rows; sy++) {
      for (let sx = 0; sx < this.camera.cols; sx++) {
        const worldX = this.camera.originX + sx;
        const worldY = this.camera.originY + sy;

        // Seamless interiors: outside the building's footprint, there is nothing to see — the
        // outdoor world is deliberately not drawn while indoors, per the design goal of feeling
        // like you've stepped inside rather than crossed a loading screen.
        if (footprint && !rectContains(footprint, { x: worldX, y: worldY })) continue;

        const map = space.grid;
        if (!map.has(worldX, worldY)) continue;
        const tile = map.getTile(worldX, worldY);
        if (tile === VOID_TILE || !map.isExplored(worldX, worldY)) continue;

        this.drawTerrainCell(space, worldX, worldY, sx, sy, space.visible.has(worldX, worldY));
      }
    }

    for (const g of space.items) {
      if (!space.visible.has(g.x, g.y)) continue;
      if (topItemAt(space, g.x, g.y) !== g) continue;
      const def = itemDef(g.item.defId);
      const screen = this.camera.worldToScreen(g.x, g.y);
      this.drawGlyph(screen.x, screen.y, def.glyph, def.fg);
    }

    const creatures = this.scene?.creatures ?? [...space.npcs, ...space.monsters];
    for (const creature of creatures) {
      if (!space.visible.has(creature.x, creature.y)) continue;
      const screen = this.camera.worldToScreen(creature.x, creature.y);
      if (creature.hostile) this.drawHostileRing(screen.x, screen.y);
      this.drawGlyph(screen.x, screen.y, creature.glyph, creature.fg);
    }

    const playerAt = this.scene?.player ?? state.player;
    const playerScreen = this.camera.worldToScreen(playerAt.x, playerAt.y);
    this.drawGlyph(playerScreen.x, playerScreen.y, state.player.glyph, state.player.fg);

    if (this.tracer) {
      const screen = this.camera.worldToScreen(this.tracer.x, this.tracer.y);
      this.drawGlyph(screen.x, screen.y, this.tracer.glyph, this.tracer.fg);
    }

    for (const balloon of state.balloons) {
      const screen = this.camera.worldToScreen(balloon.x, balloon.y);
      drawBalloon(ctx, screen.x + this.camera.cellW / 2, screen.y, balloon.text);
    }
  }

  private drawTerrainCell(
    space: Space,
    worldX: number,
    worldY: number,
    sx: number,
    sy: number,
    visible: boolean,
  ): void {
    const grid = space.grid;
    const tileId = tileIdOf(grid.getTile(worldX, worldY));
    const height = grid.getHeight(worldX, worldY);
    const visual = visualFor(tileId, height);
    const glyph = isConnectedWall(tileId) ? wallGlyph(grid, worldX, worldY) : visual.glyph;

    const screenX = sx * this.camera.cellW;
    const screenY = sy * this.camera.cellH;

    this.ctx.fillStyle = visual.bg;
    this.ctx.fillRect(screenX, screenY, this.camera.cellW, this.camera.cellH);
    this.ctx.fillStyle = visual.fg;
    this.ctx.fillText(glyph, screenX + this.camera.cellW / 2, screenY + this.camera.cellH / 2);

    if (!visible) {
      this.ctx.fillStyle = PALETTE.rememberedOverlay;
      this.ctx.fillRect(screenX, screenY, this.camera.cellW, this.camera.cellH);
    }
  }

  /** A thin red ring marks anything that wants to fight you; peaceful things get none. */
  private drawHostileRing(screenX: number, screenY: number): void {
    const { cellW, cellH } = this.camera;
    this.ctx.strokeStyle = PALETTE.hostileRing;
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    this.ctx.ellipse(screenX + cellW / 2, screenY + cellH / 2, cellW / 2 - 0.5, cellH / 2 - 0.5, 0, 0, Math.PI * 2);
    this.ctx.stroke();
  }

  private drawGlyph(screenX: number, screenY: number, glyph: string, fg: string): void {
    this.ctx.fillStyle = fg;
    this.ctx.fillText(glyph, screenX + this.camera.cellW / 2, screenY + this.camera.cellH / 2);
  }
}

/** The item drawn for a cell: the last one dropped there. */
function topItemAt(space: Space, x: number, y: number): GroundItem | undefined {
  for (let i = space.items.length - 1; i >= 0; i--) {
    const g = space.items[i]!;
    if (g.x === x && g.y === y) return g;
  }
  return undefined;
}
