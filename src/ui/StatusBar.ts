import type { GameState } from '../engine/GameState';
import { getActiveSpace } from '../engine/GameState';

/** Renders the bottom status line as plain DOM. No HP/combat stats yet — that lands with M2. */
export class StatusBar {
  private readonly el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  render(state: GameState): void {
    const space = getActiveSpace(state);
    this.el.innerHTML = '';
    this.appendField('Location', space.name);
    this.appendField('Position', `${state.player.x},${state.player.y}`);
    this.appendField('Turn', String(state.turnCount));
  }

  private appendField(label: string, value: string): void {
    const field = document.createElement('span');
    const labelEl = document.createElement('span');
    labelEl.className = 'status-label';
    labelEl.textContent = `${label}: `;
    const valueEl = document.createElement('span');
    valueEl.className = 'status-value';
    valueEl.textContent = value;
    field.appendChild(labelEl);
    field.appendChild(valueEl);
    this.el.appendChild(field);
  }
}
