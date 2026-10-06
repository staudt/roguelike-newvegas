import { FONT_FAMILY, LINE_HEIGHT_RATIO } from '../config/constants';
import { GROUND_LEVELS, MAX_GROUND_HEIGHT, PALETTE } from '../config/palette';
import { isConnectedWall, wallGlyph } from '../ui/WallGlyphs';
import { linePoints, type Point } from '../utils/geometry';
import { TILES, visualFor } from '../world/Tile';
import type { SpaceJSON } from '../world/MapLoader';
import {
  buildBuilding,
  defaultDoorOffset,
  doorCells,
  doorOffsetRange,
  idToFileName,
  MIN_BUILDING_H,
  MIN_BUILDING_W,
  outsideDoorWalkable,
  slugify,
  validateBuilding,
  type BuildingRect,
  type DoorSide,
} from '../world/buildingTemplate';
import { INTERACTION_LABELS, type InteractionId } from '../entities/Npc';
import { MONSTERS } from '../entities/MonsterData';
import { type EditableMonster, type EditableNpc, type EditableTransition, MapDocument } from './MapDocument';

/**
 * The map editor.
 *
 * Loads a `SpaceJSON` file over the dev-only `/__map` route, lets you paint tiles/heights and
 * place NPCs/transitions on a canvas rendered with the game's own `visualFor`/`wallGlyph`, and
 * saves back to the same route (falling back to a file download when there is no dev server).
 *
 * Deliberately a separate page from the game — see editor.html / vite.config.ts. It shares the
 * tile table, palette and on-disk JSON contract with the game, and nothing else.
 */

type MapFile = string;
const WORLD_FILE = 'worldMap.json';
/** Used when the dev server can't list the map directory. */
const FALLBACK_FILES = ['worldMap.json', 'prospectorSaloon.json', 'docMitchellsHouse.json'];

interface SpaceEntry {
  file: MapFile;
  id: string;
  name: string;
}

/** A building interior created this session that has not been written to disk yet. */
interface PendingSpace {
  file: MapFile;
  json: SpaceJSON;
  /** Where its door transition lives on the world map, so an undo of the patch can drop it. */
  door: { x: number; y: number };
}

const DEFAULT_CELL = 22;
const ZOOM_STEPS = [10, 14, 18, 22, 28, 36];

type Mode = 'tile' | 'height' | 'npc' | 'monster' | 'transition';
type TileTool = 'pencil' | 'line' | 'rect' | 'box' | 'building' | 'fill' | 'pick';
type HeightTool = 'raise' | 'lower' | 'set';

const PAINTABLE_TILES = ['ground', 'rock', 'wall', 'door', 'floor'] as const;

async function fetchSpace(file: MapFile): Promise<SpaceJSON> {
  const response = await fetch(`/__map?file=${file}`);
  if (!response.ok) throw new Error(`GET /__map?file=${file} -> ${response.status}`);
  return (await response.json()) as SpaceJSON;
}

async function fetchSpaceList(): Promise<SpaceEntry[]> {
  let files: string[];
  try {
    const response = await fetch('/__map?list=1');
    if (!response.ok) throw new Error(String(response.status));
    files = (await response.json()) as string[];
  } catch {
    files = FALLBACK_FILES;
  }
  const entries: SpaceEntry[] = [];
  for (const file of files) {
    try {
      const data = await fetchSpace(file);
      entries.push({ file, id: data.id, name: data.name });
    } catch {
      entries.push({ file, id: file.replace(/\.json$/, ''), name: file });
    }
  }
  // World first, then the rest by display name.
  entries.sort((a, b) => (a.file === WORLD_FILE ? -1 : b.file === WORLD_FILE ? 1 : a.name.localeCompare(b.name)));
  return entries;
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
  const canvas = root.querySelector<HTMLCanvasElement>('#map')!;
  const ctxOrNull = canvas.getContext('2d');
  if (!ctxOrNull) throw new Error('Canvas 2D context unavailable');
  const ctx = ctxOrNull;
  const status = root.querySelector<HTMLDivElement>('#status')!;
  const loadError = root.querySelector<HTMLDivElement>('#load-error')!;
  const paletteEl = root.querySelector<HTMLDivElement>('#palette')!;
  const inspectorEl = root.querySelector<HTMLDivElement>('#inspector')!;
  const saveButton = root.querySelector<HTMLButtonElement>('#save')!;
  const pendingEl = root.querySelector<HTMLSpanElement>('#pending')!;

  let currentFile: MapFile = 'worldMap.json';
  let doc: MapDocument | null = null;
  /** Cell height in px (the zoom step). Width follows from the font so cells match the game. */
  let cell = DEFAULT_CELL;
  let cellW = DEFAULT_CELL;
  /** Where the mouse is during a line/rect/box drag, for the live outline. */
  let previewTo: Point | null = null;
  let dirty = false;
  let spaceEntries: SpaceEntry[] = [];
  const pendingSpaces = new Map<string, PendingSpace>();
  /** The rectangle dragged with the Building tool, awaiting its form. */
  let buildingRect: BuildingRect | null = null;
  let buildingForm = { name: '', id: '', idEdited: false, side: 'S' as DoorSide, offset: 1 };
  let buildingMessage = '';

  let mode: Mode = 'tile';
  let tileTool: TileTool = 'pencil';
  let brushTile: string = 'ground';
  let heightTool: HeightTool = 'set';
  let heightLevel = 0;

  let selectedNpcId: string | null = null;
  let selectedTransition: EditableTransition | null = null;
  let selectedMonster: EditableMonster | null = null;
  let brushMonster: string = Object.keys(MONSTERS)[0]!;

  let painting = false;
  let anchor: Point | null = null;
  /** Cells already touched this stroke — keeps raise/lower from double-applying on a slow drag. */
  let strokeVisited = new Set<string>();

  // --- loading --------------------------------------------------------------------------------

  let loadSerial = 0;

  async function loadFile(file: MapFile): Promise<void> {
    const serial = ++loadSerial;
    try {
      const data = await fetchSpace(file);
      if (serial !== loadSerial) return; // a newer load superseded this one
      doc = new MapDocument(data);
      currentFile = file;
      fileSelect.value = file;
      history.replaceState(null, '', `#${file}`);
      dirty = false;
      pendingSpaces.clear();
      buildingRect = null;
      buildingMessage = '';
      refreshPending();
      selectedNpcId = null;
      selectedTransition = null;
      selectedMonster = null;
      loadError.textContent = '';
      loadError.className = '';
      saveButton.textContent = 'Save';
      setZoom(cell);
      refreshPalette();
      refreshInspector();
      redraw();
    } catch (error) {
      loadError.textContent =
        `Could not load ${file} from the dev server (${error instanceof Error ? error.message : String(error)}). ` +
        `Run "npm run dev" and open this page from there to edit maps.`;
      loadError.className = 'bad';
    }
  }

  fileSelect.addEventListener('change', () => {
    if ((dirty || pendingSpaces.size > 0) && !window.confirm('Discard unsaved changes and load the other map?')) {
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
      option.textContent = entry.file === WORLD_FILE ? `World (${entry.name})` : entry.name;
      fileSelect.append(option);
    }
    fileSelect.value = currentFile;
  }

  async function refreshSpaceList(): Promise<void> {
    spaceEntries = await fetchSpaceList();
    renderFileOptions();
  }

  function refreshPending(): void {
    const n = pendingSpaces.size;
    pendingEl.textContent = n > 0 ? `+${n} new space${n === 1 ? '' : 's'}` : '';
  }

  window.addEventListener('beforeunload', (event) => {
    if (dirty || pendingSpaces.size > 0) event.preventDefault();
  });

  // --- drawing ----------------------------------------------------------------------------------

  function setZoom(next: number): void {
    if (!doc) return;
    cell = next;
    // Same proportions as the game: cell height = font size * LINE_HEIGHT_RATIO, cell width = the
    // font's real advance width. (Setting canvas size resets the context, so the font goes after.)
    const fontSize = Math.max(6, Math.round(cell / LINE_HEIGHT_RATIO));
    const fontSpec = `${fontSize}px ${FONT_FAMILY}`;
    ctx.font = fontSpec;
    cellW = Math.max(1, Math.ceil(ctx.measureText('M').width));
    canvas.width = doc.width * cellW;
    canvas.height = doc.height * cell;
    ctx.font = fontSpec;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    root.querySelector('#zoom')!.textContent = `${cell}px`;
    redraw();
  }

  function redraw(): void {
    if (!doc) return;
    ctx.fillStyle = PALETTE.unexplored;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const grid = doc.toGrid();
    for (let y = 0; y < doc.height; y++) {
      for (let x = 0; x < doc.width; x++) {
        const tileId = doc.tileAt(x, y);
        const visual = visualFor(tileId, doc.heightAt(x, y));
        const glyph = isConnectedWall(tileId) ? wallGlyph(grid, x, y) : visual.glyph;
        const px = x * cellW;
        const py = y * cell;
        ctx.fillStyle = visual.bg;
        ctx.fillRect(px, py, cellW, cell);
        ctx.fillStyle = visual.fg;
        ctx.fillText(glyph, px + cellW / 2, py + cell / 2);
      }
    }

    for (const transition of doc.transitions) {
      drawMarker(transition.x, transition.y, '>', PALETTE.interactableFg, transition === selectedTransition);
    }
    for (const monster of doc.monsters) {
      const def = MONSTERS[monster.defId];
      drawMarker(monster.x, monster.y, def?.glyph ?? '?', def?.fg ?? PALETTE.hostileRing, monster === selectedMonster);
      if (def?.hostile) drawRing(monster.x, monster.y);
    }
    for (const npc of doc.npcs) {
      drawMarker(npc.x, npc.y, '@', npc.fg ?? PALETTE.npcFg, npc.id === selectedNpcId);
    }

    if (doc.playerStart) {
      drawMarker(doc.playerStart.x, doc.playerStart.y, '@', PALETTE.playerFg, false);
    }

    drawShapePreview();
  }

  /** Live outline of the line/rect/box being dragged, so you can see it before letting go. */
  function drawShapePreview(): void {
    if (!doc || mode !== 'tile') return;
    if (tileTool === 'building') {
      const rect = painting && anchor && previewTo ? rectBetween(anchor, previewTo) : buildingRect;
      if (rect) drawBuildingPreview(rect, painting);
      return;
    }
    if (!painting || !anchor || !previewTo) return;
    if (tileTool !== 'line' && tileTool !== 'rect' && tileTool !== 'box') return;

    const ghost = new MapDocument(doc.toJSON());
    if (tileTool === 'line') ghost.lineTile(anchor, previewTo, brushTile);
    if (tileTool === 'rect') ghost.rectTile(anchor, previewTo, brushTile);
    if (tileTool === 'box') ghost.boxTile(anchor, previewTo, brushTile);

    ctx.save();
    ctx.globalAlpha = 0.75;
    const ghostGrid = ghost.toGrid();
    for (let y = 0; y < ghost.height; y++) {
      for (let x = 0; x < ghost.width; x++) {
        if (ghost.tileAt(x, y) === doc.tileAt(x, y)) continue;
        const tileId = ghost.tileAt(x, y);
        const visual = visualFor(tileId, ghost.heightAt(x, y));
        const glyph = isConnectedWall(tileId) ? wallGlyph(ghostGrid, x, y) : visual.glyph;
        ctx.fillStyle = visual.bg;
        ctx.fillRect(x * cellW, y * cell, cellW, cell);
        ctx.fillStyle = visual.fg;
        ctx.fillText(glyph, x * cellW + cellW / 2, y * cell + cell / 2);
        ctx.strokeStyle = PALETTE.uiGreen;
        ctx.strokeRect(x * cellW + 0.5, y * cell + 0.5, cellW - 1, cell - 1);
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
        const visual = visualFor('wall', 0);
        ctx.fillStyle = visual.bg;
        ctx.fillRect(x * cellW, y * cell, cellW, cell);
        ctx.fillStyle = visual.fg;
        ctx.fillText(visual.glyph, x * cellW + cellW / 2, y * cell + cell / 2);
      }
    }
    if (!dragging && big) {
      const range = doorOffsetRange(rect, buildingForm.side);
      if (buildingForm.offset >= range.min && buildingForm.offset <= range.max) {
        const door = doorCells(rect, buildingForm.side, buildingForm.offset).door;
        const visual = visualFor('door', 0);
        ctx.fillStyle = visual.bg;
        ctx.fillRect(door.x * cellW, door.y * cell, cellW, cell);
        ctx.fillStyle = visual.fg;
        ctx.fillText(visual.glyph, door.x * cellW + cellW / 2, door.y * cell + cell / 2);
      }
    }
    ctx.strokeStyle = big ? PALETTE.uiGreen : PALETTE.hostileRing;
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x * cellW + 1, rect.y * cell + 1, rect.w * cellW - 2, rect.h * cell - 2);
    ctx.restore();
  }

  /** Thin red ring marking a hostile monster (the selection box is a square, so the two read differently). */
  function drawRing(wx: number, wy: number): void {
    const x = wx - (doc?.worldOrigin.x ?? 0);
    const y = wy - (doc?.worldOrigin.y ?? 0);
    ctx.save();
    ctx.strokeStyle = PALETTE.hostileRing;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x * cellW + cellW / 2, y * cell + cell / 2, cellW / 2 - 1, cell / 2 - 1, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Markers (NPCs, monsters, transitions, player start) are stored in WORLD coordinates; the grid is local. */
  function drawMarker(wx: number, wy: number, glyph: string, fg: string, selected: boolean): void {
    const x = wx - (doc?.worldOrigin.x ?? 0);
    const y = wy - (doc?.worldOrigin.y ?? 0);
    const px = x * cellW;
    const py = y * cell;
    ctx.fillStyle = fg;
    ctx.fillText(glyph, px + cellW / 2, py + cell / 2);
    if (selected) {
      ctx.save();
      ctx.strokeStyle = PALETTE.hostileRing;
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1, py + 1, cellW - 2, cell - 2);
      ctx.restore();
    }
  }

  // --- input: coordinates ------------------------------------------------------------------------

  function cellAt(event: MouseEvent): Point {
    const box = canvas.getBoundingClientRect();
    const docRef = doc;
    const w = docRef?.width ?? 1;
    const h = docRef?.height ?? 1;
    return {
      x: Math.floor(((event.clientX - box.left) / box.width) * w),
      y: Math.floor(((event.clientY - box.top) / box.height) * h),
    };
  }

  function toWorld(local: Point): Point {
    return { x: local.x + (doc?.worldOrigin.x ?? 0), y: local.y + (doc?.worldOrigin.y ?? 0) };
  }

  function markDirty(): void {
    dirty = true;
    saveButton.textContent = 'Save •';
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
      doc.fillTile(at, brushTile);
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

  canvas.addEventListener('mousedown', (event) => {
    if (!doc) return;
    const at = cellAt(event);
    if (mode === 'tile') handleTileMouseDown(at);
    if (mode === 'height') handleHeightMouseDown(at);
    if (!doc.inBounds(at.x, at.y)) return;
    const world = toWorld(at);
    if (mode === 'npc') handleNpcMouseDown(world);
    if (mode === 'monster') handleMonsterMouseDown(world);
    if (mode === 'transition') handleTransitionMouseDown(world);
  });

  canvas.addEventListener('mousemove', (event) => {
    if (!doc) return;
    const at = cellAt(event);
    const height = doc.heightAt(at.x, at.y);
    status.textContent = `${at.x}, ${at.y}   ${doc.tileAt(at.x, at.y)}${doc.tileAt(at.x, at.y) === 'ground' ? ` h${height}` : ''}`;
    if (mode === 'tile') handleTileMouseMove(at);
    if (mode === 'height') handleHeightMouseMove(at);
    if (!doc.inBounds(at.x, at.y)) return;
    const world = toWorld(at);
    if (mode === 'npc') handleNpcMouseMove(world);
    if (mode === 'monster') handleMonsterMouseMove(world);
    if (mode === 'transition') handleTransitionMouseMove(world);
  });

  window.addEventListener('mouseup', (event) => {
    if (!painting) return;
    if (doc && mode === 'tile') handleTileMouseUp(cellAt(event));
    painting = false;
    anchor = null;
    previewTo = null;
  });

  window.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing = target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

    if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !typing) {
      event.preventDefault();
      if (doc?.undo()) {
        // Undoing a building patch removes its door transition; its pending interior goes with it.
        for (const [id, pending] of pendingSpaces) {
          if (doc.transitionAt(pending.door.x, pending.door.y)?.toSpace !== id) pendingSpaces.delete(id);
        }
        refreshPending();
        buildingRect = null;
        selectedMonster = null;
        selectedTransition = null;
        refreshInspector();
        redraw();
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault();
      void save();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && !typing) {
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

  // --- chrome: mode + tool buttons --------------------------------------------------------------

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
    if (mode === 'transition') paletteEl.append(buildHint('Click an empty cell to place a transition. Drag an existing marker to move it. Set its destination space in the panel on the right. Delete/Backspace removes the selected transition.'));
  }

  function buildHint(text: string): HTMLElement {
    const div = document.createElement('div');
    div.className = 'hint';
    div.textContent = text;
    return div;
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
          `Drag a rectangle on the world map (at least ${MIN_BUILDING_W}x${MIN_BUILDING_H}); a form appears on the right to name it, pick the door and create the building and its interior space.`,
        ),
      );
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
      button.textContent = visual.glyph;
      button.title = def.id;
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
      label.textContent = def.hostile ? def.name : `${def.name} (peaceful)`;
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
    if (mode === 'transition') {
      inspectorEl.append(selectedTransition ? buildTransitionForm(selectedTransition) : buildHint('No transition selected.'));
      return;
    }
    if (mode === 'tile' && tileTool === 'building') {
      inspectorEl.append(buildingRect ? buildBuildingForm(buildingRect) : buildHint('Drag a rectangle to start a new building.'));
      return;
    }
    inspectorEl.append(buildHint('Switch to the NPCs, Monsters or Transitions mode to edit markers.'));
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
    buildingForm = { name: '', id: '', idEdited: false, side: 'S', offset: defaultDoorOffset(rect, 'S') };
    refreshInspector();
    redraw();
  }

  function currentBuildingParams(rect: BuildingRect) {
    return {
      id: buildingForm.id,
      name: buildingForm.name,
      rect,
      doorSide: buildingForm.side,
      doorOffset: buildingForm.offset,
    };
  }

  function allSpaceIds(): string[] {
    return [...spaceEntries.map((e) => e.id), ...pendingSpaces.keys()];
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
    const idInput = document.createElement('input');
    idInput.type = 'text';
    idInput.value = buildingForm.id;
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
      const json = doc.toJSON();
      const errors = validateBuilding(json, allSpaceIds(), currentBuildingParams(rect));
      const lines = errors.map((e) => `x ${e}`);
      if (errors.length === 0 && !outsideDoorWalkable(json, rect, buildingForm.side, buildingForm.offset)) {
        lines.push('! The cell outside the door is not walkable (rock/wall) - the door will open onto nothing.');
      }
      if (buildingMessage) lines.unshift(buildingMessage);
      messageEl.textContent = lines.join('\n');
      messageEl.style.color = errors.length > 0 || buildingMessage ? PALETTE.uiDanger : PALETTE.uiAmber;
    };

    nameInput.addEventListener('input', () => {
      buildingForm.name = nameInput.value;
      if (!buildingForm.idEdited) {
        buildingForm.id = slugify(nameInput.value);
        idInput.value = buildingForm.id;
      }
      buildingMessage = '';
      refreshMessage();
    });
    idInput.addEventListener('input', () => {
      buildingForm.id = idInput.value;
      buildingForm.idEdited = true;
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

    form.append(field('Name', nameInput), field('Id', idInput), field('Door side', sideSelect));
    form.append(field(`Door position along that side (${range().min}..${range().max})`, offsetInput));
    form.append(messageEl);

    const createButton = document.createElement('button');
    createButton.textContent = 'Create';
    createButton.addEventListener('click', () => {
      if (!doc) return;
      const params = currentBuildingParams(rect);
      const errors = validateBuilding(doc.toJSON(), allSpaceIds(), params);
      if (doc.id !== 'world') errors.unshift('Buildings can only be created while editing the world map.');
      if (errors.length > 0) {
        buildingMessage = 'Cannot create:';
        refreshMessage();
        return;
      }
      const result = buildBuilding(params);
      doc.applyBuildingPatch(result.outdoorPatch);
      pendingSpaces.set(params.id, {
        file: uniqueFileName(params.id),
        json: result.interior,
        door: { x: result.outdoorPatch.transition.x, y: result.outdoorPatch.transition.y },
      });
      buildingRect = null;
      buildingMessage = '';
      refreshPending();
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

  function uniqueFileName(id: string): string {
    const taken = new Set([...spaceEntries.map((e) => e.file), ...[...pendingSpaces.values()].map((p) => p.file)]);
    let file = idToFileName(id);
    for (let n = 2; taken.has(file); n++) file = idToFileName(`${id}-${n}`);
    return file;
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
    info.textContent = `${monster.defId} @ (${monster.x}, ${monster.y})${def && !def.hostile ? ' (peaceful)' : ''}`;
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

  // --- chrome: zoom + save --------------------------------------------------------------------

  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-zoom]')) {
    button.addEventListener('click', () => {
      const index = ZOOM_STEPS.indexOf(cell);
      const delta = Number(button.dataset['zoom'] ?? '0');
      const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + delta))];
      if (next !== undefined && next !== cell) setZoom(next);
    });
  }

  function downloadFallback(json: string, fileName: string = currentFile): void {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function post(file: string, json: string): Promise<boolean> {
    try {
      const response = await fetch(`/__map?file=${file}`, { method: 'POST', body: json });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function save(): Promise<void> {
    if (!doc) return;
    // New interiors first, the world map (which references them) last — a half-finished save then
    // leaves orphan files rather than a door into a space that does not exist.
    let failedNew = 0;
    for (const [id, pending] of [...pendingSpaces]) {
      const json = JSON.stringify(pending.json, null, 2) + '\n';
      if (await post(pending.file, json)) {
        pendingSpaces.delete(id);
      } else {
        failedNew++;
        downloadFallback(json, pending.file);
      }
    }
    refreshPending();

    const json = JSON.stringify(doc.toJSON(), null, 2) + '\n';
    if (failedNew > 0) {
      downloadFallback(json);
      saveButton.textContent = 'Save failed — downloaded instead';
      return;
    }
    if (await post(currentFile, json)) {
      dirty = false;
      saveButton.textContent = 'Saved';
      await refreshSpaceList();
    } else {
      // No dev server (e.g. a static build) or a rejected write: download so work is never lost.
      downloadFallback(json);
      saveButton.textContent = 'Save failed — downloaded instead';
    }
  }
  saveButton.addEventListener('click', () => void save());

  // The dev server full-reloads this page whenever a map JSON changes (including our own save), so
  // the open file is kept in the URL hash to land back on the same map afterwards.
  await refreshSpaceList();
  const hashed = spaceEntries.find((e) => e.file === location.hash.slice(1));
  await loadFile(hashed?.file ?? currentFile);
}

const LAYOUT = `
  <header>
    <strong>New Vegas RL — Map Editor</strong>
    <select id="file"><option value="worldMap.json">World</option></select>
    <span class="tools" id="mode-tools">
      <button data-mode="tile" class="on">Tiles</button>
      <button data-mode="height">Height</button>
      <button data-mode="npc">NPCs</button>
      <button data-mode="monster">Monsters</button>
      <button data-mode="transition">Transitions</button>
    </span>
    <span class="tools">
      <button data-zoom="-1">&minus;</button>
      <span id="zoom">22px</span>
      <button data-zoom="1">+</button>
    </span>
    <span class="grow"></span>
    <span id="pending"></span>
    <span id="status">&nbsp;</span>
    <button id="save">Save</button>
  </header>
  <div id="load-error"></div>
  <div id="body">
    <aside id="palette"></aside>
    <main><div id="canvas-wrap"><canvas id="map"></canvas></div></main>
    <aside id="inspector"></aside>
  </div>
`;

const STYLE = `
  body { margin: 0; background: ${PALETTE.uiBg}; color: ${PALETTE.uiDim};
         font: 13px ui-monospace, 'Cascadia Mono', 'DejaVu Sans Mono', Consolas, monospace; }
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
  button.danger { border-color: ${PALETTE.uiDanger}; color: ${PALETTE.uiDanger}; margin-top: 8px; }
  .tools { display: flex; flex-wrap: wrap; gap: 4px; }
  #pending { color: ${PALETTE.uiAmber}; }
  #status { color: ${PALETTE.uiDim}; min-width: 140px; }
  #load-error { padding: 6px 12px; }
  #load-error.bad { background: #3a1616; color: #ffb4b4; border-bottom: 1px solid ${PALETTE.uiBorder}; }
  #body { display: flex; height: calc(100vh - 42px); box-sizing: border-box; }
  #palette { width: 230px; padding: 10px; border-right: 1px solid ${PALETTE.uiBorder}; overflow-y: auto; }
  #inspector { width: 240px; padding: 10px; border-left: 1px solid ${PALETTE.uiBorder}; overflow-y: auto; }
  main { flex: 1; overflow: auto; display: flex; align-items: flex-start; justify-content: flex-start; }
  #canvas-wrap { padding: 12px; }
  canvas { display: block; cursor: crosshair; image-rendering: pixelated; }
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
