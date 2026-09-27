import { useTranslation } from 'react-i18next';

import { SettingsPage } from '@/features/settings/components/SettingsPage';
import { NotificationSettings } from '@/features/settings/components/NotificationSettings';

export default function NotificationSettingsScreen() {
  const { t } = useTranslation();
  return (
    <SettingsPage title={t('settings.notifications.title')}>
      <NotificationSettings />
    </SettingsPage>
  );
}
