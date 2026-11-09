import { useCallback, useDeferredValue, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAccounts, useVisibleAccountIds } from '@/hooks/useAccounts';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import { useAccountStore, anyCalendarConfigured } from '@/stores/accountStore';
import { useCalendarStore } from '@/stores/calendarStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { ViewContainer, Spinner } from '@/ui/components';
import { CalendarDrawer } from '@/features/calendar/components/CalendarDrawer';
import { OfflineBanner } from '@/features/calendar/components/OfflineBanner';
import { SyncErrorBanner } from '@/features/calendar/components/SyncErrorBanner';
import { useIsOnline } from '@/services/shared/network';
import { drainPending } from '@/services/pendingMutations';
import { MonthDayView } from '@/features/calendar/components/MonthDayView';
import { AgendaView } from '@/features/calendar/components/AgendaView';
import { createNavigationGuard } from '@/utils/navigationGuard';
import type { CalendarEvent, RecurrenceEditScope } from '@/types';
import { useCalendarNavigation } from '@/features/calendar/hooks/useCalendarNavigation';
import { useCalendarData } from '@/features/calendar/hooks/useCalendarData';
import { useCalendarDrawer } from '@/features/calendar/hooks/useCalendarDrawer';
import { useZoom } from '@/features/calendar/hooks/useZoom';
import { useMonthReturn } from '@/features/calendar/hooks/useMonthReturn';
import { CalendarTopBar } from '@/features/calendar/components/CalendarTopBar';
import { TimeGridView } from '@/features/calendar/components/TimeGridView';
import { ViewLayer } from '@/features/calendar/components/ViewLayer';
import { CalendarFab } from '@/features/calendar/components/CalendarFab';
import { CalendarLoadingOverlay } from '@/features/calendar/components/CalendarLoadingOverlay';
import { toGridEvents, type GridEvent } from '@/features/calendar/utils/toGridEvents';
import { eventToInput } from '@/features/calendar/utils/eventToInput';
import { decideMoveEventScope } from '@/features/calendar/utils/moveEventScope';
import { isCalMode, type CalMode } from '@/features/calendar/constants';
import { CalendarUnavailable } from '@/features/calendar/components/CalendarUnavailable';
import { useInvitations } from '@/features/invitations/hooks/useInvitations';
import { useUpdateEvent } from '@/features/event/hooks/useMutateEvent';
import { askRecurrenceScope } from '@/features/event/recurrenceScope';
import { useBriefing } from '@/features/briefing/useBriefing';
import { BriefingBar } from '@/features/briefing/BriefingBar';
import { useVoiceAssistant } from '@/features/voice/useVoiceAssistant';
import { VoiceAssistantSheet } from '@/features/voice/VoiceAssistantSheet';

dayjs.extend(isoWeek);

export default function CalendarScreen() {
  const router = useRouter();
  const { date: dateParam } = useLocalSearchParams<{ date?: string }>();
  const { t } = useTranslation();

  const accounts = useAccounts();
  const visibleAccountIds = useVisibleAccountIds();
  // The merged view is usable while at least one visible account serves CalDAV.
  const calendarUnavailable = !useAccountStore((s) => anyCalendarConfigured(s, visibleAccountIds));
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn);
  const language = useSettingsStore((s) => s.language);
  const monthViewStyle = useSettingsStore((state) => state.monthViewStyle);
  const hiddenCalendarIds = useCalendarStore((s) => s.hiddenCalendarIds);
  const toggleCalendarVisibility = useCalendarStore((s) => s.toggleCalendarVisibility);
  const notifDisabledCalendarIds = useCalendarStore((s) => s.notifDisabledCalendarIds);
  const toggleCalendarNotifications = useCalendarStore((s) => s.toggleCalendarNotifications);
  const voiceAssistantByAccount = useSettingsStore((s) => s.voiceAssistantByAccount);

  const nav = useCalendarNavigation();
  const { viewMode, date, fetchDate, agendaVisibleDate } = nav;
  const displayedDay = viewMode === 'schedule' ? agendaVisibleDate : date;
  const { openDay } = useMonthReturn(viewMode, nav.switchMode);
  const setViewMode = useCalendarStore((s) => s.setViewMode);

  const applySelectedDate = useCallback((dateStr: string) => {
    const raw = dateStr.split('T')[0];
    const parts = raw.split('-').map(Number);
    if (parts.length === 3 && !parts.some(Number.isNaN)) {
      const targetDate = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
      nav.setDate(targetDate);
      setViewMode('month');
    }
  }, [nav.setDate, setViewMode]);

  useEffect(() => {
    if (dateParam && !Array.isArray(dateParam)) {
      applySelectedDate(dateParam);
    }
  }, [dateParam, applySelectedDate]);

  const deferredViewMode = useDeferredValue(viewMode);
  const deferredDate = useDeferredValue(date);
  const deferredAnchorDate = useDeferredValue(nav.anchorDate);
  const deferredWeekStartsOn = useDeferredValue(weekStartsOn);
  const deferredIsCalendarMode = isCalMode(deferredViewMode);
  const lastCalModeRef = useRef<CalMode>('week');
  if (isCalMode(deferredViewMode)) lastCalModeRef.current = deferredViewMode;
  const calMode: CalMode = lastCalModeRef.current;

  const { hourRowHeight, cellHeight, commitZoom } = useZoom();
  const {
    activeAccount, visibleAccounts, calendars, allEvents, agendaEvents,
    showFullOverlay, showSmallLoader, syncFailed, retrySync,
  } = useCalendarData(fetchDate, viewMode === 'schedule');
  const { data: invitations } = useInvitations(visibleAccounts);
  const pendingInvitationsCount = invitations.length;
  const voiceAssistantEnabled = activeAccount
    ? (voiceAssistantByAccount[activeAccount.id] ?? false)
    : false;
  const insets = useSafeAreaInsets();
  const drawer = useCalendarDrawer();
  const voice = useVoiceAssistant(activeAccount, calendars);
  const briefing = useBriefing(displayedDay);
  const { start: startBriefing } = briefing;
  const handleListen = useCallback(() => {
    void startBriefing();
  }, [startBriefing]);

  // nextcloud-calendar://listen (home-widget button) redirects here with
  // ?autolisten=1 — start the briefing once, then clear the param so the next
  // widget tap re-triggers.
  const { autolisten } = useLocalSearchParams<{ autolisten?: string }>();
  useEffect(() => {
    if (autolisten !== '1') return;
    void startBriefing();
    router.setParams({ autolisten: undefined });
  }, [autolisten, startBriefing, router]);

  const online = useIsOnline();
  useEffect(() => {
    if (online && activeAccount) void drainPending(activeAccount);
  }, [online, activeAccount]);


  const calendarEvents = useMemo(() => toGridEvents(allEvents, accounts), [allEvents, accounts]);

  const allDayEvents = useMemo(() => allEvents.filter((e) => e.allDay), [allEvents]);
  const nowHour = useMemo(() => Math.max(0, new Date().getHours() - 1), []);

  const navGuard = useRef(createNavigationGuard()).current;

  const handlePressGridEvent = useCallback(
    (event: { _event: CalendarEvent }) => {
      navGuard(() => router.push(
        `/event/${encodeURIComponent(event._event.uid)}?accountId=${encodeURIComponent(event._event.accountId)}`,
      ));
    },
    [router, navGuard]
  );
  const handlePressEventFromMonth = useCallback(
    (event: CalendarEvent) => {
      navGuard(() => router.push(
        `/event/${encodeURIComponent(event.uid)}?accountId=${encodeURIComponent(event.accountId)}`,
      ));
    },
    [router, navGuard]
  );
  const handlePressCell = useCallback(
    (d: Date) => { navGuard(() => router.push({ pathname: '/event/new', params: { date: d.toISOString() } })); },
    [router, navGuard]
  );

  const updateMutation = useUpdateEvent(accounts, calendars);
  const { mutateAsync } = updateMutation;

  const recurrenceScopeStrings = useMemo(
    () => ({
      message: t('event.recurrenceScopeMessage'),
      thisOnly: t('event.scopeThisOnly'),
      thisAndFollowing: t('event.scopeThisAndFollowingBtn'),
      all: t('event.scopeAllEvents'),
      cancel: t('common.cancel'),
    }),
    [t]
  );

  const handleMoveEvent = useCallback(
    (gridEvent: GridEvent, nextStart: Date, nextEnd: Date) => {
      const event = gridEvent._event;
      const owner = accounts.find((a) => a.id === event.accountId);
      if (!owner) return;
      const apply = (scope: RecurrenceEditScope) => {
        void mutateAsync({
          event,
          input: { ...eventToInput(event, owner), dtstart: nextStart, dtend: nextEnd },
          scope,
          datesOnly: true,
        });
      };
      const decision = decideMoveEventScope(event);
      if (decision.kind === 'prompt') {
        askRecurrenceScope(t('event.editEvent'), recurrenceScopeStrings, apply);
        return;
      }
      apply(decision.scope);
    },
    [accounts, mutateAsync, t, recurrenceScopeStrings]
  );

  const isToday = dayjs(displayedDay).isSame(dayjs(), 'day');

  const headerTitle = useMemo(() => {
    const d = dayjs(viewMode === 'schedule' ? agendaVisibleDate : date).locale(language);
    if (viewMode === '7days') {
      return `${d.format('D MMM')} – ${d.add(6, 'day').format('D MMM YYYY')}`;
    }
    const monthYear = d.format('MMMM YYYY');
    if (viewMode === 'week' || viewMode === '3days' || viewMode === 'day') {
      return `${monthYear}  ·  ${t('calendar.weekAbbr')}${d.isoWeek()}`;
    }
    return monthYear;
  }, [displayedDay, viewMode, language, t]);

  const handleMonthPageChange = useCallback(
    (firstOfMonth: Date) => {
      if (useCalendarStore.getState().viewMode === 'month') {
        nav.onPageChange(firstOfMonth);
      }
    },
    [nav.onPageChange]
  );

  const handleGridPageChange = useCallback(
    (focusDate: Date) => {
      if (isCalMode(useCalendarStore.getState().viewMode)) {
        nav.onPageChange(focusDate);
      }
    },
    [nav.onPageChange]
  );

  if (calendarUnavailable) {
    return <CalendarUnavailable />;
  }

  return (
    <ViewContainer>
      <CalendarTopBar
        headerTitle={headerTitle}
        isToday={isToday}
        viewMode={viewMode}
        pendingInvitationsCount={pendingInvitationsCount}
        onOpenDrawer={drawer.openDrawer}
        onOpenSearch={() => navGuard(() => router.push('/search'))}
        onToday={nav.goToday}
        onSwitchMode={nav.switchMode}
        onListen={voiceAssistantEnabled ? undefined : handleListen}
        onOpenVoice={voiceAssistantEnabled ? voice.open : undefined}
      />

      <OfflineBanner account={activeAccount ?? null} />
      {syncFailed && <SyncErrorBanner onRetry={retrySync} />}

      <View style={styles.viewArea}>
        <ViewLayer visible={deferredViewMode === 'month'}>
          <MonthDayView
            date={deferredDate}
            events={allEvents}
            weekStartsOn={deferredWeekStartsOn}
            jump={nav.jump}
            onSelectDate={nav.setDate}
            onMonthChange={handleMonthPageChange}
            onPressEvent={handlePressEventFromMonth}
            onPressCell={handlePressCell}
            variant={monthViewStyle}
            onOpenDay={openDay}
          />
        </ViewLayer>

        <ViewLayer visible={deferredViewMode === 'schedule'}>
          {deferredViewMode === 'schedule' && (
            <AgendaView
              ref={nav.agendaRef}
              events={agendaEvents}
              date={date}
              onPressEvent={handlePressEventFromMonth}
              onPressCell={handlePressCell}
              onVisibleDateChange={nav.setAgendaVisibleDate}
            />
          )}
        </ViewLayer>

        <ViewLayer visible={deferredIsCalendarMode}>
          <TimeGridView
            mode={calMode}
            anchorDate={deferredAnchorDate}
            activeDate={deferredDate}
            events={calendarEvents}
            allDayEvents={allDayEvents}
            hourRowHeight={hourRowHeight}
            cellHeight={cellHeight}
            weekStartsOn={deferredWeekStartsOn}
            active={deferredIsCalendarMode}
            jump={nav.jump}
            commitZoom={commitZoom}
            initialScrollHour={nowHour}
            onPageChange={handleGridPageChange}
            onPressSlot={handlePressCell}
            onPressEvent={handlePressGridEvent}
            onPressAllDayEvent={handlePressEventFromMonth}
            onMoveEvent={handleMoveEvent}
          />
        </ViewLayer>
      </View>

      {showFullOverlay && <CalendarLoadingOverlay label={t('calendar.loadingCalendar')} />}
      {showSmallLoader && <Spinner size="small" color="secondary" style={styles.smallLoader} />}

      <BriefingBar
        status={briefing.state === 'done' ? 'idle' : briefing.state}
        currentText={briefing.segments[briefing.index]?.text ?? ''}
        onPause={briefing.pause}
        onResume={briefing.resume}
        onNext={briefing.next}
        onStop={briefing.stop}
        style={StyleSheet.flatten([styles.briefingBar, { bottom: insets.bottom + 76 }])}
      />

      <VoiceAssistantSheet
        visible={voice.visible}
        state={voice.state === 'idle' ? 'listening' : voice.state}
        transcript={voice.transcript}
        intentDescription={voice.intentDescription}
        candidates={voice.candidates}
        reply={voice.reply}
        errorText={voice.errorText}
        onSubmitText={voice.submitText}
        onConfirm={voice.confirm}
        onCancel={voice.close}
        onPickCandidate={voice.pickCandidate}
        onRelisten={voice.relisten}
        onClose={voice.close}
      />

      <CalendarFab
        onPress={() => navGuard(() => {
          const shown = displayedDay;
          const now = new Date();
          const start = new Date(
            shown.getFullYear(), shown.getMonth(), shown.getDate(), now.getHours(), now.getMinutes()
          );
          router.push({ pathname: '/event/new', params: { date: start.toISOString() } });
        })}
      />

      <CalendarDrawer
        open={drawer.drawerOpen}
        drawerAnim={drawer.drawerAnim}
        overlayAnim={drawer.overlayAnim}
        drawerWidth={drawer.drawerWidth}
        insets={insets}
        activeAccount={activeAccount}
        accounts={visibleAccounts}
        calendars={calendars}
        hiddenCalendarIds={hiddenCalendarIds}
        notifDisabledCalendarIds={notifDisabledCalendarIds}
        pendingInvitationsCount={pendingInvitationsCount}
        toggleCalendarVisibility={toggleCalendarVisibility}
        toggleCalendarNotifications={toggleCalendarNotifications}
        onClose={drawer.closeDrawer}
        onNavigateSettings={() => {
          drawer.closeDrawer();
          router.push('/(tabs)/settings');
        }}
        onNavigateInvitations={() => {
          drawer.closeDrawer();
          router.push('/invitations');
        }}
      />
    </ViewContainer>
  );
}

const styles = StyleSheet.create({
  viewArea: { flex: 1 },
  smallLoader: { position: 'absolute', bottom: 24, left: 16, zIndex: 5 },
  briefingBar: { position: 'absolute', left: 16, right: 16, zIndex: 8 },
});
