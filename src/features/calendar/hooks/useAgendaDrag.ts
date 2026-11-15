import { useCallback, useMemo, useRef, useState } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { haptic, ImpactFeedbackStyle } from '@/utils/haptics';
import { LONG_PRESS_MS } from '../constants';
import {
  agendaDayDelta,
  agendaRowIndexAtContentY,
  agendaTargetDayAtContentY,
  type AgendaDragRow,
} from '../utils/agendaDragMath';
import type { CalendarEvent } from '@/types';

const AUTOSCROLL_EDGE_PX = 64;
const AUTOSCROLL_STEP_PX = 16;

export interface AgendaDragState {
  event: CalendarEvent;
  /** Day key of the row the gesture started on — shifts are relative to it. */
  sourceKey: string;
}

interface Args {
  offsets: number[];
  rows: AgendaDragRow[];
  /** Live list scroll offset (content Y). */
  scrollY: React.MutableRefObject<number>;
  /** Absolute Y of the list container on screen — measured on layout. */
  containerTop: React.MutableRefObject<number>;
  /** Container height on screen — needed for the bottom-edge autoscroll. */
  containerHeight: React.MutableRefObject<number>;
  /** Scroll the list by a signed amount (already clamped by caller). */
  onScrollBy: (dy: number) => void;
  /** Commit: move the event by a whole-day delta. */
  onMoveEventByDays: (event: CalendarEvent, dayDelta: number) => void;
}

/**
 * Drag-to-move for the agenda list: per-row Pan activated after long-press.
 * A dragged row lifts a ghost following the finger; the day section under the
 * finger is the drop target and the event shifts by whole days, wall-clock
 * times preserved (mirrors the time-grid column move).
 */
export function useAgendaDrag({
  offsets,
  rows,
  scrollY,
  containerTop,
  containerHeight,
  onScrollBy,
  onMoveEventByDays,
}: Args) {
  const [drag, setDrag] = useState<AgendaDragState | null>(null);
  const [targetKey, setTargetKey] = useState<string | null>(null);

  // Ghost top-left position inside the list container (screen-Y minus container top).
  const ghostY = useSharedValue(0);
  // Finger offset inside the grabbed row, so the ghost tracks without jumping.
  const grabOffset = useSharedValue(0);
  // Last seen finger absolute Y — drives edge autoscroll on every update.
  const fingerAbsY = useSharedValue(0);

  const live = useRef({ offsets, rows, scrollY, containerTop, containerHeight, onScrollBy, onMoveEventByDays, drag });
  live.current = { offsets, rows, scrollY, containerTop, containerHeight, onScrollBy, onMoveEventByDays, drag };

  const begin = useCallback((uid: string, sourceKey: string, absoluteY: number) => {
    const s = live.current;
    // Resolve the event on the JS side — gesture worklets can't carry Date fields.
    const event = s.rows.find(
      (r) => r.type === 'item' && r.key === sourceKey && r.event?.uid === uid,
    )?.event;
    if (!event || event.isTask || event.readOnly) return;
    const contentY = absoluteY - s.containerTop.current + s.scrollY.current;
    // The gesture fired inside the grabbed row — hit-test locates its top.
    const rowTop = s.offsets[agendaRowIndexAtContentY(s.offsets, contentY)] ?? contentY;
    grabOffset.value = Math.max(0, contentY - rowTop);
    ghostY.value = contentY - s.scrollY.current - grabOffset.value;
    fingerAbsY.value = absoluteY;
    haptic(ImpactFeedbackStyle.Medium);
    setTargetKey(sourceKey);
    setDrag({ event, sourceKey });
  }, [ghostY, grabOffset, fingerAbsY]);

  const update = useCallback((absoluteY: number) => {
    const s = live.current;
    if (!s.drag) return;
    fingerAbsY.value = absoluteY;
    const contentY = absoluteY - s.containerTop.current + s.scrollY.current;
    ghostY.value = contentY - s.scrollY.current - grabOffset.value;

    const key = agendaTargetDayAtContentY(s.offsets, s.rows, contentY);
    if (key) setTargetKey(key);

    const relY = absoluteY - s.containerTop.current;
    if (relY < AUTOSCROLL_EDGE_PX) s.onScrollBy(-AUTOSCROLL_STEP_PX);
    else if (relY > s.containerHeight.current - AUTOSCROLL_EDGE_PX) s.onScrollBy(AUTOSCROLL_STEP_PX);
  }, [fingerAbsY, ghostY, grabOffset]);

  const commit = useCallback(() => {
    const s = live.current;
    const current = s.drag;
    setDrag(null);
    setTargetKey(null);
    if (!current) return;
    const contentY = fingerAbsY.value - s.containerTop.current + s.scrollY.current;
    const key = agendaTargetDayAtContentY(s.offsets, s.rows, contentY) ?? current.sourceKey;
    const delta = agendaDayDelta(current.sourceKey, key);
    if (delta !== 0) s.onMoveEventByDays(current.event, delta);
  }, [fingerAbsY]);

  const cancel = useCallback(() => {
    setDrag(null);
    setTargetKey(null);
  }, []);

  const rowGesture = useCallback(
    (uid: string, sourceKey: string) =>
      Gesture.Pan()
        .activateAfterLongPress(LONG_PRESS_MS)
        .onStart((e) => {
          scheduleOnRN(begin, uid, sourceKey, e.absoluteY);
        })
        .onUpdate((e) => {
          scheduleOnRN(update, e.absoluteY);
        })
        .onEnd(() => {
          scheduleOnRN(commit);
        })
        .onFinalize(() => {
          scheduleOnRN(cancel);
        }),
    [begin, update, commit, cancel],
  );

  const draggingUid = drag?.event.uid ?? null;

  return useMemo(
    () => ({ drag, draggingUid, targetKey, ghostY, rowGesture }),
    [drag, draggingUid, targetKey, ghostY, rowGesture],
  );
}
