/**
 * Drag arithmetic, ported from super-calendar.
 *
 * Source: https://github.com/afonsojramos/super-calendar
 * packages/core/src/utils/drag.ts — MIT License, Copyright (c) 2026 Afonso
 * Jorge Ramos.
 *
 * Only the three functions the grid needs are taken. The overlap predicate
 * lives in eventLayout.ts, and we do not reject a drop that collides with
 * another event — overlapping events lay out side by side instead.
 */

export const SNAP_MINUTES = 15;

export function snapDeltaMinutes(
  translationPx: number,
  cellHeightPx: number,
  stepMinutes: number,
): number {
  'worklet';
  if (cellHeightPx <= 0 || stepMinutes <= 0) return 0;
  const rawMinutes = (translationPx / cellHeightPx) * 60;
  return Math.round(rawMinutes / stepMinutes) * stepMinutes;
}

export function shiftMinutes(date: Date, minutes: number): Date {
  const next = new Date(date);
  next.setMinutes(next.getMinutes() + minutes);
  return next;
}

export function resolveDraggedBounds(
  start: Date,
  end: Date,
  deltaStartMinutes: number,
  deltaEndMinutes: number,
  snapMinutes: number,
): { start: Date; end: Date } | null {
  const nextStart = shiftMinutes(start, deltaStartMinutes);
  const nextEnd = shiftMinutes(end, deltaEndMinutes);
  const oldDuration = end.getTime() - start.getTime();
  const newDuration = nextEnd.getTime() - nextStart.getTime();
  if (newDuration < snapMinutes * 60_000 && newDuration < oldDuration) return null;
  return { start: nextStart, end: nextEnd };
}
