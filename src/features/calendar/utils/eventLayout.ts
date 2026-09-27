import type { GridEvent } from './toGridEvents';

export interface PositionedEvent {
  event: GridEvent;
  leftPct: number;
  widthPct: number;
  zIndex: number;
}

export const MIN_EVENT_WIDTH_PCT = 40;

function overlaps(a: GridEvent, b: GridEvent): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

function layoutGroup(group: GridEvent[]): PositionedEvent[] {
  const columns: GridEvent[][] = [];
  const columnOf = new Map<GridEvent, number>();

  for (const event of group) {
    let placed = false;
    for (let c = 0; c < columns.length; c++) {
      const last = columns[c][columns[c].length - 1];
      if (last.end.getTime() <= event.start.getTime()) {
        columns[c].push(event);
        columnOf.set(event, c);
        placed = true;
        break;
      }
    }
    if (!placed) {
      columns.push([event]);
      columnOf.set(event, columns.length - 1);
    }
  }

  const total = columns.length;

  return group.map((event) => {
    const column = columnOf.get(event)!;
    let span = 1;
    for (let c = column + 1; c < total; c++) {
      if (columns[c].some((other) => overlaps(other, event))) break;
      span++;
    }

    const sharedWidth = (span / total) * 100;
    if (sharedWidth >= MIN_EVENT_WIDTH_PCT) {
      return {
        event,
        leftPct: (column / total) * 100,
        widthPct: sharedWidth,
        zIndex: 100 + column,
      };
    }

    const leftPct = column * ((100 - MIN_EVENT_WIDTH_PCT) / (total - 1));
    return {
      event,
      leftPct,
      widthPct: 100 - leftPct,
      zIndex: 100 + column,
    };
  });
}

export function layoutDay(slices: GridEvent[]): PositionedEvent[] {
  const sorted = [...slices].sort((a, b) => {
    const byStart = a.start.getTime() - b.start.getTime();
    if (byStart !== 0) return byStart;
    const byEnd = a.end.getTime() - b.end.getTime();
    if (byEnd !== 0) return byEnd;
    return a._event.uid.localeCompare(b._event.uid);
  });

  const out: PositionedEvent[] = [];
  let group: GridEvent[] = [];
  let groupEnd = -Infinity;

  for (const event of sorted) {
    if (group.length > 0 && event.start.getTime() >= groupEnd) {
      out.push(...layoutGroup(group));
      group = [];
      groupEnd = -Infinity;
    }
    group.push(event);
    groupEnd = Math.max(groupEnd, event.end.getTime());
  }
  if (group.length > 0) out.push(...layoutGroup(group));

  return out;
}
