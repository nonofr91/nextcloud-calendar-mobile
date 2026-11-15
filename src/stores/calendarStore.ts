import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { legacyBackedStorage } from '@/stores/legacyStorage';
import type { ViewMode } from '@/types';

interface CalendarState {
  viewMode: ViewMode;
  selectedDate: Date | null;
  hiddenCalendarIds: string[];
  notifDisabledCalendarIds: string[];
  widgetDisabledCalendarIds: string[];
  hourRowHeight: number;
  /** Opt-in: Deck board cards (VTODOs) merged into calendar views. */
  showDeckCards: boolean;
  setViewMode: (mode: ViewMode) => void;
  setSelectedDate: (date: Date | null) => void;
  toggleCalendarVisibility: (calendarId: string) => void;
  toggleCalendarNotifications: (calendarId: string) => void;
  toggleCalendarWidget: (calendarId: string) => void;
  setHourRowHeight: (h: number) => void;
  toggleShowDeckCards: () => void;
}

function toggleIn(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export const useCalendarStore = create<CalendarState>()(
  persist(
    (set, get) => ({
      viewMode: 'week',
      selectedDate: null,
      hiddenCalendarIds: [],
      notifDisabledCalendarIds: [],
      widgetDisabledCalendarIds: [],
      hourRowHeight: 60,
      showDeckCards: false,
      setViewMode: (mode) => set({ viewMode: mode }),
      setSelectedDate: (date) => set({ selectedDate: date }),
      toggleCalendarVisibility: (calendarId) =>
        set({ hiddenCalendarIds: toggleIn(get().hiddenCalendarIds, calendarId) }),
      toggleCalendarNotifications: (calendarId) =>
        set({ notifDisabledCalendarIds: toggleIn(get().notifDisabledCalendarIds, calendarId) }),
      toggleCalendarWidget: (calendarId) =>
        set({ widgetDisabledCalendarIds: toggleIn(get().widgetDisabledCalendarIds, calendarId) }),
      setHourRowHeight: (h) => set({ hourRowHeight: h }),
      toggleShowDeckCards: () =>
        set({ showDeckCards: !get().showDeckCards }),
    }),
    {
      name: 'calendar-store',
      storage: createJSONStorage(() =>
        legacyBackedStorage(['viewMode', 'hiddenCalendarIds', 'notifDisabledCalendarIds', 'widgetDisabledCalendarIds', 'hourRowHeight', 'showDeckCards'])
      ),
      partialize: (state) => ({
        viewMode: state.viewMode,
        hiddenCalendarIds: state.hiddenCalendarIds,
        notifDisabledCalendarIds: state.notifDisabledCalendarIds,
        widgetDisabledCalendarIds: state.widgetDisabledCalendarIds,
        hourRowHeight: state.hourRowHeight,
        showDeckCards: state.showDeckCards,
      }),
    }
  )
);
