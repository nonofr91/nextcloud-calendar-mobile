export const APP_SCHEME = 'nextcloud-calendar';

export interface AgendaEventItem {
  uid: string;
  accountId: string;
  title: string;
  startIso: string;
  endIso: string;
  allDay: boolean;
  color: string;
  timeLabel: string;
  deepLink: string;
}

/**
 * Per-account badge embedded in the snapshot — the widget renderer cannot
 * call hooks, so icon pixels are snapshotted at build time from the MMKV
 * caches (`serverIcon:`/`avatar:`). `svg` holds raw SVG XML, `image` a
 * `data:` URI. Absent for single-account views (same rule as the agenda).
 */
export interface AccountTagSnapshot {
  label: string;
  color: string;
  svg?: string;
  image?: string;
}

export interface AgendaDaySection {
  dayKey: string;
  dayLabel: string;
  dayNumber: string;
  weekdayLong: string;
  isToday: boolean;
  items: AgendaEventItem[];
  totalCount: number;
}

export interface AgendaSnapshot {
  generatedAtIso: string;
  timeZone: string;
  locale?: string;
  scheme: 'light' | 'dark';
  dayLabel: string;
  dayNumber: string;
  relativeLabel: string;
  events: AgendaEventItem[];
  sections: AgendaDaySection[];
  nextEvent?: AgendaEventItem;
  /** accountId → badge data, only when events span more than one account. */
  accountTags?: Record<string, AccountTagSnapshot>;
}

export interface AgendaTimelineEntry {
  atIso: string;
  snapshot: AgendaSnapshot;
}

export interface MonthWidgetEvent {
  uid: string;
  title: string;
  color: string;
}

export interface MonthWidgetDay {
  dateIso: string;
  dayNumber: string;
  dayOfWeek: number;
  inMonth: boolean;
  isToday: boolean;
  events: MonthWidgetEvent[];
  totalEvents?: number;
}

export interface MonthWidgetSnapshot {
  monthLabel: string;
  monthOffset?: number;
  scheme: 'light' | 'dark';
  days: MonthWidgetDay[];
}

export interface LiveEventState {
  uid: string;
  title: string;
  startIso: string;
  endIso: string;
  color: string;
  link: string;
  location: string;
  videoProvider?: string;
  attendees: string[];
}

export interface WidgetSurface<P> {
  readonly id: 'homeWidget' | 'liveActivity';
  isSupported(): boolean;
  update(payload: P): Promise<void>;
  clear(): Promise<void>;
  requestPermission?(): Promise<boolean>;
  canPromote?(): boolean;
}

export function eventDeepLink(uid: string, accountId?: string): string {
  const base = `${APP_SCHEME}://event/${encodeURIComponent(uid)}`;
  return accountId ? `${base}?accountId=${encodeURIComponent(accountId)}` : base;
}

export function listenDeepLink(): string {
  return `${APP_SCHEME}://listen`;
}

export function openAppLink(): string {
  return `${APP_SCHEME}:///`;
}
