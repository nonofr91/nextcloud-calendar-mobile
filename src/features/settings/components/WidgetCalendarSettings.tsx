import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useAccountStore } from '@/stores/accountStore';
import { useActiveAccount } from '@/hooks/useAccounts';
import { useCalendars } from '@/hooks/useCalendars';
import { useCalendarStore } from '@/stores/calendarStore';
import { refreshWidgets } from '@/features/widget';
import { Divider, Stack, Toggle, Typography } from '@/ui/components';

const cardOuter = { marginHorizontal: 16, marginBottom: 4 };

export function WidgetCalendarSettings() {
  const { t } = useTranslation();
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const activeAccount = useActiveAccount(activeAccountId);
  const { data: calendars = [] } = useCalendars(activeAccount);
  const hiddenCalendarIds = useCalendarStore((s) => s.hiddenCalendarIds);
  const widgetDisabledCalendarIds = useCalendarStore((s) => s.widgetDisabledCalendarIds);
  const toggleWidget = useCalendarStore((s) => s.toggleCalendarWidget);

  const setWidget = useCallback((id: string) => {
    toggleWidget(id);
    void refreshWidgets();
  }, [toggleWidget]);

  return (
    <Stack card gap={12} padding={16} hAlign="stretch" style={cardOuter}>
      <Stack gap={2}>
        <Typography variant="body1">{t('settings.widgets.calendars')}</Typography>
        <Typography variant="caption" color="secondary">
          {t('settings.widgets.calendarsHint')}
        </Typography>
      </Stack>

      {calendars.length === 0 ? (
        <Typography variant="caption" color="secondary">
          {t('calendar.drawerNoCalendars')}
        </Typography>
      ) : (
        calendars.map((cal, i) => {
          const hidden = hiddenCalendarIds.includes(cal.id);
          const on = !hidden && !widgetDisabledCalendarIds.includes(cal.id);

          return (
            <Stack key={cal.id} gap={12} hAlign="stretch">
              {i > 0 && <Divider />}
              <Stack direction="horizontal" vAlign="center" gap={12}>
                <Stack gap={2} style={{ flex: 1 }}>
                  <Typography variant="body1" numberOfLines={1}>{cal.displayName}</Typography>
                  {hidden && (
                    <Typography variant="caption" color="secondary">
                      {t('settings.widgets.calendarHidden')}
                    </Typography>
                  )}
                </Stack>
                <Toggle
                  value={on}
                  disabled={hidden}
                  onValueChange={() => setWidget(cal.id)}
                  accessibilityLabel={cal.displayName}
                />
              </Stack>
            </Stack>
          );
        })
      )}
    </Stack>
  );
}
