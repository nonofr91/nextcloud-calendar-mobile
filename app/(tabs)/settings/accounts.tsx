import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { setActiveAccountId } from '@/services/nextcloud/auth';
import { useAccounts } from '@/hooks/useAccounts';
import { useAccountStore } from '@/stores/accountStore';
import { AccountCard } from '@/features/account/components/AccountCard';
import { toggleAccountVisibilityAndPromote } from '@/features/account/utils/visibility';
import { SettingsPage } from '@/features/settings/components/SettingsPage';
import { Button, Stack } from '@/ui/components';

export default function AccountSettingsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const visibleAccountIds = useAccountStore((s) => s.visibleAccountIds);
  const setStoreId = useAccountStore((s) => s.setActiveAccountId);
  const accounts = useAccounts();
  const allIds = accounts.map((a) => a.id);
  const isAccountVisible = (id: string) =>
    visibleAccountIds === null || visibleAccountIds.includes(id);

  async function handleSetActive(id: string) {
    if (!isAccountVisible(id)) {
      useAccountStore.getState().toggleAccountVisibility(id, allIds);
    }
    await setActiveAccountId(id);
    setStoreId(id);
  }

  return (
    <SettingsPage title={t('settings.accounts')}>
      {accounts.map((account) => (
        <AccountCard
          key={account.id}
          account={account}
          isActive={account.id === activeAccountId}
          isVisible={isAccountVisible(account.id)}
          onSetActive={() => handleSetActive(account.id)}
          onOpen={() => router.push(`/(tabs)/settings/account/${account.id}`)}
          onToggleVisible={() => void toggleAccountVisibilityAndPromote(account.id, allIds)}
        />
      ))}
      <Stack padding={[16, 8]}>
        <Button
          testID="accounts-add"
          variant="ghost"
          dashed
          title={t('settings.addAccount')}
          onPress={() => router.push('/(auth)/setup')}
        />
      </Stack>
    </SettingsPage>
  );
}
