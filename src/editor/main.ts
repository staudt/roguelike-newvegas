import { FONT_FAMILY, LINE_HEIGHT_RATIO } from '../config/constants';
import { GROUND_LEVELS, MAX_GROUND_HEIGHT, PALETTE } from '../config/palette';
import { linePoints, type Point } from '../utils/geometry';
import { CHUNK_SIZE } from '../world/ChunkedMap';
import type { ChunkJSON } from '../world/ChunkCodec';
import { TILES, VOID_TILE, tileIdOf, tileIndex, visualFor } from '../world/Tile';
import type { TileMap } from '../world/TileMap';
import {
  buildBuilding,
  defaultDoorOffset,
  doorCells,
  doorOffsetRange,
  MIN_BUILDING_H,
  MIN_BUILDING_W,
  outsideDoorWalkable,
  validateBuilding,
  type BuildingContext,
  type BuildingRect,
  type DoorSide,
} from '../world/buildingTemplate';
import { INTERACTION_LABELS, type InteractionId } from '../entities/Npc';
import { MONSTERS, monsterStartsHostile } from '../entities/MonsterData';
import { ITEMS, type ItemDef } from '../items/ItemData';
import {
  FILL_CAP,
  MapDocument,
  type EditableGroundItem,
  type EditableLoadout,
  type EditableMonster,
  type EditableNpc,
  type EditablePlace,
  type EditableTransition,
  type ExpandFill,
  type ExpandSide,
  type FlatSpaceJSON,
  type SavePlan,
  type WorldMetaJSON,
} from './MapDocument';

/**
 * The map editor.
 *
 * Edits the chunked world (world.json + chunks/ over the dev-only `/__world` route) or a flat
 * space file (over `/__map`). The canvas is only as big as the area you look through: it draws
 * the visible cells of the map, so the world can be arbitrarily large. Pan with the middle mouse
 * button, Space + drag, arrow keys or the wheel; zoom with +/- or Ctrl + wheel; the minimap
 * (bottom-right) shows the whole world and jumps on click.
 *
 * Deliberately a separate page from the game — see editor.html / vite.config.ts. It shares the
 * tile table, palette and on-disk JSON contract with the game, and nothing else.
 */

type MapFile = string;
/** The dropdown value for the chunked world; flat space files use their file name. */
const WORLD_FILE = 'world';
/** The pre-chunk flat world file; superseded by world.json + chunks and never offered for editing. */
const LEGACY_WORLD_FILE = 'worldMap.json';

interface SpaceEntry {
  file: MapFile;
  name: string;
}

const DEFAULT_CELL = 22;
const ZOOM_STEPS = [2, 4, 6, 10, 14, 18, 22, 28, 36];

type Mode = 'tile' | 'height' | 'npc' | 'monster' | 'item' | 'transition';
type TileTool = 'pencil' | 'line' | 'rect' | 'box' | 'building' | 'fill' | 'pick';
type HeightTool = 'raise' | 'lower' | 'set';

const PAINTABLE_TILES = ['ground', 'rock', 'wall', 'door', 'openDoor', 'floor', 'road', 'void'] as const;

const MINIMAP_MAX_W = 220;
const MINIMAP_MAX_H = 170;

/** Connected wall glyphs, the same table the game's WallGlyphs uses (bitmask N=1 S=2 W=4 E=8). */
const WALL_GLYPHS = ['─', '│', '│', '│', '─', '┘', '┐', '┤', '─', '└', '┌', '├', '─', '┴', '┬', '┼'];
const WALL_TILE = tileIndex('wall');

function wallGlyphAt(map: TileMap, x: number, y: number): string {
  let mask = 0;
  if (map.getTile(x, y - 1) === WALL_TILE) mask |= 1;
  if (map.getTile(x, y + 1) === WALL_TILE) mask |= 2;
  if (map.getTile(x - 1, y) === WALL_TILE) mask |= 4;
  if (map.getTile(x + 1, y) === WALL_TILE) mask |= 8;
  return WALL_GLYPHS[mask]!;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
  return (await response.json()) as T;
}

async function fetchWorld(): Promise<{ meta: WorldMetaJSON; chunks: ChunkJSON[] }> {
  const meta = await fetchJson<WorldMetaJSON>('/__world?meta=1');
  const list = await fetchJson<Array<{ cx: number; cy: number }>>('/__world?list=1');
  const chunks = await Promise.all(list.map((c) => fetchJson<ChunkJSON>(`/__world?chunk=${c.cx},${c.cy}`)));
  return { meta, chunks };
}

async function fetchSpaceList(): Promise<SpaceEntry[]> {
  let files: string[] = [];
  try {
    files = await fetchJson<string[]>('/__map?list=1');
  } catch {
    files = [];
  }
  const entries: SpaceEntry[] = [{ file: WORLD_FILE, name: 'World' }];
  const flat: SpaceEntry[] = [];
  for (const file of files) {
    if (file === LEGACY_WORLD_FILE || file === 'world.json') continue; // the world has its own entry
    try {
      const data = await fetchJson<FlatSpaceJSON>(`/__map?file=${file}`);
      flat.push({ file, name: data.name });
    } catch {
      flat.push({ file, name: file });
    }
  }
  flat.sort((a, b) => a.name.localeCompare(b.name));
  return [...entries, ...flat];
}

function readSavedView(): { file: string; camX: number; camY: number; cell: number } | null {
  try {
    const raw = sessionStorage.getItem('editorView');
    return raw ? (JSON.parse(raw) as { file: string; camX: number; camY: number; cell: number }) : null;
  } catch {
    return null;
  }
}

async function boot(): Promise<void> {
  // Assigned to fresh `const`s right after the null checks (rather than narrowing the original
  // bindings in place) so the non-null type is the binding's actual static type — that's what lets
  // the nested handler functions declared further down see them as non-null without re-deriving
  // the check; narrowing via `if` does not survive a function-body boundary like that.
  const rootOrNull = document.querySelector<HTMLDivElement>('#editor');
  if (!rootOrNull) throw new Error('#editor root missing from editor.html');
  const root = rootOrNull;
  root.innerHTML = LAYOUT;
  document.head.insertAdjacentHTML('beforeend', `<style>${STYLE}</style>`);

  const fileSelect = root.querySelector<HTMLSelectElement>('#file')!;
  const viewport = root.querySelector<HTMLElement>('#viewport')!;
  const canvas = root.querySelector<HTMLCanvasElement>('#map')!;
  const ctxOrNull = canvas.getContext('2d');
  if (!ctxOrNull) throw new Error('Canvas 2D context unavailable');
  const ctx = ctxOrNull;
  const minimap = root.querySelector<HTMLCanvasElement>('#minimap')!;
  const miniCtx = minimap.getContext('2d')!;
  const status = root.querySelector<HTMLSpanElement>('#status')!;
  const note = root.querySelector<HTMLSpanElement>('#note')!;
  const loadError = root.querySelector<HTMLDivElement>('#load-error')!;
  const paletteEl = root.querySelector<HTMLDivElement>('#palette')!;
  const sizeEl = root.querySelector<HTMLDivElement>('#size')!;
  const inspectorEl = root.querySelector<HTMLDivElement>('#inspector')!;
  const saveButton = root.querySelector<HTMLButtonElement>('#save')!;
  const chunksButton = root.querySelector<HTMLButtonElement>('#chunks')!;

  let currentFile: MapFile = WORLD_FILE;
  let doc: MapDocument | null = null;

  /** Cell height in px (the zoom step). Width follows from the font so cells match the game. */
  let cell = DEFAULT_CELL;
  let cellW = DEFAULT_CELL;
  let fontSpec = '';
  /** World coordinate (in cells, fractional) at the canvas's top-left corner. */
  let camX = 0;
  let camY = 0;
  let showChunks = true;
  /** The last cell the mouse was over, for "Add chunk at cursor" (the button click moves the mouse away). */
  let cursorCell: Point | null = null;
  let spaceDown = false;
  let panning: { startX: number; startY: number; camX: number; camY: number } | null = null;

  /** Where the mouse is during a line/rect/box drag, for the live outline. */
  let previewTo: Point | null = null;
  let dirty = false;
  let spaceEntries: SpaceEntry[] = [];
  let selectedPlace: EditablePlace | null = null;
  /** The rectangle dragged with the Building tool, awaiting its form. */
  let buildingRect: BuildingRect | null = null;
  let buildingForm = { name: '', side: 'S' as DoorSide, offset: 1 };
  let buildingMessage = '';
  let expandFill: ExpandFill = 'ground';
  let lastMetaText = '';

  let mode: Mode = 'tile';
  let tileTool: TileTool = 'pencil';
  let brushTile: string = 'ground';
  let heightTool: HeightTool = 'set';
  let heightLevel = 0;

  let selectedNpcId: string | null = null;
  let selectedTransition: EditableTransition | null = null;
  let selectedMonster: EditableMonster | null = null;
  let brushMonster: string = Object.keys(MONSTERS)[0]!;
  let selectedItem: EditableGroundItem | null = null;
  let brushItem: string = Object.keys(ITEMS)[0]!;
  /** Stack size for newly placed / carried ammo. */
  let brushCount = 12;

  let painting = false;
  let anchor: Point | null = null;
  /** Cells already touched this stroke — keeps raise/lower from double-applying on a slow drag. */
  let strokeVisited = new Set<string>();

  // --- small helpers -------------------------------------------------------------------------

  let noteTimer = 0;
  function say(message: string): void {
    note.textContent = message;
    window.clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => (note.textContent = ''), 8000);
  }

  function markDirty(): void {
    dirty = true;
    minimapStale = true;
    saveButton.textContent = 'Save •';
    saveButton.classList.add('unsaved');
    refreshSize();
  }

  // --- loading --------------------------------------------------------------------------------

  let loadSerial = 0;

  async function loadFile(file: MapFile): Promise<void> {
    const serial = ++loadSerial;
    try {
      let next: MapDocument;
      if (file === WORLD_FILE) {
        const { meta, chunks } = await fetchWorld();
        next = MapDocument.fromWorld(meta, chunks);
      } else {
        next = MapDocument.fromFlat(await fetchJson<FlatSpaceJSON>(`/__map?file=${file}`));
      }
      if (serial !== loadSerial) return; // a newer load superseded this one
      doc = next;
      lastMetaText = doc.kind === 'world' ? doc.metaText() : '';
      currentFile = file;
      fileSelect.value = file;
      history.replaceState(null, '', `#${file}`);
      dirty = false;
      minimapStale = true;
      selectedPlace = null;
      buildingRect = null;
      buildingMessage = '';
      selectedNpcId = null;
      selectedTransition = null;
      selectedMonster = null;
      selectedItem = null;
      loadError.textContent = '';
      loadError.className = '';
      saveButton.textContent = 'Save';
      saveButton.classList.remove('unsaved');
      resizeCanvas();
      const saved = readSavedView();
      if (saved && saved.file === file) {
        applyZoomStep(saved.cell);
        camX = saved.camX;
        camY = saved.camY;
      } else {
        fitToContent();
      }
      refreshPalette();
      refreshInspector();
      refreshSize();
      redraw();
    } catch (error) {
      loadError.textContent =
        `Could not load ${file} from the dev server (${error instanceof Error ? error.message : String(error)}). ` +
        `Run "npm run dev" and open this page from there to edit maps.`;
      loadError.className = 'bad';
    }
  }

  fileSelect.addEventListener('change', () => {
    if (dirty && !window.confirm('Discard unsaved changes and load the other map?')) {
      fileSelect.value = currentFile;
      return;
    }
    void loadFile(fileSelect.value as MapFile);
  });

  function renderFileOptions(): void {
    fileSelect.innerHTML = '';
    for (const entry of spaceEntries) {
      const option = document.createElement('option');
      option.value = entry.file;
      option.textContent = entry.file === WORLD_FILE ? `World (${doc?.kind === 'world' ? doc.name : 'Goodsprings'})` : entry.name;
      fileSelect.append(option);
    }
    fileSelect.value = currentFile;
  }

  async function refreshSpaceList(): Promise<void> {
    spaceEntries = await fetchSpaceList();
    renderFileOptions();
  }

  window.addEventListener('beforeunload', (event) => {
    if (dirty) event.preventDefault();
  });

  // --- view: size, zoom, camera -----------------------------------------------------------------

  function metricsFor(step: number): { width: number; font: string } {
    // Same proportions as the game: cell height = font size * LINE_HEIGHT_RATIO, cell width = the
    // font's real advance width.
    // Below the smallest readable font no glyphs are drawn, so the width just keeps the game's aspect.
    const fontSize = Math.max(6, Math.round(step / LINE_HEIGHT_RATIO));
    const font = `${fontSize}px ${FONT_FAMILY}`;
    ctx.font = font;
    const measured = Math.max(1, Math.ceil(ctx.measureText('M').width));
    return { width: step >= 10 ? measured : Math.max(1, Math.round((step * measured) / (fontSize * LINE_HEIGHT_RATIO))), font };
  }

  function applyZoomStep(step: number): void {
    cell = step;
    const m = metricsFor(step);
    cellW = m.width;
    fontSpec = m.font;
    root.querySelector('#zoom')!.textContent = `${cell}px`;
  }

  function resizeCanvas(): void {
    const w = Math.max(1, viewport.clientWidth);
    const h = Math.max(1, viewport.clientHeight);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  /** Zoom to `step`, keeping the world point under screen position (px, py) where it is. */
  function setZoom(step: number, px = canvas.width / 2, py = canvas.height / 2): void {
    if (step === cell) return;
    const wx = camX + px / cellW;
    const wy = camY + py / cell;
    applyZoomStep(step);
    camX = wx - px / cellW;
    camY = wy - py / cell;
    redraw();
  }

  function stepZoom(delta: number, px?: number, py?: number): void {
    const index = ZOOM_STEPS.indexOf(cell);
    const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + delta))];
    if (next !== undefined) setZoom(next, px, py);
  }

  /** Tight rectangle around every non-void cell (falls back to the map bounds). */
  function contentExtents(): { x: number; y: number; width: number; height: number } {
    if (!doc) return { x: 0, y: 0, width: 1, height: 1 };
    const b = doc.map.bounds();
    const chunked = doc.chunked();
    if (!chunked) return b;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const chunk of chunked.chunkList()) {
      for (let i = 0; i < chunk.tiles.length; i++) {
        if (chunk.tiles[i] === VOID_TILE) continue;
        const x = chunk.cx * CHUNK_SIZE + (i % CHUNK_SIZE);
        const y = chunk.cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (minX > maxX) return b.width > 0 ? b : { x: 0, y: 0, width: 40, height: 30 };
    return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  }

  /** Largest zoom at which the content fits, then centered. */
  function fitToContent(): void {
    const e = contentExtents();
    let chosen = ZOOM_STEPS[0]!;
    for (const step of ZOOM_STEPS) {
      const m = metricsFor(step);
      if ((e.width + 2) * m.width <= canvas.width && (e.height + 2) * step <= canvas.height) chosen = step;
    }
    applyZoomStep(chosen);
    camX = e.x + e.width / 2 - canvas.width / cellW / 2;
    camY = e.y + e.height / 2 - canvas.height / cell / 2;
  }

  function saveView(): void {
    try {
      sessionStorage.setItem('editorView', JSON.stringify({ file: currentFile, camX, camY, cell }));
    } catch {
      /* storage unavailable: the view just won't survive a reload */
    }
  }

  const resizeObserver = new ResizeObserver(() => {
    resizeCanvas();
    redraw();
  });
  resizeObserver.observe(viewport);

  // --- drawing ----------------------------------------------------------------------------------

  let frame = 0;
  function redraw(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      drawNow();
    });
  }

  const sx = (wx: number): number => (wx - camX) * cellW;
  const sy = (wy: number): number => (wy - camY) * cell;

  function drawNow(): void {
    if (!doc) return;
    saveView();
    ctx.fillStyle = PALETTE.unexplored;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = fontSpec;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const map = doc.map;
    const x0 = Math.floor(camX);
    const y0 = Math.floor(camY);
    const x1 = Math.ceil(camX + canvas.width / cellW);
    const y1 = Math.ceil(camY + canvas.height / cell);
    const text = cell >= 10;

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const tile = map.getTile(x, y);
        if (tile === VOID_TILE) continue; // already black
        const id = tileIdOf(tile);
        const visual = visualFor(id, map.getHeight(x, y), tileIdOf(map.getBase(x, y)));
        const px = (x - camX) * cellW;
        const py = (y - camY) * cell;
        ctx.fillStyle = visual.bg;
        ctx.fillRect(px, py, cellW, cell);
        if (!text) continue;
        ctx.fillStyle = visual.fg;
        ctx.fillText(id === 'wall' ? wallGlyphAt(map, x, y) : visual.glyph, px + cellW / 2, py + cell / 2);
      }
    }

    if (showChunks && doc.kind === 'world') drawChunkLines(x0, y0, x1, y1);
    drawOrigin();
    drawPlaces();
    for (const transition of doc.transitions) {
      drawMarker(transition.x, transition.y, '>', PALETTE.interactableFg, transition === selectedTransition);
    }
    drawItems();
    for (const monster of doc.monsters) {
      const def = MONSTERS[monster.defId];
      drawMarker(monster.x, monster.y, def?.glyph ?? '?', def?.fg ?? PALETTE.hostileRing, monster === selectedMonster);
      if (def && monsterStartsHostile(def)) drawRing(monster.x, monster.y);
    }
    for (const npc of doc.npcs) {
      drawMarker(npc.x, npc.y, '@', npc.fg ?? PALETTE.npcFg, npc.id === selectedNpcId);
    }
    if (doc.playerStart) drawMarker(doc.playerStart.x, doc.playerStart.y, '@', PALETTE.playerFg, false);

    drawShapePreview(x0, y0, x1, y1);
    if (cursorCell) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx(cursorCell.x) + 0.5, sy(cursorCell.y) + 0.5, cellW - 1, cell - 1);
    }
    drawMinimap();
  }

  /** Faint lines on chunk boundaries, and a stronger outline around chunks that actually exist. */
  function drawChunkLines(x0: number, y0: number, x1: number, y1: number): void {
    if (!doc) return;
    const chunked = doc.chunked();
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(120, 200, 255, 0.16)';
    ctx.beginPath();
    for (let x = Math.floor(x0 / CHUNK_SIZE) * CHUNK_SIZE; x <= x1; x += CHUNK_SIZE) {
      ctx.moveTo(Math.round(sx(x)) + 0.5, 0);
      ctx.lineTo(Math.round(sx(x)) + 0.5, canvas.height);
    }
    for (let y = Math.floor(y0 / CHUNK_SIZE) * CHUNK_SIZE; y <= y1; y += CHUNK_SIZE) {
      ctx.moveTo(0, Math.round(sy(y)) + 0.5);
      ctx.lineTo(canvas.width, Math.round(sy(y)) + 0.5);
    }
    ctx.stroke();
    if (chunked) {
      ctx.strokeStyle = 'rgba(120, 200, 255, 0.5)';
      ctx.setLineDash([6, 4]);
      for (const c of chunked.chunkList()) {
        const gx = c.cx * CHUNK_SIZE;
        const gy = c.cy * CHUNK_SIZE;
        if (gx > x1 || gy > y1 || gx + CHUNK_SIZE < x0 || gy + CHUNK_SIZE < y0) continue;
        ctx.strokeRect(sx(gx) + 0.5, sy(gy) + 0.5, CHUNK_SIZE * cellW - 1, CHUNK_SIZE * cell - 1);
        if (cell >= 10) {
          ctx.fillStyle = 'rgba(120, 200, 255, 0.55)';
          ctx.font = `${Math.max(9, Math.round(cell * 0.45))}px ${FONT_FAMILY}`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(`chunk ${c.cx},${c.cy}${c.dirty ? ' *' : ''}`, sx(gx) + 4, sy(gy) + 4);
        }
      }
    }
    ctx.restore();
  }

  /** The world origin: amber axis lines through (0, 0) and a small label. */
  function drawOrigin(): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 176, 0, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const ox = Math.round(sx(0)) + 0.5;
    const oy = Math.round(sy(0)) + 0.5;
    ctx.moveTo(ox, 0);
    ctx.lineTo(ox, canvas.height);
    ctx.moveTo(0, oy);
    ctx.lineTo(canvas.width, oy);
    ctx.stroke();
    ctx.fillStyle = PALETTE.uiAmber;
    ctx.font = `11px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('0,0', ox + 3, oy + 18);
    ctx.restore();
  }

  /** Faint dashed amber outline + name for each place, so the named rectangles are visible. */
  function drawPlaces(): void {
    if (!doc) return;
    ctx.save();
    for (const place of doc.places) {
      const r = place.rect;
      const selected = place === selectedPlace;
      ctx.strokeStyle = PALETTE.uiAmber;
      ctx.globalAlpha = selected ? 1 : 0.45;
      ctx.lineWidth = selected ? 2 : 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(sx(r.x) + 0.5, sy(r.y) + 0.5, r.width * cellW - 1, r.height * cell - 1);
      ctx.setLineDash([]);
      if (cell < 10) continue;
      ctx.fillStyle = PALETTE.uiAmber;
      ctx.font = `${Math.max(8, Math.round(cell * 0.45))}px ${FONT_FAMILY}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(place.name, sx(r.x) + 3, sy(r.y) + 3);
    }
    ctx.restore();
  }

  /** Draws one ghost cell (a tile about to be painted) with a green outline. */
  function drawGhost(x: number, y: number, tileId: string): void {
    const visual = visualFor(tileId, 0);
    const px = sx(x);
    const py = sy(y);
    ctx.fillStyle = tileId === 'void' ? '#1c1c1c' : visual.bg;
    ctx.fillRect(px, py, cellW, cell);
    if (cell >= 10) {
      ctx.fillStyle = visual.fg;
      ctx.fillText(visual.glyph, px + cellW / 2, py + cell / 2);
    }
    ctx.strokeStyle = PALETTE.uiGreen;
    ctx.strokeRect(px + 0.5, py + 0.5, cellW - 1, cell - 1);
  }

  /** Live outline of the line/rect/box being dragged, so you can see it before letting go. */
  function drawShapePreview(vx0: number, vy0: number, vx1: number, vy1: number): void {
    if (!doc || mode !== 'tile') return;
    if (tileTool === 'building') {
      const rect = painting && anchor && previewTo ? rectBetween(anchor, previewTo) : buildingRect;
      if (rect) drawBuildingPreview(rect, painting);
      return;
    }
    if (!painting || !anchor || !previewTo) return;
    if (tileTool !== 'line' && tileTool !== 'rect' && tileTool !== 'box') return;

    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1;
    if (tileTool === 'line') {
      for (const p of linePoints(anchor, previewTo)) {
        if (p.x >= vx0 && p.x < vx1 && p.y >= vy0 && p.y < vy1 && doc.canPaint(p.x, p.y)) drawGhost(p.x, p.y, brushTile);
      }
    } else {
      const r = rectBetween(anchor, previewTo);
      const gx0 = Math.max(r.x, vx0);
      const gx1 = Math.min(r.x + r.w - 1, vx1 - 1);
      const gy0 = Math.max(r.y, vy0);
      const gy1 = Math.min(r.y + r.h - 1, vy1 - 1);
      for (let y = gy0; y <= gy1; y++) {
        for (let x = gx0; x <= gx1; x++) {
          const edge = x === r.x || y === r.y || x === r.x + r.w - 1 || y === r.y + r.h - 1;
          if ((tileTool === 'rect' || edge) && doc.canPaint(x, y)) drawGhost(x, y, brushTile);
        }
      }
    }
    ctx.restore();
  }

  function rectBetween(a: Point, b: Point): BuildingRect {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
  }

  /** Ghost of the building ring (and door, once the form fixes it) plus an outline of the footprint. */
  function drawBuildingPreview(rect: BuildingRect, dragging: boolean): void {
    if (!doc) return;
    const big = rect.w >= MIN_BUILDING_W && rect.h >= MIN_BUILDING_H;
    ctx.save();
    ctx.globalAlpha = 0.75;
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const onRing = x === rect.x || y === rect.y || x === rect.x + rect.w - 1 || y === rect.y + rect.h - 1;
        if (!onRing) continue;
        const px = sx(x);
        const py = sy(y);
        if (px + cellW < 0 || py + cell < 0 || px > canvas.width || py > canvas.height) continue;
        const visual = visualFor('wall', 0, 'floor');
        ctx.fillStyle = visual.bg;
        ctx.fillRect(px, py, cellW, cell);
        ctx.fillStyle = visual.fg;
        ctx.fillText(visual.glyph, px + cellW / 2, py + cell / 2);
      }
    }
    if (!dragging && big) {
      const range = doorOffsetRange(rect, buildingForm.side);
      if (buildingForm.offset >= range.min && buildingForm.offset <= range.max) {
        const door = doorCells(rect, buildingForm.side, buildingForm.offset).door;
        const visual = visualFor('door', 0);
        ctx.fillStyle = visual.bg;
        ctx.fillRect(sx(door.x), sy(door.y), cellW, cell);
        ctx.fillStyle = visual.fg;
        ctx.fillText(visual.glyph, sx(door.x) + cellW / 2, sy(door.y) + cell / 2);
      }
    }
    ctx.strokeStyle = big ? PALETTE.uiGreen : PALETTE.hostileRing;
    ctx.lineWidth = 2;
    ctx.strokeRect(sx(rect.x) + 1, sy(rect.y) + 1, rect.w * cellW - 2, rect.h * cell - 2);
    ctx.restore();
  }

  /** Ground items: the top item of each cell, with a small "+" badge when more are stacked there. */
  function drawItems(): void {
    if (!doc) return;
    const byCell = new Map<string, EditableGroundItem[]>();
    for (const item of doc.items) {
      const key = `${item.x},${item.y}`;
      const list = byCell.get(key);
      if (list) list.push(item);
      else byCell.set(key, [item]);
    }
    for (const list of byCell.values()) {
      const top = list[list.length - 1]!;
      const def: ItemDef | undefined = ITEMS[top.defId];
      drawMarker(top.x, top.y, def?.glyph ?? '?', def?.fg ?? PALETTE.hostileRing, selectedItem !== null && list.includes(selectedItem));
      if (list.length > 1 && cell >= 10) {
        ctx.save();
        ctx.fillStyle = PALETTE.uiAmber;
        ctx.font = `bold ${Math.max(8, Math.round(cell * 0.45))}px ${FONT_FAMILY}`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText('+', sx(top.x) + cellW - 1, sy(top.y) + 1);
        ctx.restore();
      }
    }
  }

  /** Thin red ring marking a hostile monster (the selection box is a square, so the two read differently). */
  function drawRing(wx: number, wy: number): void {
    if (cell < 10) return;
    ctx.save();
    ctx.strokeStyle = PALETTE.hostileRing;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(sx(wx) + cellW / 2, sy(wy) + cell / 2, cellW / 2 - 1, cell / 2 - 1, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Markers (NPCs, monsters, transitions, player start) sit at WORLD coordinates. */
  function drawMarker(wx: number, wy: number, glyph: string, fg: string, selected: boolean): void {
    const px = sx(wx);
    const py = sy(wy);
    if (px + cellW < 0 || py + cell < 0 || px > canvas.width || py > canvas.height) return;
    ctx.fillStyle = fg;
    if (cell >= 10) ctx.fillText(glyph, px + cellW / 2, py + cell / 2);
    else ctx.fillRect(px, py, cellW, cell);
    if (selected) {
      ctx.save();
      ctx.strokeStyle = PALETTE.hostileRing;
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1, py + 1, cellW - 2, cell - 2);
      ctx.restore();
    }
  }

  // --- minimap ------------------------------------------------------------------------------------

  let minimapStale = true;
  const mini = { canvas: document.createElement('canvas'), x: 0, y: 0, scale: 1 };

  /**
   * Whole-world overview, one cached bitmap rebuilt lazily after edits. It samples one cell per
   * minimap pixel, so the cost depends on the minimap's size, never on the world's.
   */
  function rebuildMinimap(): void {
    if (!doc) return;
    const b = doc.map.bounds();
    if (b.width === 0 || b.height === 0) {
      mini.canvas.width = 1;
      mini.canvas.height = 1;
      mini.x = 0;
      mini.y = 0;
      mini.scale = 1;
      return;
    }
    const scale = Math.min(MINIMAP_MAX_W / b.width, MINIMAP_MAX_H / b.height, 4);
    const w = Math.max(1, Math.floor(b.width * scale));
    const h = Math.max(1, Math.floor(b.height * scale));
    mini.canvas.width = w;
    mini.canvas.height = h;
    mini.x = b.x;
    mini.y = b.y;
    mini.scale = scale;
    const m = mini.canvas.getContext('2d')!;
    m.fillStyle = '#000';
    m.fillRect(0, 0, w, h);
    const block = Math.max(1, Math.ceil(scale));
    const colors = new Map<number, string>();
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const wx = b.x + Math.floor((i + 0.5) / scale);
        const wy = b.y + Math.floor((j + 0.5) / scale);
        const tile = doc.map.getTile(wx, wy);
        if (tile === VOID_TILE) continue;
        const height = doc.map.getHeight(wx, wy);
        const base = doc.map.getBase(wx, wy);
        const key = (tile * 256 + base) * 16 + height;
        let color = colors.get(key);
        if (color === undefined) {
          color = visualFor(tileIdOf(tile), height, tileIdOf(base)).bg;
          // Walls and doors are dark on dark; lighten them so structures show on the overview.
          const id = tileIdOf(tile);
          if (id === 'wall') color = '#b0845a';
          else if (id === 'door' || id === 'openDoor') color = PALETTE.doorFg;
          else if (id === 'rock') color = '#5a5650';
          colors.set(key, color);
        }
        m.fillStyle = color;
        m.fillRect(i, j, scale >= 1 ? block : 1, scale >= 1 ? block : 1);
      }
    }
  }

  function drawMinimap(): void {
    if (!doc) return;
    if (minimapStale) {
      rebuildMinimap();
      minimapStale = false;
    }
    minimap.width = mini.canvas.width;
    minimap.height = mini.canvas.height;
    miniCtx.drawImage(mini.canvas, 0, 0);
    const vx = (camX - mini.x) * mini.scale;
    const vy = (camY - mini.y) * mini.scale;
    const vw = (canvas.width / cellW) * mini.scale;
    const vh = (canvas.height / cell) * mini.scale;
    miniCtx.strokeStyle = PALETTE.uiGreen;
    miniCtx.lineWidth = 1;
    miniCtx.strokeRect(Math.round(vx) + 0.5, Math.round(vy) + 0.5, Math.max(2, Math.round(vw)), Math.max(2, Math.round(vh)));
  }

  function jumpFromMinimap(event: MouseEvent): void {
    const box = minimap.getBoundingClientRect();
    const mx = ((event.clientX - box.left) / box.width) * minimap.width;
    const my = ((event.clientY - box.top) / box.height) * minimap.height;
    camX = mini.x + mx / mini.scale - canvas.width / cellW / 2;
    camY = mini.y + my / mini.scale - canvas.height / cell / 2;
    redraw();
  }
  let miniDragging = false;
  minimap.addEventListener('mousedown', (event) => {
    event.stopPropagation();
    miniDragging = true;
    jumpFromMinimap(event);
  });
  window.addEventListener('mousemove', (event) => {
    if (miniDragging) jumpFromMinimap(event);
  });
  window.addEventListener('mouseup', () => (miniDragging = false));

  // --- input: coordinates ------------------------------------------------------------------------

  function cellAt(event: MouseEvent): Point {
    const box = canvas.getBoundingClientRect();
    return {
      x: Math.floor(camX + (event.clientX - box.left) / cellW),
      y: Math.floor(camY + (event.clientY - box.top) / cell),
    };
  }

  function describeCell(at: Point): string {
    if (!doc) return '';
    const tile = doc.tileAt(at.x, at.y);
    const h = ['ground', 'road'].includes(doc.tileAt(at.x, at.y)) ? ` h${doc.heightAt(at.x, at.y)}` : '';
    const chunk = doc.kind === 'world' ? `   chunk ${at.x >> 6},${at.y >> 6}` : '';
    return `${at.x}, ${at.y}   ${tile}${h}${chunk}`;
  }

  // --- input: tile mode ---------------------------------------------------------------------------

  function handleTileMouseDown(at: Point): void {
    if (!doc) return;
    if (tileTool === 'pick') {
      brushTile = doc.tileAt(at.x, at.y);
      refreshPalette();
      return;
    }
    if (tileTool === 'building') {
      buildingRect = null;
      buildingMessage = '';
      painting = true;
      anchor = at;
      previewTo = at;
      refreshInspector();
      redraw();
      return;
    }
    doc.beginStroke();
    painting = true;
    anchor = at;
    if (tileTool === 'pencil') doc.paintTile(at.x, at.y, brushTile);
    if (tileTool === 'fill') {
      const result = doc.fillTile(at, brushTile);
      if (result.capped) say(`Fill stopped at ${FILL_CAP.toLocaleString()} cells (the area was too big or open).`);
      else say(`Filled ${result.filled.toLocaleString()} cells.`);
      painting = false;
      anchor = null;
    }
    redraw();
    markDirty();
  }

  function handleTileMouseMove(at: Point): void {
    if (!doc || !painting || !anchor) return;
    if (tileTool === 'line' || tileTool === 'rect' || tileTool === 'box' || tileTool === 'building') {
      previewTo = at;
      redraw();
      return;
    }
    if (tileTool !== 'pencil') return;
    doc.lineTile(anchor, at, brushTile);
    anchor = at;
    redraw();
    markDirty();
  }

  function handleTileMouseUp(at: Point): void {
    if (!doc || !painting || !anchor) return;
    if (tileTool === 'building') {
      previewTo = null;
      beginBuildingForm(rectBetween(anchor, at));
      return;
    }
    if (tileTool === 'line') doc.lineTile(anchor, at, brushTile);
    if (tileTool === 'rect') doc.rectTile(anchor, at, brushTile);
    if (tileTool === 'box') doc.boxTile(anchor, at, brushTile);
    previewTo = null;
    redraw();
    markDirty();
  }

  // --- input: height mode --------------------------------------------------------------------

  function applyHeightAt(x: number, y: number): void {
    if (!doc) return;
    const key = `${x},${y}`;
    if (heightTool !== 'set' && strokeVisited.has(key)) return;
    strokeVisited.add(key);
    if (heightTool === 'set') doc.setHeight(x, y, heightLevel);
    if (heightTool === 'raise') doc.adjustHeight(x, y, 1);
    if (heightTool === 'lower') doc.adjustHeight(x, y, -1);
  }

  function handleHeightMouseDown(at: Point): void {
    if (!doc) return;
    doc.beginStroke();
    painting = true;
    anchor = at;
    strokeVisited = new Set();
    applyHeightAt(at.x, at.y);
    redraw();
    markDirty();
  }

  function handleHeightMouseMove(at: Point): void {
    if (!doc || !painting || !anchor) return;
    for (const point of linePoints(anchor, at)) applyHeightAt(point.x, point.y);
    anchor = at;
    redraw();
    markDirty();
  }

  // --- input: npc mode -----------------------------------------------------------------------

  function handleNpcMouseDown(at: Point): void {
    if (!doc) return;
    doc.beginStroke();
    const existing = doc.npcAt(at.x, at.y);
    if (existing) {
      selectedNpcId = existing.id;
    } else {
      const created = doc.addNpc(at.x, at.y);
      selectedNpcId = created.id;
      markDirty();
    }
    painting = true;
    anchor = at;
    refreshInspector();
    redraw();
  }

  function handleNpcMouseMove(at: Point): void {
    if (!doc || !painting || !selectedNpcId || !anchor) return;
    if (at.x === anchor.x && at.y === anchor.y) return;
    if (doc.npcAt(at.x, at.y)) return; // another NPC already occupies that cell
    doc.moveNpc(selectedNpcId, at.x, at.y);
    anchor = at;
    redraw();
    markDirty();
  }

  // --- input: monster mode ----------------------------------------------------------------

  function handleMonsterMouseDown(at: Point): void {
    if (!doc) return;
    doc.beginStroke();
    const existing = doc.monsterAt(at.x, at.y);
    if (existing) {
      selectedMonster = existing;
    } else {
      selectedMonster = doc.addMonster(brushMonster, at.x, at.y);
      markDirty();
    }
    painting = true;
    anchor = at;
    refreshInspector();
    redraw();
  }

  function handleMonsterMouseMove(at: Point): void {
    if (!doc || !painting || !selectedMonster || !anchor) return;
    if (at.x === anchor.x && at.y === anchor.y) return;
    if (doc.monsterAt(at.x, at.y)) return;
    doc.moveMonster(selectedMonster, at.x, at.y);
    anchor = at;
    refreshInspector();
    redraw();
    markDirty();
  }

  // --- input: item mode ----------------------------------------------------------------

  /** Plain click selects the top item on the cell (or places the brush item on an empty one); Shift-click always places. */
  function handleItemMouseDown(at: Point, shift: boolean): void {
    if (!doc) return;
    doc.beginStroke();
    const here = doc.itemsAt(at.x, at.y);
    if (here.length > 0 && !shift) {
      selectedItem = here[here.length - 1]!;
    } else {
      selectedItem = doc.addItem(brushItem, at.x, at.y, newItemCount(brushItem));
      markDirty();
    }
    painting = true;
    anchor = at;
    refreshInspector();
    redraw();
  }

  function handleItemMouseMove(at: Point): void {
    if (!doc || !painting || !selectedItem || !anchor) return;
    if (at.x === anchor.x && at.y === anchor.y) return;
    doc.moveItem(selectedItem, at.x, at.y);
    anchor = at;
    refreshInspector();
    redraw();
    markDirty();
  }

  /** Ammo gets the Count field's value; everything else is a single item with no count key. */
  function newItemCount(defId: string): number | undefined {
    return ITEMS[defId]?.kind === 'ammo' ? brushCount : undefined;
  }

  // --- input: transition mode ------------------------------------------------------------------

  function handleTransitionMouseDown(at: Point): void {
    if (!doc) return;
    doc.beginStroke();
    const existing = doc.transitionAt(at.x, at.y);
    if (existing) {
      selectedTransition = existing;
    } else {
      selectedTransition = doc.addTransition(at.x, at.y);
      markDirty();
    }
    painting = true;
    anchor = at;
    refreshInspector();
    redraw();
  }

  function handleTransitionMouseMove(at: Point): void {
    if (!doc || !painting || !selectedTransition || !anchor) return;
    if (at.x === anchor.x && at.y === anchor.y) return;
    if (doc.transitionAt(at.x, at.y)) return;
    doc.moveTransition(selectedTransition, at.x, at.y);
    anchor = at;
    redraw();
    markDirty();
  }

  // --- input: wiring --------------------------------------------------------------------------

  function setPanCursor(): void {
    canvas.style.cursor = panning ? 'grabbing' : spaceDown ? 'grab' : 'crosshair';
  }

  canvas.addEventListener('mousedown', (event) => {
    if (!doc) return;
    if (event.button === 1 || (event.button === 0 && spaceDown)) {
      event.preventDefault();
      panning = { startX: event.clientX, startY: event.clientY, camX, camY };
      setPanCursor();
      return;
    }
    if (event.button !== 0) return;
    const at = cellAt(event);
    // Markers only go on cells that exist; tiles can be painted anywhere in the world (that is
    // how it grows), but never outside a flat space.
    if (mode === 'tile') handleTileMouseDown(at);
    if (mode === 'height') handleHeightMouseDown(at);
    if (!doc.map.has(at.x, at.y)) return;
    if (mode === 'npc') handleNpcMouseDown(at);
    if (mode === 'monster') handleMonsterMouseDown(at);
    if (mode === 'item') handleItemMouseDown(at, event.shiftKey);
    if (mode === 'transition') handleTransitionMouseDown(at);
  });

  canvas.addEventListener('mousemove', (event) => {
    if (!doc) return;
    const at = cellAt(event);
    if (!cursorCell || cursorCell.x !== at.x || cursorCell.y !== at.y) {
      cursorCell = at;
      status.textContent = describeCell(at);
      redraw();
    }
    if (panning) return;
    if (mode === 'tile') handleTileMouseMove(at);
    if (mode === 'height') handleHeightMouseMove(at);
    if (!doc.map.has(at.x, at.y)) return;
    if (mode === 'npc') handleNpcMouseMove(at);
    if (mode === 'monster') handleMonsterMouseMove(at);
    if (mode === 'item') handleItemMouseMove(at);
    if (mode === 'transition') handleTransitionMouseMove(at);
  });

  canvas.addEventListener('mouseleave', () => {
    cursorCell = null;
    redraw();
  });

  // Panning keeps tracking even when the pointer leaves the canvas.
  window.addEventListener('mousemove', (event) => {
    if (!panning) return;
    camX = panning.camX - (event.clientX - panning.startX) / cellW;
    camY = panning.camY - (event.clientY - panning.startY) / cell;
    redraw();
  });

  window.addEventListener('mouseup', (event) => {
    if (panning) {
      panning = null;
      setPanCursor();
      return;
    }
    if (!painting) return;
    if (doc && mode === 'tile') handleTileMouseUp(cellAt(event));
    painting = false;
    anchor = null;
    previewTo = null;
  });

  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const box = canvas.getBoundingClientRect();
      if (event.ctrlKey) {
        stepZoom(event.deltaY < 0 ? 1 : -1, event.clientX - box.left, event.clientY - box.top);
        return;
      }
      const dx = event.shiftKey ? event.deltaY : event.deltaX;
      const dy = event.shiftKey ? 0 : event.deltaY;
      camX += dx / cellW;
      camY += dy / cell;
      redraw();
    },
    { passive: false },
  );

  function undo(): void {
    if (!doc?.undo()) return;
    selectedPlace = null;
    buildingRect = null;
    selectedMonster = null;
    selectedItem = null;
    selectedTransition = null;
    refreshPalette();
    refreshInspector();
    markDirty();
    redraw();
  }

  const PAN_KEYS: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };

  window.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing =
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');

    if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !typing) {
      event.preventDefault();
      undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault();
      void save();
      return;
    }
    if (typing) return;

    if (event.key === ' ') {
      event.preventDefault();
      spaceDown = true;
      setPanCursor();
      return;
    }
    const pan = PAN_KEYS[event.key];
    if (pan && !event.ctrlKey) {
      event.preventDefault();
      const stride = event.shiftKey ? 16 : 4;
      camX += pan[0] * stride;
      camY += pan[1] * stride;
      redraw();
      return;
    }
    if (event.key === '+' || event.key === '=') {
      stepZoom(1);
      return;
    }
    if (event.key === '-' || event.key === '_') {
      stepZoom(-1);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (mode === 'npc' && selectedNpcId) {
        doc?.beginStroke();
        doc?.removeNpc(selectedNpcId);
        selectedNpcId = null;
        refreshInspector();
        redraw();
        markDirty();
      }
      if (mode === 'monster' && selectedMonster) {
        doc?.beginStroke();
        doc?.removeMonster(selectedMonster);
        selectedMonster = null;
        refreshInspector();
        redraw();
        markDirty();
      }
      if (mode === 'item' && selectedItem) {
        doc?.beginStroke();
        doc?.removeItem(selectedItem);
        selectedItem = null;
        refreshInspector();
        redraw();
        markDirty();
      }
      if (mode === 'transition' && selectedTransition) {
        doc?.beginStroke();
        doc?.removeTransition(selectedTransition);
        selectedTransition = null;
        refreshInspector();
        redraw();
        markDirty();
      }
    }
  });

  window.addEventListener('keyup', (event) => {
    if (event.key !== ' ') return;
    spaceDown = false;
    setPanCursor();
    const target = event.target;
    if (!(target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'))) {
      event.preventDefault(); // a focused button would otherwise "click" on Space release
    }
  });

  // --- chrome: world size -----------------------------------------------------------------------

  function refreshSize(): void {
    sizeEl.innerHTML = '';
    if (!doc || doc.kind !== 'world') {
      sizeEl.style.display = 'none';
      return;
    }
    sizeEl.style.display = '';
    const title = document.createElement('div');
    title.className = 'id-display';
    title.textContent = 'World size';
    const b = doc.map.bounds();
    const info = document.createElement('div');
    info.className = 'hint';
    info.textContent =
      b.width === 0
        ? 'No chunks.'
        : `${b.width} x ${b.height} cells, x ${b.x}..${b.x + b.width - 1}, y ${b.y}..${b.y + b.height - 1}; ${doc.chunkCount()} chunks of ${CHUNK_SIZE}x${CHUNK_SIZE}`;

    const fill = document.createElement('select');
    fill.id = 'expand-fill';
    for (const [value, label] of [['ground', 'Ground h0'], ['rock', 'Rock'], ['void', 'Void']] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      fill.append(option);
    }
    fill.value = expandFill;
    fill.addEventListener('change', () => (expandFill = fill.value as ExpandFill));

    const grid = document.createElement('div');
    grid.className = 'tools';
    for (const [side, label] of [['N', '+ North'], ['S', '+ South'], ['E', '+ East'], ['W', '+ West']] as const) {
      const button = document.createElement('button');
      button.textContent = label;
      button.dataset['expand'] = side;
      button.addEventListener('click', () => expand(side));
      grid.append(button);
    }

    const cursorButtons = document.createElement('div');
    cursorButtons.className = 'tools';
    const add = document.createElement('button');
    add.textContent = 'Add chunk at cursor';
    add.id = 'add-chunk';
    add.addEventListener('click', () => {
      if (!doc || !cursorCell) return say('Hover the map first: the chunk under the mouse is used.');
      const cx = cursorCell.x >> 6;
      const cy = cursorCell.y >> 6;
      if (doc.addChunk(cx, cy, expandFill)) {
        say(`Added chunk ${cx},${cy}.`);
        markDirty();
        redraw();
      } else {
        say(`Chunk ${cx},${cy} already exists.`);
      }
    });
    const remove = document.createElement('button');
    remove.textContent = 'Remove chunk';
    remove.id = 'remove-chunk';
    remove.className = 'danger';
    remove.addEventListener('click', () => {
      if (!doc || !cursorCell) return say('Hover the map first: the chunk under the mouse is used.');
      const cx = cursorCell.x >> 6;
      const cy = cursorCell.y >> 6;
      if (doc.removeChunk(cx, cy)) {
        say(`Removed chunk ${cx},${cy} (its file is deleted on Save).`);
        markDirty();
        redraw();
      } else {
        say(`No chunk at ${cx},${cy}.`);
      }
    });
    cursorButtons.append(add, remove);

    sizeEl.append(title, info, field('Fill for new chunks', fill), grid, cursorButtons);
  }

  function expand(side: ExpandSide): void {
    if (!doc) return;
    const added = doc.expand(side, expandFill);
    if (added.length === 0) return say('Nothing added.');
    say(`Added ${added.length} chunk${added.length === 1 ? '' : 's'}: ${added.map((c) => `${c.x},${c.y}`).join(' ')}.`);
    markDirty();
    redraw();
  }

  function setActive(selector: string, isActive: (el: HTMLButtonElement) => boolean): void {
    for (const el of root.querySelectorAll<HTMLButtonElement>(selector)) {
      el.classList.toggle('on', isActive(el));
    }
  }

  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
    button.addEventListener('click', () => {
      mode = (button.dataset['mode'] ?? 'tile') as Mode;
      setActive('[data-mode]', (el) => el === button);
      refreshPalette();
      refreshInspector();
      redraw();
    });
  }

  function refreshPalette(): void {
    paletteEl.innerHTML = '';
    if (mode === 'tile') paletteEl.append(buildTilePalette());
    if (mode === 'height') paletteEl.append(buildHeightPalette());
    if (mode === 'npc') paletteEl.append(buildHint('Click an empty cell to place an NPC. Drag an existing marker to move it. Edit it in the panel on the right. Delete/Backspace removes the selected NPC.'));
    if (mode === 'monster') paletteEl.append(buildMonsterPalette());
    if (mode === 'item') paletteEl.append(buildItemPalette());
    if (mode === 'transition') paletteEl.append(buildHint('Click an empty cell to place a transition. Drag an existing marker to move it. Set its destination space in the panel on the right. Delete/Backspace removes the selected transition.'));
  }

  function buildHint(text: string): HTMLElement {
    const div = document.createElement('div');
    div.className = 'hint';
    div.textContent = text;
    return div;
  }

  function buildPlacesList(): HTMLElement {
    const box = document.createElement('div');
    box.className = 'places';
    const title = document.createElement('div');
    title.className = 'id-display';
    title.textContent = 'Places';
    box.append(title);
    if (!doc || doc.places.length === 0) {
      box.append(buildHint('No places yet.'));
      return box;
    }
    for (const place of doc.places) {
      const row = document.createElement('div');
      row.className = `place-row${place === selectedPlace ? ' on' : ''}`;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = place.name;
      input.addEventListener('focus', () => {
        if (selectedPlace === place) return;
        selectedPlace = place;
        for (const r of box.querySelectorAll('.place-row')) r.classList.toggle('on', r === row);
        redraw();
      });
      input.addEventListener('change', () => {
        const name = input.value.trim();
        if (name === '') {
          input.value = place.name;
          return;
        }
        doc?.beginStroke();
        doc?.renamePlace(place, name);
        redraw();
        markDirty();
      });
      const select = document.createElement('button');
      select.textContent = '\u25a1';
      select.title = `Highlight ${place.name} (${place.rect.x},${place.rect.y} ${place.rect.width}x${place.rect.height})`;
      select.addEventListener('click', () => {
        selectedPlace = place;
        refreshPalette();
        redraw();
      });
      const del = document.createElement('button');
      del.textContent = 'x';
      del.className = 'danger';
      del.title = 'Delete place (tiles stay)';
      del.addEventListener('click', () => {
        doc?.removePlace(place);
        if (selectedPlace === place) selectedPlace = null;
        refreshPalette();
        redraw();
        markDirty();
      });
      row.append(select, input, del);
      box.append(row);
    }
    return box;
  }

  function buildTilePalette(): HTMLElement {
    const wrap = document.createElement('div');

    const tools = document.createElement('div');
    tools.className = 'tools';
    const toolList: Array<{ id: TileTool; label: string }> = [
      { id: 'pencil', label: 'Pencil' },
      { id: 'line', label: 'Line' },
      { id: 'rect', label: 'Rect' },
      { id: 'box', label: 'Box' },
      { id: 'building', label: 'Building' },
      { id: 'fill', label: 'Fill' },
      { id: 'pick', label: 'Pick' },
    ];
    for (const entry of toolList) {
      const button = document.createElement('button');
      button.textContent = entry.label;
      button.className = tileTool === entry.id ? 'on' : '';
      button.addEventListener('click', () => {
        tileTool = entry.id;
        if (tileTool !== 'building') buildingRect = null;
        refreshPalette();
        refreshInspector();
        redraw();
      });
      tools.append(button);
    }
    wrap.append(tools);

    if (tileTool === 'building') {
      wrap.append(
        buildHint(
          `Drag a rectangle on the world map (at least ${MIN_BUILDING_W}x${MIN_BUILDING_H}); a form appears on the right to name it, pick the door and create the building.`,
        ),
      );
      wrap.append(buildPlacesList());
      return wrap;
    }

    const swatches = document.createElement('div');
    swatches.className = 'swatches';
    for (const tileId of PAINTABLE_TILES) {
      const def = TILES[tileId]!;
      const visual = visualFor(tileId, 0);
      const button = document.createElement('button');
      button.className = `swatch${brushTile === tileId ? ' on' : ''}`;
      button.style.color = visual.fg;
      button.style.background = visual.bg;
      button.textContent = tileId === 'void' ? '∅' : visual.glyph;
      if (tileId === 'void') button.style.borderColor = PALETTE.uiDim;
      button.title = tileId === 'void' ? 'void (erase: a hard stop)' : def.id;
      button.addEventListener('click', () => {
        brushTile = tileId;
        refreshPalette();
      });
      swatches.append(button);
      const label = document.createElement('span');
      label.className = 'swatch-label';
      label.textContent = def.id;
      swatches.append(label);
    }
    wrap.append(swatches);
    return wrap;
  }

  function buildMonsterPalette(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.append(buildHint('Pick a type, then click an empty cell to place one. Click an existing monster to select it, drag to move. Delete/Backspace removes the selected monster.'));
    const list = document.createElement('div');
    list.className = 'monster-list';
    for (const def of Object.values(MONSTERS)) {
      const button = document.createElement('button');
      button.className = `monster-row${brushMonster === def.id ? ' on' : ''}`;
      const glyph = document.createElement('span');
      glyph.className = 'monster-glyph';
      glyph.style.color = def.fg;
      glyph.textContent = def.glyph;
      const label = document.createElement('span');
      label.textContent = monsterStartsHostile(def) ? def.name : `${def.name} (peaceful)`;
      button.append(glyph, label);
      button.addEventListener('click', () => {
        brushMonster = def.id;
        refreshPalette();
      });
      list.append(button);
    }
    wrap.append(list);
    return wrap;
  }

  function itemLabel(def: ItemDef): string {
    return `${def.name} (${def.kind})`;
  }

  function buildItemPalette(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.append(
      buildHint(
        'Pick an item, then click an empty cell to drop one. Click a cell with items to select the top one, drag to move it, Delete/Backspace removes it. Shift+click adds another to an occupied cell.',
      ),
    );
    const count = document.createElement('input');
    count.type = 'number';
    count.min = '1';
    count.id = 'item-count';
    count.value = String(brushCount);
    count.addEventListener('change', () => {
      brushCount = Math.max(1, Math.floor(Number(count.value)) || 1);
      count.value = String(brushCount);
    });
    wrap.append(field('Count (ammo)', count));
    const list = document.createElement('div');
    list.className = 'monster-list';
    for (const def of Object.values(ITEMS)) {
      const button = document.createElement('button');
      button.className = `monster-row${brushItem === def.id ? ' on' : ''}`;
      button.dataset['item'] = def.id;
      const glyph = document.createElement('span');
      glyph.className = 'monster-glyph';
      glyph.style.color = def.fg;
      glyph.textContent = def.glyph;
      const label = document.createElement('span');
      label.textContent = itemLabel(def);
      button.append(glyph, label);
      button.addEventListener('click', () => {
        brushItem = def.id;
        refreshPalette();
      });
      list.append(button);
    }
    wrap.append(list);
    return wrap;
  }

  function buildHeightPalette(): HTMLElement {
    const wrap = document.createElement('div');

    const tools = document.createElement('div');
    tools.className = 'tools';
    const toolList: Array<{ id: HeightTool; label: string }> = [
      { id: 'raise', label: 'Raise +1' },
      { id: 'lower', label: 'Lower -1' },
      { id: 'set', label: 'Set level' },
    ];
    for (const entry of toolList) {
      const button = document.createElement('button');
      button.textContent = entry.label;
      button.className = heightTool === entry.id ? 'on' : '';
      button.addEventListener('click', () => {
        heightTool = entry.id;
        refreshPalette();
      });
      tools.append(button);
    }
    wrap.append(tools);

    if (heightTool === 'set') {
      const swatches = document.createElement('div');
      swatches.className = 'swatches';
      for (let level = 0; level <= MAX_GROUND_HEIGHT; level++) {
        const rung = GROUND_LEVELS[level]!;
        const button = document.createElement('button');
        button.className = `swatch${heightLevel === level ? ' on' : ''}`;
        button.style.color = rung.fg;
        button.style.background = rung.bg;
        button.textContent = rung.glyph;
        button.title = `height ${level}`;
        button.addEventListener('click', () => {
          heightLevel = level;
          refreshPalette();
        });
        swatches.append(button);
      }
      wrap.append(swatches);
    }
    return wrap;
  }

  // --- chrome: inspector (NPC / transition forms) -------------------------------------------------

  function refreshInspector(): void {
    inspectorEl.innerHTML = '';
    if (!doc) return;

    if (mode === 'npc') {
      const npc = selectedNpcId ? doc.npcById(selectedNpcId) : undefined;
      inspectorEl.append(npc ? buildNpcForm(npc) : buildHint('No NPC selected.'));
      return;
    }
    if (mode === 'monster') {
      inspectorEl.append(selectedMonster ? buildMonsterForm(selectedMonster) : buildHint('No monster selected.'));
      return;
    }
    if (mode === 'item') {
      inspectorEl.append(selectedItem ? buildItemInspector(selectedItem) : buildHint('No item selected.'));
      return;
    }
    if (mode === 'transition') {
      inspectorEl.append(selectedTransition ? buildTransitionForm(selectedTransition) : buildHint('No transition selected.'));
      return;
    }
    if (mode === 'tile' && tileTool === 'building') {
      inspectorEl.append(buildingRect ? buildBuildingForm(buildingRect) : buildHint('Drag a rectangle to start a new building.'));
      return;
    }
    inspectorEl.append(buildHint('Switch to the NPCs, Monsters, Items or Transitions mode to edit markers.'));
  }

  function field(labelText: string, input: HTMLElement): HTMLElement {
    const row = document.createElement('label');
    row.className = 'field';
    const span = document.createElement('span');
    span.textContent = labelText;
    row.append(span, input);
    return row;
  }

  // --- building tool ---------------------------------------------------------------------------

  function beginBuildingForm(rect: BuildingRect): void {
    buildingRect = rect;
    buildingMessage = '';
    buildingForm = { name: '', side: 'S', offset: defaultDoorOffset(rect, 'S') };
    refreshInspector();
    redraw();
  }

  function buildingContext(): BuildingContext {
    if (!doc) throw new Error('no document');
    return { map: doc.map, npcs: doc.npcs, monsters: doc.monsters, playerStart: doc.playerStart, places: doc.places };
  }

  function currentBuildingParams(rect: BuildingRect) {
    return {
      name: buildingForm.name,
      rect,
      doorSide: buildingForm.side,
      doorOffset: buildingForm.offset,
    };
  }

  function buildBuildingForm(rect: BuildingRect): HTMLElement {
    const form = document.createElement('div');
    form.className = 'form';
    const info = document.createElement('div');
    info.className = 'id-display';
    info.textContent = `New building ${rect.w}x${rect.h} @ (${rect.x}, ${rect.y})`;
    form.append(info);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Goodsprings General Store';
    nameInput.value = buildingForm.name;
    const sideSelect = document.createElement('select');
    for (const [value, label] of [['N', 'North'], ['S', 'South'], ['E', 'East'], ['W', 'West']] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      sideSelect.append(option);
    }
    sideSelect.value = buildingForm.side;
    const offsetInput = document.createElement('input');
    offsetInput.type = 'number';
    offsetInput.value = String(buildingForm.offset);
    const range = (): { min: number; max: number } => doorOffsetRange(rect, buildingForm.side);
    offsetInput.min = String(range().min);
    offsetInput.max = String(range().max);

    const messageEl = document.createElement('div');
    messageEl.className = 'hint';
    messageEl.style.whiteSpace = 'pre-wrap';
    const refreshMessage = (): void => {
      if (!doc) return;
      const errors = validateBuilding(buildingContext(), currentBuildingParams(rect));
      const lines = errors.map((e) => `x ${e}`);
      if (errors.length === 0 && !outsideDoorWalkable(doc.map, rect, buildingForm.side, buildingForm.offset)) {
        lines.push('! The cell outside the door is not walkable (rock/wall/void) - the door will open onto nothing.');
      }
      if (buildingMessage) lines.unshift(buildingMessage);
      messageEl.textContent = lines.join('\n');
      messageEl.style.color = errors.length > 0 || buildingMessage ? PALETTE.uiDanger : PALETTE.uiAmber;
    };

    nameInput.addEventListener('input', () => {
      buildingForm.name = nameInput.value;
      buildingMessage = '';
      refreshMessage();
    });
    sideSelect.addEventListener('change', () => {
      buildingForm.side = sideSelect.value as DoorSide;
      buildingForm.offset = defaultDoorOffset(rect, buildingForm.side);
      offsetInput.value = String(buildingForm.offset);
      offsetInput.min = String(range().min);
      offsetInput.max = String(range().max);
      buildingMessage = '';
      refreshMessage();
      redraw();
    });
    offsetInput.addEventListener('input', () => {
      buildingForm.offset = Number(offsetInput.value);
      buildingMessage = '';
      refreshMessage();
      redraw();
    });

    form.append(field('Name', nameInput), field('Door side', sideSelect));
    form.append(field(`Door position along that side (${range().min}..${range().max})`, offsetInput));
    form.append(messageEl);

    const createButton = document.createElement('button');
    createButton.textContent = 'Create';
    createButton.addEventListener('click', () => {
      if (!doc) return;
      const params = currentBuildingParams(rect);
      const errors = validateBuilding(buildingContext(), params);
      if (doc.kind !== 'world') errors.unshift('Buildings can only be created while editing the world map.');
      if (errors.length > 0) {
        buildingMessage = 'Cannot create:';
        refreshMessage();
        return;
      }
      doc.applyBuildingPatch(buildBuilding(params));
      buildingRect = null;
      buildingMessage = '';
      refreshPalette();
      refreshInspector();
      redraw();
      markDirty();
    });
    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => {
      buildingRect = null;
      buildingMessage = '';
      refreshInspector();
      redraw();
    });
    const buttons = document.createElement('div');
    buttons.className = 'tools';
    buttons.append(createButton, cancelButton);
    form.append(buttons);
    refreshMessage();
    return form;
  }

  /** The items on the selected item's cell, each removable, plus a button to drop the brush item there too. */
  function buildItemInspector(selected: EditableGroundItem): HTMLElement {
    const form = document.createElement('div');
    form.className = 'form';
    const info = document.createElement('div');
    info.className = 'id-display';
    info.textContent = `Items @ (${selected.x}, ${selected.y})`;
    form.append(info);
    for (const item of doc?.itemsAt(selected.x, selected.y) ?? []) {
      const def = ITEMS[item.defId];
      const row = document.createElement('div');
      row.className = `place-row${item === selected ? ' on' : ''}`;
      const glyph = document.createElement('span');
      glyph.className = 'monster-glyph';
      glyph.style.color = def?.fg ?? PALETTE.hostileRing;
      glyph.textContent = def?.glyph ?? '?';
      const label = document.createElement('button');
      label.textContent = def ? def.name : `${item.defId} (unknown)`;
      label.style.flex = '1';
      label.style.textAlign = 'left';
      label.addEventListener('click', () => {
        selectedItem = item;
        refreshInspector();
        redraw();
      });
      row.append(glyph, label);
      if (def?.kind === 'ammo') {
        const count = document.createElement('input');
        count.type = 'number';
        count.min = '1';
        count.style.width = '52px';
        count.value = String(item.count ?? 1);
        count.addEventListener('change', () => {
          doc?.beginStroke();
          item.count = Math.max(1, Math.floor(Number(count.value)) || 1);
          count.value = String(item.count);
          markDirty();
        });
        row.append(count);
      }
      const del = document.createElement('button');
      del.textContent = 'x';
      del.className = 'danger';
      del.title = 'Remove this item';
      del.addEventListener('click', () => {
        doc?.beginStroke();
        doc?.removeItem(item);
        selectedItem = doc?.itemsAt(selected.x, selected.y).at(-1) ?? null;
        refreshInspector();
        redraw();
        markDirty();
      });
      row.append(del);
      form.append(row);
    }
    const add = document.createElement('button');
    add.textContent = `Add ${ITEMS[brushItem]?.name ?? brushItem} here`;
    add.addEventListener('click', () => {
      doc?.beginStroke();
      selectedItem = doc?.addItem(brushItem, selected.x, selected.y, newItemCount(brushItem)) ?? selectedItem;
      refreshInspector();
      redraw();
      markDirty();
    });
    form.append(add);
    return form;
  }

  /** "Carries" section shared by the NPC and monster forms: items, wielded weapon, readied ammo. */
  function buildCarriesSection(owner: EditableLoadout): HTMLElement {
    const box = document.createElement('div');
    box.className = 'field carries';
    const title = document.createElement('span');
    title.textContent = 'Carries';
    box.append(title);

    const changed = (): void => {
      refreshInspector();
      markDirty();
    };
    const entries = owner.inventory ?? [];
    entries.forEach((entry, index) => {
      const defId = typeof entry === 'string' ? entry : entry.defId;
      const count = typeof entry === 'string' ? undefined : entry.count;
      const def = ITEMS[defId];
      const row = document.createElement('div');
      row.className = 'place-row';
      const glyph = document.createElement('span');
      glyph.className = 'monster-glyph';
      glyph.style.color = def?.fg ?? PALETTE.hostileRing;
      glyph.textContent = def?.glyph ?? '?';
      const label = document.createElement('span');
      label.style.flex = '1';
      label.textContent = (def ? def.name : `${defId} (unknown)`) + (count !== undefined ? ` x${count}` : '');
      const del = document.createElement('button');
      del.textContent = 'x';
      del.className = 'danger';
      del.title = 'Remove from inventory';
      del.addEventListener('click', () => {
        doc?.beginStroke();
        doc?.removeCarried(owner, index);
        changed();
      });
      row.append(glyph, label, del);
      box.append(row);
    });
    if (entries.length === 0) box.append(buildHint('Nothing.'));

    const addRow = document.createElement('div');
    addRow.className = 'place-row';
    const pick = document.createElement('select');
    pick.className = 'carry-add';
    pick.style.flex = '1';
    pick.style.minWidth = '0';
    for (const def of Object.values(ITEMS)) {
      const option = document.createElement('option');
      option.value = def.id;
      option.textContent = itemLabel(def);
      pick.append(option);
    }
    const amount = document.createElement('input');
    amount.type = 'number';
    amount.min = '1';
    amount.style.width = '52px';
    amount.style.flex = 'none';
    amount.value = String(brushCount);
    amount.title = 'Count (ammo only)';
    const syncAmount = (): void => {
      amount.disabled = ITEMS[pick.value]?.kind !== 'ammo';
    };
    pick.addEventListener('change', syncAmount);
    syncAmount();
    const addButton = document.createElement('button');
    addButton.textContent = 'Add item';
    addButton.className = 'carry-add-button';
    addButton.addEventListener('click', () => {
      doc?.beginStroke();
      doc?.addCarried(owner, pick.value, Math.max(1, Math.floor(Number(amount.value)) || 1));
      changed();
    });
    addRow.append(pick, amount);
    box.append(addRow, addButton);

    const carried = doc?.carriedDefIds(owner) ?? [];
    const choose = (
      labelText: string,
      current: string | undefined,
      eligible: (def: ItemDef) => boolean,
      apply: (defId: string | undefined) => void,
      className: string,
    ): void => {
      const select = document.createElement('select');
      select.className = className;
      const none = document.createElement('option');
      none.value = '';
      none.textContent = '(none)';
      select.append(none);
      for (const id of carried) {
        const def = ITEMS[id];
        if (!def || !eligible(def)) continue;
        const option = document.createElement('option');
        option.value = id;
        option.textContent = def.name;
        select.append(option);
      }
      select.value = current ?? '';
      select.addEventListener('change', () => {
        doc?.beginStroke();
        apply(select.value === '' ? undefined : select.value);
        changed();
      });
      box.append(field(labelText, select));
    };
    choose('Wields', owner.wield, (d) => d.kind === 'weapon' || d.kind === 'gun', (id) => void doc?.setWield(owner, id), 'carry-wield');
    choose('Readied ammo', owner.ready, (d) => d.kind === 'ammo', (id) => void doc?.setReady(owner, id), 'carry-ready');

    box.append(
      buildHint(
        'If a hostile NPC carries a gun and ammo it will draw it and shoot; leave Wields empty so they draw it when provoked.',
      ),
    );
    return box;
  }

  function buildNpcForm(npc: EditableNpc): HTMLElement {
    const form = document.createElement('div');
    form.className = 'form';

    const idDisplay = document.createElement('div');
    idDisplay.className = 'id-display';
    idDisplay.textContent = `id: ${npc.id}  @ (${npc.x}, ${npc.y})`;
    form.append(idDisplay);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = npc.name;
    nameInput.addEventListener('change', () => {
      doc?.beginStroke();
      doc?.updateNpc(npc.id, { name: nameInput.value });
      markDirty();
    });
    form.append(field('Name', nameInput));

    const dialogueInput = document.createElement('textarea');
    dialogueInput.rows = 4;
    dialogueInput.value = npc.dialogue.join('\n');
    dialogueInput.addEventListener('change', () => {
      const lines = dialogueInput.value.split('\n').map((line) => line.trim()).filter(Boolean);
      doc?.beginStroke();
      doc?.updateNpc(npc.id, { dialogue: lines.length > 0 ? lines : [''] });
      markDirty();
    });
    form.append(field('Dialogue (one talking point per line — cycles on repeated bump)', dialogueInput));

    const fgInput = document.createElement('input');
    fgInput.type = 'text';
    fgInput.placeholder = PALETTE.npcFg;
    fgInput.value = npc.fg ?? '';
    fgInput.addEventListener('change', () => {
      doc?.beginStroke();
      doc?.updateNpc(npc.id, { fg: fgInput.value || undefined });
      redraw();
      markDirty();
    });
    form.append(field('Color (fg)', fgInput));

    const interactionBox = document.createElement('div');
    interactionBox.className = 'field';
    const interactionTitle = document.createElement('span');
    interactionTitle.textContent = 'Interactions';
    interactionBox.append(interactionTitle);
    const boxes: Array<{ id: InteractionId; input: HTMLInputElement }> = [];
    for (const id of Object.keys(INTERACTION_LABELS) as InteractionId[]) {
      const row = document.createElement('label');
      row.className = 'check';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = npc.interactions.includes(id);
      boxes.push({ id, input });
      row.append(input, document.createTextNode(INTERACTION_LABELS[id]));
      interactionBox.append(row);
    }
    for (const box of boxes) {
      box.input.addEventListener('change', () => {
        const chosen = boxes.filter((b) => b.input.checked).map((b) => b.id);
        if (chosen.length === 0) {
          box.input.checked = true; // at least one interaction must stay
          return;
        }
        doc?.beginStroke();
        doc?.updateNpc(npc.id, { interactions: chosen });
        markDirty();
      });
    }
    const interactionHint = document.createElement('div');
    interactionHint.className = 'hint';
    interactionHint.textContent = 'At least one. With more than one, bumping the NPC opens a menu.';
    interactionBox.append(interactionHint);
    form.append(interactionBox);
    form.append(buildCarriesSection(npc));

    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'Delete NPC';
    deleteButton.className = 'danger';
    deleteButton.addEventListener('click', () => {
      doc?.beginStroke();
      doc?.removeNpc(npc.id);
      selectedNpcId = null;
      refreshInspector();
      redraw();
      markDirty();
    });
    form.append(deleteButton);

    return form;
  }

  function buildMonsterForm(monster: EditableMonster): HTMLElement {
    const form = document.createElement('div');
    form.className = 'form';
    const def = MONSTERS[monster.defId];

    const info = document.createElement('div');
    info.className = 'id-display';
    info.textContent = `${monster.defId} @ (${monster.x}, ${monster.y})${def && !monsterStartsHostile(def) ? ' (peaceful)' : ''}`;
    form.append(info);

    const typeSelect = document.createElement('select');
    for (const entry of Object.values(MONSTERS)) {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = entry.name;
      typeSelect.append(option);
    }
    if (!def) {
      const option = document.createElement('option');
      option.value = monster.defId;
      option.textContent = `${monster.defId} (unknown)`;
      typeSelect.append(option);
    }
    typeSelect.value = monster.defId;
    typeSelect.addEventListener('change', () => {
      doc?.beginStroke();
      doc?.updateMonster(monster, { defId: typeSelect.value });
      refreshInspector();
      redraw();
      markDirty();
    });
    form.append(field('Type', typeSelect));
    form.append(buildCarriesSection(monster));

    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'Delete monster';
    deleteButton.className = 'danger';
    deleteButton.addEventListener('click', () => {
      doc?.beginStroke();
      doc?.removeMonster(monster);
      selectedMonster = null;
      refreshInspector();
      redraw();
      markDirty();
    });
    form.append(deleteButton);
    return form;
  }

  function buildTransitionForm(transition: EditableTransition): HTMLElement {
    const form = document.createElement('div');
    form.className = 'form';

    const posDisplay = document.createElement('div');
    posDisplay.className = 'id-display';
    posDisplay.textContent = `@ (${transition.x}, ${transition.y})`;
    form.append(posDisplay);

    const toSpaceInput = document.createElement('input');
    toSpaceInput.type = 'text';
    toSpaceInput.value = transition.toSpace;
    toSpaceInput.addEventListener('change', () => {
      doc?.beginStroke();
      doc?.updateTransition(transition, toSpaceInput.value);
      markDirty();
    });
    form.append(field('To space id', toSpaceInput));

    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'Delete transition';
    deleteButton.className = 'danger';
    deleteButton.addEventListener('click', () => {
      doc?.beginStroke();
      doc?.removeTransition(transition);
      selectedTransition = null;
      refreshInspector();
      redraw();
      markDirty();
    });
    form.append(deleteButton);

    return form;
  }

  // --- chrome: zoom + chunk toggle + save ---------------------------------------------------------

  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-zoom]')) {
    button.addEventListener('click', () => stepZoom(Number(button.dataset['zoom'] ?? '0')));
  }

  chunksButton.addEventListener('click', () => {
    showChunks = !showChunks;
    chunksButton.classList.toggle('on', showChunks);
    redraw();
  });

  function downloadFallback(text: string, fileName: string): void {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function send(url: string, method: 'POST' | 'DELETE', body?: string): Promise<boolean> {
    try {
      const response = await fetch(url, body === undefined ? { method } : { method, body });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function saveWorld(current: MapDocument): Promise<void> {
    const plan: SavePlan = current.savePlan();
    const metaChanged = plan.metaText !== lastMetaText;
    if (plan.writes.length === 0 && plan.deletes.length === 0 && !metaChanged) {
      saveButton.textContent = 'Saved (nothing changed)';
      saveButton.classList.remove('unsaved');
      dirty = false;
      return;
    }
    let ok = true;
    for (const w of plan.writes) ok = (await send(`/__world?chunk=${w.cx},${w.cy}`, 'POST', w.text)) && ok;
    for (const d of plan.deletes) ok = (await send(`/__world?chunk=${d.cx},${d.cy}`, 'DELETE')) && ok;
    if (metaChanged && plan.metaText !== null) ok = (await send('/__world?meta=1', 'POST', plan.metaText)) && ok;
    if (ok) {
      current.commitSave(plan);
      if (plan.metaText !== null) lastMetaText = plan.metaText;
      dirty = false;
      minimapStale = true;
      saveButton.textContent = `Saved (${plan.writes.length} written, ${plan.deletes.length} deleted)`;
      saveButton.classList.remove('unsaved');
      say(`Saved: ${plan.writes.length} chunk file${plan.writes.length === 1 ? '' : 's'} written, ${plan.deletes.length} deleted${metaChanged ? ', world.json updated' : ''}.`);
      refreshSize();
      redraw();
    } else {
      // No dev server (e.g. a static build) or a rejected write: download so work is never lost.
      if (plan.metaText !== null) downloadFallback(plan.metaText, 'world.json');
      for (const w of plan.writes) downloadFallback(w.text, `${w.cx}_${w.cy}.json`);
      saveButton.textContent = 'Save failed — downloaded instead';
    }
  }

  async function save(): Promise<void> {
    if (!doc) return;
    if (doc.kind === 'world') return saveWorld(doc);
    const text = doc.flatText();
    if (await send(`/__map?file=${currentFile}`, 'POST', text)) {
      dirty = false;
      saveButton.textContent = 'Saved';
      saveButton.classList.remove('unsaved');
      await refreshSpaceList();
    } else {
      downloadFallback(text, currentFile);
      saveButton.textContent = 'Save failed — downloaded instead';
    }
  }
  saveButton.addEventListener('click', () => void save());

  // The dev server may full-reload this page when a map JSON changes (including our own save), so
  // the open file is kept in the URL hash (and the view in sessionStorage) to land back where we were.
  await refreshSpaceList();
  const hashed = spaceEntries.find((e) => e.file === location.hash.slice(1));
  await loadFile(hashed?.file ?? currentFile);
  renderFileOptions();
}

const LAYOUT = `
  <header>
    <strong>New Vegas RL — Map Editor</strong>
    <select id="file"><option value="world">World</option></select>
    <span class="tools" id="mode-tools">
      <button data-mode="tile" class="on">Tiles</button>
      <button data-mode="height">Height</button>
      <button data-mode="npc">NPCs</button>
      <button data-mode="monster">Monsters</button>
      <button data-mode="item">Items</button>
      <button data-mode="transition">Transitions</button>
    </span>
    <span class="tools">
      <button data-zoom="-1" title="Zoom out (-, Ctrl+wheel)">&minus;</button>
      <span id="zoom">22px</span>
      <button data-zoom="1" title="Zoom in (+, Ctrl+wheel)">+</button>
      <button id="chunks" class="on" title="Show chunk boundaries">Chunks</button>
    </span>
    <span class="grow"></span>
    <span id="status">&nbsp;</span>
    <span id="note"></span>
    <button id="save">Save</button>
  </header>
  <div id="load-error"></div>
  <div id="body">
    <aside id="palette-col"><div id="palette"></div><div id="size"></div></aside>
    <main id="viewport"><canvas id="map"></canvas><canvas id="minimap"></canvas></main>
    <aside id="inspector"></aside>
  </div>
`;

const STYLE = `
  body { margin: 0; background: ${PALETTE.uiBg}; color: ${PALETTE.uiDim};
         font: 13px ui-monospace, 'Cascadia Mono', 'DejaVu Sans Mono', Consolas, monospace; }
  #editor { display: flex; flex-direction: column; height: 100vh; }
  header { display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
           padding: 8px 12px; background: #0c1409; border-bottom: 1px solid ${PALETTE.uiBorder}; }
  header strong { color: ${PALETTE.uiAmber}; }
  .grow { flex: 1; }
  button, select, input, textarea {
    background: #0f160c; color: ${PALETTE.uiDim}; border: 1px solid ${PALETTE.uiBorder};
    padding: 4px 9px; border-radius: 3px; font: inherit;
  }
  button { cursor: pointer; }
  button.on { background: ${PALETTE.uiGreen}; border-color: ${PALETTE.uiGreen}; color: #06250f; }
  button.unsaved { border-color: ${PALETTE.uiAmber}; color: ${PALETTE.uiAmber}; }
  button.danger { border-color: ${PALETTE.uiDanger}; color: ${PALETTE.uiDanger}; margin-top: 8px; }
  .tools { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .places { margin-top: 12px; display: flex; flex-direction: column; gap: 4px; }
  .place-row { display: flex; gap: 4px; align-items: center; }
  .place-row.on { outline: 2px solid ${PALETTE.uiAmber}; }
  .place-row input { flex: 1; min-width: 0; padding: 3px 6px; }
  .place-row button { padding: 2px 6px; margin: 0; }
  #status { color: ${PALETTE.uiDim}; min-width: 140px; }
  #note { color: ${PALETTE.uiAmber}; max-width: 420px; }
  #load-error { padding: 6px 12px; }
  #load-error.bad { background: #3a1616; color: #ffb4b4; border-bottom: 1px solid ${PALETTE.uiBorder}; }
  #body { display: flex; flex: 1; min-height: 0; }
  #palette-col { width: 230px; padding: 10px; border-right: 1px solid ${PALETTE.uiBorder}; overflow-y: auto; box-sizing: border-box; }
  #size { margin-top: 16px; padding-top: 10px; border-top: 1px solid ${PALETTE.uiBorder}; display: flex; flex-direction: column; gap: 8px; }
  #size button.danger { margin-top: 0; }
  #inspector { width: 240px; padding: 10px; border-left: 1px solid ${PALETTE.uiBorder}; overflow-y: auto; box-sizing: border-box; }
  main { flex: 1; min-width: 0; position: relative; overflow: hidden; }
  canvas#map { position: absolute; inset: 0; cursor: crosshair; }
  canvas#minimap { position: absolute; right: 12px; bottom: 12px; border: 1px solid ${PALETTE.uiAmber};
                   background: #000; cursor: pointer; image-rendering: pixelated; opacity: 0.92; }
  .swatches { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-top: 8px; }
  .swatch { width: 28px; height: 28px; padding: 0; font-size: 15px; }
  .swatch.on { outline: 2px solid ${PALETTE.uiAmber}; }
  .swatch-label { font-size: 11px; color: ${PALETTE.uiDim}; margin-right: 6px; }
  .hint { color: ${PALETTE.uiDim}; line-height: 1.4em; }
  .form { display: flex; flex-direction: column; gap: 8px; }
  .field { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: ${PALETTE.uiDim}; }
  .field input, .field textarea { color: ${PALETTE.uiGreen}; }
  .check { display: flex; gap: 6px; align-items: center; color: ${PALETTE.uiGreen}; }
  .monster-list { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
  .monster-row { display: flex; gap: 8px; align-items: center; text-align: left; }
  .monster-row.on { outline: 2px solid ${PALETTE.uiAmber}; }
  .monster-glyph { font-size: 18px; width: 14px; text-align: center; }
  .id-display { font-size: 12px; color: ${PALETTE.uiAmber}; word-break: break-all; }
`;

void boot();
