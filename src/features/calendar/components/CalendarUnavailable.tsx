import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'expo-router';
import { CalendarOff } from 'lucide-react-native';

import { useAccountStore } from '@/stores/accountStore';
import { useActiveAccount } from '@/hooks/useAccounts';
import { fetchCapabilities } from '@/services/nextcloud/nextcloud';
import { ViewContainer, Stack, Typography, Button } from '@/ui/components';

export function CalendarUnavailable() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const activeAccount = useActiveAccount(activeAccountId);
  const setCapabilities = useAccountStore((s) => s.setCapabilities);
  const [retrying, setRetrying] = useState(false);

  async function onRetry() {
    if (!activeAccount) return;
    setRetrying(true);
    try {
      setCapabilities(await fetchCapabilities(activeAccount));
    } finally {
      setRetrying(false);
    }
  }

  return (
    <ViewContainer centered>
      <Stack gap={16} hAlign="center" vAlign="center" padding={32} style={styles.fill}>
        <CalendarOff size={72} color={colors.textSecondary} strokeWidth={1.5} />
        <Typography variant="h2" style={styles.center}>
          {t('calendar.unavailable.title')}
        </Typography>
        <Typography variant="body1" color="secondary" style={styles.center}>
          {t('calendar.unavailable.body')}
        </Typography>
        <Button
          title={t('calendar.unavailable.retry')}
          onPress={onRetry}
          loading={retrying}
          style={styles.retry}
        />
      </Stack>
    </ViewContainer>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { textAlign: 'center' },
  retry: { alignSelf: 'center', marginTop: 8 },
});
