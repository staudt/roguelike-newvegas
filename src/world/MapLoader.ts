import type { GroundItem, Place, Space } from '../engine/GameState';
import { createMonster } from '../entities/Monster';
import type { FactionId, Nerve, Temperament } from '../entities/Factions';
import { createNpc, type InteractionId, type NpcProfile } from '../entities/Npc';
import { npcProfile } from '../entities/NpcData';
import { addGroundItem } from '../engine/GroundItems';
import { GROUND_CONDITION } from '../config/constants';
import { rollCondition, setConditionPercent } from '../items/Condition';
import { createItem } from '../items/Item';
import type { RNG } from '../utils/RNG';
import { applyLoadout, loadoutOf, type LoadoutJSON } from '../items/Loadout';
import type { Point, Rect } from '../utils/geometry';
import { VisibleSet } from '../fov/VisibleSet';
import { ChunkedMap } from './ChunkedMap';
import { decodeChunk, type ChunkJSON } from './ChunkCodec';
import { FlatMap, decodeBases, encodeBases } from './FlatMap';
import { tileIdOf, tileIndex } from './Tile';

/**
 * On-disk shape of one FLAT space: a small fixed rectangle (a building's extra floor) with a flat
 * tile grid and a parallel height grid. `worldOrigin` is where its top-left cell sits in world
 * coordinates. The big outdoor world is not one of these: it is chunked (see WorldMetaJSON).
 */
export interface SpaceJSON {
  kind?: 'flat';
  id: string;
  name: string;
  indoor: boolean;
  worldOrigin: Point;
  width: number;
  height: number;
  /** Row-major tile ids, length width*height. */
  tiles: string[];
  /** Row-major terrain height 0..3, length width*height. Ignored for non-ground tiles. */
  heights: number[];
  /** Row-major tile each object stands on ('' for none), length width*height. Omitted means none. */
  bases?: string[];
  npcs: Array<LoadoutJSON & {
    id: string;
    name: string;
    x: number;
    y: number;
    dialogue: string[];
    fg?: string;
    /** Omitted means just 'talk'. More than one opens a menu on bump. */
    interactions?: InteractionId[];
    /** Optional overrides of the built-in profile (see NpcData). `kind` is a creature kind (see CreatureData). */
    kind?: string;
    faction?: FactionId;
    temperament?: Temperament;
    nerve?: Nerve;
  }>;
  /** Creatures placed from the monster table. Omitted means none. */
  monsters?: Array<LoadoutJSON & { defId: string; x: number; y: number }>;
  /**
   * Items lying on the floor. Omitted means none. Weapons and armor may give `condition` in percent;
   * otherwise they lie there used (GROUND_CONDITION).
   */
  items?: Array<{ defId: string; x: number; y: number; count?: number; condition?: number }>;
  transitions: Array<{ x: number; y: number; toSpace: string }>;
  /** Named rectangles (buildings, districts) shown as the Location. Omitted means none. */
  places?: Array<{ name: string; rect: Rect }>;
  /** Where the player starts out. Only meaningful on the space the game boots into ('world'). */
  playerStart?: Point;
  /** Groundwork for multi-floor buildings: which building this interior belongs to. Ignored by the loader for now. */
  building?: string;
  /** Floor index within `building` (0 = ground floor). Ignored by the loader for now. */
  floor?: number;
}

type EntityJSON = Pick<SpaceJSON, 'npcs' | 'monsters' | 'transitions' | 'places' | 'items'>;

/**
 * Creatures, NPCs and ground items from map data. `rng` rolls the condition of gear the map does
 * not pin down (carried and lying about, both used); without one everything is as new.
 */
function buildEntities(data: EntityJSON, rng?: RNG) {
  const npcs = data.npcs.map((n) => {
    const profile: NpcProfile = {
      ...npcProfile(n.id),
      ...(n.kind ? { kind: n.kind } : {}),
      ...(n.faction ? { faction: n.faction } : {}),
      ...(n.temperament ? { temperament: n.temperament } : {}),
      ...(n.nerve ? { nerve: n.nerve } : {}),
    };
    const npc = createNpc(n.id, n.name, n.x, n.y, n.dialogue, n.fg, n.interactions, profile);
    applyLoadout(npc, n, rng);
    return npc;
  });
  const monsters = (data.monsters ?? []).map((m, i) => {
    const monster = createMonster(`${m.defId}-${i + 1}`, m.defId, m.x, m.y);
    applyLoadout(monster, m, rng);
    return monster;
  });
  const space = { items: [] as GroundItem[] };
  for (const g of data.items ?? []) {
    const item = createItem(g.defId, g.count);
    if (g.condition !== undefined) setConditionPercent(item, g.condition);
    else if (rng) rollCondition(item, rng, GROUND_CONDITION);
    addGroundItem(space, g.x, g.y, item);
  }
  return {
    npcs,
    monsters,
    transitions: data.transitions.map((t) => ({ ...t })),
    places: (data.places ?? []).map((pl): Place => ({ name: pl.name, rect: { ...pl.rect } })),
    items: space.items,
  };
}

/**
 * On-disk shape of the chunked world's metadata (world.json next to a chunks/ folder of
 * `<cx>_<cy>.json` files): everything about the world except its cells.
 */
export interface WorldMetaJSON {
  kind: 'chunked';
  id: string;
  name: string;
  playerStart?: Point;
  npcs: SpaceJSON['npcs'];
  monsters?: SpaceJSON['monsters'];
  transitions: SpaceJSON['transitions'];
  places?: SpaceJSON['places'];
  items?: SpaceJSON['items'];
}

export function isWorldMeta(data: unknown): data is WorldMetaJSON {
  return typeof data === 'object' && data !== null && (data as { kind?: unknown }).kind === 'chunked';
}

/** Builds the outdoor world: an (initially) empty ChunkedMap filled from the given chunk files. */
export function loadWorld(meta: WorldMetaJSON, chunkJsons: ChunkJSON[], rng?: RNG): Space {
  const grid = new ChunkedMap();
  for (const json of chunkJsons) grid.addChunk(decodeChunk(json));
  return {
    id: meta.id,
    name: meta.name,
    indoor: false,
    grid,
    ...buildEntities(meta, rng),
    visible: VisibleSet.empty(),
  };
}

export function loadSpace(data: SpaceJSON, rng?: RNG): Space {
  const expected = data.width * data.height;
  if (data.tiles.length !== expected) {
    throw new Error(
      `Space "${data.id}": tiles length ${data.tiles.length} does not match ${data.width}x${data.height}`,
    );
  }
  if (data.heights.length !== expected) {
    throw new Error(
      `Space "${data.id}": heights length ${data.heights.length} does not match ${data.width}x${data.height}`,
    );
  }
  if (data.bases && data.bases.length !== expected) {
    throw new Error(
      `Space "${data.id}": bases length ${data.bases.length} does not match ${data.width}x${data.height}`,
    );
  }

  const grid = new FlatMap(
    data.width,
    data.height,
    data.worldOrigin ?? { x: 0, y: 0 },
    Uint8Array.from(data.tiles, (t) => tileIndex(t)),
    Uint8Array.from(data.heights),
    decodeBases(data.bases, expected),
  );

  return {
    id: data.id,
    name: data.name,
    indoor: data.indoor,
    grid,
    ...buildEntities(data, rng),
    visible: VisibleSet.empty(),
  };
}

/** The inverse of loadSpace, for flat spaces. */
export function serializeSpace(space: Space): SpaceJSON {
  const grid = space.grid;
  if (!(grid instanceof FlatMap)) throw new Error(`Space "${space.id}" is not flat and can't be saved as a SpaceJSON`);
  return {
    id: space.id,
    name: space.name,
    indoor: space.indoor,
    worldOrigin: { ...grid.origin },
    width: grid.width,
    height: grid.height,
    tiles: Array.from(grid.tiles, (t) => tileIdOf(t)),
    heights: Array.from(grid.heights),
    ...(grid.bases.some((b) => b !== 0) ? { bases: encodeBases(grid.bases) } : {}),
    npcs: space.npcs.map((n) => ({
      id: n.id,
      name: n.name,
      x: n.x,
      y: n.y,
      dialogue: [...n.dialogue],
      fg: n.fg,
      interactions: [...n.interactions],
      ...loadoutOf(n),
    })),
    monsters: space.monsters.map((m) => ({ defId: m.defId, x: m.x, y: m.y, ...loadoutOf(m) })),
    ...(space.items.length === 0 ? {} : { items: serializeItems(space) }),
    transitions: space.transitions.map((t) => ({ ...t })),
    places: space.places.map((pl) => ({ name: pl.name, rect: { ...pl.rect } })),
  };
}

function serializeItems(space: Space): NonNullable<SpaceJSON['items']> {
  return space.items.map((g) => ({
      defId: g.item.defId,
      x: g.x,
      y: g.y,
      ...(g.item.count !== undefined ? { count: g.item.count } : {}),
    }));
}
