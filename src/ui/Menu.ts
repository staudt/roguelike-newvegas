/**
 * The #menu-overlay controller: a titled list of options with a cursor (arrows/Enter/Esc, letter
 * hotkeys, mouse click), or a read-only panel of lines (inventory, character sheet, help, death
 * screen). It only draws and tracks the cursor; what a pick *does* is the caller's callback.
 * The overlay sits over a corner of the viewport and never hides the canvas, so the map keeps
 * rendering behind it.
 */
export interface MenuOption {
  label: string;
  hotkey?: string;
  /** Dim text after the label, e.g. "(wielded)". */
  hint?: string;
}

export interface PanelLine {
  text: string;
  /** CSS modifier class: 'warn' (hurt), 'danger' (crippled), 'head' (section), 'dim'. */
  cls?: string;
}

export type MenuResult = 'pick' | 'cancel' | 'none';

export class Menu {
  private readonly el: HTMLElement;
  private options: MenuOption[] = [];
  private selected = 0;
  private onPick: ((index: number) => void) | null = null;
  private titleText = '';
  private footerText = '';

  constructor(el: HTMLElement) {
    this.el = el;
    this.hide();
  }

  /** Opens a selectable menu. `onPick` runs on Enter, a hotkey, or a click. */
  open(
    title: string,
    options: MenuOption[],
    onPick: (index: number) => void,
    selected = 0,
    footer = 'Up/Down + Enter, Esc to cancel',
  ): void {
    this.options = options;
    this.selected = Math.max(0, Math.min(options.length - 1, selected));
    this.onPick = onPick;
    this.titleText = title;
    this.footerText = footer;
    this.el.className = '';
    this.redraw();
  }

  /** Shows a read-only panel. `centered` for the death screen. */
  showPanel(title: string, lines: PanelLine[], footer: string, centered = false): void {
    this.options = [];
    this.onPick = null;
    this.el.className = centered ? 'centered' : '';
    this.el.innerHTML = '';
    this.addDiv('menu-title', title);
    for (const line of lines) this.addDiv(`menu-line ${line.cls ?? ''}`, line.text);
    if (footer) this.addDiv('menu-footer', footer);
  }

  hide(): void {
    this.options = [];
    this.onPick = null;
    this.el.className = 'hidden';
    this.el.innerHTML = '';
  }

  /** Feeds a key to an open menu. Up/Down arrive as `ArrowUp`/`ArrowDown`. */
  handleKey(key: string): MenuResult {
    const count = this.options.length;
    if (key === 'Escape') return 'cancel';
    if (count === 0) return 'none';
    if (key === 'ArrowUp') {
      this.selected = (this.selected + count - 1) % count;
      this.redraw();
      return 'none';
    }
    if (key === 'ArrowDown') {
      this.selected = (this.selected + 1) % count;
      this.redraw();
      return 'none';
    }
    if (key === 'Enter') return this.pick(this.selected);
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

  private redraw(): void {
    this.el.innerHTML = '';
    this.addDiv('menu-title', this.titleText);
    this.options.forEach((option, i) => {
      const row = this.addDiv(`menu-line menu-option${i === this.selected ? ' selected' : ''}`, '');
      const key = option.hotkey ? `${option.hotkey} - ` : '';
      row.appendChild(document.createTextNode(`${i === this.selected ? '> ' : '  '}${key}${option.label}`));
      if (option.hint) {
        const hint = document.createElement('span');
        hint.className = 'menu-hint';
        hint.textContent = ` ${option.hint}`;
        row.appendChild(hint);
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
