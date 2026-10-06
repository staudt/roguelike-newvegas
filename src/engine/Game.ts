import prospectorSaloonRaw from '../world/goodsprings/prospectorSaloon.json';
import worldMapRaw from '../world/goodsprings/worldMap.json';
import { createPlayer } from '../entities/Player';
import { InputManager } from '../input/InputManager';
import type { Direction } from '../utils/geometry';
import { loadSpace, type SpaceJSON } from '../world/MapLoader';
import { MessageLog } from '../ui/MessageLog';
import { Renderer } from '../ui/Renderer';
import { StatusBar } from '../ui/StatusBar';
import { EventBus, type GameEvents } from './EventBus';
import {
  addMessage,
  createGameState,
  getActiveSpace,
  type GameState,
  type Space,
} from './GameState';
import { advanceTurn, recomputeVisibility, tryMovePlayer } from './TurnManager';

/**
 * Top-level orchestrator: owns the GameState and every long-lived service (renderer, input,
 * message log, status bar), and is the only place that wires them together. Command handlers
 * are kept as small free functions in TurnManager rather than piled up here, specifically to
 * avoid rogueout's Game.ts growing into a 1600-line catch-all as features land.
 */
export class Game {
  private readonly events = new EventBus<GameEvents>();
  private readonly renderer: Renderer;
  private readonly messageLog: MessageLog;
  private readonly statusBar: StatusBar;
  private readonly state: GameState;

  constructor(canvas: HTMLCanvasElement, messageLogEl: HTMLElement, statusBarEl: HTMLElement) {
    this.renderer = new Renderer(canvas);
    this.messageLog = new MessageLog(messageLogEl);
    this.statusBar = new StatusBar(statusBarEl);

    const worldData = worldMapRaw as unknown as SpaceJSON;
    const saloonData = prospectorSaloonRaw as unknown as SpaceJSON;
    const worldSpace: Space = loadSpace(worldData);
    const saloonSpace: Space = loadSpace(saloonData);

    const start = worldData.playerStart ?? { x: 0, y: 0 };
    const player = createPlayer(start.x, start.y);

    this.state = createGameState(
      player,
      { [worldSpace.id]: worldSpace, [saloonSpace.id]: saloonSpace },
      worldSpace.id,
    );
    addMessage(this.state, `Welcome to ${worldSpace.name}.`);

    new InputManager({
      onDirection: (direction) => this.handleDirection(direction),
      onWait: () => this.handleWait(),
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

  private handleDirection(direction: Direction): void {
    tryMovePlayer(this.state, direction, this.events);
    this.render();
  }

  private handleWait(): void {
    advanceTurn(this.state, this.events);
    this.render();
  }

  private render(): void {
    this.renderer.render(this.state);
    this.messageLog.render(this.state.messageLog);
    this.statusBar.render(this.state);
  }

  /**
   * Dev-only inspection + test-mutation bridge on `window.__game`, present from the first
   * playable build per the project's architecture. `import.meta.env.DEV` is statically false in
   * a production build, so Vite dead-code-eliminates this whole method — it never reaches dist.
   */
  private exposeDebugBridge(): void {
    if (!import.meta.env.DEV) return;

    const bridge = {
      getState: () => this.state,
      getActiveSpace: () => getActiveSpace(this.state),
      getPlayer: () => this.state.player,
      listNpcs: () => getActiveSpace(this.state).npcs,
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
        addMessage(this.state, `${npc.name}: "${npc.dialogue}"`);
        this.render();
      },
    };

    (window as unknown as { __game: typeof bridge }).__game = bridge;
  }
}
