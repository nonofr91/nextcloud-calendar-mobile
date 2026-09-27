import { memo } from 'react';
import { StyleSheet } from 'react-native';
import { useTheme } from 'expo-router';
import { Stack, Spinner, Typography } from '@/ui/components';

interface Props {
  label: string;
}

function CalendarLoadingOverlayImpl({ label }: Props) {
  const { colors } = useTheme();
  return (
    <Stack
      vAlign="center"
      hAlign="center"
      gap={12}
      backgroundColor={colors.background}
      style={styles.overlay}
    >
      <Spinner size="large" />
      <Typography variant="caption" color="secondary">
        {label}
      </Typography>
    </Stack>
  );
}

export const CalendarLoadingOverlay = memo(CalendarLoadingOverlayImpl);

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 5 },
});
