import i18n from '@/utils/i18n';

import LiveUpdates from '../../../../../modules/live-updates/src/LiveUpdatesModule';
import type { LiveEventState, WidgetSurface } from '../../core/types';
import { writeLiveEvent } from '../../storage/widgetStore';

function argb(hex: string): number | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return m ? 0xff000000 + parseInt(m[1], 16) : undefined;
}

function template(key: string): string {
  return (
    (i18n.getResource(i18n.language, 'translation', key) as string | undefined) ??
    (i18n.getResource('en', 'translation', key) as string)
  );
}

export const liveActivity: WidgetSurface<LiveEventState> = {
  id: 'liveActivity',
  isSupported: () => {
    try {
      return LiveUpdates.isSupported() && LiveUpdates.hasPermission();
    } catch {
      return false;
    }
  },
  canPromote: () => {
    try {
      return LiveUpdates.canPromote();
    } catch {
      return false;
    }
  },
  requestPermission: async () => {
    try {
      if (LiveUpdates.hasPermission()) return true;
      const { granted } = await LiveUpdates.requestPermission();
      return granted;
    } catch {
      return false;
    }
  },
  update: async (state) => {
    writeLiveEvent(state);
    await LiveUpdates.update({
      title: state.title,
      textTemplate: template('widget.liveRemaining'),
      shortTemplate: template('widget.liveRemainingShort'),
      hourUnit: template('widget.durationHour'),
      minuteUnit: template('widget.durationMinute'),
      location: state.location,
      attendees: state.attendees,
      startMs: new Date(state.startIso).getTime(),
      endMs: new Date(state.endIso).getTime(),
      color: argb(state.color),
    });
  },
  clear: async () => {
    writeLiveEvent(null);
    await LiveUpdates.clear();
  },
};
