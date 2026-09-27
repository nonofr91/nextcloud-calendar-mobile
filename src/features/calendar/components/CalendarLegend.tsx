import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import type { CalendarMeta } from '@/types';
import { useCalendarStore } from '@/stores/calendarStore';

interface Props {
  calendars: CalendarMeta[];
}

export function CalendarLegend({ calendars }: Props) {
  const hiddenCalendarIds = useCalendarStore((s) => s.hiddenCalendarIds);
  const toggleCalendarVisibility = useCalendarStore((s) => s.toggleCalendarVisibility);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll}>
      {calendars.map((cal) => {
        const hidden = hiddenCalendarIds.includes(cal.id);
        return (
          <TouchableOpacity
            key={cal.id}
            style={[styles.chip, hidden && styles.chipHidden]}
            onPress={() => toggleCalendarVisibility(cal.id)}
          >
            <View style={[styles.dot, { backgroundColor: cal.color }]} />
            <Text style={[styles.label, hidden && styles.labelHidden]}>{cal.displayName}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 12, paddingVertical: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0f0f0',
    borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8,
  },
  chipHidden: { backgroundColor: '#e8e8e8', opacity: 0.5 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  label: { fontSize: 13, color: '#333' },
  labelHidden: { color: '#999' },
});
