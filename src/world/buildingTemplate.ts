import type { Point } from '../utils/geometry';
import type { SpaceJSON } from './MapLoader';
import { TILES } from './Tile';

/**
 * Pure geometry for "a building": a ring of wall tiles with floor inside and one (closed) door,
 * all in the one world map, plus a named place rectangle. No separate interior space.
 */
export type DoorSide = 'N' | 'S' | 'E' | 'W';

/** Outer footprint of the building on the world map, wall ring included. World coordinates. */
export interface BuildingRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MIN_BUILDING_W = 5;
export const MIN_BUILDING_H = 4;

export interface BuildingParams {
  name: string;
  rect: BuildingRect;
  doorSide: DoorSide;
  /** Cells along the door's side, counted from the rect's top (W/E) or left (N/S) edge. */
  doorOffset: number;
}

export interface BuildingPatch {
  /** Every cell of the footprint, in world coordinates. Heights under it are reset to 0. */
  tiles: Array<{ x: number; y: number; id: string }>;
  place: { name: string; rect: { x: number; y: number; width: number; height: number } };
}

/** Valid door offsets are 1..length-2 (never a corner). */
export function doorOffsetRange(rect: BuildingRect, side: DoorSide): { min: number; max: number } {
  const length = side === 'N' || side === 'S' ? rect.w : rect.h;
  return { min: 1, max: length - 2 };
}

export function defaultDoorOffset(rect: BuildingRect, side: DoorSide): number {
  const { min, max } = doorOffsetRange(rect, side);
  const length = side === 'N' || side === 'S' ? rect.w : rect.h;
  return Math.max(min, Math.min(max, Math.floor((length - 1) / 2)));
}

/** World coordinates of the door tile and of the cell just outside it. */
export function doorCells(rect: BuildingRect, side: DoorSide, offset: number): { door: Point; outside: Point } {
  switch (side) {
    case 'N':
      return { door: { x: rect.x + offset, y: rect.y }, outside: { x: rect.x + offset, y: rect.y - 1 } };
    case 'S':
      return {
        door: { x: rect.x + offset, y: rect.y + rect.h - 1 },
        outside: { x: rect.x + offset, y: rect.y + rect.h },
      };
    case 'W':
      return { door: { x: rect.x, y: rect.y + offset }, outside: { x: rect.x - 1, y: rect.y + offset } };
    case 'E':
      return {
        door: { x: rect.x + rect.w - 1, y: rect.y + offset },
        outside: { x: rect.x + rect.w, y: rect.y + offset },
      };
  }
}

/** Pure patch for the world map: wall ring, floor inside, one closed door, plus the named place. */
export function buildBuilding(params: BuildingParams): BuildingPatch {
  const { name, rect, doorSide, doorOffset } = params;
  if (rect.w < MIN_BUILDING_W || rect.h < MIN_BUILDING_H) {
    throw new Error(`Building must be at least ${MIN_BUILDING_W}x${MIN_BUILDING_H}, got ${rect.w}x${rect.h}`);
  }
  const range = doorOffsetRange(rect, doorSide);
  if (!Number.isInteger(doorOffset) || doorOffset < range.min || doorOffset > range.max) {
    throw new Error(`Door offset ${doorOffset} must be ${range.min}..${range.max} (not a corner)`);
  }

  const { door } = doorCells(rect, doorSide, doorOffset);
  const tiles: BuildingPatch['tiles'] = [];
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const onRing = x === rect.x || y === rect.y || x === rect.x + rect.w - 1 || y === rect.y + rect.h - 1;
      const isDoor = x === door.x && y === door.y;
      tiles.push({ x, y, id: isDoor ? 'door' : onRing ? 'wall' : 'floor' });
    }
  }
  return {
    tiles,
    place: { name: name.trim(), rect: { x: rect.x, y: rect.y, width: rect.w, height: rect.h } },
  };
}

/** Is the cell just outside the door somewhere a player can actually stand? */
export function outsideDoorWalkable(world: SpaceJSON, rect: BuildingRect, side: DoorSide, offset: number): boolean {
  const { outside } = doorCells(rect, side, offset);
  if (outside.x < 0 || outside.y < 0 || outside.x >= world.width || outside.y >= world.height) return false;
  const id = world.tiles[outside.y * world.width + outside.x];
  return id !== undefined && TILES[id]?.walkable === true;
}

/** Everything that makes a placement illegal, as human-readable messages (empty = fine). */
export function validateBuilding(world: SpaceJSON, params: BuildingParams): string[] {
  const errors: string[] = [];
  const { rect, doorSide, doorOffset } = params;

  if (params.name.trim() === '') errors.push('Name is required.');

  if (rect.w < MIN_BUILDING_W || rect.h < MIN_BUILDING_H) {
    errors.push(`Too small: ${rect.w}x${rect.h} (minimum ${MIN_BUILDING_W}x${MIN_BUILDING_H}).`);
    return errors;
  }
  if (rect.x < 1 || rect.y < 1 || rect.x + rect.w > world.width - 1 || rect.y + rect.h > world.height - 1) {
    errors.push('Building must lie inside the map and not cover its border.');
    return errors;
  }

  const range = doorOffsetRange(rect, doorSide);
  if (!Number.isInteger(doorOffset) || doorOffset < range.min || doorOffset > range.max) {
    errors.push(`Door position must be ${range.min}..${range.max} (the door cannot be on a corner).`);
  }

  const inRect = (p: Point): boolean =>
    p.x >= rect.x && p.y >= rect.y && p.x < rect.x + rect.w && p.y < rect.y + rect.h;
  for (const n of world.npcs) if (inRect(n)) errors.push(`Overlaps NPC "${n.name}" at (${n.x}, ${n.y}).`);
  for (const m of world.monsters ?? []) if (inRect(m)) errors.push(`Overlaps a ${m.defId} at (${m.x}, ${m.y}).`);
  if (world.playerStart && inRect(world.playerStart)) errors.push('Overlaps the player start.');
  for (const pl of world.places ?? []) {
    const r = pl.rect;
    if (rect.x < r.x + r.width && r.x < rect.x + rect.w && rect.y < r.y + r.height && r.y < rect.y + rect.h) {
      errors.push(`Overlaps the place "${pl.name}".`);
    }
  }
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const id = world.tiles[y * world.width + x];
      if (id === 'door' || id === 'openDoor') errors.push(`Overlaps an existing door at (${x}, ${y}).`);
    }
  }
  return errors;
}
