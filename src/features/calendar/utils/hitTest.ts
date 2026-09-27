import type { PositionedEvent } from './eventLayout';
import type { GridEvent } from './toGridEvents';

export type DragMode = 'move' | 'resizeStart' | 'resizeEnd';

export const RESIZE_ZONE_RATIO = 0.2;

export const MIN_RESIZE_DURATION_MIN = 45;

const DAY_MINUTES = 1440;

export function hitTestEvent(
  xInColumn: number,
  y: number,
  positioned: PositionedEvent[],
  columnWidth: number,
  gridHeight: number,
): { event: GridEvent; mode: DragMode } | null {
  const candidates = [...positioned].sort((a, b) => b.zIndex - a.zIndex);

  for (const { event, leftPct, widthPct } of candidates) {
    const left = (leftPct / 100) * columnWidth;
    const right = left + (widthPct / 100) * columnWidth;
    if (xInColumn < left || xInColumn >= right) continue;

    const startMin = event.start.getHours() * 60 + event.start.getMinutes();
    const durationMin = (event.end.getTime() - event.start.getTime()) / 60_000;
    const top = (startMin / DAY_MINUTES) * gridHeight;
    const height = (durationMin / DAY_MINUTES) * gridHeight;
    if (y < top || y >= top + height) continue;

    if (durationMin < MIN_RESIZE_DURATION_MIN) return { event, mode: 'move' };

    const offset = y - top;
    if (offset < height * RESIZE_ZONE_RATIO) return { event, mode: 'resizeStart' };
    if (offset > height * (1 - RESIZE_ZONE_RATIO)) return { event, mode: 'resizeEnd' };
    return { event, mode: 'move' };
  }

  return null;
}
