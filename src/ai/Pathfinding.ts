import { PATH_NODE_BUDGET } from '../config/constants';
import { DIRECTION_VECTORS, type Point } from '../utils/geometry';
import { canStep, type MapGrid } from '../world/GameMap';

const NEIGHBOURS = Object.values(DIRECTION_VECTORS);

/**
 * First step of a shortest path from `from` to `to` over `grid` (local coordinates), honouring
 * the real movement rules (`canStep`, so height and barriers count). `blocked` marks cells that
 * can't be entered — other creatures, doors — except the goal itself, which is always allowed so a
 * hunter can path onto the cell its prey stands on. Returns null if there's no route within the
 * node budget (which also bounds the cost: this runs for every hunter every turn).
 */
export function nextStepToward(
  grid: MapGrid,
  from: Point,
  to: Point,
  blocked: (x: number, y: number) => boolean,
  budget: number = PATH_NODE_BUDGET,
): Point | null {
  if (from.x === to.x && from.y === to.y) return null;

  const key = (x: number, y: number): number => y * grid.width + x;
  const cameFrom = new Map<number, number>();
  const startKey = key(from.x, from.y);
  cameFrom.set(startKey, -1);

  const queue: Point[] = [from];
  let head = 0;
  let expanded = 0;

  while (head < queue.length && expanded < budget) {
    const current = queue[head++]!;
    expanded++;

    for (const v of NEIGHBOURS) {
      const next = { x: current.x + v.x, y: current.y + v.y };
      const nextKey = key(next.x, next.y);
      if (cameFrom.has(nextKey)) continue;

      const isGoal = next.x === to.x && next.y === to.y;
      if (!isGoal && blocked(next.x, next.y)) continue;
      if (!canStep(grid, current, next) && !isGoal) continue;

      cameFrom.set(nextKey, key(current.x, current.y));

      if (isGoal) {
        // Walk back to the cell right after `from`.
        let step = nextKey;
        for (;;) {
          const parent = cameFrom.get(step)!;
          if (parent === startKey) break;
          step = parent;
        }
        return { x: step % grid.width, y: Math.floor(step / grid.width) };
      }
      queue.push(next);
    }
  }

  return null;
}
