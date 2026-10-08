import { PATH_NODE_BUDGET } from '../config/constants';
import { DIRECTION_VECTORS, type Point } from '../utils/geometry';
import { canStep, type MapGrid } from '../world/GameMap';
import { tileOpenable } from '../world/Tile';

const NEIGHBOURS = Object.values(DIRECTION_VECTORS);

/** Coordinates pack into one number without knowing the map's size: offset so negatives work. */
const KEY_OFFSET = 1 << 24;
const KEY_STRIDE = 1 << 26;

export function cellKey(x: number, y: number): number {
  return (y + KEY_OFFSET) * KEY_STRIDE + (x + KEY_OFFSET);
}

function pointOf(k: number): Point {
  const x = (k % KEY_STRIDE) - KEY_OFFSET;
  const y = Math.floor(k / KEY_STRIDE) - KEY_OFFSET;
  return { x, y };
}

/** A cell waiting in the A* open list. `f` = steps so far + Chebyshev distance left. */
interface OpenNode {
  x: number;
  y: number;
  g: number;
  f: number;
  /** Insertion order: the last tie-break, so equal paths always resolve the same way. */
  seq: number;
}

/** Lower f first; on a tie the one nearer the goal (higher g), then the older. */
function before(a: OpenNode, b: OpenNode): boolean {
  if (a.f !== b.f) return a.f < b.f;
  if (a.g !== b.g) return a.g > b.g;
  return a.seq < b.seq;
}

/** A plain binary min-heap over `before`. */
class OpenList {
  private readonly items: OpenNode[] = [];

  get size(): number {
    return this.items.length;
  }

  push(node: OpenNode): void {
    const items = this.items;
    items.push(node);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(items[i]!, items[parent]!)) break;
      [items[i], items[parent]] = [items[parent]!, items[i]!];
      i = parent;
    }
  }

  pop(): OpenNode {
    const items = this.items;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let best = i;
        if (l < items.length && before(items[l]!, items[best]!)) best = l;
        if (r < items.length && before(items[r]!, items[best]!)) best = r;
        if (best === i) break;
        [items[i], items[best]] = [items[best]!, items[i]!];
        i = best;
      }
    }
    return top;
  }
}

/**
 * First step of a shortest path from `from` to `to` over `grid` (world coordinates), honouring
 * the real movement rules (`canStep`, so height, barriers and the void edge count). `blocked` marks
 * cells that can't be entered — other creatures, doors — except the goal itself, which is always
 * allowed so a hunter can path onto the cell its prey stands on. Returns null if there's no route
 * within the node budget (which also bounds the cost: this runs for every hunter every turn).
 * With `opensDoors` (people, not animals) a closed door counts as a way through: the walker opens it
 * when it gets there.
 *
 * A* with the Chebyshev distance as the estimate (exact on open ground, where every step costs one),
 * so in the open it expands little more than the path itself and the budget reaches far; it only
 * fans out where walls or cliffs are in the way.
 */
export function nextStepToward(
  grid: MapGrid,
  from: Point,
  to: Point,
  blocked: (x: number, y: number) => boolean,
  budget: number = PATH_NODE_BUDGET,
  opensDoors = false,
): Point | null {
  if (from.x === to.x && from.y === to.y) return null;

  const estimate = (x: number, y: number): number => Math.max(Math.abs(to.x - x), Math.abs(to.y - y));
  const cameFrom = new Map<number, number>();
  const bestG = new Map<number, number>();
  const startKey = cellKey(from.x, from.y);
  cameFrom.set(startKey, -1);
  bestG.set(startKey, 0);

  const open = new OpenList();
  let seq = 0;
  open.push({ x: from.x, y: from.y, g: 0, f: estimate(from.x, from.y), seq: seq++ });
  let expanded = 0;

  while (open.size > 0 && expanded < budget) {
    const current = open.pop();
    const currentKey = cellKey(current.x, current.y);
    if (current.g > bestG.get(currentKey)!) continue; // a stale entry: reached more cheaply since
    expanded++;

    for (const v of NEIGHBOURS) {
      const next = { x: current.x + v.x, y: current.y + v.y };
      const nextKey = cellKey(next.x, next.y);
      const g = current.g + 1;
      const known = bestG.get(nextKey);
      if (known !== undefined && known <= g) continue;

      const isGoal = next.x === to.x && next.y === to.y;
      if (!isGoal && blocked(next.x, next.y)) continue;
      const door = opensDoors && tileOpenable(grid.getTile(next.x, next.y));
      if (!door && !canStep(grid, current, next) && !isGoal) continue;

      cameFrom.set(nextKey, currentKey);
      bestG.set(nextKey, g);

      // Unit steps and a consistent estimate: the goal is first reached by a shortest path.
      if (isGoal) {
        // Walk back to the cell right after `from`.
        let step = nextKey;
        for (;;) {
          const parent = cameFrom.get(step)!;
          if (parent === startKey) break;
          step = parent;
        }
        return pointOf(step);
      }
      open.push({ x: next.x, y: next.y, g, f: g + estimate(next.x, next.y), seq: seq++ });
    }
  }

  return null;
}

/** Budget for the escape map: wide enough to see round a building, small enough to run per fleeing creature. */
const FLEE_NODE_BUDGET = 1500;
/** How much farther than 'merely far' a long way round counts. >1 lets runners trade a step toward the threat for an exit. */
const FLEE_DISTANCE_WEIGHT = 1.2;
const FLEE_RELAX_PASSES = 40;

/**
 * One step for a creature running from `threat`, using an escape map (the classic roguelike
 * 'safety map'): walk distances out from the threat, scale them by -1.2, then relax so every cell
 * also counts the cost of getting to somewhere safer. Walking downhill on that map goes round
 * obstacles to real distance instead of sticking to a wall, and will pass a little closer to the
 * threat to reach an exit rather than hide in a dead end. Returns null when no neighbour is any
 * safer (cornered). Cells the search never reached (behind a closed door, far off) count as safest.
 */
export function fleeStep(
  grid: MapGrid,
  from: Point,
  threat: Point,
  blocked: (x: number, y: number) => boolean,
  budget: number = FLEE_NODE_BUDGET,
): Point | null {
  const dist = new Map<number, number>();
  const cells: Point[] = [threat];
  dist.set(cellKey(threat.x, threat.y), 0);
  let maxDist = 0;
  for (let head = 0; head < cells.length && head < budget; head++) {
    const current = cells[head]!;
    const d = dist.get(cellKey(current.x, current.y))!;
    for (const v of NEIGHBOURS) {
      const next = { x: current.x + v.x, y: current.y + v.y };
      const key = cellKey(next.x, next.y);
      if (dist.has(key) || !canStep(grid, current, next)) continue;
      dist.set(key, d + 1);
      if (d + 1 > maxDist) maxDist = d + 1;
      cells.push(next);
    }
  }

  const safety = new Map<number, number>();
  for (const c of cells) {
    const key = cellKey(c.x, c.y);
    safety.set(key, -FLEE_DISTANCE_WEIGHT * dist.get(key)!);
  }
  const unseen = -FLEE_DISTANCE_WEIGHT * (maxDist + 1);
  const valueAt = (p: Point): number => safety.get(cellKey(p.x, p.y)) ?? unseen;

  for (let pass = 0; pass < FLEE_RELAX_PASSES; pass++) {
    let changed = false;
    for (const c of cells) {
      const key = cellKey(c.x, c.y);
      let best = safety.get(key)!;
      for (const v of NEIGHBOURS) {
        const n = { x: c.x + v.x, y: c.y + v.y };
        if (!canStep(grid, c, n)) continue;
        const through = valueAt(n) + 1;
        if (through < best) best = through;
      }
      if (best < safety.get(key)!) {
        safety.set(key, best);
        changed = true;
      }
    }
    if (!changed) break;
  }

  let bestStep: Point | null = null;
  let bestValue = valueAt(from);
  for (const v of NEIGHBOURS) {
    const p = { x: from.x + v.x, y: from.y + v.y };
    if (!canStep(grid, from, p) || blocked(p.x, p.y)) continue;
    const value = valueAt(p);
    if (value < bestValue) {
      bestValue = value;
      bestStep = p;
    }
  }
  return bestStep;
}

export interface PathSearch {
  /** Steps (excluding `start`) to the first cell that satisfies `isGoal`, or null if none was reached. */
  path: Point[] | null;
  /** Steps to the reached cell nearest `near` (squared distance, earliest found on a tie); empty if that is `start`. */
  nearest: Point[];
}

/**
 * Breadth-first search for a whole walk, for click-to-travel. `canMove` decides each single step
 * (so it can know about doors, creatures and what the player has explored). Also remembers the
 * visited cell closest to `near`, which is where to head when the goal itself can't be reached.
 * Bounded by `budget` expanded cells, so a huge world costs no more than a small one.
 */
export function searchPath(
  start: Point,
  isGoal: (p: Point) => boolean,
  canMove: (from: Point, to: Point) => boolean,
  near: Point,
  budget: number,
): PathSearch {
  const cameFrom = new Map<number, number>();
  const startKey = cellKey(start.x, start.y);
  cameFrom.set(startKey, -1);
  const sq = (p: Point): number => (p.x - near.x) ** 2 + (p.y - near.y) ** 2;

  const walkBack = (p: Point): Point[] => {
    const steps: Point[] = [];
    let key = cellKey(p.x, p.y);
    while (key !== startKey) {
      steps.push(pointOf(key));
      key = cameFrom.get(key)!;
    }
    return steps.reverse();
  };

  const queue: Point[] = [start];
  let nearestPoint = start;
  let nearestDist = sq(start);

  for (let head = 0, expanded = 0; head < queue.length && expanded < budget; head++, expanded++) {
    const current = queue[head]!;
    for (const v of NEIGHBOURS) {
      const next = { x: current.x + v.x, y: current.y + v.y };
      const key = cellKey(next.x, next.y);
      if (cameFrom.has(key) || !canMove(current, next)) continue;
      cameFrom.set(key, cellKey(current.x, current.y));
      if (isGoal(next)) return { path: walkBack(next), nearest: [] };
      const d = sq(next);
      if (d < nearestDist) {
        nearestDist = d;
        nearestPoint = next;
      }
      queue.push(next);
    }
  }

  return { path: null, nearest: nearestPoint === start ? [] : walkBack(nearestPoint) };
}
