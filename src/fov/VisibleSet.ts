/**
 * Which cells are visible this turn, as a small window around the viewer instead of a flag per
 * cell of the whole map (allocating and scanning a whole-world array every turn is what stops
 * scaling). Cells outside the window are simply not visible.
 */
export class VisibleSet {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
  private readonly data: Uint8Array;

  constructor(minX: number, minY: number, width: number, height: number) {
    this.minX = minX;
    this.minY = minY;
    this.width = Math.max(0, width);
    this.height = Math.max(0, height);
    this.data = new Uint8Array(this.width * this.height);
  }

  static empty(): VisibleSet {
    return new VisibleSet(0, 0, 0, 0);
  }

  has(x: number, y: number): boolean {
    const lx = x - this.minX;
    const ly = y - this.minY;
    if (lx < 0 || ly < 0 || lx >= this.width || ly >= this.height) return false;
    return this.data[ly * this.width + lx] === 1;
  }

  add(x: number, y: number): void {
    const lx = x - this.minX;
    const ly = y - this.minY;
    if (lx < 0 || ly < 0 || lx >= this.width || ly >= this.height) return;
    this.data[ly * this.width + lx] = 1;
  }

  /** Calls `fn` for every visible cell. */
  forEach(fn: (x: number, y: number) => void): void {
    for (let ly = 0; ly < this.height; ly++) {
      for (let lx = 0; lx < this.width; lx++) {
        if (this.data[ly * this.width + lx] === 1) fn(this.minX + lx, this.minY + ly);
      }
    }
  }
}
