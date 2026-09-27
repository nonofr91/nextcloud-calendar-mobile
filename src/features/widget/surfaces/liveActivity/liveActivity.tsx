import type { LiveEventState, WidgetSurface } from '../../core/types';

export const liveActivity: WidgetSurface<LiveEventState> = {
  id: 'liveActivity',
  isSupported: () => false,
  update: async () => {},
  clear: async () => {},
};
