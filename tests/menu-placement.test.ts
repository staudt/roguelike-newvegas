import { describe, expect, it } from 'vitest';
import { overlapArea, placeMenu } from '../src/ui/menuPlacement';
import type { Rect } from '../src/utils/geometry';

const CELL = { width: 10, height: 20 };
const VIEWPORT = { width: 400, height: 300 };
const MENU = { width: 100, height: 60 };

function cell(cx: number, cy: number): Rect {
  return { x: cx * CELL.width, y: cy * CELL.height, ...CELL };
}

function place(anchor: Rect, avoid: Rect[], viewport = VIEWPORT, menu = MENU) {
  const pos = placeMenu({ anchor, avoid, menu, viewport, gapX: CELL.width, gapY: CELL.height });
  return { pos, rect: { ...pos, ...menu } as Rect };
}

describe('placeMenu', () => {
  it('prefers the right side, one cell away', () => {
    const anchor = cell(10, 5);
    const { pos } = place(anchor, [anchor]);
    expect(pos).toEqual({ x: anchor.x + anchor.width + CELL.width, y: anchor.y });
  });

  it('goes left when the right side does not fit', () => {
    const anchor = cell(36, 5);
    const { pos } = place(anchor, [anchor]);
    expect(pos.x).toBe(anchor.x - CELL.width - MENU.width);
  });

  it('never covers the anchor or the player', () => {
    const anchor = cell(10, 5);
    const player = cell(12, 5); // standing in the way on the right
    const { rect } = place(anchor, [anchor, player]);
    expect(overlapArea(rect, anchor)).toBe(0);
    expect(overlapArea(rect, player)).toBe(0);
  });

  it('falls back to below/above when both sides are blocked', () => {
    const viewport = { width: 120, height: 300 };
    const anchor = cell(5, 5);
    const { pos, rect } = place(anchor, [anchor], viewport);
    expect(overlapArea(rect, anchor)).toBe(0);
    expect(pos.y).toBe(anchor.y + anchor.height + CELL.height);
  });

  it('clamps into the viewport when nothing fits cleanly', () => {
    const viewport = { width: 100, height: 60 };
    const { pos } = place(cell(3, 1), [], viewport);
    expect(pos).toEqual({ x: 0, y: 0 });
  });

  it('keeps a menu inside the viewport near the bottom edge', () => {
    const anchor = cell(10, 14);
    const { rect } = place(anchor, [anchor]);
    expect(rect.y + rect.height).toBeLessThanOrEqual(VIEWPORT.height);
    expect(overlapArea(rect, anchor)).toBe(0);
  });
});
