/** Pure builder for the contextual Enter menu: what makes sense right now goes first. */

export interface CommandContext {
  /** Ground items on the player's cell. */
  itemsHere: number;
  gunWielded: boolean;
  /** Rounds in the readied ammo stack (0 when none readied). */
  readiedAmmo: number;
  /** Rounds-bearing ammo stacks in the pack matching the wielded gun. */
  ammoInPack: number;
  hurt: boolean;
  /** Consumable stacks in the pack. */
  consumables: number;
  /** Items that can be dropped. */
  droppable: number;
  /** An alternate weapon is set, so `x` has something to swap to. */
  hasAlternate?: boolean;
}

export type CommandId =
  | 'pickup'
  | 'fire'
  | 'ready'
  | 'use'
  | 'wield'
  | 'inventory'
  | 'drop'
  | 'sheet'
  | 'fight'
  | 'kick'
  | 'run'
  | 'swap'
  | 'wait'
  | 'help'
  | 'wear';

export interface CommandRow {
  id: CommandId;
  label: string;
  key: string;
  disabled: boolean;
  group: 'context' | 'standard' | 'later';
}

function row(id: CommandId, label: string, key: string, group: CommandRow['group'], disabled = false): CommandRow {
  return { id, label, key, disabled, group };
}

export function buildCommandList(ctx: CommandContext): CommandRow[] {
  const context: CommandRow[] = [];
  if (ctx.itemsHere > 0) context.push(row('pickup', 'Pick up', ',', 'context'));
  if (ctx.gunWielded && ctx.readiedAmmo > 0) context.push(row('fire', 'Fire', 'f', 'context'));
  else if (ctx.gunWielded && ctx.ammoInPack > 0) context.push(row('ready', 'Ready ammo', 'Q', 'context'));
  if (ctx.hasAlternate) context.push(row('swap', 'Swap weapons', 'x', 'context'));
  if (ctx.consumables > 0) {
    const use = row('use', 'Use item', 'q', 'context');
    if (ctx.hurt) context.unshift(use);
    else context.push(use);
  }

  const standard: CommandRow[] = [row('wield', 'Wield', 'w', 'standard'), row('inventory', 'Inventory', 'i', 'standard')];
  if (ctx.droppable > 0) standard.push(row('drop', 'Drop', 'd', 'standard'));
  standard.push(
    row('sheet', 'Character sheet', 'C', 'standard'),
    row('fight', 'Fight in a direction', 'F', 'standard'),
    row('kick', 'Kick', 'k', 'standard'),
    row('run', 'Go in a direction', 'g', 'standard'),
    row('wait', 'Wait', '.', 'standard'),
    row('help', 'Help', '?', 'standard'),
  );
  return [...context, ...standard, row('wear', 'Wear', 'W', 'later', true)];
}
