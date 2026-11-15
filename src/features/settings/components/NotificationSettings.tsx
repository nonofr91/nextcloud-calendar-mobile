import { useCallback, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useSettingsStore } from '@/stores/settingsStore';
import { useAccountStore } from '@/stores/accountStore';
import { useActiveAccount } from '@/hooks/useAccounts';
import { registerPushNotifications, unregisterPushNotifications } from '@/services/push/pushRegistration';
import { refreshWidgets } from '@/features/widget';
import { liveActivity } from '@/features/widget/surfaces/liveActivity';
import { AlarmOffsetPicker } from '@/features/notifications/AlarmOffsetPicker';
import { requestAlertPermission, scheduleEventAlerts } from '@/features/notifications/scheduleAlerts';
import { Button, Divider, Select, Stack, Toggle, Typography, type SelectOption } from '@/ui/components';

const cardOuter = { marginHorizontal: 16, marginBottom: 4 };
const CAR_WINDOW_OPTIONS = [15, 30, 45, 60];

export function NotificationSettings() {
  const { t } = useTranslation();
  const enabled = useSettingsStore((s) => s.liveActivityEnabled);
  const setEnabled = useSettingsStore((s) => s.setLiveActivityEnabled);
  const timedAlerts = useSettingsStore((s) => s.timedAlerts);
  const allDayAlerts = useSettingsStore((s) => s.allDayAlerts);
  const setTimedAlerts = useSettingsStore((s) => s.setTimedAlerts);
  const setAllDayAlerts = useSettingsStore((s) => s.setAllDayAlerts);
  const pushEnabled = useSettingsStore((s) => s.pushNotifications);
  const setPushEnabled = useSettingsStore((s) => s.setPushNotifications);
  const carEnabled = useSettingsStore((s) => s.carNotificationsEnabled);
  const setCarEnabled = useSettingsStore((s) => s.setCarNotificationsEnabled);
  const carMinimal = useSettingsStore((s) => s.carNotifyMinimal);
  const setCarMinimal = useSettingsStore((s) => s.setCarNotifyMinimal);
  const carWindow = useSettingsStore((s) => s.carNotifyWindowMin);
  const setCarWindow = useSettingsStore((s) => s.setCarNotifyWindowMin);

  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const account = useActiveAccount(activeAccountId);

  const [granted, setGranted] = useState(true);

  useFocusEffect(
    useCallback(() => {
      setGranted(liveActivity.isSupported());
    }, [])
  );

  async function handleEnable(next: boolean) {
    setEnabled(next);

    if (!next) {
      await liveActivity.clear();
      return;
    }

    const ok = (await liveActivity.requestPermission?.()) ?? true;
    setGranted(ok);
    await refreshWidgets();
  }

  async function applyAlerts(next: number[], set: (v: number[]) => void) {
    set(next);
    if (next.length > 0) await requestAlertPermission();
    await scheduleEventAlerts();
  }

  async function handlePushEnable(next: boolean) {
    setPushEnabled(next);

    if (!next || !account) {
      if (account) {
        try {
          await unregisterPushNotifications(account);
        } catch (err) {
          console.warn('[NotificationSettings] unregister failed:', err);
        }
      }
      return;
    }

    const ok = await requestAlertPermission();
    if (!ok) return;

    try {
      await registerPushNotifications(account);
    } catch (err) {
      console.warn('[NotificationSettings] register failed:', err);
    }
  }

  const mainCard = (
    <Stack card gap={12} padding={16} hAlign="stretch" style={cardOuter}>
      <Stack direction="horizontal" vAlign="center" gap={12}>
        <Stack gap={2} style={{ flex: 1 }}>
          <Typography variant="body1">{t('settings.notifications.liveActivity')}</Typography>
          <Typography variant="caption" color="secondary">
            {t('settings.notifications.liveActivityHint')}
          </Typography>
        </Stack>
        <Toggle value={enabled} onValueChange={handleEnable} />
      </Stack>

      {enabled && !granted && (
        <>
          <Typography variant="caption" color="secondary">
            {t('settings.notifications.permissionDenied')}
          </Typography>
          <Button
            variant="link" size="small" alignment="start" color="primary"
            title={t('settings.notifications.openSettings')}
            onPress={() => Linking.openSettings()}
          />
        </>
      )}

      <Divider />

      <Stack direction="horizontal" vAlign="center" gap={12}>
        <Stack gap={2} style={{ flex: 1 }}>
          <Typography variant="body1">{t('settings.notifications.push')}</Typography>
          <Typography variant="caption" color="secondary">
            {t('settings.notifications.pushHint')}
          </Typography>
        </Stack>
        <Toggle value={pushEnabled} onValueChange={handlePushEnable} />
      </Stack>

      <Divider />

      <Stack gap={2}>
        <Typography variant="body1">{t('settings.alerts.timed')}</Typography>
        <Typography variant="caption" color="secondary">{t('settings.alerts.timedHint')}</Typography>
      </Stack>
      <AlarmOffsetPicker
        values={timedAlerts}
        onChange={(v) => void applyAlerts(v, setTimedAlerts)}
      />

      <Stack gap={2}>
        <Typography variant="body1">{t('settings.alerts.allDay')}</Typography>
        <Typography variant="caption" color="secondary">{t('settings.alerts.allDayHint')}</Typography>
      </Stack>
      <AlarmOffsetPicker
        values={allDayAlerts}
        onChange={(v) => void applyAlerts(v, setAllDayAlerts)}
        allDay
      />
    </Stack>
  );

  const carCard = Platform.OS === 'android' && (
      <Stack card gap={12} padding={16} hAlign="stretch" style={cardOuter}>
        <Stack direction="horizontal" vAlign="center" gap={12}>
          <Stack gap={2} style={{ flex: 1 }}>
            <Typography variant="body1">{t('settings.car.notify')}</Typography>
            <Typography variant="caption" color="secondary">
              {t('settings.car.notifyHint')}
            </Typography>
          </Stack>
          <Toggle value={carEnabled} onValueChange={setCarEnabled} />
        </Stack>

        {carEnabled && (
          <>
            <Divider />
            <Stack direction="horizontal" vAlign="center" gap={12}>
              <Stack gap={2} style={{ flex: 1 }}>
                <Typography variant="body1">{t('settings.car.minimal')}</Typography>
                <Typography variant="caption" color="secondary">
                  {t('settings.car.minimalHint')}
                </Typography>
              </Stack>
              <Toggle value={carMinimal} onValueChange={setCarMinimal} />
            </Stack>
            <Divider />
            <Stack gap={8}>
              <Typography variant="body1">{t('settings.car.window')}</Typography>
              <Select<number>
                value={carWindow}
                options={CAR_WINDOW_OPTIONS.map((v): SelectOption<number> => ({
                  value: v,
                  label: t('settings.car.windowValue', { count: v }),
                }))}
                accessibilityLabel={t('settings.car.window')}
                onChange={setCarWindow}
              />
            </Stack>
          </>
        )}
      </Stack>
    );

  return (
    <>
      {mainCard}
      {carCard}
    </>
  );
}
