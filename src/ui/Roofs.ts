import { rectContains, type Point } from '../utils/geometry';
import type { Place, Space } from '../engine/GameState';

/**
 * Buildings are drawn from outside as a solid roof, not as black unknown. A cell is roofed when it
 * lies inside a named place you are not standing in, is not in view right now, and is not a wall or
 * door you have already seen (those keep drawing as walls, so the outline stays crisp). Stepping
 * inside lifts that building's roof; indoor spaces never have one.
 */
export function roofedPlaces(space: Space, player: Point): Place[] {
  if (space.indoor) return [];
  return space.places.filter((p) => !rectContains(p.rect, player));
}

export function isRoofed(
  places: readonly Place[],
  x: number,
  y: number,
  tileId: string,
  explored: boolean,
  visible: boolean,
): boolean {
  if (visible) return false;
  if (!places.some((p) => rectContains(p.rect, { x, y }))) return false;
  const solid = tileId === 'wall' || tileId === 'door';
  return !(solid && explored);
}
