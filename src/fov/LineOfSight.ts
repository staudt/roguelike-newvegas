import { linePoints, type Point } from '../utils/geometry';
import { getHeight, getTileId, isOpaque, type MapGrid } from '../world/GameMap';

function groundHeightAt(map: MapGrid, p: Point): number {
  return getTileId(map, p.x, p.y) === 'ground' ? getHeight(map, p.x, p.y) : 0;
}

/**
 * Height-aware line of sight between two cells on the same map grid.
 *
 * Walls, doors, and rock always block anything beyond them (you can see the wall's surface, not
 * through it). Open ground doesn't block outright — instead the sightline itself has a height,
 * linearly interpolated between the height at `from` and the height at `to`. A cell of ground
 * taller than the sightline at that point is cover: it blocks the shot/view, exactly like a hill
 * crest hiding what's behind it. Standing *on* a peak is not itself protection — only intervening
 * terrain between the two endpoints counts, which is what the plan calls for.
 *
 * This is the same function ranged combat will reuse for line-of-fire in a later milestone.
 */
export function hasLineOfSight(map: MapGrid, from: Point, to: Point): boolean {
  const points = linePoints(from, to);
  const steps = points.length - 1;
  if (steps <= 0) return true;

  const fromHeight = groundHeightAt(map, from);
  const toHeight = groundHeightAt(map, to);

  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    const isEndpoint = i === points.length - 1;

    if (isOpaque(map, p.x, p.y)) return isEndpoint;
    if (isEndpoint) continue;

    const sightlineHeight = fromHeight + (toHeight - fromHeight) * (i / steps);
    if (groundHeightAt(map, p) > sightlineHeight) return false;
  }

  return true;
}
