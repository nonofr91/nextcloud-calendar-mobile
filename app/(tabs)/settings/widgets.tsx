import { useTranslation } from 'react-i18next';

import { SettingsPage } from '@/features/settings/components/SettingsPage';
import { WidgetCalendarSettings } from '@/features/settings/components/WidgetCalendarSettings';

export default function WidgetSettingsScreen() {
  const { t } = useTranslation();
  return (
    <SettingsPage title={t('settings.widgets.title')}>
      <WidgetCalendarSettings />
    </SettingsPage>
  );
}
