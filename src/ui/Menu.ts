import type { Rect } from '../utils/geometry';
import { placeMenu } from './menuPlacement';

/**
 * The #menu-overlay controller: a titled list of options with a cursor (arrows/Enter/Esc, letter
 * hotkeys, mouse click), or a read-only panel of lines (inventory, character sheet, help, death
 * screen). It only draws and tracks the cursor; what a pick *does* is the caller's callback.
 * Action menus can be anchored next to a map cell (see `MenuAnchor`); panels sit in a corner and
 * the death screen is centred. The overlay never hides the canvas, so the map keeps rendering.
 */
export interface MenuOption {
  label: string;
  hotkey?: string;
  /** Dim text after the label, e.g. "(wielded)". */
  hint?: string;
  /** Right-aligned key binding shown instead of the "k - " prefix (command menu). */
  keyHint?: string;
  /** Greyed out; still pickable (the caller explains why nothing happens). */
  disabled?: boolean;
}

/** Where an action menu belongs, in px relative to the overlay's positioning parent. */
export interface MenuAnchor {
  anchor: Rect;
  avoid: Rect[];
  gapX: number;
  gapY: number;
}

export interface PanelLine {
  text: string;
  /** CSS modifier class: 'warn' (hurt), 'danger' (crippled), 'head' (section), 'dim'. */
  cls?: string;
  /** An item glyph drawn in its own colour before the text. */
  glyph?: { ch: string; color: string };
}

export type MenuResult = 'pick' | 'cancel' | 'none';

export class Menu {
  private readonly el: HTMLElement;
  private options: MenuOption[] = [];
  private selected = 0;
  private onPick: ((index: number) => void) | null = null;
  private titleText = '';
  private footerText = '';
  private anchorProvider: (() => MenuAnchor) | null = null;

  constructor(el: HTMLElement) {
    this.el = el;
    this.hide();
  }

  /**
   * Opens a selectable menu. `onPick` runs on Enter, a hotkey, or a click. `selected` of -1 means
   * no row is highlighted yet, so Enter cancels instead of picking. `anchor`, when given, places
   * the menu beside a map cell instead of in the corner.
   */
  open(
    title: string,
    options: MenuOption[],
    onPick: (index: number) => void,
    selected = 0,
    footer = 'Up/Down + Enter, Esc to cancel',
    anchor: (() => MenuAnchor) | null = null,
  ): void {
    this.options = options;
    this.selected = selected < 0 ? -1 : Math.min(options.length - 1, selected);
    this.onPick = onPick;
    this.titleText = title;
    this.footerText = footer;
    this.anchorProvider = anchor;
    this.resetPosition();
    this.el.className = anchor ? 'anchored' : '';
    this.redraw();
    this.reposition();
  }

  /** Re-places an anchored menu (camera moved, window resized). No-op for other menus. */
  reposition(): void {
    if (!this.anchorProvider || this.options.length === 0) return;
    const parent = this.el.parentElement;
    if (!parent) return;
    const a = this.anchorProvider();
    const pos = placeMenu({
      anchor: a.anchor,
      avoid: a.avoid,
      menu: { width: this.el.offsetWidth, height: this.el.offsetHeight },
      viewport: { width: parent.clientWidth, height: parent.clientHeight },
      gapX: a.gapX,
      gapY: a.gapY,
    });
    this.el.style.left = `${Math.round(pos.x)}px`;
    this.el.style.top = `${Math.round(pos.y)}px`;
  }

  /** Shows a read-only panel. `centered` for the death screen. */
  showPanel(title: string, lines: PanelLine[], footer: string, centered = false): void {
    this.options = [];
    this.onPick = null;
    this.anchorProvider = null;
    this.resetPosition();
    this.el.className = centered ? 'centered' : '';
    this.el.innerHTML = '';
    this.addDiv('menu-title', title);
    for (const line of lines) {
      const row = this.addDiv(`menu-line ${line.cls ?? ''}`, line.text);
      if (line.glyph) {
        const g = document.createElement('span');
        g.className = 'menu-glyph';
        g.textContent = line.glyph.ch;
        g.style.color = line.glyph.color;
        row.prepend(g, ' ');
      }
    }
    if (footer) this.addDiv('menu-footer', footer);
  }

  hide(): void {
    this.options = [];
    this.onPick = null;
    this.anchorProvider = null;
    this.resetPosition();
    this.el.className = 'hidden';
    this.el.innerHTML = '';
  }

  /** Feeds a key to an open menu. Up/Down arrive as `ArrowUp`/`ArrowDown`. */
  handleKey(key: string): MenuResult {
    const count = this.options.length;
    if (key === 'Escape') return 'cancel';
    if (count === 0) return 'none';
    if (key === 'ArrowUp') {
      this.selected = this.selected < 0 ? count - 1 : (this.selected + count - 1) % count;
      this.redraw();
      return 'none';
    }
    if (key === 'ArrowDown') {
      this.selected = (this.selected + 1) % count;
      this.redraw();
      return 'none';
    }
    if (key === 'Enter') return this.selected < 0 ? 'cancel' : this.pick(this.selected);
    const index = this.options.findIndex((o) => o.hotkey === key);
    if (index >= 0) {
      this.selected = index;
      return this.pick(index);
    }
    return 'none';
  }

  private pick(index: number): MenuResult {
    this.onPick?.(index);
    return 'pick';
  }

  private resetPosition(): void {
    this.el.style.left = '';
    this.el.style.top = '';
  }

  private redraw(): void {
    this.el.innerHTML = '';
    this.addDiv('menu-title', this.titleText);
    this.options.forEach((option, i) => {
      const cls = `menu-line menu-option${i === this.selected ? ' selected' : ''}${option.disabled ? ' disabled' : ''}`;
      const row = this.addDiv(cls, '');
      const key = option.hotkey && !option.keyHint ? (option.hotkey === '-' ? '- ' : `${option.hotkey} - `) : '';
      row.appendChild(document.createTextNode(`${i === this.selected ? '> ' : '  '}${key}${option.label}`));
      if (option.hint) {
        const hint = document.createElement('span');
        hint.className = 'menu-hint';
        hint.textContent = ` ${option.hint}`;
        row.appendChild(hint);
      }
      if (option.keyHint) {
        const k = document.createElement('span');
        k.className = 'menu-key';
        k.textContent = option.keyHint;
        row.appendChild(k);
      }
      row.addEventListener('click', () => {
        this.selected = i;
        this.pick(i);
      });
    });
    if (this.footerText) this.addDiv('menu-footer', this.footerText);
  }

  private addDiv(cls: string, text: string): HTMLDivElement {
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = text;
    this.el.appendChild(div);
    return div;
  }
}
