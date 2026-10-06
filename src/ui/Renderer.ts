import { BASE_FONT_SIZE, FONT_FAMILY, LINE_HEIGHT_RATIO } from '../config/constants';
import { PALETTE } from '../config/palette';
import type { GameState, Space } from '../engine/GameState';
import { getActiveSpace, worldToLocal } from '../engine/GameState';
import { rectContains, type Rect } from '../utils/geometry';
import { inBounds } from '../world/GameMap';
import { visualFor } from '../world/Tile';
import { drawBalloon } from './Balloon';
import { Camera } from './Camera';
import { isConnectedWall, wallGlyph } from './WallGlyphs';

export class Renderer {
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
    this.camera.centerOn(state.player, space.grid.width, space.grid.height);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${BASE_FONT_SIZE}px ${FONT_FAMILY}`;

    ctx.fillStyle = PALETTE.unexplored;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const footprint: Rect | null = space.indoor
      ? { x: space.worldOrigin.x, y: space.worldOrigin.y, width: space.grid.width, height: space.grid.height }
      : null;

    for (let sy = 0; sy < this.camera.rows; sy++) {
      for (let sx = 0; sx < this.camera.cols; sx++) {
        const worldX = this.camera.originX + sx;
        const worldY = this.camera.originY + sy;

        // Seamless interiors: outside the building's footprint, there is nothing to see — the
        // outdoor world is deliberately not drawn while indoors, per the design goal of feeling
        // like you've stepped inside rather than crossed a loading screen.
        if (footprint && !rectContains(footprint, { x: worldX, y: worldY })) continue;

        const local = worldToLocal(space, { x: worldX, y: worldY });
        if (!inBounds(space.grid, local.x, local.y)) continue;

        const idx = local.y * space.grid.width + local.x;
        if (!space.explored[idx]) continue;

        this.drawTerrainCell(space, local.x, local.y, sx, sy, space.visible[idx] === 1);
      }
    }

    for (const creature of [...space.npcs, ...space.monsters]) {
      const local = worldToLocal(space, creature);
      if (!inBounds(space.grid, local.x, local.y)) continue;
      const idx = local.y * space.grid.width + local.x;
      if (!space.visible[idx]) continue;
      const screen = this.camera.worldToScreen(creature.x, creature.y);
      if (creature.hostile) this.drawHostileRing(screen.x, screen.y);
      this.drawGlyph(screen.x, screen.y, creature.glyph, creature.fg);
    }

    const playerScreen = this.camera.worldToScreen(state.player.x, state.player.y);
    this.drawGlyph(playerScreen.x, playerScreen.y, state.player.glyph, state.player.fg);

    for (const balloon of state.balloons) {
      const screen = this.camera.worldToScreen(balloon.x, balloon.y);
      drawBalloon(ctx, screen.x + this.camera.cellW / 2, screen.y, balloon.text);
    }
  }

  private drawTerrainCell(
    space: Space,
    localX: number,
    localY: number,
    sx: number,
    sy: number,
    visible: boolean,
  ): void {
    const grid = space.grid;
    const tileId = grid.tiles[localY * grid.width + localX]!;
    const height = grid.heights[localY * grid.width + localX] ?? 0;
    const visual = visualFor(tileId, height);
    const glyph = isConnectedWall(tileId) ? wallGlyph(grid, localX, localY) : visual.glyph;

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
