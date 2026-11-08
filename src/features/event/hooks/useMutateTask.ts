import { useCallback } from 'react';
import { Alert } from 'react-native';

import { fetchEventIcs, updateEvent } from '@/services/nextcloud/caldav';
import { describeMutationError } from '@/services/shared/errors';
import { patchByUid } from '@/database/eventWrites';
import { setVtodoCompleted } from '@/utils/vtodo';
import i18n from '@/utils/i18n';
import type { Account, CalendarEvent } from '@/types';

import { useAction } from './useMutateEvent';

export function useToggleTask(accounts: readonly Account[]) {
  return useAction<CalendarEvent, void>(
    useCallback(
      async (event) => {
        const account = accounts.find((a) => a.id === event.accountId);
        if (!account || !event.isTask || event.readOnly) return;
        const next = !event.taskCompleted;

        const rollback = {
          taskStatus: event.taskStatus,
          taskCompletedAt: event.taskCompletedAt,
          taskPercent: event.taskPercent,
        };

        await patchByUid(account.id, event.uid, {
          taskStatus: next ? 'COMPLETED' : 'NEEDS-ACTION',
          taskCompletedAt: next ? new Date() : undefined,
          taskPercent: next ? 100 : 0,
        });

        try {
          const ics = await fetchEventIcs(account, event.href);
          await updateEvent(account, event.href, setVtodoCompleted(ics, next));
        } catch (error) {
          await patchByUid(account.id, event.uid, rollback);
          Alert.alert(i18n.t('event.errorUpdateFailed'), describeMutationError(error));
        }
      },
      [accounts],
    ),
  );
}
