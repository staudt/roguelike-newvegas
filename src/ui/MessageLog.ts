import { groupMessages, type MessageGroup } from './messageGroups';

/** Renders the scrolling message log as plain DOM — only the map glyph grid is canvas. */
export class MessageLog {
  private readonly el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  render(messages: readonly string[], groups: readonly MessageGroup[] = []): void {
    const recent = groupMessages(messages, groups).slice(-50);
    this.el.innerHTML = '';
    for (const text of recent) {
      const line = document.createElement('div');
      line.className = 'message-log-entry';
      line.textContent = text;
      this.el.appendChild(line);
    }
    this.el.scrollTop = this.el.scrollHeight;
  }
}
