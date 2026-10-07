import { linePoints, type Point } from '../utils/geometry';
import type { MapGrid } from '../world/GameMap';
import { baseGroundHeight, tileIsGround, tileIsOverlay, tileOpaque } from '../world/Tile';

/** Eyes (and gun barrels) sit this far above the ground you stand on: one rise is never cover. */
const EYE_HEIGHT = 1;

/** What you aim at or look at stands this far above its ground (a body, a face of terrain). */
const TARGET_HEIGHT = 1;

/** Walls stand this far above the ground beside them, so they read at any distance. */
const WALL_HEIGHT = 2;

function groundHeightAt(map: MapGrid, p: Point): number {
  const tile = map.getTile(p.x, p.y);
  if (tileIsGround(tile)) return map.getHeight(p.x, p.y);
  return tileIsOverlay(tile) ? baseGroundHeight(map.getHeight(p.x, p.y)) : 0;
}

/**
 * Height-aware line of sight between two cells on the same map grid.
 *
 * Walls, doors, and rock always block anything beyond them (you can see the wall's surface, not
 * through it). Open ground doesn't block outright — instead the sightline itself has a height,
 * linearly interpolated between the eye height at `from` (ground + EYE_HEIGHT) and the ground height at `to`. A cell of ground
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

  const fromHeight = groundHeightAt(map, from) + EYE_HEIGHT;
  // A wall has no ground height of its own; it stands on the terrain just before it on the line.
  const toHeight = tileOpaque(map.getTile(to.x, to.y))
    ? Math.max(groundHeightAt(map, to), groundHeightAt(map, points[steps - 1]!)) + WALL_HEIGHT
    : groundHeightAt(map, to) + TARGET_HEIGHT;

  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    const isEndpoint = i === points.length - 1;

    if (tileOpaque(map.getTile(p.x, p.y))) return isEndpoint;
    if (isEndpoint) continue;

    const sightlineHeight = fromHeight + (toHeight - fromHeight) * (i / steps);
    if (groundHeightAt(map, p) > sightlineHeight) return false;
  }

  return true;
}
