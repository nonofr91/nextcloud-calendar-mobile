import type { AgendaTimelineEntry, WidgetSurface } from '../../core/types';

export const homeWidget: WidgetSurface<AgendaTimelineEntry[]> = {
  id: 'homeWidget',
  isSupported: () => false,
  update: async () => {},
  clear: async () => {},
};
