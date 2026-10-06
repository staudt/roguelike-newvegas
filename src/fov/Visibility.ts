import { euclideanDistance, type Point } from '../utils/geometry';
import type { MapGrid } from '../world/GameMap';
import { hasLineOfSight } from './LineOfSight';
import { VisibleSet } from './VisibleSet';

/**
 * Which cells of `map` are visible from `origin` within `radius` tiles, Euclidean-limited and
 * height-aware (see LineOfSight). Returns a window just big enough for the radius, so the cost
 * depends on the sight radius and never on the size of the world. Only cells that exist in the map
 * can be visible.
 */
export function computeVisible(map: MapGrid, origin: Point, radius: number): VisibleSet {
  const minX = Math.floor(origin.x - radius);
  const maxX = Math.ceil(origin.x + radius);
  const minY = Math.floor(origin.y - radius);
  const maxY = Math.ceil(origin.y + radius);
  const visible = new VisibleSet(minX, minY, maxX - minX + 1, maxY - minY + 1);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!map.has(x, y)) continue;
      const point = { x, y };
      if (euclideanDistance(origin, point) > radius) continue;
      if (!hasLineOfSight(map, origin, point)) continue;
      visible.add(x, y);
    }
  }

  return visible;
}

export function isVisible(visible: VisibleSet, map: MapGrid, x: number, y: number): boolean {
  return map.has(x, y) && visible.has(x, y);
}

/** Marks every newly visible cell as explored in the map — once seen, remembered. */
export function markExplored(map: MapGrid, visible: VisibleSet): void {
  visible.forEach((x, y) => map.markExplored(x, y));
}
