export const MIN_HOUR_ROW = 30;
export const MAX_HOUR_ROW = 200;

export const DEFAULT_HOUR_ROW = 60;

export function scaledCellHeight(baseCellHeight: number, scale: number): number {
  'worklet';
  return Math.min(Math.max(baseCellHeight * scale, MIN_HOUR_ROW), MAX_HOUR_ROW);
}

export function anchoredScrollY(args: {
  scrollY: number;
  focalY: number;
  headerInset: number;
  fromCellHeight: number;
  toCellHeight: number;
}): number {
  'worklet';
  const { scrollY, focalY, headerInset, fromCellHeight, toCellHeight } = args;
  if (fromCellHeight <= 0) return scrollY;
  const hoursAtFocal = (scrollY + focalY - headerInset) / fromCellHeight;
  return Math.max(0, hoursAtFocal * toCellHeight - focalY + headerInset);
}
