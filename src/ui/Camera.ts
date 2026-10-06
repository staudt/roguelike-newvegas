import { MIN_VIEWPORT_COLS, MIN_VIEWPORT_ROWS } from '../config/constants';
import type { Point } from '../utils/geometry';

/**
 * Tracks which grid cell is shown in the viewport's top-left corner, plus pixel<->grid math.
 *
 * Unlike rogueout's Camera, cell width and height are independent (`cellW`/`cellH`) rather than
 * one shared `TILE_SIZE` — we want ordinary terminal proportions (a cell narrower than it is
 * tall), not glyphs stretched into square cells. The Renderer measures real font metrics each
 * resize and feeds them in via `setCellSize`; everything here stays pure arithmetic, which is
 * what keeps scroll/clamp/centre behaviour testable without a DOM.
 */
export class Camera {
  originX = 0;
  originY = 0;
  cols = MIN_VIEWPORT_COLS;
  rows = MIN_VIEWPORT_ROWS;
  cellW = 1;
  cellH = 1;

  resize(cols: number, rows: number): void {
    this.cols = Math.max(1, cols);
    this.rows = Math.max(1, rows);
  }

  setCellSize(cellW: number, cellH: number): void {
    this.cellW = Math.max(1, cellW);
    this.cellH = Math.max(1, cellH);
  }

  centerOn(focus: Point, mapWidth: number, mapHeight: number): void {
    this.originX = axisOrigin(focus.x, mapWidth, this.cols);
    this.originY = axisOrigin(focus.y, mapHeight, this.rows);
  }

  worldToScreen(x: number, y: number): Point {
    return { x: (x - this.originX) * this.cellW, y: (y - this.originY) * this.cellH };
  }

  screenToWorld(px: number, py: number): Point {
    return {
      x: Math.floor(px / this.cellW) + this.originX,
      y: Math.floor(py / this.cellH) + this.originY,
    };
  }
}

/**
 * Where one axis of the viewport starts, in world coordinates.
 *
 * Three cases: a map bigger than the viewport scrolls and clamps to its edges; a map smaller than
 * the viewport is centred by going *negative*, rather than pinning it to the top-left corner with
 * dead space beside it. Drawing then walks over out-of-bounds coordinates, which is safe — they
 * render as unexplored.
 */
function axisOrigin(focus: number, mapExtent: number, viewportExtent: number): number {
  if (mapExtent <= viewportExtent) return -Math.floor((viewportExtent - mapExtent) / 2);

  const centered = focus - Math.floor(viewportExtent / 2);
  return Math.max(0, Math.min(centered, mapExtent - viewportExtent));
}
