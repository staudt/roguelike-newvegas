import { PATH_NODE_BUDGET } from '../config/constants';
import { DIRECTION_VECTORS, type Point } from '../utils/geometry';
import { canStep, type MapGrid } from '../world/GameMap';

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

/**
 * First step of a shortest path from `from` to `to` over `grid` (world coordinates), honouring
 * the real movement rules (`canStep`, so height, barriers and the void edge count). `blocked` marks
 * cells that can't be entered — other creatures, doors — except the goal itself, which is always
 * allowed so a hunter can path onto the cell its prey stands on. Returns null if there's no route
 * within the node budget (which also bounds the cost: this runs for every hunter every turn).
 */
export function nextStepToward(
  grid: MapGrid,
  from: Point,
  to: Point,
  blocked: (x: number, y: number) => boolean,
  budget: number = PATH_NODE_BUDGET,
): Point | null {
  if (from.x === to.x && from.y === to.y) return null;

  const cameFrom = new Map<number, number>();
  const startKey = cellKey(from.x, from.y);
  cameFrom.set(startKey, -1);

  const queue: Point[] = [from];
  let head = 0;
  let expanded = 0;

  while (head < queue.length && expanded < budget) {
    const current = queue[head++]!;
    expanded++;

    for (const v of NEIGHBOURS) {
      const next = { x: current.x + v.x, y: current.y + v.y };
      const nextKey = cellKey(next.x, next.y);
      if (cameFrom.has(nextKey)) continue;

      const isGoal = next.x === to.x && next.y === to.y;
      if (!isGoal && blocked(next.x, next.y)) continue;
      if (!canStep(grid, current, next) && !isGoal) continue;

      cameFrom.set(nextKey, cellKey(current.x, current.y));

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
      queue.push(next);
    }
  }

  return null;
}
