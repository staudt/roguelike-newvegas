import { GROUND_LEVELS, MAX_GROUND_HEIGHT, PALETTE } from '../config/palette';
import { isConnectedWall, wallGlyph } from '../ui/WallGlyphs';
import { linePoints, type Point } from '../utils/geometry';
import { TILES, visualFor } from '../world/Tile';
import type { SpaceJSON } from '../world/MapLoader';
import { type EditableNpc, type EditableTransition, MapDocument } from './MapDocument';

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

const ALLOWED_FILES = ['worldMap.json', 'prospectorSaloon.json'] as const;
type MapFile = (typeof ALLOWED_FILES)[number];

const DEFAULT_CELL = 22;
const ZOOM_STEPS = [10, 14, 18, 22, 28, 36];

type Mode = 'tile' | 'height' | 'npc' | 'transition';
type TileTool = 'pencil' | 'line' | 'rect' | 'fill' | 'pick';
type HeightTool = 'raise' | 'lower' | 'set';

const PAINTABLE_TILES = ['ground', 'rock', 'wall', 'door', 'floor'] as const;

async function fetchSpace(file: MapFile): Promise<SpaceJSON> {
  const response = await fetch(`/__map?file=${file}`);
  if (!response.ok) throw new Error(`GET /__map?file=${file} -> ${response.status}`);
  return (await response.json()) as SpaceJSON;
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

  let currentFile: MapFile = 'worldMap.json';
  let doc: MapDocument | null = null;
  let cell = DEFAULT_CELL;
  let dirty = false;

  let mode: Mode = 'tile';
  let tileTool: TileTool = 'pencil';
  let brushTile: string = 'ground';
  let heightTool: HeightTool = 'set';
  let heightLevel = 0;

  let selectedNpcId: string | null = null;
  let selectedTransition: EditableTransition | null = null;

  let painting = false;
  let anchor: Point | null = null;
  /** Cells already touched this stroke — keeps raise/lower from double-applying on a slow drag. */
  let strokeVisited = new Set<string>();

  // --- loading --------------------------------------------------------------------------------

  async function loadFile(file: MapFile): Promise<void> {
    try {
      const data = await fetchSpace(file);
      doc = new MapDocument(data);
      currentFile = file;
      dirty = false;
      selectedNpcId = null;
      selectedTransition = null;
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
    if (dirty && !window.confirm('Discard unsaved changes and load the other map?')) {
      fileSelect.value = currentFile;
      return;
    }
    void loadFile(fileSelect.value as MapFile);
  });

  // --- drawing ----------------------------------------------------------------------------------

  function setZoom(next: number): void {
    if (!doc) return;
    cell = next;
    canvas.width = doc.width * cell;
    canvas.height = doc.height * cell;
    ctx.font = `${Math.round(cell * 0.72)}px "Cascadia Mono", "DejaVu Sans Mono", Consolas, monospace`;
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
        const px = x * cell;
        const py = y * cell;
        ctx.fillStyle = visual.bg;
        ctx.fillRect(px, py, cell, cell);
        ctx.fillStyle = visual.fg;
        ctx.fillText(glyph, px + cell / 2, py + cell / 2);
      }
    }

    for (const transition of doc.transitions) {
      drawMarker(transition.x, transition.y, '>', PALETTE.interactableFg, transition === selectedTransition);
    }
    for (const npc of doc.npcs) {
      drawMarker(npc.x, npc.y, '@', npc.fg ?? PALETTE.npcFg, npc.id === selectedNpcId);
    }

    if (doc.playerStart) {
      drawMarker(doc.playerStart.x, doc.playerStart.y, '@', PALETTE.playerFg, false);
    }
  }

  function drawMarker(x: number, y: number, glyph: string, fg: string, selected: boolean): void {
    const px = x * cell;
    const py = y * cell;
    ctx.fillStyle = fg;
    ctx.fillText(glyph, px + cell / 2, py + cell / 2);
    if (selected) {
      ctx.save();
      ctx.strokeStyle = PALETTE.hostileRing;
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1, py + 1, cell - 2, cell - 2);
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
    if (!doc || !painting || !anchor || tileTool !== 'pencil') return;
    doc.lineTile(anchor, at, brushTile);
    anchor = at;
    redraw();
    markDirty();
  }

  function handleTileMouseUp(at: Point): void {
    if (!doc || !painting || !anchor) return;
    if (tileTool === 'line') doc.lineTile(anchor, at, brushTile);
    if (tileTool === 'rect') doc.rectTile(anchor, at, brushTile);
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
    if (mode === 'npc') handleNpcMouseDown(at);
    if (mode === 'transition') handleTransitionMouseDown(at);
  });

  canvas.addEventListener('mousemove', (event) => {
    if (!doc) return;
    const at = cellAt(event);
    const height = doc.heightAt(at.x, at.y);
    status.textContent = `${at.x}, ${at.y}   ${doc.tileAt(at.x, at.y)}${doc.tileAt(at.x, at.y) === 'ground' ? ` h${height}` : ''}`;
    if (mode === 'tile') handleTileMouseMove(at);
    if (mode === 'height') handleHeightMouseMove(at);
    if (mode === 'npc') handleNpcMouseMove(at);
    if (mode === 'transition') handleTransitionMouseMove(at);
  });

  window.addEventListener('mouseup', (event) => {
    if (!painting) return;
    if (doc && mode === 'tile') handleTileMouseUp(cellAt(event));
    painting = false;
    anchor = null;
  });

  window.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing = target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

    if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !typing) {
      event.preventDefault();
      if (doc?.undo()) {
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
      { id: 'fill', label: 'Fill' },
      { id: 'pick', label: 'Pick' },
    ];
    for (const entry of toolList) {
      const button = document.createElement('button');
      button.textContent = entry.label;
      button.className = tileTool === entry.id ? 'on' : '';
      button.addEventListener('click', () => {
        tileTool = entry.id;
        refreshPalette();
      });
      tools.append(button);
    }
    wrap.append(tools);

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
    if (mode === 'transition') {
      inspectorEl.append(selectedTransition ? buildTransitionForm(selectedTransition) : buildHint('No transition selected.'));
      return;
    }
    inspectorEl.append(buildHint('Switch to the NPCs or Transitions mode to edit markers.'));
  }

  function field(labelText: string, input: HTMLElement): HTMLElement {
    const row = document.createElement('label');
    row.className = 'field';
    const span = document.createElement('span');
    span.textContent = labelText;
    row.append(span, input);
    return row;
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

  function downloadFallback(json: string): void {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = currentFile;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function save(): Promise<void> {
    if (!doc) return;
    const json = JSON.stringify(doc.toJSON(), null, 2);
    try {
      const response = await fetch(`/__map?file=${currentFile}`, { method: 'POST', body: json });
      if (response.ok) {
        dirty = false;
        saveButton.textContent = 'Saved';
      } else {
        downloadFallback(json);
        saveButton.textContent = 'Save failed — downloaded instead';
      }
    } catch {
      // No dev server (e.g. a static build): fall back to a download so work is never lost.
      downloadFallback(json);
      saveButton.textContent = 'Downloaded (no dev server)';
    }
  }
  saveButton.addEventListener('click', () => void save());

  await loadFile(currentFile);
}

const LAYOUT = `
  <header>
    <strong>New Vegas RL — Map Editor</strong>
    <select id="file">
      <option value="worldMap.json">World (Goodsprings)</option>
      <option value="prospectorSaloon.json">Prospector Saloon</option>
    </select>
    <span class="tools" id="mode-tools">
      <button data-mode="tile" class="on">Tiles</button>
      <button data-mode="height">Height</button>
      <button data-mode="npc">NPCs</button>
      <button data-mode="transition">Transitions</button>
    </span>
    <span class="tools">
      <button data-zoom="-1">&minus;</button>
      <span id="zoom">22px</span>
      <button data-zoom="1">+</button>
    </span>
    <span class="grow"></span>
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
  .tools { display: flex; gap: 4px; }
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
  .id-display { font-size: 12px; color: ${PALETTE.uiAmber}; word-break: break-all; }
`;

void boot();
