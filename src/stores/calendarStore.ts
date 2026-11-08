import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { legacyBackedStorage } from '@/stores/legacyStorage';
import type { ViewMode } from '@/types';

export type MonthWidgetFontSize = 'small' | 'normal' | 'large' | 'xlarge' | 'huge';
export type MonthWidgetFontWeight = 'light' | 'normal' | 'medium' | 'bold' | 'black';
export type MonthWidgetTheme = 'system' | 'light' | 'dark';
export type MonthWidgetCardStyle = 'card' | 'borderless' | 'transparent';
export type MonthWidgetDayTap = 'calendar' | 'newEvent';

interface CalendarState {
  viewMode: ViewMode;
  selectedDate: Date | null;
  hiddenCalendarIds: string[];
  notifDisabledCalendarIds: string[];
  widgetDisabledCalendarIds: string[];
  /** User overrides for "counts for availability" — absent id defaults to !isReadOnly. */
  availabilityCalendarOverrides: Record<string, boolean>;
  monthWidgetFontSize: MonthWidgetFontSize;
  monthWidgetFontWeight: MonthWidgetFontWeight;
  monthWidgetTheme: MonthWidgetTheme;
  monthWidgetCardStyle: MonthWidgetCardStyle;
  monthWidgetDayTap: MonthWidgetDayTap;
  hourRowHeight: number;
  showCompletedTasks: boolean;
  setViewMode: (mode: ViewMode) => void;
  setSelectedDate: (date: Date | null) => void;
  toggleCalendarVisibility: (calendarId: string) => void;
  toggleCalendarNotifications: (calendarId: string) => void;
  toggleCalendarWidget: (calendarId: string) => void;
  setCalendarAvailability: (calendarId: string, value: boolean) => void;
  setMonthWidgetFontSize: (value: MonthWidgetFontSize) => void;
  setMonthWidgetFontWeight: (value: MonthWidgetFontWeight) => void;
  setMonthWidgetTheme: (value: MonthWidgetTheme) => void;
  setMonthWidgetCardStyle: (value: MonthWidgetCardStyle) => void;
  setMonthWidgetDayTap: (value: MonthWidgetDayTap) => void;
  setHourRowHeight: (h: number) => void;
  toggleShowCompletedTasks: () => void;
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
      availabilityCalendarOverrides: {},
      monthWidgetFontSize: 'large',
      monthWidgetFontWeight: 'bold',
      monthWidgetTheme: 'system',
      monthWidgetCardStyle: 'card',
      monthWidgetDayTap: 'calendar',
      hourRowHeight: 60,
      showCompletedTasks: false,
      setViewMode: (mode) => set({ viewMode: mode }),
      setSelectedDate: (date) => set({ selectedDate: date }),
      toggleCalendarVisibility: (calendarId) =>
        set({ hiddenCalendarIds: toggleIn(get().hiddenCalendarIds, calendarId) }),
      toggleCalendarNotifications: (calendarId) =>
        set({ notifDisabledCalendarIds: toggleIn(get().notifDisabledCalendarIds, calendarId) }),
      toggleCalendarWidget: (calendarId) =>
        set({ widgetDisabledCalendarIds: toggleIn(get().widgetDisabledCalendarIds, calendarId) }),
      setCalendarAvailability: (calendarId, value) =>
        set({ availabilityCalendarOverrides: { ...get().availabilityCalendarOverrides, [calendarId]: value } }),
      setMonthWidgetFontSize: (monthWidgetFontSize) => set({ monthWidgetFontSize }),
      setMonthWidgetFontWeight: (monthWidgetFontWeight) => set({ monthWidgetFontWeight }),
      setMonthWidgetTheme: (monthWidgetTheme) => set({ monthWidgetTheme }),
      setMonthWidgetCardStyle: (monthWidgetCardStyle) => set({ monthWidgetCardStyle }),
      setMonthWidgetDayTap: (monthWidgetDayTap) => set({ monthWidgetDayTap }),
      setHourRowHeight: (h) => set({ hourRowHeight: h }),
      toggleShowCompletedTasks: () =>
        set({ showCompletedTasks: !get().showCompletedTasks }),
    }),
    {
      name: 'calendar-store',
      storage: createJSONStorage(() =>
        legacyBackedStorage([
          'viewMode', 'hiddenCalendarIds', 'notifDisabledCalendarIds', 'widgetDisabledCalendarIds', 'availabilityCalendarOverrides', 'hourRowHeight', 'showCompletedTasks',
          'monthWidgetFontSize', 'monthWidgetFontWeight', 'monthWidgetTheme', 'monthWidgetCardStyle', 'monthWidgetDayTap',
        ])
      ),
      partialize: (state) => ({
        viewMode: state.viewMode,
        hiddenCalendarIds: state.hiddenCalendarIds,
        notifDisabledCalendarIds: state.notifDisabledCalendarIds,
        widgetDisabledCalendarIds: state.widgetDisabledCalendarIds,
        availabilityCalendarOverrides: state.availabilityCalendarOverrides,
        monthWidgetFontSize: state.monthWidgetFontSize,
        monthWidgetFontWeight: state.monthWidgetFontWeight,
        monthWidgetTheme: state.monthWidgetTheme,
        monthWidgetCardStyle: state.monthWidgetCardStyle,
        monthWidgetDayTap: state.monthWidgetDayTap,
        hourRowHeight: state.hourRowHeight,
        showCompletedTasks: state.showCompletedTasks,
      }),
    }
  )
);
