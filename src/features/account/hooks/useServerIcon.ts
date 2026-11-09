import { useEffect, useState } from 'react';

import { storage } from '@/storage';
import type { Account } from '@/types';
import { trustedFetch } from '@/services/shared/trustedFetch';

export type ServerIcon =
  | { kind: 'svg'; svg: string }
  | { kind: 'uri'; uri: string };

function cacheKey(id: string): string {
  return `serverIcon:${id}`;
}

function basicAuth(account: Pick<Account, 'username' | 'appPassword'>): string {
  return 'Basic ' + btoa(`${account.username}:${account.appPassword}`);
}

function parse(raw: string | undefined): ServerIcon | null {
  if (raw?.startsWith('svg:')) return { kind: 'svg', svg: raw.slice(4) };
  if (raw?.startsWith('uri:')) return { kind: 'uri', uri: raw.slice(4) };
  return null;
}

/**
 * The instance logo exposed by Nextcloud theming (public endpoint). Cached
 * per account like the avatar — the logo identifies the server on merged
 * multi-account views.
 */
export function useServerIcon(account: Account | null): {
  data: ServerIcon | null | undefined;
} {
  const [data, setData] = useState<ServerIcon | null | undefined>(() =>
    account ? (parse(storage.getString(cacheKey(account.id)) ?? undefined) ?? undefined) : undefined,
  );

  useEffect(() => {
    if (!account) {
      setData(undefined);
      return;
    }
    let active = true;
    const cached = parse(storage.getString(cacheKey(account.id)) ?? undefined);
    if (cached) setData(cached);

    (async () => {
      try {
        const url = `${account.baseUrl}/index.php/apps/theming/image/logo`;
        const res = await trustedFetch(url, { headers: { Authorization: basicAuth(account) } });
        if (!res.ok) {
          console.warn('[useServerIcon] non-ok response', res.status, url);
          if (active && !cached) setData(null);
          return;
        }
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('svg') || contentType.includes('xml')) {
          const svg = await res.text();
          if (!svg.includes('<svg')) {
            if (active && !cached) setData(null);
            return;
          }
          storage.set(cacheKey(account.id), `svg:${svg}`);
          if (active) setData({ kind: 'svg', svg });
        } else {
          const base64 = await res.base64();
          const uri = `data:${contentType || 'image/png'};base64,${base64}`;
          storage.set(cacheKey(account.id), `uri:${uri}`);
          if (active) setData({ kind: 'uri', uri });
        }
      } catch (e) {
        console.warn('[useServerIcon] failed to load logo', account.baseUrl, e);
        if (active && !cached) setData(null);
      }
    })();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id]);

  return { data };
}
