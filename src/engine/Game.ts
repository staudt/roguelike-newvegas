import docMitchellsHouseRaw from '../world/goodsprings/docMitchellsHouse.json';
import prospectorSaloonRaw from '../world/goodsprings/prospectorSaloon.json';
import worldMapRaw from '../world/goodsprings/worldMap.json';
import { limbCondition } from '../combat/Limbs';
import { theName, type Creature } from '../entities/Creature';
import { createMonster } from '../entities/Monster';
import { INTERACTION_LABELS, type Npc } from '../entities/Npc';
import { createPlayer } from '../entities/Player';
import { InputManager } from '../input/InputManager';
import { createItem } from '../items/Item';
import { itemDef } from '../items/ItemData';
import type { Direction } from '../utils/geometry';
import { loadSpace, type SpaceJSON } from '../world/MapLoader';
import { Menu, type PanelLine } from '../ui/Menu';
import { MessageLog } from '../ui/MessageLog';
import { Renderer } from '../ui/Renderer';
import { limbShortName, StatusBar } from '../ui/StatusBar';
import { EventBus, type GameEvents } from './EventBus';
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
  | { kind: 'direction'; command: 'fight' }
  | { kind: 'confirm'; target: Creature }
  | { kind: 'menu' } // an option menu is open in the overlay (its callback lives in the Menu)
  | { kind: 'panel' } // a read-only panel (inventory, character sheet, help)
  | { kind: 'game-over' };

type ModeName = 'normal' | 'direction' | 'confirm' | 'menu' | 'panel' | 'game-over';

const MODE_NAMES: Record<Mode['kind'], ModeName> = {
  normal: 'normal',
  direction: 'direction',
  confirm: 'confirm',
  menu: 'menu',
  panel: 'panel',
  'game-over': 'game-over',
};

const SPACE_DATA: SpaceJSON[] = [
  worldMapRaw as unknown as SpaceJSON,
  prospectorSaloonRaw as unknown as SpaceJSON,
  docMitchellsHouseRaw as unknown as SpaceJSON,
];

const HELP_LINES: PanelLine[] = [
  { text: 'Arrows        move (two arrows together = diagonal)' },
  { text: 'F + direction fight in that direction' },
  { text: 'w             wield a weapon (or bare hands)' },
  { text: 'i             inventory' },
  { text: 'C             character sheet' },
  { text: '.             wait a turn' },
  { text: 'f             fire (not yet available)' },
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

  constructor(
    canvas: HTMLCanvasElement,
    messageLogEl: HTMLElement,
    statusBarEl: HTMLElement,
    menuEl: HTMLElement,
  ) {
    this.renderer = new Renderer(canvas);
    this.messageLog = new MessageLog(messageLogEl);
    this.statusBar = new StatusBar(statusBarEl);
    this.menu = new Menu(menuEl);

    this.state = this.buildState();
    this.bindEvents();

    this.input = new InputManager({
      onDirection: (direction) => this.handleDirection(direction),
      onKey: (key) => this.handleKey(key),
    });

    window.addEventListener('resize', () => {
      if (this.renderer.resize()) this.render();
    });
  }

  start(): void {
    this.renderer.resize();
    recomputeVisibility(this.state);
    this.render();
    this.exposeDebugBridge();
  }

  /** Fresh world from the map JSON. Always rebuilt from scratch: permadeath, no continue. */
  private buildState(): GameState {
    const spaces: Record<string, Space> = {};
    for (const data of SPACE_DATA) {
      const space = loadSpace(data);
      spaces[space.id] = space;
    }
    const worldData = SPACE_DATA[0]!;
    const start = worldData.playerStart ?? { x: 0, y: 0 };
    const state = createGameState(createPlayer(start.x, start.y), spaces, getWorldId(worldData));
    addMessage(state, `Welcome to ${spaces[state.activeSpaceId]!.name}.`);
    return state;
  }

  private bindEvents(): void {
    for (const off of this.unsubscribe) off();
    this.events = new EventBus<GameEvents>();
    this.unsubscribe = [
      this.events.on('attack-prompted', ({ target }) => this.setMode({ kind: 'confirm', target })),
      this.events.on('npc-menu', ({ npc }) => this.openNpcMenu(npc)),
      this.events.on('player-died', () => this.showDeathScreen()),
    ];
  }

  private restart(): void {
    this.menu.hide();
    this.state = this.buildState();
    this.bindEvents();
    this.mode = { kind: 'normal' };
    recomputeVisibility(this.state);
    this.render();
  }

  // ---- input modes -------------------------------------------------------------------------

  private setMode(mode: Mode): void {
    this.mode = mode;
  }

  private promptText(): string | null {
    switch (this.mode.kind) {
      case 'direction':
        return 'Attack in which direction? (arrows, Esc cancels)';
      case 'confirm':
        return `Really attack ${theName(this.mode.target)}? [y/n]`;
      default:
        return null;
    }
  }

  private handleDirection(direction: Direction): void {
    const mode = this.mode;
    switch (mode.kind) {
      case 'normal':
        tryMovePlayer(this.state, direction, this.events);
        break;
      case 'direction':
        this.setMode({ kind: 'normal' });
        fightDirection(this.state, direction, this.events);
        break;
      case 'confirm':
        this.setMode({ kind: 'normal' }); // any other key than y is "no"
        break;
      case 'menu':
        // Up/Down move the cursor; sideways does nothing.
        if (direction === 'N') this.menu.handleKey('ArrowUp');
        else if (direction === 'S') this.menu.handleKey('ArrowDown');
        break;
      default:
        break;
    }
    this.render();
  }

  private handleKey(key: string): void {
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
        this.setMode({ kind: 'normal' });
        if (key === 'y' || key === 'Y') confirmAttack(this.state, mode.target, this.events);
        break;
      case 'menu': {
        const result = this.menu.handleKey(key);
        if (result === 'cancel') this.closeMenu();
        break;
      }
      case 'panel':
        if (key === 'Escape' || key === 'Enter' || key === ' ') this.closeMenu();
        break;
      case 'game-over':
        if (key === 'Enter') {
          this.restart();
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
      case 'f':
        addMessage(this.state, 'You have nothing to fire.');
        break;
      case '.':
        advanceTurn(this.state, this.events);
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
    this.menu.open(npc.name, options, (index) => {
      const id = npc.interactions[index]!;
      // Close first: the interaction may itself open something (or kill the player).
      this.closeMenu();
      useInteraction(this.state, npc, id, this.events);
      this.render();
    });
    this.setMode({ kind: 'menu' });
  }

  private openWieldMenu(): void {
    const player = this.state.player;
    const items = player.inventory;
    const options = [
      {
        label: 'bare hands',
        hotkey: '-',
        hint: player.wielded === null ? '(wielded)' : undefined,
      },
      ...items.map((item, i) => ({
        label: itemDef(item.defId).name,
        hotkey: String.fromCharCode(97 + i),
        hint: player.wielded === item.id ? '(wielded)' : undefined,
      })),
    ];
    const current = player.wielded === null ? 0 : items.findIndex((i) => i.id === player.wielded) + 1;
    this.menu.open(
      'Wield what?',
      options,
      (index) => {
        this.closeMenu();
        wieldItem(this.state, index === 0 ? null : items[index - 1]!.id, this.events);
        this.render();
      },
      current,
    );
    this.setMode({ kind: 'menu' });
  }

  private showInventory(): void {
    const player = this.state.player;
    const lines: PanelLine[] =
      player.inventory.length === 0
        ? [{ text: 'You are carrying nothing.', cls: 'dim' }]
        : player.inventory.map((item, i) => ({
            text: `${String.fromCharCode(97 + i)} - ${itemDef(item.defId).name}${
              player.wielded === item.id ? ' (wielded)' : ''
            }`,
          }));
    this.menu.showPanel('Inventory', lines, 'Esc to close');
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
    this.messageLog.render(this.state.messageLog);
    this.statusBar.render(this.state, this.promptText());
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
      give: (defId: string) => {
        const item = createItem(defId);
        this.state.player.inventory.push(item);
        return item;
      },
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
    };

    (window as unknown as { __game: typeof bridge }).__game = bridge;
  }
}

function getWorldId(data: SpaceJSON): string {
  return data.id;
}
