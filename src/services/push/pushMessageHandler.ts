import * as Notifications from 'expo-notifications';

import { fetchNotifications } from '@/services/nextcloud/notifications';
import { useNotificationStore, withSeenFlag } from '@/stores/notificationStore';
import { decryptPushSubject } from './pushCrypto';
import type { Account } from '@/types';

export interface PushMessageData {
  /** base64 encrypted subject */
  subject?: string;
  signature?: string;
  priority?: string;
  nid?: number;
  [key: string]: unknown;
}

let activePrivateKey: string | null = null;
let activeAccount: Account | null = null;

export function setPushAccount(account: Account | null, privateKey: string | null): void {
  activeAccount = account;
  activePrivateKey = privateKey;
}

export function listenToPushMessages(): () => void {
  const sub = Notifications.addNotificationReceivedListener(async (event) => {
    const data = (event.request.content.data ?? {}) as PushMessageData;
    console.log('[pushMessageHandler] received', data);

    const account = activeAccount;
    if (account && activePrivateKey && data.subject) {
      try {
        const decrypted = decryptPushSubject(data.subject, activePrivateKey);
        const payload = JSON.parse(decrypted) as {
          nid?: number;
          app?: string;
          subject?: string;
          delete?: boolean;
          'delete-all'?: boolean;
        };

        console.log('[pushMessageHandler] decrypted subject', payload);

        if (payload['delete-all']) {
          useNotificationStore.getState().clear();
          return;
        }

        if (payload.delete && payload.nid) {
          useNotificationStore.getState().removeNotification(account.id, payload.nid);
          return;
        }

        // Refresh OCS notifications so the store is up to date.
        const notifications = await fetchNotifications(account);
        useNotificationStore.getState().addOrUpdateNotifications(
          notifications.map((n) => withSeenFlag(n, account.id)),
        );

        // If the payload contains the notification id, try to present a local alert.
        if (payload.nid) {
          const found = notifications.find((n) => n.notificationId === payload.nid);
          if (found) {
            await Notifications.scheduleNotificationAsync({
              content: {
                title: found.subject,
                body: found.message || found.subject,
                data: { nid: found.notificationId, link: found.link },
              },
              trigger: null,
            });
          }
        }
      } catch (err) {
        console.warn('[pushMessageHandler] decrypt/handling failed:', err);
      }
    } else {
      // No private key / account available; refresh anyway.
      if (account) {
        try {
          const notifications = await fetchNotifications(account);
          useNotificationStore.getState().addOrUpdateNotifications(
            notifications.map((n) => withSeenFlag(n, account.id)),
          );
        } catch (err) {
          console.warn('[pushMessageHandler] refresh failed:', err);
        }
      }
    }
  });

  return () => sub.remove();
}
