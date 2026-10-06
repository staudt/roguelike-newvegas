import { euclideanDistance, type Point } from '../utils/geometry';
import { inBounds, type MapGrid } from '../world/GameMap';
import { hasLineOfSight } from './LineOfSight';

/**
 * Which cells of `map` are visible from `origin` within `radius` tiles, Euclidean-limited and
 * height-aware (see LineOfSight). A dense Uint8Array over the whole grid, one entry per cell —
 * simple and plenty fast at Goodsprings-sized maps; a shadowcasting sweep can replace this later
 * without touching callers, since the signature is just "map + origin + radius -> visibility".
 */
export function computeVisible(map: MapGrid, origin: Point, radius: number): Uint8Array {
  const visible = new Uint8Array(map.width * map.height);
  const minX = Math.max(0, Math.floor(origin.x - radius));
  const maxX = Math.min(map.width - 1, Math.ceil(origin.x + radius));
  const minY = Math.max(0, Math.floor(origin.y - radius));
  const maxY = Math.min(map.height - 1, Math.ceil(origin.y + radius));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const point = { x, y };
      if (euclideanDistance(origin, point) > radius) continue;
      if (!hasLineOfSight(map, origin, point)) continue;
      visible[y * map.width + x] = 1;
    }
  }

  return visible;
}

export function isVisible(visible: Uint8Array, map: MapGrid, x: number, y: number): boolean {
  if (!inBounds(map, x, y)) return false;
  return visible[y * map.width + x] === 1;
}

/** OR's newly visible cells into the running explored set — once seen, remembered forever. */
export function markExplored(explored: Uint8Array, visible: Uint8Array): void {
  for (let i = 0; i < visible.length; i++) {
    if (visible[i]) explored[i] = 1;
  }
}
