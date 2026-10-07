import { limbCondition } from '../combat/Limbs';
import { capitalize } from '../combat/Narration';
import { theName, type Creature } from '../entities/Creature';
import { createMonster } from '../entities/Monster';
import { INTERACTION_LABELS, type Npc } from '../entities/Npc';
import { createPlayer } from '../entities/Player';
import { InputManager } from '../input/InputManager';
import { addToStack, createItem, isUndroppable, itemLabel, type Item } from '../items/Item';
import { readiedAmmoCount, wieldedGun } from '../items/Carrying';
import { isWieldable, itemDef } from '../items/ItemData';
import { creatureAt } from '../entities/Creature';
import { chebyshevDistance, directionBetween, type Direction, type Point } from '../utils/geometry';
import type { ChunkJSON } from '../world/ChunkCodec';
import { ChunkStreamer, parseChunkPath, type ChunkCoord } from '../world/ChunkStreamer';
import type { ChunkedMap } from '../world/ChunkedMap';
import { isWorldMeta, loadSpace, loadWorld, type SpaceJSON, type WorldMetaJSON } from '../world/MapLoader';
import { inventoryLetter, inventoryLines, itemTags, orderedInventory } from '../ui/itemLists';
import { Menu, type MenuAnchor, type MenuOption, type PanelLine } from '../ui/Menu';
import { buildCommandList, type CommandRow } from '../ui/commandMenu';
import { MessageLog } from '../ui/MessageLog';
import type { MessageGroup } from '../ui/messageGroups';
import { PALETTE } from '../config/palette';
import { Renderer } from '../ui/Renderer';
import { limbShortName, StatusBar } from '../ui/StatusBar';
import { TRAVEL_STEP_MS } from '../config/constants';
import { EventBus, type GameEvents } from './EventBus';
import { addGroundItem, groundItemsAt } from './GroundItems';
import { kickDirection } from './Kick';
import { planRun, planTravel, snapshotTravel, travelInterruption } from './Travel';
import { dropItem, fireGun, pickUp, readyAmmo, useItem } from './Items';
import {
  addMessage,
  createGameState,
  getActiveSpace,
  type GameState,
  type Space,
} from './GameState';
import {
  advanceTurn,
  confirmAttack,
  fightDirection,
  recomputeVisibility,
  swapWeapons,
  tryMovePlayer,
  useInteraction,
  wieldItem,
} from './TurnManager';

/**
 * What the next keypress means. A single discriminated union rather than scattered booleans:
 * exactly one mode is active, and every transition goes through `setMode`.
 */
type Mode =
  | { kind: 'normal' }
  | { kind: 'direction'; command: 'fight' | 'fire' | 'kick' | 'run' }
  | { kind: 'animating' } // a shot tracer is playing; keys are swallowed
  | { kind: 'confirm'; target: Creature } // a Yes/No menu is open (its callback lives in the Menu)
  | { kind: 'menu' } // an option menu is open in the overlay (its callback lives in the Menu)
  | { kind: 'panel' } // a read-only panel (inventory, character sheet, help)
  | { kind: 'game-over' };

type ModeName = 'normal' | 'direction' | 'confirm' | 'menu' | 'panel' | 'animating' | 'game-over';

type ShotEvent = GameEvents['shot-fired'];

/** Milliseconds per cell the tracer travels, and how long the hit flash lingers. */
const TRACER_STEP_MS = 25;
const HIT_FLASH_MS = 90;

const MODE_NAMES: Record<Mode['kind'], ModeName> = {
  normal: 'normal',
  direction: 'direction',
  confirm: 'confirm',
  menu: 'menu',
  panel: 'panel',
  animating: 'animating',
  'game-over': 'game-over',
};

const WORLD_SPACE_ID = 'world';

/**
 * Every .json directly in src/world/goodsprings is found at build time — adding a map file (the
 * editor's "New building" helper does) needs no code change here. The one with `kind: 'chunked'`
 * is the world's metadata; any others are flat spaces (a building's extra floor).
 */
const MAP_DATA = collectMaps(
  import.meta.glob<SpaceJSON | WorldMetaJSON>('../world/goodsprings/*.json', {
    eager: true,
    import: 'default',
  }),
);

/** The world's cells live in chunks/<cx>_<cy>.json, one lazy import each (a chunk per request). */
const CHUNK_LOADERS = import.meta.glob<ChunkJSON>('../world/goodsprings/chunks/*.json', {
  import: 'default',
});

const CHUNK_LOADERS_BY_COORD = new Map<string, () => Promise<ChunkJSON>>();
const CHUNK_COORDS: ChunkCoord[] = [];
for (const [path, loader] of Object.entries(CHUNK_LOADERS)) {
  const coord = parseChunkPath(path);
  if (!coord) continue;
  CHUNK_LOADERS_BY_COORD.set(`${coord.cx},${coord.cy}`, loader);
  CHUNK_COORDS.push(coord);
}

function collectMaps(files: Record<string, SpaceJSON | WorldMetaJSON>): {
  world: WorldMetaJSON;
  flat: SpaceJSON[];
} {
  const byId = new Map<string, string>();
  let world: WorldMetaJSON | undefined;
  const flat: SpaceJSON[] = [];
  for (const [path, data] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const earlier = byId.get(data.id);
    if (earlier !== undefined) {
      throw new Error(`Duplicate space id "${data.id}" in ${path} and ${earlier}`);
    }
    byId.set(data.id, path);
    if (isWorldMeta(data)) world = data;
    else flat.push(data);
  }
  if (!world || world.id !== WORLD_SPACE_ID) {
    throw new Error(`No chunked world with id "${WORLD_SPACE_ID}" found in src/world/goodsprings/*.json`);
  }
  return { world, flat };
}

const HELP_LINES: PanelLine[] = [
  { text: 'Arrows        move (two arrows together = diagonal)' },
  { text: 'F + direction fight in that direction' },
  { text: 'Enter         command menu (every command and its key)' },
  { text: 'f + direction fire the wielded gun' },
  { text: 'k + direction kick (may knock the target back)' },
  { text: 'g + direction go: walk that way until something stops you' },
  { text: 'Click         walk there (stops when anything turns up); click someone to talk,' },
  { text: '              or an adjacent creature to attack; click menu rows to pick' },
  { text: 'x             swap wielded and alternate weapon' },
  { text: ',             pick up' },
  { text: 'd             drop' },
  { text: 'w             wield a weapon, gun or bare hands' },
  { text: 'Q             ready ammunition (free)' },
  { text: 'q             quaff / use a stimpak' },
  { text: 'i             inventory' },
  { text: 'C             character sheet' },
  { text: '.             wait a turn' },
  { text: '?             this help' },
  { text: 'Esc           cancel a prompt or close a window' },
];

/**
 * Top-level orchestrator: owns the GameState and every long-lived service (renderer, input,
 * message log, status bar, menu overlay), and is the only place that wires them together. The
 * engine commands live in TurnManager; this class only decides which one a key means in the
 * current input mode, and shows the result.
 */
export class Game {
  private events = new EventBus<GameEvents>();
  private unsubscribe: Array<() => void> = [];
  private readonly renderer: Renderer;
  private readonly messageLog: MessageLog;
  private readonly statusBar: StatusBar;
  private readonly menu: Menu;
  private readonly input: InputManager;
  private state: GameState;
  private mode: Mode = { kind: 'normal' };
  private debugMonsterCounter = 0;
  private streamer!: ChunkStreamer;
  private streamedChunk: ChunkCoord | null = null;
  private pendingShots: ShotEvent[] = [];
  private playingShots = false;
  /** Bumped by restart; a tracer timer from an older generation does nothing. */
  private animationToken = 0;
  private lastShotEvent: ShotEvent | null = null;
  /** Message ranges per player input, so one action reads as one log line. UI-only. */
  private messageGroups: MessageGroup[] = [];
  private inputDepth = 0;
  /** A click-to-travel or `g` walk in progress: the steps left, and who to bump into on arrival. */
  private travel: { path: Point[]; interact: Npc | null } | null = null;
  private travelTimer: number | null = null;
  private readonly canvas: HTMLCanvasElement;

  constructor(
    canvas: HTMLCanvasElement,
    messageLogEl: HTMLElement,
    statusBarEl: HTMLElement,
    menuEl: HTMLElement,
  ) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.messageLog = new MessageLog(messageLogEl);
    this.statusBar = new StatusBar(statusBarEl);
    this.menu = new Menu(menuEl);
    this.menu.wrapPick = (run) => this.groupInput(run);

    this.state = this.buildState();
    this.bindEvents();

    this.input = new InputManager({
      onDirection: (direction) => this.handleDirection(direction),
      onKey: (key) => this.handleKey(key),
    });

    canvas.addEventListener('click', (event) => this.handleClick(event));

    window.addEventListener('resize', () => {
      if (this.renderer.resize()) this.render();
      else this.menu.reposition();
    });
  }

  /** Loads the chunks around the player first, so the very first frame already has ground. */
  async start(): Promise<void> {
    this.renderer.resize();
    await this.loadInitialChunks();
    recomputeVisibility(this.state);
    this.render();
    this.exposeDebugBridge();
  }

  /** Fresh world from the map JSON. Always rebuilt from scratch: permadeath, no continue. */
  private buildState(): GameState {
    const spaces: Record<string, Space> = {};
    const world = loadWorld(MAP_DATA.world, []);
    spaces[world.id] = world;
    for (const data of MAP_DATA.flat) {
      const space = loadSpace(data);
      spaces[space.id] = space;
    }
    this.streamer = new ChunkStreamer(world.grid as ChunkedMap, CHUNK_COORDS, (cx, cy) => {
      const load = CHUNK_LOADERS_BY_COORD.get(`${cx},${cy}`);
      if (!load) return Promise.reject(new Error(`No chunk file for (${cx},${cy})`));
      return load();
    });
    this.streamedChunk = null;
    const start = MAP_DATA.world.playerStart ?? { x: 0, y: 0 };
    const state = createGameState(createPlayer(start.x, start.y), spaces, world.id);
    addMessage(state, `Welcome to ${spaces[state.activeSpaceId]!.name}.`);
    return state;
  }

  private bindEvents(): void {
    for (const off of this.unsubscribe) off();
    this.events = new EventBus<GameEvents>();
    this.unsubscribe = [
      this.events.on('attack-prompted', ({ target, kick }) => this.openConfirmMenu(target, kick)),
      this.events.on('npc-menu', ({ npc }) => this.openNpcMenu(npc)),
      this.events.on('shot-fired', (shot) => {
        this.lastShotEvent = shot;
        this.pendingShots.push(shot);
      }),
      this.events.on('player-died', () => this.showDeathScreen()),
    ];
  }

  private async loadInitialChunks(): Promise<void> {
    await this.streamer.ensureAround(this.state.player);
    this.streamedChunk = ChunkStreamer.chunkOf(this.state.player);
  }

  private async restart(): Promise<void> {
    this.cancelTravel();
    this.menu.hide();
    this.cancelAnimations();
    this.state = this.buildState();
    this.messageGroups = [];
    this.bindEvents();
    this.mode = { kind: 'normal' };
    await this.loadInitialChunks();
    recomputeVisibility(this.state);
    this.render();
  }

  /**
   * When the player crosses into another chunk, fire off loading the ring around them and then
   * unload what is now far away. Fire-and-forget: the 3x3 ring always covers the sight radius, so
   * the frame drawn now is complete, and the next one picks up whatever arrives.
   */
  private streamChunks(): void {
    const here = ChunkStreamer.chunkOf(this.state.player);
    const last = this.streamedChunk;
    if (last && last.cx === here.cx && last.cy === here.cy) return;
    this.streamedChunk = here;
    const streamer = this.streamer;
    const center = { x: this.state.player.x, y: this.state.player.y };
    void streamer
      .ensureAround(center)
      .then(() => {
        streamer.unloadFar(center);
        if (streamer !== this.streamer) return;
        recomputeVisibility(this.state);
        this.render();
      })
      .catch((err) => console.error('Chunk streaming failed', err));
  }

  // ---- input modes -------------------------------------------------------------------------

  private setMode(mode: Mode): void {
    this.mode = mode;
  }

  private promptText(): string | null {
    if (this.mode.kind !== 'direction') return null;
    const verb = { fire: 'Fire', kick: 'Kick', fight: 'Attack', run: 'Go' }[this.mode.command];
    return `${verb} in which direction? (arrows, Esc cancels)`;
  }

  /** Anchor for a menu about `target`: beside its cell, never over it or the player. */
  private anchorTo(target: { x: number; y: number }): () => MenuAnchor {
    return () => {
      const cell = this.renderer.cellRect(target.x, target.y);
      const player = this.renderer.cellRect(this.state.player.x, this.state.player.y);
      return { anchor: cell, avoid: [cell, player], gapX: cell.width, gapY: cell.height };
    };
  }

  /**
   * Runs one player input and records the messages it caused as one log group. Re-entrant: only the
   * outermost call records. A restart inside the input swaps the state, so nothing is recorded then.
   */
  private groupInput(run: () => void): void {
    if (this.inputDepth > 0) {
      run();
      return;
    }
    const state = this.state;
    const from = state.messageLog.length;
    this.inputDepth++;
    try {
      run();
    } finally {
      this.inputDepth--;
      if (this.state === state && state.messageLog.length > from) {
        this.messageGroups.push({ from, to: state.messageLog.length });
        // The input's own render ran before the group existed; redraw the log with it.
        this.messageLog.render(state.messageLog, this.messageGroups);
      }
    }
  }

  private handleDirection(direction: Direction): void {
    this.cancelTravel();
    this.groupInput(() => this.handleDirectionNow(direction));
  }

  private handleKey(key: string): void {
    this.cancelTravel();
    this.groupInput(() => this.handleKeyNow(key));
  }

  private handleDirectionNow(direction: Direction): void {
    const mode = this.mode;
    switch (mode.kind) {
      case 'normal':
        tryMovePlayer(this.state, direction, this.events);
        break;
      case 'direction':
        this.setMode({ kind: 'normal' });
        if (mode.command === 'fire') fireGun(this.state, direction, this.events);
        else if (mode.command === 'kick') kickDirection(this.state, direction, this.events);
        else if (mode.command === 'run') this.startRun(direction);
        else fightDirection(this.state, direction, this.events);
        break;
      case 'confirm':
      case 'menu':
        // Up/Down move the cursor; sideways does nothing.
        if (direction === 'N') this.menu.handleKey('ArrowUp');
        else if (direction === 'S') this.menu.handleKey('ArrowDown');
        break;
      default:
        break; // panel, game-over, animating: arrows do nothing
    }
    this.render();
  }

  private handleKeyNow(key: string): void {
    const mode = this.mode;
    switch (mode.kind) {
      case 'normal':
        this.handleNormalKey(key);
        break;
      case 'direction':
        // Arrows are routed by handleDirection; any other key abandons the command.
        this.setMode({ kind: 'normal' });
        break;
      case 'confirm':
      case 'menu': {
        const result = this.menu.handleKey(key);
        if (result === 'cancel') this.closeMenu();
        break;
      }
      case 'panel':
        if (key === 'Escape' || key === 'Enter' || key === ' ') this.closeMenu();
        break;
      case 'animating':
        return; // swallowed; the animation re-renders itself
      case 'game-over':
        if (key === 'Enter') {
          void this.restart();
          return;
        }
        break;
    }
    this.render();
  }

  private handleNormalKey(key: string): void {
    switch (key) {
      case 'F':
        this.setMode({ kind: 'direction', command: 'fight' });
        break;
      case 'k':
        this.setMode({ kind: 'direction', command: 'kick' });
        break;
      case 'g':
        this.setMode({ kind: 'direction', command: 'run' });
        break;
      case 'x':
        swapWeapons(this.state, this.events);
        break;
      case 'W':
        addMessage(this.state, "You can't do that yet.");
        break;
      case 'f':
        this.setMode({ kind: 'direction', command: 'fire' });
        break;
      case ',':
        this.pickUpCommand();
        break;
      case 'd':
        this.openDropMenu();
        break;
      case 'Q':
        this.openReadyMenu();
        break;
      case 'q':
        this.openUseMenu();
        break;
      case '.':
        advanceTurn(this.state, this.events);
        break;
      case 'Enter':
        this.openCommandMenu();
        break;
      case 'w':
        this.openWieldMenu();
        break;
      case 'i':
        this.showInventory();
        break;
      case 'C':
        this.showCharacterSheet();
        break;
      case '?':
        this.menu.showPanel('Keys', HELP_LINES, 'Esc to close');
        this.setMode({ kind: 'panel' });
        break;
      default:
        break;
    }
  }

  private closeMenu(): void {
    this.menu.hide();
    this.setMode({ kind: 'normal' });
  }

  // ---- menus and screens -------------------------------------------------------------------

  private openNpcMenu(npc: Npc): void {
    const taken = new Set<string>();
    const options = npc.interactions.map((id) => {
      const label = INTERACTION_LABELS[id];
      const letter = label.charAt(0).toLowerCase();
      const hotkey = taken.has(letter) ? undefined : letter;
      taken.add(letter);
      return { label, hotkey };
    });
    this.menu.open(
      npc.name,
      options,
      (index) => {
      const id = npc.interactions[index]!;
      // Close first: the interaction may itself open something (or kill the player).
      this.closeMenu();
      useInteraction(this.state, npc, id, this.events);
      this.render();
      },
      0,
      undefined,
      this.anchorTo(npc),
    );
    this.setMode({ kind: 'menu' });
  }

  private openConfirmMenu(target: Creature, kick?: Direction): void {
    this.menu.open(
      `Really ${kick ? 'kick' : 'attack'} ${theName(target)}?`,
      [
        { label: kick ? 'Yes, kick' : 'Yes, attack', hotkey: 'y' },
        { label: 'No', hotkey: 'n' },
      ],
      (index) => {
        this.closeMenu();
        if (index === 0) {
          if (kick) kickDirection(this.state, kick, this.events, undefined, true);
          else confirmAttack(this.state, target, this.events);
        }
        this.render();
      },
      1, // default to No
      'y / n, Esc to cancel',
      this.anchorTo(target),
    );
    this.setMode({ kind: 'confirm', target });
  }

  private commandRows(): CommandRow[] {
    const p = this.state.player;
    const gun = wieldedGun(p);
    const stacks = p.inventory.filter((i) => itemDef(i.defId).kind === 'ammo');
    return buildCommandList({
      itemsHere: groundItemsAt(this.state, p.x, p.y).length,
      gunWielded: gun !== null,
      readiedAmmo: readiedAmmoCount(p),
      ammoInPack: gun
        ? stacks.filter((i) => {
            const def = itemDef(i.defId);
            return def.kind === 'ammo' && def.ammoType === gun.ammoType;
          }).length
        : 0,
      hurt: p.hp < p.maxHp,
      consumables: p.inventory.filter((i) => itemDef(i.defId).kind === 'consumable').length,
      droppable: p.inventory.filter((i) => !isUndroppable(i)).length,
      hasAlternate: p.alternate !== null || p.wielded !== null,
    });
  }

  private openCommandMenu(): void {
    const rows = this.commandRows();
    // A divider between the contextual group and the standard list, when both exist. `entries`
    // maps each menu index back to its row (undefined for the divider).
    const entries: Array<CommandRow | undefined> = [];
    const options: MenuOption[] = [];
    const hasContext = rows.some((r) => r.group === 'context');
    rows.forEach((c, i) => {
      if (hasContext && c.group === 'standard' && rows[i - 1]?.group === 'context') {
        entries.push(undefined);
        options.push({ label: '', separator: true });
      }
      entries.push(c);
      options.push({
        label: c.label,
        hotkey: c.key,
        keyHint: c.key,
        disabled: c.disabled,
        hint: c.disabled ? '(not yet)' : undefined,
      });
    });
    this.menu.open(
      'Commands',
      options,
      (index) => {
        this.closeMenu();
        this.handleNormalKey(entries[index]!.key);
        this.render();
      },
      hasContext ? 0 : -1,
      'Key or Up/Down + Enter, Esc/Enter closes',
      this.anchorTo(this.state.player),
    );
    this.setMode({ kind: 'menu' });
  }

  /** Rows for a list of inventory items (letters follow display order). */
  private itemOptions(items: Item[], extra?: (item: Item) => Partial<MenuOption>): MenuOption[] {
    const player = this.state.player;
    return items.map((item, i) => {
      const tags = itemTags(player, item).filter((t) => t !== "(can't drop)");
      return { label: itemLabel(item), hotkey: inventoryLetter(i), hint: tags.join(' ') || undefined, ...extra?.(item) };
    });
  }

  private openItemMenu(
    title: string,
    options: MenuOption[],
    onPick: (index: number) => void,
    selected = 0,
  ): void {
    this.menu.open(
      title,
      options,
      (index) => {
        this.closeMenu();
        onPick(index);
        this.render();
      },
      selected,
      undefined,
      this.anchorTo(this.state.player),
    );
    this.setMode({ kind: 'menu' });
  }

  private pickUpCommand(): void {
    const { x, y } = this.state.player;
    const here = groundItemsAt(this.state, x, y);
    if (here.length <= 1) {
      pickUp(this.state, 'all', this.events); // one item, or the engine's "nothing here"
      return;
    }
    const options: MenuOption[] = [
      { label: 'All of it', hotkey: '-' },
      ...here.map((g, i) => ({ label: itemLabel(g.item), hotkey: inventoryLetter(i) })),
    ];
    this.openItemMenu('Pick up what?', options, (index) => {
      pickUp(this.state, index === 0 ? 'all' : [here[index - 1]!.item.id], this.events);
    });
  }

  private openDropMenu(): void {
    const items = orderedInventory(this.state.player.inventory);
    if (items.length === 0) {
      addMessage(this.state, 'You are carrying nothing.');
      return;
    }
    const options = this.itemOptions(items, (item) =>
      isUndroppable(item) ? { disabled: true, hint: "(can't drop)" } : {},
    );
    this.openItemMenu('Drop what?', options, (index) => dropItem(this.state, items[index]!.id, this.events));
  }

  private openReadyMenu(): void {
    const player = this.state.player;
    const stacks = orderedInventory(player.inventory).filter((i) => itemDef(i.defId).kind === 'ammo');
    if (stacks.length === 0) {
      addMessage(this.state, 'You have no ammunition.');
      return;
    }
    const options: MenuOption[] = [
      { label: 'nothing', hotkey: '-', hint: player.readied === null ? '(readied)' : undefined },
      ...this.itemOptions(stacks).map((o, i) => ({ ...o, hotkey: inventoryLetter(i) })),
    ];
    const current = player.readied === null ? 0 : stacks.findIndex((i) => i.id === player.readied) + 1;
    this.openItemMenu(
      'Ready what?',
      options,
      (index) => readyAmmo(this.state, index === 0 ? null : stacks[index - 1]!.id, this.events),
      current,
    );
  }

  private openUseMenu(): void {
    const items = orderedInventory(this.state.player.inventory).filter(
      (i) => itemDef(i.defId).kind === 'consumable',
    );
    if (items.length === 0) {
      addMessage(this.state, 'You have nothing to use.');
      return;
    }
    this.openItemMenu('Use what?', this.itemOptions(items), (index) =>
      useItem(this.state, items[index]!.id, this.events),
    );
  }

  private openWieldMenu(): void {
    const player = this.state.player;
    const items = orderedInventory(player.inventory).filter((i) => isWieldable(itemDef(i.defId)));
    const options: MenuOption[] = [
      { label: 'bare hands', hotkey: '-', hint: player.wielded === null ? '(wielded)' : undefined },
      ...this.itemOptions(items).map((o, i) => ({ ...o, hotkey: inventoryLetter(i) })),
    ];
    const current = player.wielded === null ? 0 : items.findIndex((i) => i.id === player.wielded) + 1;
    this.openItemMenu(
      'Wield what?',
      options,
      (index) => wieldItem(this.state, index === 0 ? null : items[index - 1]!.id, this.events),
      current,
    );
  }

  private showInventory(): void {
    this.menu.showPanel('Inventory', inventoryLines(this.state.player), 'Esc to close');
    this.setMode({ kind: 'panel' });
  }

  private showCharacterSheet(): void {
    const p = this.state.player;
    const s = p.special;
    const lines: PanelLine[] = [
      { text: 'SPECIAL', cls: 'head' },
      { text: `  Strength     ${s.strength}` },
      { text: `  Perception   ${s.perception}` },
      { text: `  Endurance    ${s.endurance}` },
      { text: `  Charisma     ${s.charisma}` },
      { text: `  Intelligence ${s.intelligence}` },
      { text: `  Agility      ${s.agility}` },
      { text: `  Luck         ${s.luck}` },
      { text: '' },
      { text: `HP ${Math.max(0, p.hp)}/${p.maxHp}    AC ${p.ac}`, cls: p.hp < p.maxHp * 0.3 ? 'danger' : 'head' },
      { text: 'Limbs', cls: 'head' },
      ...p.limbs.map((limb) => {
        const cond = limbCondition(limb);
        return {
          text: `  ${limbShortName(limb.name).padEnd(10)} ${String(Math.max(0, limb.hp)).padStart(3)}/${limb.maxHp}  ${cond}`,
          cls: cond === 'crippled' ? 'danger' : cond === 'hurt' ? 'warn' : '',
        };
      }),
    ];
    this.menu.showPanel(p.name, lines, 'Esc to close');
    this.setMode({ kind: 'panel' });
  }

  private showDeathScreen(): void {
    const log = this.state.messageLog;
    const cause = log[log.length - 1] ?? '';
    this.menu.showPanel(
      'You died.',
      [
        { text: `You survived ${this.state.turnCount} turns.` },
        { text: cause, cls: 'danger' },
        { text: '' },
      ],
      'Press Enter to begin again',
      true,
    );
    this.setMode({ kind: 'game-over' });
  }

  private render(): void {
    // The engine flags death before the event handler necessarily ran (e.g. via the bridge).
    if (this.state.gameOver && this.mode.kind !== 'game-over') this.showDeathScreen();
    this.renderer.render(this.state);
    this.streamChunks();
    this.messageLog.render(this.state.messageLog, this.messageGroups);
    this.statusBar.render(this.state, this.promptText());
    this.menu.reposition();
    this.playQueuedShots();
  }

  // ---- mouse, click-to-travel and running ------------------------------------------------------

  /** A click on the map. Menu rows take their own clicks; this is about the cells under the canvas. */
  private handleClick(event: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const cell = this.renderer.camera.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    this.clickCell(cell);
  }

  /** What a click on a map cell means in the current mode. Also on the debug bridge. */
  private clickCell(cell: Point): void {
    this.cancelTravel();
    this.groupInput(() => {
      const mode = this.mode;
      switch (mode.kind) {
        case 'normal':
          this.clickMap(cell);
          break;
        case 'direction': {
          // Answering "which direction?" with a click on a neighbouring cell; elsewhere cancels it.
          const near = chebyshevDistance(this.state.player, cell) === 1;
          const direction = near ? directionBetween(this.state.player, cell) : null;
          if (direction) this.handleDirectionNow(direction);
          else this.setMode({ kind: 'normal' });
          break;
        }
        case 'confirm':
        case 'menu':
        case 'panel':
          this.closeMenu(); // clicked away from the window
          break;
        default:
          break; // animating, game-over
      }
      this.render();
    });
  }

  private clickMap(cell: Point): void {
    const result = planTravel(this.state, cell);
    if ('refusal' in result) {
      if (result.refusal) addMessage(this.state, result.refusal);
      return;
    }
    const { path, interact } = result.plan;
    if (path.length === 0) {
      // Right beside whoever was clicked: act on them like walking into them.
      const direction = directionBetween(this.state.player, cell);
      if (direction) tryMovePlayer(this.state, direction, this.events);
      return;
    }
    this.startTravel(path, interact);
  }

  /** `g` + direction: walk that way until something stops you. */
  private startRun(direction: Direction): void {
    const path = planRun(this.state, direction);
    if (path.length === 0) {
      addMessage(this.state, "You can't go that way.");
      return;
    }
    this.startTravel(path, null);
  }

  private startTravel(path: Point[], interact: Npc | null): void {
    this.travel = { path: [...path], interact };
    this.stepTravel();
  }

  private cancelTravel(): void {
    if (this.travelTimer !== null) window.clearTimeout(this.travelTimer);
    this.travelTimer = null;
    this.travel = null;
  }

  /**
   * One step of a walk, then the next on a timer. After every step it asks whether anything
   * significant changed (see `travelInterruption`); any key or click cancels it as well.
   */
  private stepTravel(): void {
    this.travelTimer = null;
    const travel = this.travel;
    if (!travel) return;
    if (this.state.gameOver || this.mode.kind !== 'normal') {
      this.cancelTravel();
      return;
    }
    const state = this.state;
    this.groupInput(() => {
      const player = state.player;
      const next = travel.path[0];
      const direction = next ? directionBetween(player, next) : null;
      if (!next || !direction || chebyshevDistance(player, next) !== 1) {
        this.finishTravel();
        return;
      }
      const blocker = creatureAt(getActiveSpace(state), next.x, next.y);
      if (blocker) {
        addMessage(state, `${capitalize(theName(blocker))} is in the way. You stop.`);
        this.cancelTravel();
        this.render();
        return;
      }

      const before = snapshotTravel(state);
      const moved = tryMovePlayer(state, direction, this.events);
      // A closed door opens instead of letting you through: the step is spent, the walk goes on.
      if (player.x === next.x && player.y === next.y) travel.path.shift();
      else if (!moved) {
        this.cancelTravel();
        this.render();
        return;
      }
      this.render();
      if (state.gameOver || this.state !== state || this.mode.kind !== 'normal') {
        this.cancelTravel();
        return;
      }

      const interruption = travelInterruption(state, before);
      if (interruption) {
        if (interruption.message) addMessage(state, interruption.message);
        this.cancelTravel();
        this.render();
        return;
      }
      if (travel.path.length === 0) this.finishTravel();
      else this.travelTimer = window.setTimeout(() => this.stepTravel(), TRAVEL_STEP_MS);
    });
  }

  /** The walk is over. If it was heading for someone to talk to, do that now (their menu or line). */
  private finishTravel(): void {
    const interact = this.travel?.interact ?? null;
    this.cancelTravel();
    if (interact && getActiveSpace(this.state).npcs.includes(interact)) {
      const near = chebyshevDistance(this.state.player, interact) === 1;
      const direction = near ? directionBetween(this.state.player, interact) : null;
      if (direction) tryMovePlayer(this.state, direction, this.events);
    }
    this.render();
  }

  // ---- shot tracer animation ---------------------------------------------------------------

  private cancelAnimations(): void {
    this.animationToken++;
    this.pendingShots = [];
    this.playingShots = false;
    this.renderer.tracer = null;
    if (this.mode.kind === 'animating') this.mode = { kind: 'normal' };
  }

  /**
   * Plays the shots the last action produced, in order, after the turn has completed. Only when the
   * game is idle in normal mode: a death or a confirm menu that appeared during the same turn
   * wins, and the tracers are simply dropped.
   */
  private playQueuedShots(): void {
    if (this.playingShots || this.pendingShots.length === 0) return;
    if (this.mode.kind !== 'normal' || this.state.gameOver) {
      this.pendingShots = [];
      return;
    }
    this.playingShots = true;
    this.setMode({ kind: 'animating' });
    const token = this.animationToken;
    const state = this.state;
    const queue = this.pendingShots;
    this.pendingShots = [];
    const finish = () => {
      if (token !== this.animationToken) return;
      this.playingShots = false;
      this.renderer.tracer = null;
      if (this.mode.kind === 'animating') this.setMode({ kind: 'normal' });
      this.render();
    };
    const playShot = (shot: ShotEvent | undefined) => {
      if (token !== this.animationToken) return;
      if (!shot) return finish();
      const fg = shot.shooterId === state.player.id ? PALETTE.uiAmber : PALETTE.hostileRing;
      let step = 0;
      const tick = () => {
        if (token !== this.animationToken) return;
        const cell = shot.path[step];
        if (cell) {
          this.renderer.tracer = { x: cell.x, y: cell.y, glyph: '\u2022', fg };
          this.renderer.render(state);
          step++;
          setTimeout(tick, TRACER_STEP_MS);
          return;
        }
        const last = shot.path[shot.path.length - 1];
        if (shot.hitId !== undefined && last) {
          this.renderer.tracer = { x: last.x, y: last.y, glyph: '*', fg: PALETTE.uiDanger };
          this.renderer.render(state);
          setTimeout(() => {
            this.renderer.tracer = null;
            playShot(queue.shift());
          }, HIT_FLASH_MS);
          return;
        }
        this.renderer.tracer = null;
        playShot(queue.shift());
      };
      tick();
    };
    playShot(queue.shift());
  }

  /**
   * Dev-only inspection + test-mutation bridge on `window.__game`, present from the first
   * playable build per the project's architecture. `import.meta.env.DEV` is statically false in
   * a production build, so Vite dead-code-eliminates this whole method — it never reaches dist.
   * It deliberately reads `this.state` lazily so it survives a restart.
   */
  private exposeDebugBridge(): void {
    if (!import.meta.env.DEV) return;

    const bridge = {
      getState: () => this.state,
      getActiveSpace: () => getActiveSpace(this.state),
      getPlayer: () => this.state.player,
      listNpcs: () => getActiveSpace(this.state).npcs,
      listMonsters: () => getActiveSpace(this.state).monsters,
      getMode: (): ModeName => MODE_NAMES[this.mode.kind],
      teleport: (x: number, y: number) => {
        this.state.player.x = x;
        this.state.player.y = y;
        recomputeVisibility(this.state);
        this.render();
      },
      enter: (spaceId: string) => {
        if (!this.state.spaces[spaceId]) throw new Error(`Unknown space "${spaceId}"`);
        this.state.activeSpaceId = spaceId;
        recomputeVisibility(this.state);
        this.render();
      },
      say: (entityId: string) => {
        const npc = getActiveSpace(this.state).npcs.find((n) => n.id === entityId);
        if (!npc) throw new Error(`Unknown NPC "${entityId}"`);
        addMessage(this.state, `${npc.name}: "${npc.dialogue[0]}"`);
        this.render();
      },
      spawnMonster: (defId: string, x: number, y: number) => {
        const monster = createMonster(`dbg-monster-${this.debugMonsterCounter++}`, defId, x, y);
        getActiveSpace(this.state).monsters.push(monster);
        recomputeVisibility(this.state);
        this.render();
        return monster;
      },
      give: (defId: string, count?: number) => {
        const item = addToStack(this.state.player.inventory, createItem(defId, count));
        this.render();
        return item;
      },
      dropAt: (defId: string, x: number, y: number, count?: number) => {
        addGroundItem(getActiveSpace(this.state), x, y, createItem(defId, count));
        this.render();
      },
      listGroundItems: () => getActiveSpace(this.state).items,
      setWielded: (defId: string | null) => {
        const p = this.state.player;
        const item = defId === null ? null : p.inventory.find((i) => i.defId === defId);
        if (item === undefined) throw new Error('No ' + defId + ' in inventory');
        p.wielded = item?.id ?? null;
        this.render();
      },
      setReadied: (defId: string | null) => {
        const p = this.state.player;
        const item = defId === null ? null : p.inventory.find((i) => i.defId === defId);
        if (item === undefined) throw new Error('No ' + defId + ' in inventory');
        p.readied = item?.id ?? null;
        this.render();
      },
      lastShot: () => this.lastShotEvent,
      damagePlayer: (n: number) => {
        const p = this.state.player;
        p.hp -= n;
        if (p.hp <= 0) {
          this.state.gameOver = true;
          addMessage(this.state, 'You were killed (debug damage).');
        }
        this.render();
      },
      setPlayerSpeed: (n: number) => {
        this.state.player.speed = n;
      },
      press: (key: string) => this.input.press(key),
      click: (x: number, y: number) => this.clickCell({ x, y }),
      travelling: () => this.travel !== null,
      chunkStats: () => this.streamer.stats(),
    };

    (window as unknown as { __game: typeof bridge }).__game = bridge;
  }
}
