import { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'expo-router';
import { X } from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';

import {
  Button, IconButton, ScreenHeader, Stack, TextField, Typography,
} from '@/ui/components';

import { startLoginFlow } from '@/services/nextcloud/loginFlow';
import type { LoginFlowCredentials } from '@/services/nextcloud/loginFlow';
import { maybeUpgradeToHttps } from '@/services/shared/httpsProbe';
import { CertTrustSheet } from '@/features/account/components/CertTrustSheet';
import { CleartextConsentSheet } from '@/features/account/components/CleartextConsentSheet';
import { useCertTrust } from '@/features/account/hooks/useCertTrust';
import { useCleartextConsent } from '@/features/account/hooks/useCleartextConsent';
import { useLoginFlow } from '../hooks/useLoginFlow';

interface Props {
  visible: boolean;
  /** Pre-fill from the setup screen's URL field — may be empty on car displays. */
  initialBaseUrl: string;
  onClose: () => void;
  onCredentials: (creds: LoginFlowCredentials) => void;
}

export function LoginFlowSheet({ visible, initialBaseUrl, onClose, onCredentials }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const flow = useLoginFlow(onCredentials);
  const certTrust = useCertTrust();
  const cleartextConsent = useCleartextConsent();
  const lastUrlRef = useRef('');

  useEffect(() => {
    if (visible) {
      setBaseUrl(initialBaseUrl);
      flow.cancel();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const attemptStart = (raw: string) => {
    lastUrlRef.current = raw;
    let normalized = raw.trim().replace(/\/$/, '');
    if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;
    void flow.start(() =>
      cleartextConsent.run(async () =>
        certTrust.run(async () => startLoginFlow(await maybeUpgradeToHttps(normalized))),
      ),
    );
  };

  const retryStart = () => attemptStart(lastUrlRef.current);

  const starting = flow.status === 'starting';
  const pending = flow.status === 'pending' && flow.session;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
        <ScreenHeader
          left={
            <IconButton variant="ghost" round size={40} onPress={onClose} accessibilityLabel={t('common.close')}>
              <X size={22} color={theme.colors.text} />
            </IconButton>
          }
        />
        <Stack gap={16} style={styles.content} hAlign="center">
          <Typography variant="h3" align="center">{t('setup.loginFlow.title')}</Typography>
          <Typography variant="caption" color="secondary" align="center">
            {t('setup.loginFlow.hint')}
          </Typography>

          {!pending ? (
            <Stack gap={12} style={styles.form}>
              <TextField
                testID="login-flow-server-url"
                label={t('setup.serverUrl')}
                placeholder={t('setup.placeholders.serverUrl')}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                value={baseUrl}
                onChangeText={setBaseUrl}
              />
              {flow.status === 'error' ? (
                <Typography variant="caption" color="danger" align="center">
                  {t('setup.loginFlow.startError')}
                </Typography>
              ) : null}
              {flow.status === 'expired' ? (
                <Typography variant="caption" color="danger" align="center">
                  {t('setup.loginFlow.expired')}
                </Typography>
              ) : null}
              <Button
                testID="login-flow-start"
                variant="primary"
                title={t('setup.loginFlow.showQr')}
                loading={starting}
                disabled={starting || !baseUrl.trim()}
                onPress={() => attemptStart(baseUrl)}
              />
            </Stack>
          ) : (
            <Stack gap={16} hAlign="center">
              <View style={styles.qrBox}>
                <QRCode value={flow.session!.loginUrl} size={220} ecl="M" />
              </View>
              <Typography variant="caption" color="secondary" align="center">
                {t('setup.loginFlow.waiting')}
              </Typography>
              <Typography variant="caption" color="secondary" align="center" numberOfLines={2}>
                {flow.session!.loginUrl}
              </Typography>
            </Stack>
          )}
        </Stack>
      </View>

      <CertTrustSheet
        error={certTrust.pending}
        onTrust={() => { certTrust.confirm(); retryStart(); }}
        onCancel={certTrust.dismiss}
      />

      <CleartextConsentSheet
        error={cleartextConsent.pending}
        onConfirm={() => { cleartextConsent.confirm(); retryStart(); }}
        onCancel={cleartextConsent.dismiss}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flex: 1, padding: 24, paddingTop: 32 },
  form: { alignSelf: 'stretch' },
  qrBox: { padding: 16, backgroundColor: '#fff', borderRadius: 12 },
});
