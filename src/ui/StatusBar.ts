import { limbCondition } from '../combat/Limbs';
import type { GameState } from '../engine/GameState';
import { getActiveSpace } from '../engine/GameState';

const DANGER_FRACTION = 0.3;

const PREFIX_LETTERS: Record<string, string> = { left: 'L', right: 'R', front: 'F', hind: 'H' };

/** "left leg" -> "L.Leg", "front left leg" -> "FL.Leg", "torso" -> "Torso". */
export function limbShortName(name: string): string {
  const words = name.split(' ');
  const base = words[words.length - 1]!;
  const cap = base.charAt(0).toUpperCase() + base.slice(1);
  const prefix = words
    .slice(0, -1)
    .map((w) => PREFIX_LETTERS[w] ?? w.charAt(0).toUpperCase())
    .join('');
  return prefix ? `${prefix}.${cap}` : cap;
}

/** Renders the bottom status line as plain DOM, plus an optional pending-prompt field. */
export class StatusBar {
  private readonly el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  render(state: GameState, prompt: string | null = null): void {
    const space = getActiveSpace(state);
    const p = state.player;
    this.el.innerHTML = '';
    if (prompt) this.appendField('', prompt, 'status-prompt');
    this.appendField(
      'HP',
      `${Math.max(0, p.hp)}/${p.maxHp}`,
      p.hp < p.maxHp * DANGER_FRACTION ? 'status-danger' : '',
    );
    for (const limb of p.limbs) {
      const cond = limbCondition(limb);
      if (cond === 'ok') continue;
      this.appendField('', `${limbShortName(limb.name)} ${cond}`, cond === 'crippled' ? 'status-danger' : 'status-warn');
    }
    this.appendField('Location', space.name);
    this.appendField('Position', `${p.x},${p.y}`);
    this.appendField('Turn', String(state.turnCount));
  }

  private appendField(label: string, value: string, cls = ''): void {
    const field = document.createElement('span');
    if (cls) field.className = cls;
    if (label) {
      const labelEl = document.createElement('span');
      labelEl.className = 'status-label';
      labelEl.textContent = `${label}: `;
      field.appendChild(labelEl);
    }
    const valueEl = document.createElement('span');
    valueEl.className = 'status-value';
    valueEl.textContent = value;
    field.appendChild(valueEl);
    this.el.appendChild(field);
  }
}
