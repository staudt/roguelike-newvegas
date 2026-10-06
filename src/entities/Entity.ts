/** Minimal shared shape for anything drawn on the map. World coordinates, always — even indoors. */
export interface Entity {
  id: string;
  kind: 'player' | 'npc' | 'monster';
  glyph: string;
  fg: string;
  x: number;
  y: number;
}
