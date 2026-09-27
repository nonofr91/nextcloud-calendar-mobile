import { useCallback, useEffect } from 'react';
import { useSharedValue } from 'react-native-reanimated';
import { useCalendarStore } from '@/stores/calendarStore';

export function useZoom() {
  const hourRowHeight = useCalendarStore((s) => s.hourRowHeight);
  const setHourRowHeight = useCalendarStore((s) => s.setHourRowHeight);

  const cellHeight = useSharedValue(hourRowHeight);

  useEffect(() => {
    cellHeight.value = hourRowHeight;
  }, [hourRowHeight, cellHeight]);

  const commitZoom = useCallback(
    (h: number) => { setHourRowHeight(Math.round(h)); },
    [setHourRowHeight]
  );

  return { hourRowHeight, cellHeight, commitZoom };
}
