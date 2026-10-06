import { PALETTE } from '../config/palette';

const PADDING_X = 8;
const PADDING_Y = 6;
const LINE_HEIGHT = 16;
const MAX_WIDTH = 220;
const TAIL_HEIGHT = 6;
const FONT = '13px "Cascadia Mono", "DejaVu Sans Mono", Consolas, monospace';

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Draws a NetHack-style monologue bubble above a speaker, anchored at the top-center of their
 * cell. This is the one piece rogueout has no equivalent of — it only ever logs NPC speech.
 */
export function drawBalloon(
  ctx: CanvasRenderingContext2D,
  anchorX: number,
  anchorTopY: number,
  text: string,
): void {
  ctx.save();
  ctx.font = FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const lines = wrapText(ctx, text, MAX_WIDTH - PADDING_X * 2);
  const measuredWidth = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const width = Math.min(MAX_WIDTH, measuredWidth + PADDING_X * 2);
  const height = lines.length * LINE_HEIGHT + PADDING_Y * 2;

  const boxLeft = anchorX - width / 2;
  const boxBottom = anchorTopY - TAIL_HEIGHT;
  const boxTop = boxBottom - height;

  ctx.fillStyle = PALETTE.balloonBg;
  ctx.strokeStyle = PALETTE.balloonBorder;
  ctx.lineWidth = 1.5;
  roundRect(ctx, boxLeft, boxTop, width, height, 5);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(anchorX - 5, boxBottom);
  ctx.lineTo(anchorX + 5, boxBottom);
  ctx.lineTo(anchorX, boxBottom + TAIL_HEIGHT);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = PALETTE.balloonText;
  lines.forEach((line, i) => {
    ctx.fillText(line, boxLeft + PADDING_X, boxTop + PADDING_Y + (i + 1) * LINE_HEIGHT - 4);
  });

  ctx.restore();
}
