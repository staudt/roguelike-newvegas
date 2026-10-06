import type { Rect } from '../utils/geometry';

export interface Size {
  width: number;
  height: number;
}

export interface PlacementInput {
  /** The thing the menu belongs to (px, same coordinate space as the viewport). */
  anchor: Rect;
  /** Rects the menu must not cover (usually the anchor cell and the player cell). */
  avoid: Rect[];
  menu: Size;
  viewport: Size;
  /** Space left between the anchor and the menu, per axis (one cell). */
  gapX: number;
  gapY: number;
}

export interface Point2 {
  x: number;
  y: number;
}

/** Overlap area of two rects (0 when they only touch). */
export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function clampTo(pos: Point2, menu: Size, viewport: Size): Point2 {
  return {
    x: Math.max(0, Math.min(pos.x, viewport.width - menu.width)),
    y: Math.max(0, Math.min(pos.y, viewport.height - menu.height)),
  };
}

/**
 * Top-left pixel for a popup menu placed beside `anchor`: tries right, left, below, above (one
 * gap away), takes the first that lies wholly inside the viewport and covers none of `avoid`.
 * Failing that, the first candidate that covers nothing once clamped into the viewport; failing
 * that, whichever clamped candidate covers the least. Pure: no DOM.
 */
export function placeMenu(input: PlacementInput): Point2 {
  const { anchor, avoid, menu, viewport, gapX, gapY } = input;
  const candidates: Point2[] = [
    { x: anchor.x + anchor.width + gapX, y: anchor.y },
    { x: anchor.x - gapX - menu.width, y: anchor.y },
    { x: anchor.x, y: anchor.y + anchor.height + gapY },
    { x: anchor.x, y: anchor.y - gapY - menu.height },
  ];

  const covered = (pos: Point2): number =>
    avoid.reduce(
      (sum, r) => sum + overlapArea({ x: pos.x, y: pos.y, width: menu.width, height: menu.height }, r),
      0,
    );

  for (const c of candidates) {
    const inside =
      c.x >= 0 && c.y >= 0 && c.x + menu.width <= viewport.width && c.y + menu.height <= viewport.height;
    if (inside && covered(c) === 0) return c;
  }

  // Nothing fits as-is: slide candidates back into the viewport (this also lets a side candidate
  // shift vertically past an obstacle).
  let best: Point2 | null = null;
  let bestCover = Infinity;
  for (const c of candidates) {
    const clamped = clampTo(c, menu, viewport);
    const cover = covered(clamped);
    if (cover === 0) return clamped;
    if (cover < bestCover) {
      best = clamped;
      bestCover = cover;
    }
  }
  return best ?? clampTo(candidates[0]!, menu, viewport);
}
