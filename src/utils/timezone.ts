const OFFSET_FMT = new Map<string, Intl.DateTimeFormat>();

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function offsetFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = OFFSET_FMT.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    OFFSET_FMT.set(tz, fmt);
  }
  return fmt;
}

export function getTimezoneOffsetMinutes(tz: string, at: Date): number {
  const parts = offsetFormatter(tz).formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  let hour = g('hour');
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), hour, g('minute'), g('second'));
  return Math.round((asUtc - at.getTime()) / 60000);
}

export function zonedWallTimeToUtc(
  year: number, month: number, day: number,
  hour: number, minute: number, second: number,
  tz: string,
): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const guess1 = new Date(naiveUtc - getTimezoneOffsetMinutes(tz, new Date(naiveUtc)) * 60000);
  const offset2 = getTimezoneOffsetMinutes(tz, guess1);
  return new Date(naiveUtc - offset2 * 60000);
}
