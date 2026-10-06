import type { Point } from '../utils/geometry';
import type { SpaceJSON } from './MapLoader';
import { TILES } from './Tile';

/**
 * Pure geometry for "a building": a hollow wall ring on the outdoor map (rock inside, one door) and
 * a separate indoor space whose grid also extends ONE tile past the door (the "vestibule") so the
 * exit transition has a cell to live in. See prospectorSaloon.json (east door) and
 * docMitchellsHouse.json (west door) for the hand-authored references this generalizes.
 */
export type DoorSide = 'N' | 'S' | 'E' | 'W';

/** Outer footprint of the building on the outdoor map, wall ring included. World coordinates. */
export interface BuildingRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MIN_BUILDING_W = 5;
export const MIN_BUILDING_H = 4;

export interface BuildingParams {
  id: string;
  name: string;
  rect: BuildingRect;
  doorSide: DoorSide;
  /** Cells along the door's side, counted from the rect's top (W/E) or left (N/S) edge. */
  doorOffset: number;
}

export interface BuildingResult {
  outdoorPatch: {
    tiles: Array<{ x: number; y: number; id: string }>;
    transition: { x: number; y: number; toSpace: string };
  };
  interior: SpaceJSON;
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

/** World coordinates of the door tile and of the cell just outside it (the interior's vestibule). */
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

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "goodsprings-general-store" -> "goodspringsGeneralStore.json" (matches the existing file naming). */
export function idToFileName(id: string): string {
  const camel = id.replace(/-+([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
  return `${camel}.json`;
}

export function buildBuilding(params: BuildingParams): BuildingResult {
  const { id, name, rect, doorSide, doorOffset } = params;
  if (rect.w < MIN_BUILDING_W || rect.h < MIN_BUILDING_H) {
    throw new Error(`Building must be at least ${MIN_BUILDING_W}x${MIN_BUILDING_H}, got ${rect.w}x${rect.h}`);
  }
  const range = doorOffsetRange(rect, doorSide);
  if (!Number.isInteger(doorOffset) || doorOffset < range.min || doorOffset > range.max) {
    throw new Error(`Door offset ${doorOffset} must be ${range.min}..${range.max} (not a corner)`);
  }

  const { door, outside } = doorCells(rect, doorSide, doorOffset);

  // Outdoor: hollow ring of wall, rock inside, door tile on the ring.
  const tiles: BuildingResult['outdoorPatch']['tiles'] = [];
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const onRing = x === rect.x || y === rect.y || x === rect.x + rect.w - 1 || y === rect.y + rect.h - 1;
      const isDoor = x === door.x && y === door.y;
      tiles.push({ x, y, id: isDoor ? 'door' : onRing ? 'wall' : 'rock' });
    }
  }

  // Interior: the footprint plus one extra row/column on the door side.
  const origin: Point = {
    x: doorSide === 'W' ? rect.x - 1 : rect.x,
    y: doorSide === 'N' ? rect.y - 1 : rect.y,
  };
  const width = rect.w + (doorSide === 'W' || doorSide === 'E' ? 1 : 0);
  const height = rect.h + (doorSide === 'N' || doorSide === 'S' ? 1 : 0);

  const interiorTiles: string[] = [];
  for (let ly = 0; ly < height; ly++) {
    for (let lx = 0; lx < width; lx++) {
      const wx = origin.x + lx;
      const wy = origin.y + ly;
      let tile: string;
      if (wx === outside.x && wy === outside.y) tile = 'ground';
      else if (wx === door.x && wy === door.y) tile = 'door';
      else if (wx < rect.x || wy < rect.y || wx >= rect.x + rect.w || wy >= rect.y + rect.h) tile = 'wall';
      else if (wx === rect.x || wy === rect.y || wx === rect.x + rect.w - 1 || wy === rect.y + rect.h - 1) tile = 'wall';
      else tile = 'floor';
      interiorTiles.push(tile);
    }
  }

  const interior: SpaceJSON = {
    id,
    name,
    indoor: true,
    worldOrigin: origin,
    width,
    height,
    tiles: interiorTiles,
    heights: new Array<number>(width * height).fill(0),
    npcs: [],
    monsters: [],
    transitions: [{ x: outside.x, y: outside.y, toSpace: 'world' }],
    building: id,
    floor: 0,
  };

  return {
    outdoorPatch: { tiles, transition: { x: door.x, y: door.y, toSpace: id } },
    interior,
  };
}

/** Is the cell just outside the door somewhere a player can actually stand? */
export function outsideDoorWalkable(world: SpaceJSON, rect: BuildingRect, side: DoorSide, offset: number): boolean {
  const { outside } = doorCells(rect, side, offset);
  if (outside.x < 0 || outside.y < 0 || outside.x >= world.width || outside.y >= world.height) return false;
  const id = world.tiles[outside.y * world.width + outside.x];
  return id !== undefined && TILES[id]?.walkable === true;
}

/**
 * Everything that makes a placement illegal, as human-readable messages (empty = fine).
 * `existingIds` are the ids of all spaces already on disk or pending.
 */
export function validateBuilding(world: SpaceJSON, existingIds: readonly string[], params: BuildingParams): string[] {
  const errors: string[] = [];
  const { rect, id, doorSide, doorOffset } = params;

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) errors.push('Id must be lowercase letters, digits and dashes.');
  else if (existingIds.includes(id)) errors.push(`A space with id "${id}" already exists.`);
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
  for (const t of world.transitions) if (inRect(t)) errors.push(`Overlaps an existing transition at (${t.x}, ${t.y}).`);
  for (const n of world.npcs) if (inRect(n)) errors.push(`Overlaps NPC "${n.name}" at (${n.x}, ${n.y}).`);
  for (const m of world.monsters ?? []) if (inRect(m)) errors.push(`Overlaps a ${m.defId} at (${m.x}, ${m.y}).`);
  if (world.playerStart && inRect(world.playerStart)) errors.push('Overlaps the player start.');
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (world.tiles[y * world.width + x] === 'door') errors.push(`Overlaps an existing door at (${x}, ${y}).`);
    }
  }
  return errors;
}
