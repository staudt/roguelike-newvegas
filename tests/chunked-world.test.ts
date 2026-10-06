import { describe, expect, it } from 'vitest';
import { runCreatureTurns } from '../src/ai/AIScheduler';
import { nextStepToward } from '../src/ai/Pathfinding';
import { SIM_RADIUS } from '../src/config/constants';
import { EventBus, type GameEvents } from '../src/engine/EventBus';
import { createGameState, type Space } from '../src/engine/GameState';
import { tryMovePlayer } from '../src/engine/TurnManager';
import { createMonster, type Monster } from '../src/entities/Monster';
import { createPlayer } from '../src/entities/Player';
import { hasLineOfSight } from '../src/fov/LineOfSight';
import { computeVisible, isVisible } from '../src/fov/Visibility';
import { VisibleSet } from '../src/fov/VisibleSet';
import { Camera } from '../src/ui/Camera';
import { CHUNK_SIZE, ChunkedMap, createChunk } from '../src/world/ChunkedMap';
import { canStep, getTileId, isOpaque, isWalkable, setHeight, setTileId } from '../src/world/GameMap';
import { GROUND_TILE } from '../src/world/Tile';

function groundChunks(map: ChunkedMap, coords: Array<[number, number]>): ChunkedMap {
  for (const [cx, cy] of coords) map.addChunk(createChunk(cx, cy, GROUND_TILE));
  return map;
}

function worldSpace(map: ChunkedMap, monsters: Monster[] = []): Space {
  return {
    id: 'w',
    name: 'W',
    indoor: false,
    grid: map,
    npcs: [],
    monsters,
    transitions: [],
    places: [],
    items: [],
    visible: VisibleSet.empty(),
  };
}

function play(map: ChunkedMap, player: { x: number; y: number }, monsters: Monster[] = []) {
  const space = worldSpace(map, monsters);
  const state = createGameState(createPlayer(player.x, player.y), { w: space }, 'w');
  return { state, space, events: new EventBus<GameEvents>() };
}

describe('across a chunk seam', () => {
  const map = groundChunks(new ChunkedMap(), [[0, 0], [1, 0]]);
  const seam = CHUNK_SIZE; // x=63 | x=64

  it('canStep and walking cross it, including the height rule', () => {
    expect(canStep(map, { x: seam - 1, y: 5 }, { x: seam, y: 5 })).toBe(true);
    setHeight(map, seam, 6, 3);
    expect(canStep(map, { x: seam - 1, y: 6 }, { x: seam, y: 6 })).toBe(false);

    const { state, events } = play(map, { x: seam - 1, y: 10 });
    expect(tryMovePlayer(state, 'E', events)).toBe(true);
    expect(state.player.x).toBe(seam);
  });

  it('line of sight is unbroken over it and blocked by a wall on the far side', () => {
    expect(hasLineOfSight(map, { x: seam - 5, y: 20 }, { x: seam + 5, y: 20 })).toBe(true);
    setTileId(map, seam + 2, 20, 'wall');
    expect(hasLineOfSight(map, { x: seam - 5, y: 20 }, { x: seam + 5, y: 20 })).toBe(false);
    expect(hasLineOfSight(map, { x: seam - 5, y: 20 }, { x: seam + 2, y: 20 })).toBe(true);
  });

  it('pathfinding steps over it and routes round a wall that spans it', () => {
    const step = nextStepToward(map, { x: seam - 3, y: 30 }, { x: seam + 3, y: 30 }, () => false);
    expect(step).toEqual({ x: seam - 2, y: 30 });
    for (let y = 28; y <= 32; y++) setTileId(map, seam, y, 'wall');
    const around = nextStepToward(map, { x: seam - 1, y: 30 }, { x: seam + 1, y: 30 }, () => false);
    expect(around).not.toBeNull();
    expect(around!.y).not.toBe(30);
  });
});

describe('at negative coordinates', () => {
  const map = groundChunks(new ChunkedMap(), [[-1, -1], [0, -1], [-1, 0], [0, 0]]);

  it('reads, steps, sees and paths exactly as in the positive quadrant', () => {
    expect(getTileId(map, -1, -1)).toBe('ground');
    expect(canStep(map, { x: -1, y: -1 }, { x: 0, y: 0 })).toBe(true);
    setTileId(map, -10, -10, 'wall');
    expect(isOpaque(map, -10, -10)).toBe(true);
    expect(hasLineOfSight(map, { x: -15, y: -10 }, { x: -5, y: -10 })).toBe(false);
    expect(nextStepToward(map, { x: -20, y: -20 }, { x: -18, y: -20 }, () => false)).toEqual({ x: -19, y: -20 });

    const visible = computeVisible(map, { x: -3, y: -3 }, 6);
    expect(isVisible(visible, map, -3, -3)).toBe(true);
    expect(isVisible(visible, map, 2, -3)).toBe(true);
    expect(isVisible(visible, map, 4, -3)).toBe(false);
  });
});

describe('visibility windows', () => {
  it('is bounded by the radius, not by the map', () => {
    const map = groundChunks(new ChunkedMap(), [[0, 0]]);
    const visible = computeVisible(map, { x: 30, y: 30 }, 10);
    expect(visible.width).toBeLessThanOrEqual(23);
    expect(visible.height).toBeLessThanOrEqual(23);
    let count = 0;
    visible.forEach(() => count++);
    expect(count).toBeGreaterThan(200);
    expect(visible.has(500, 500)).toBe(false);
  });

  it('is fast on a huge world with only one chunk loaded', () => {
    const map = groundChunks(new ChunkedMap(), [[0, 0]]);
    setTileId(map, 100000, 100000, 'wall'); // far away: the map is conceptually enormous
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) computeVisible(map, { x: 32, y: 32 }, 24);
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it('never shows cells that are not in the map', () => {
    const map = groundChunks(new ChunkedMap(), [[0, 0]]);
    const visible = computeVisible(map, { x: 2, y: 2 }, 10);
    expect(isVisible(visible, map, -1, 2)).toBe(false);
    expect(visible.has(-1, 2)).toBe(false);
  });
});

describe('the camera', () => {
  it('centres on the focus with no clamping to any map size', () => {
    const camera = new Camera();
    camera.resize(41, 25);
    camera.centerOn({ x: 0, y: 0 });
    expect(camera.originX).toBe(-20);
    expect(camera.originY).toBe(-12);
    camera.setCellSize(10, 20);
    camera.centerOn({ x: 5000, y: -7000 });
    expect(camera.worldToScreen(5000, -7000)).toEqual({ x: 20 * 10, y: 12 * 20 });
    expect(camera.screenToWorld(200, 240)).toEqual({ x: 5000, y: -7000 });
  });
});

describe('void is a hard stop', () => {
  const edge = () => groundChunks(new ChunkedMap(), [[0, 0]]);

  it('reads as void: unwalkable and opaque', () => {
    const map = edge();
    expect(getTileId(map, -1, 5)).toBe('void');
    expect(getTileId(map, 64, 5)).toBe('void');
    expect(isWalkable(map, -1, 5)).toBe(false);
    expect(isOpaque(map, 64, 5)).toBe(true);
    expect(canStep(map, { x: 0, y: 5 }, { x: -1, y: 5 })).toBe(false);
  });

  it('the player cannot walk off the map', () => {
    const { state, events } = play(edge(), { x: 0, y: 5 });
    expect(tryMovePlayer(state, 'W', events)).toBe(false);
    expect(state.player).toMatchObject({ x: 0, y: 5 });
    expect(state.turnCount).toBe(0);
  });

  it('a hunting creature cannot step off it, even straight at its prey beyond', () => {
    const map = edge();
    const gecko = createMonster('g', 'gecko', 0, 5);
    gecko.alerted = true;
    const { state, events } = play(map, { x: -3, y: 5 }, [gecko]);
    for (let i = 0; i < 5; i++) runCreatureTurns(state, () => 0.999, events);
    expect(gecko.x).toBeGreaterThanOrEqual(0);
    expect(nextStepToward(map, { x: 0, y: 5 }, { x: -3, y: 5 }, () => false)).toBeNull();
  });

  it('line of sight stops at the void', () => {
    const map = edge();
    expect(hasLineOfSight(map, { x: 5, y: 5 }, { x: -5, y: 5 })).toBe(false);
    expect(hasLineOfSight(map, { x: 5, y: 5 }, { x: 0, y: 5 })).toBe(true);
  });
});

describe('AI at scale', () => {
  const rng = () => 0.999;

  it('a creature outside SIM_RADIUS does not act and banks no energy', () => {
    const map = groundChunks(new ChunkedMap(), [[0, 0], [1, 0], [2, 0]]);
    const far = createMonster('far', 'gecko', SIM_RADIUS + 5, 5);
    far.alerted = true;
    const near = createMonster('near', 'gecko', 10, 5);
    near.alerted = true;
    far.awareness = near.awareness = 100;
    const { state, events } = play(map, { x: 0, y: 5 }, [far, near]);
    for (let i = 0; i < 2; i++) runCreatureTurns(state, rng, events);
    expect(far.x).toBe(SIM_RADIUS + 5);
    expect(far.energy).toBe(0);
    expect(near.x).toBeLessThan(10);
  });

  it('two creatures can never share a cell, nor step onto the player', () => {
    const map = groundChunks(new ChunkedMap(), [[0, 0]]);
    const a = createMonster('a', 'gecko', 10, 10);
    const b = createMonster('b', 'gecko', 10, 11);
    a.alerted = b.alerted = true;
    a.awareness = b.awareness = 50;
    const { state, events } = play(map, { x: 20, y: 10 }, [a, b]);
    for (let i = 0; i < 30; i++) {
      runCreatureTurns(state, rng, events);
      const cells = new Set([`${a.x},${a.y}`, `${b.x},${b.y}`, `${state.player.x},${state.player.y}`]);
      expect(cells.size).toBe(3);
    }
    expect(Math.max(a.x, b.x)).toBeGreaterThanOrEqual(18); // they did close in
  });

  it('one idle tick with 20,000 creatures spread over a big world stays cheap', () => {
    const map = new ChunkedMap();
    for (let cy = 0; cy < 10; cy++) for (let cx = 0; cx < 10; cx++) map.addChunk(createChunk(cx, cy, GROUND_TILE));
    const monsters: Monster[] = [];
    for (let i = 0; i < 20000; i++) {
      monsters.push(createMonster(`m${i}`, 'brahmin', (i * 7) % (10 * CHUNK_SIZE), Math.floor(i / 31) % (10 * CHUNK_SIZE)));
    }
    const { state, events } = play(map, { x: 320, y: 320 }, monsters);
    runCreatureTurns(state, rng, events); // warm up
    const t0 = performance.now();
    runCreatureTurns(state, rng, events);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
