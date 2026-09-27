import { memo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from 'expo-router';

const HOUR_LINES = Array.from({ length: 23 }, (_, i) => i + 1);
const HALF_LINES = Array.from({ length: 24 }, (_, i) => i);

function GridLinesImpl() {
  const { colors } = useTheme();
  return (
    <View testID="grid-lines" pointerEvents="none" style={StyleSheet.absoluteFill}>
      {HALF_LINES.map((hour) => (
        <View
          key={`half-${hour}`}
          testID={`half-hour-line-${hour}`}
          style={[styles.line, { top: `${((hour + 0.5) / 24) * 100}%`, backgroundColor: colors.borderSubtle }]}
        />
      ))}
      {HOUR_LINES.map((hour) => (
        <View
          key={`hour-${hour}`}
          testID={`hour-line-${hour}`}
          style={[styles.line, { top: `${(hour / 24) * 100}%`, backgroundColor: colors.border }]}
        />
      ))}
    </View>
  );
}

export const GridLines = memo(GridLinesImpl);

const styles = StyleSheet.create({
  line: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
});
