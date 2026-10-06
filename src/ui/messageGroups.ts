/** One log line per player action: a group is the half-open message range [from, to). */
export interface MessageGroup {
  from: number;
  to: number;
}

/** Joins each group's messages with two spaces; messages outside any group are their own line. */
export function groupMessages(messages: readonly string[], groups: readonly MessageGroup[]): string[] {
  const lines: string[] = [];
  let i = 0;
  const sorted = [...groups].filter((g) => g.to > g.from).sort((a, b) => a.from - b.from);
  for (const g of sorted) {
    const from = Math.max(g.from, i);
    const to = Math.min(g.to, messages.length);
    if (to <= from) continue;
    while (i < from) lines.push(messages[i++]!);
    lines.push(messages.slice(from, to).join('  '));
    i = to;
  }
  while (i < messages.length) lines.push(messages[i++]!);
  return lines;
}
