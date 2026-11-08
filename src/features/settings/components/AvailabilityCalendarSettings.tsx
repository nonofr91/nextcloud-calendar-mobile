import { useTranslation } from 'react-i18next';

import { useAccounts } from '@/hooks/useAccounts';
import { useMultiCalendars } from '@/hooks/useCalendars';
import { hostnameOf } from '@/features/account/utils/account';
import { calendarKeyOf } from '@/utils/calendars';
import { useCalendarStore } from '@/stores/calendarStore';
import { Divider, Stack, Toggle, Typography } from '@/ui/components';

const cardOuter = { marginHorizontal: 16, marginBottom: 12 };

/** Per-calendar "counts for availability" flag — default: writable counts, read-only doesn't. */
export function AvailabilityCalendarSettings() {
    const { t } = useTranslation();
    const accounts = useAccounts();
    // Availability flags apply to the merged calendar set — list every account.
    const { data: calendars = [] } = useMultiCalendars(accounts);
    const overrides = useCalendarStore((s) => s.availabilityCalendarOverrides);
    const setAvailability = useCalendarStore((s) => s.setCalendarAvailability);

    return (
        <Stack card gap={12} padding={16} hAlign="stretch" style={cardOuter}>
            <Stack gap={2}>
                <Typography variant="body1">{t('settings.voice.availabilityTitle')}</Typography>
                <Typography variant="caption" color="secondary">
                    {t('settings.voice.availabilityHint')}
                </Typography>
            </Stack>

            {calendars.length === 0 ? (
                <Typography variant="caption" color="secondary">
                    {t('calendar.drawerNoCalendars')}
                </Typography>
            ) : (
                calendars.map((cal, i) => {
                    const key = calendarKeyOf(cal);
                    const on = overrides[key] ?? !cal.isReadOnly;
                    const owner = accounts.find((a) => a.id === cal.accountId);
                    return (
                        <Stack key={key} gap={12} hAlign="stretch">
                            {i > 0 && <Divider />}
                            <Stack direction="horizontal" vAlign="center" gap={12}>
                                <Stack gap={2} style={{ flex: 1 }}>
                                    <Typography variant="body1" numberOfLines={1}>{cal.displayName}</Typography>
                                    {accounts.length > 1 && owner && (
                                        <Typography variant="caption" color="secondary">
                                            {hostnameOf(owner.baseUrl)}
                                        </Typography>
                                    )}
                                    {cal.isReadOnly && (
                                        <Typography variant="caption" color="secondary">
                                            {t('voice.calendarReadOnly')}
                                        </Typography>
                                    )}
                                </Stack>
                                <Toggle
                                    value={on}
                                    onValueChange={(v) => setAvailability(key, v)}
                                    accessibilityLabel={cal.displayName}
                                    testID={`availability-${key}`}
                                />
                            </Stack>
                        </Stack>
                    );
                })
            )}
        </Stack>
    );
}
