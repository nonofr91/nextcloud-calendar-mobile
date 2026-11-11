import type { CalendarEvent } from '@/types';
import { storage } from '@/storage';
import { getAccounts } from '@/hooks/useAccounts';
import { accountTagColor, accountTagLabel, hostnameOf } from '@/features/account/utils/account';
import type { AccountTagSnapshot } from './types';

function serverIconCache(id: string): { svg?: string; image?: string } {
  const raw = storage.getString(`serverIcon:${id}`);
  if (raw?.startsWith('svg:')) return { svg: raw.slice(4) };
  if (raw?.startsWith('uri:')) return { image: raw.slice(4) };
  return {};
}

/**
 * Badges for merged multi-account rows, mirroring AgendaView rules: only when
 * the visible events span more than one account, and accounts sharing a host
 * show the user avatar instead of the server logo. Pixel data comes from the
 * MMKV caches populated by useServerIcon/useAvatar — absent until the app has
 * fetched them once, in which case the renderer falls back to `color`.
 */
export function buildAccountTags(events: CalendarEvent[]): Record<string, AccountTagSnapshot> | undefined {
  const idsInView = new Set(events.map((e) => e.accountId));
  if (idsInView.size <= 1) return undefined;

  const accounts = getAccounts().filter((a) => idsInView.has(a.id));
  const hostCount = new Map<string, number>();
  for (const a of accounts) {
    const h = hostnameOf(a.baseUrl);
    hostCount.set(h, (hostCount.get(h) ?? 0) + 1);
  }

  const tags: Record<string, AccountTagSnapshot> = {};
  for (const a of accounts) {
    const sameHost = (hostCount.get(hostnameOf(a.baseUrl)) ?? 0) > 1;
    const icon = sameHost
      ? { image: storage.getString(`avatar:${a.id}`) }
      : serverIconCache(a.id);
    tags[a.id] = {
      label: accountTagLabel(a),
      color: accountTagColor(a.id),
      ...(icon.image ? { image: icon.image } : {}),
      ...(icon.svg ? { svg: icon.svg } : {}),
    };
  }
  return tags;
}
