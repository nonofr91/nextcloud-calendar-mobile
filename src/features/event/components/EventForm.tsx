import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Platform, KeyboardAvoidingView, Keyboard, useWindowDimensions, LayoutChangeEvent, Alert } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import * as ExpoLocation from 'expo-location';
import { LocateFixed } from 'lucide-react-native';
import dayjs from 'dayjs';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'expo-router';
import { Sparkles } from 'lucide-react-native';
import { TalkToggle } from './TalkToggle';
import { AttendeesField } from './AttendeesField';
import { FindTimeSuggestSheet } from './FindTimeSuggestSheet';
import { useFindTimeStore } from '@/features/event/stores/findTimeStore';
import { AttachmentsField } from './AttachmentsField';
import { requestAlertPermission } from '@/features/notifications/scheduleAlerts';
import { useSettingsStore } from '@/stores/settingsStore';
import { calendarKeyOf, isWritableCalendar } from '@/utils/calendars';
import { useTimeFormat } from '@/hooks/useTimeFormat';
import { getNativePickerLocale } from '@/utils/i18n';
import { AlertPicker } from './AlertPicker';
import { RecurrencePicker } from './RecurrencePicker';
import { Stack, Typography, TextField, DateField, Button, Chip, Toggle, IconButton, Spinner, Select } from '@/ui/components';
import type { SelectOption } from '@/ui/components';
import { reverseGeocode } from '@/features/map/utils/geocode';
import { useSavedPlaces } from '@/features/places/useSavedPlaces';
import { matchPlaces } from '@/features/places/matchPlaces';
import { resolveOrganizer } from '@/features/event/utils/organizer';
import { hostnameOf } from '@/features/account/utils/account';
import type {
  CalendarMeta, Attendee, CreateEventInput, EventAttachment, PendingAttachment,
  RecurrenceRule, TalkRoomType, Account, SuggestedSlot,
} from '@/types';
import { TimezonePicker } from './TimezonePicker';
import { isValidTimeZone, resolveAccountTimezone, wallDateToUtc, zonedUtcToWallDate } from '@/utils/timezone';
import { useTaskTypes } from '@/features/ai/useTaskTypes';
import { useTextTask } from '@/features/ai/useTextTask';
import { draftDescriptionPrompt } from '@/features/ai/prompts';

dayjs.extend(localizedFormat);

export interface InitialValues {
  summary?: string;
  calendarId?: string;
  /** Owner of initialValues.calendarId — remote ids collide across accounts. */
  calendarAccountId?: string;
  allDay?: boolean;
  dtstart?: Date;
  dtend?: Date;
  description?: string;
  location?: string;
  geo?: { lat: number; lon: number };
  attendees?: Attendee[];
  rrule?: RecurrenceRule;
  alarms?: number[];
  uid?: string;
  extraLines?: string[];
  attachments?: EventAttachment[];
  timezone?: string;
}

interface Props {
  calendars: CalendarMeta[];
  defaultDate?: Date;
  organizerEmail: string;
  organizerName: string;
  onSubmit: (input: CreateEventInput) => void;
  initialValues?: InitialValues;
  disableCalendarChange?: boolean;
  account?: (Pick<Account, 'id' | 'displayName' | 'baseUrl' | 'username' | 'appPassword' | 'timezone' | 'davUserId'> & Partial<Account>) | null;
  /** Every account that contributes calendars — groups the picker and makes
   * attendees/find-time/attachments follow the selected calendar's owner. */
  accounts?: readonly Account[];


}

export interface EventFormHandle {
  submit: () => void;
}

type AndroidPickerStep = null | { target: 'start' | 'end'; step: 'date' | 'time'; partial?: Date };

export const EventForm = forwardRef<EventFormHandle, Props>(function EventForm({
  calendars, defaultDate, organizerEmail, organizerName, onSubmit,
  initialValues, disableCalendarChange = false, account, accounts,
}: Props, ref) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { use24h, timeFormat, formatTime } = useTimeFormat();
  const language = useSettingsStore((s) => s.language);
  const aiEnabled = useSettingsStore((s) => s.aiEnabled);
  const { textTaskType } = useTaskTypes();
  const {
    state: aiDraftState,
    output: aiDraftOutput,
    error: aiDraftError,
    run: runTextTask,
    reset: resetTextTask,
  } = useTextTask();
  const aiDraftVisible = aiEnabled && !!textTaskType;
  const aiDraftRunning = aiDraftState === 'scheduling' || aiDraftState === 'running';
  const twoColDates = useWindowDimensions().width >= 600;

  const iosPickerLocale = timeFormat === 'auto'
    ? getNativePickerLocale(language)
    : `${language}-${use24h ? 'GB' : 'US'}`;

  const [summary, setSummary] = useState(initialValues?.summary ?? '');
  const writableCalendars = calendars.filter(isWritableCalendar);
  const storedDefault = useSettingsStore((s) =>
    account ? s.defaultCalendarByAccount[account.id] : undefined,
  );

  // Selection is a composite account|remoteId key — remote ids collide across
  // accounts, so a bare id cannot name a calendar in the merged picker.
  const defaultCalendarKey = (() => {
    const owner = initialValues?.calendarAccountId ?? account?.id;
    const owned = (c: CalendarMeta) => !owner || c.accountId === owner;
    const wanted = initialValues?.calendarId
      ? calendars.find((c) => c.id === initialValues.calendarId && owned(c))
      : undefined;
    const stored = !wanted && storedDefault
      ? writableCalendars.find((c) => c.id === storedDefault && owned(c))
      : undefined;
    const personal = !wanted && !stored
      ? writableCalendars.find((c) => c.slug.toLowerCase() === 'personal' && owned(c))
      : undefined;
    const pick = wanted ?? stored ?? personal ?? writableCalendars[0];
    return pick ? calendarKeyOf(pick) : '';
  })();
  const [selectedCalendarKey, setSelectedCalendarKey] = useState(defaultCalendarKey);
  const [allDay, setAllDay] = useState(initialValues?.allDay ?? false);

  // The account that owns the selected calendar — attendees search, free/busy,
  // find-time and DAV uploads must hit its server, not the default account's.
  const selectedCal = calendars.find((c) => calendarKeyOf(c) === selectedCalendarKey);
  const selectedOwnerAccount = accounts?.find(
    (a) => a.id === selectedCal?.accountId,
  );
  const selectedAccount = selectedOwnerAccount ?? account;
  const multiAccountPicker = new Set(writableCalendars.map((c) => c.accountId)).size > 1;
  const submitOrganizer = selectedOwnerAccount
    ? resolveOrganizer(selectedOwnerAccount)
    : { organizerEmail, organizerName };

  // Timed events are edited as wall-clock times in the event's own zone:
  // dtstart/dtend below hold the zone's wall time as a device-local Date, and
  // are converted back to real instants on submit. The zone defaults to the
  // event's TZID, else the effective account/device zone — never a raw
  // `account.timezone`, which may be '' and would desync fields from zone.
  const initialTimezone = (() => {
    const fromEvent = initialValues?.timezone;
    return fromEvent && isValidTimeZone(fromEvent) ? fromEvent : resolveAccountTimezone(account);
  })();
  const [timezone, setTimezone] = useState(initialTimezone);
  const asWallDate = (d: Date) =>
    initialValues?.allDay ? d : zonedUtcToWallDate(d, initialTimezone);
  const [dtstart, setDtstart] = useState(
    initialValues?.dtstart ? asWallDate(initialValues.dtstart) : (defaultDate ?? new Date())
  );
  const [dtend, setDtend] = useState(
    initialValues?.dtend
      ? asWallDate(initialValues.dtend)
      : (defaultDate ? dayjs(defaultDate).add(1, 'hour').toDate() : dayjs().add(1, 'hour').toDate())
  );
  const [description, setDescription] = useState(initialValues?.description ?? '');
  const [location, setLocation] = useState(initialValues?.location ?? '');
  const [geo, setGeo] = useState(initialValues?.geo);
  const [locating, setLocating] = useState(false);
  const savedPlaces = useSavedPlaces();
  const placeSuggestions = matchPlaces(location, savedPlaces).filter((p) => p.label !== location);
  const [withTalkRoom, setWithTalkRoom] = useState(false);
  const [talkRoomType, setTalkRoomType] = useState<TalkRoomType>('private');
  const [attendees, setAttendees] = useState<Attendee[]>(initialValues?.attendees ?? []);
  const [rrule, setRrule] = useState<RecurrenceRule | undefined>(initialValues?.rrule);
  const [alarms, setAlarms] = useState<number[] | undefined>(initialValues?.alarms);
  const [removedAttachments, setRemovedAttachments] = useState<EventAttachment[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [remoteAttachments, setRemoteAttachments] = useState<EventAttachment[]>([]);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [endError, setEndError] = useState<string | null>(null);

  const [androidStep, setAndroidStep] = useState<AndroidPickerStep>(null);
  const [findTimeVisible, setFindTimeVisible] = useState(false);

  // Slot picked on the full-screen find-time route comes back through the store.
  const findTimeResult = useFindTimeStore((s) => s.result);
  useEffect(() => {
    if (!findTimeResult) return;
    setDtstart(findTimeResult.start);
    setDtend(findTimeResult.end);
    setEndError(null);
    useFindTimeStore.getState().clearResult();
  }, [findTimeResult]);

  const scrollRef = useRef<ScrollView>(null);
  const inputOffsets = useRef<Record<string, number>>({});
  const viewportHeight = useRef(0);

  function scrollToField(key: string) {
    const y = inputOffsets.current[key];
    if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
  }

  // The attendee suggestion list opens upward as an overlay: anchor the
  // input near the bottom of the viewport (just above the keyboard) so the
  // panel above it stays fully visible.
  function scrollAttendeeToViewportBottom() {
    const y = inputOffsets.current.attendee;
    const vh = viewportHeight.current;
    if (y == null || vh === 0) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, y + 100 - vh), animated: true });
  }

  function onFieldLayout(key: string, event: LayoutChangeEvent) {
    inputOffsets.current[key] = event.nativeEvent.layout.y;
  }

  // iOS embeds the native compact pickers inline; only Android opens a picker.
  function openStartPicker() {
    setAndroidStep({ target: 'start', step: 'date' });
  }

  function openEndPicker() {
    setAndroidStep({ target: 'end', step: 'date' });
  }

  const seeded = useRef(!!initialValues);

  function applyStart(d: Date) {
    if (!seeded.current) {
      seeded.current = true;
      setDtstart(d);
      setDtend(allDay ? d : dayjs(d).add(1, 'hour').toDate());
      return;
    }

    const duration = dtend.getTime() - dtstart.getTime();
    setDtstart(d);
    setDtend((prevEnd) => {
      if (allDay) return dayjs(prevEnd).isBefore(dayjs(d), 'day') ? d : prevEnd;
      return new Date(d.getTime() + (duration > 0 ? duration : 3_600_000));
    });
    setEndError(null);
  }

  function applyEnd(d: Date) {
    seeded.current = true;
    const invalid = allDay
      ? dayjs(d).isBefore(dayjs(dtstart), 'day')
      : d <= dtstart;
    if (invalid) {
      setDtend(allDay ? dtstart : dayjs(dtstart).add(1, 'hour').toDate());
      setEndError(t('event.errorEndAfterStart'));
    } else {
      setDtend(d);
      setEndError(null);
    }
  }

  function handleIosStartChange(_: DateTimePickerEvent, d?: Date) {
    if (d) applyStart(d);
  }

  function handleIosEndChange(_: DateTimePickerEvent, d?: Date) {
    if (d) applyEnd(d);
  }

  function handleAndroidChange(_: DateTimePickerEvent, selected?: Date) {
    if (!androidStep) return;

    if (selected === undefined) {
      setAndroidStep(null);
      return;
    }

    const { target, step } = androidStep;

    if (allDay || step === 'time') {
      const base = step === 'time' && androidStep.partial ? androidStep.partial : selected;
      let finalDate: Date;
      if (step === 'time') {
        const d = new Date(androidStep.partial!);
        d.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
        finalDate = d;
      } else {
        finalDate = base;
      }
      if (target === 'start') applyStart(finalDate);
      else applyEnd(finalDate);
      setAndroidStep(null);
    } else {
      setAndroidStep({ target, step: 'time', partial: selected });
    }
  }

  async function useCurrentLocation() {
    setLocating(true);
    try {
      const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('event.locationPermissionDenied'));
        return;
      }
      const pos = await ExpoLocation.getCurrentPositionAsync({
        accuracy: ExpoLocation.Accuracy.Balanced,
      });
      const { latitude, longitude } = pos.coords;
      setGeo({ lat: latitude, lon: longitude });
      const name = await reverseGeocode(latitude, longitude, language);
      setLocation(name ?? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
    } catch {
      Alert.alert(t('event.locationUnavailable'));
    } finally {
      setLocating(false);
    }
  }

  function handleSubmit() {
    Keyboard.dismiss();
    setTitleError(null);
    setCalendarError(null);
    if (!summary.trim()) { setTitleError(t('event.errorTitleRequired')); return; }
    if (!selectedCalendarKey) { setCalendarError(t('event.errorSelectCalendar')); return; }
    if (allDay) {
      if (dayjs(dtend).startOf('day').isBefore(dayjs(dtstart).startOf('day'))) {
        setEndError(t('event.errorEndAfterStart')); return;
      }
    } else if (dtend <= dtstart) {
      setEndError(t('event.errorEndAfterStart')); return;
    }
    const { timedAlerts, allDayAlerts } = useSettingsStore.getState();
    const willAlert = alarms === undefined
      ? (allDay ? allDayAlerts : timedAlerts).length > 0
      : alarms.length > 0;
    if (willAlert) void requestAlertPermission();

    onSubmit({
      summary: summary.trim(),
      calendarId: selectedCal?.id ?? selectedCalendarKey,
      calendarAccountId: selectedCal?.accountId,
      description, location, geo, attendees, withTalkRoom, talkRoomType,
      organizerEmail: submitOrganizer.organizerEmail,
      organizerName: submitOrganizer.organizerName,
      rrule, alarms,
      uid: initialValues?.uid,
      extraLines: initialValues?.extraLines,
      pendingAttachments: pendingAttachments.length ? pendingAttachments : undefined,
      remoteAttachments: remoteAttachments.length ? remoteAttachments : undefined,
      removedAttachments: removedAttachments.length ? removedAttachments : undefined,
      dtstart: allDay ? dtstart : wallDateToUtc(dtstart, timezone),
      dtend: allDay ? dtend : wallDateToUtc(dtend, timezone),
      allDay,
      timezone: allDay ? undefined : timezone,
    });
  }

  useImperativeHandle(ref, () => ({ submit: handleSubmit }));

  useEffect(() => {
    if (aiDraftState === 'done' && aiDraftOutput) {
      setDescription(aiDraftOutput);
      resetTextTask();
    }
  }, [aiDraftState, aiDraftOutput, resetTextTask]);

  function handleAiDraft() {
    void runTextTask(
      draftDescriptionPrompt({
        summary: summary.trim(),
        start: dtstart.toISOString(),
        end: dtend.toISOString(),
        location: location.trim() || undefined,
      })
    );
  }

  const startBlock = (
    <View style={twoColDates ? styles.grow : undefined}>
      {Platform.OS === 'ios' ? (
        <View style={styles.iosPickerRow}>
          <Typography variant="body2" color="secondary">{t('event.start')}</Typography>
          <DateTimePicker
            value={dtstart}
            mode={allDay ? 'date' : 'datetime'}
            display="compact"
            accentColor={theme.colors.primary}
            locale={iosPickerLocale}
            onChange={handleIosStartChange}
          />
        </View>
      ) : (
        <DateField
          testID="event-form-start"
          label={t('event.start')}
          value={dayjs(dtstart).format('ddd ll')}
          time={allDay ? undefined : formatTime(dtstart)}
          onPress={openStartPicker}
        />
      )}
    </View>
  );
  const endBlock = (
    <View style={twoColDates ? styles.grow : undefined}>
      {Platform.OS === 'ios' ? (
        <>
          <View style={styles.iosPickerRow}>
            <Typography variant="body2" color="secondary">{t('event.end')}</Typography>
            <DateTimePicker
              value={dtend}
              mode={allDay ? 'date' : 'datetime'}
              display="compact"
              accentColor={theme.colors.primary}
              locale={iosPickerLocale}
              onChange={handleIosEndChange}
            />
          </View>
          {endError ? (
            <Typography variant="caption" color="danger">{endError}</Typography>
          ) : null}
        </>
      ) : (
        <DateField
          testID="event-form-end"
          label={t('event.end')}
          value={dayjs(dtend).format('ddd ll')}
          time={allDay ? undefined : formatTime(dtend)}
          onPress={openEndPicker}
          error={endError ?? undefined}
        />
      )}
    </View>
  );

  const androidPickerMode = androidStep?.step === 'time' ? 'time' : 'date';
  const androidPickerValue = androidStep?.step === 'time' && androidStep.partial
    ? androidStep.partial
    : androidStep?.target === 'start' ? dtstart : dtend;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="none"
      contentInsetAdjustmentBehavior="automatic"
      onLayout={(e) => { viewportHeight.current = e.nativeEvent.layout.height; }}
    >
      <Stack gap={16}>
        <View onLayout={(e) => onFieldLayout('title', e)}>
          <TextField
            testID="event-form-title"
            label={t('event.titleLabel')}
            value={summary}
            onChangeText={(v) => { setSummary(v); if (titleError) setTitleError(null); }}
            placeholder={t('event.titlePlaceholder')}
            error={titleError ?? undefined}
            onFocus={() => scrollToField('title')}
          />
        </View>

        <Stack gap={8}>
          <Typography variant="body2" color="secondary">{t('event.calendar')}</Typography>
          {writableCalendars.length === 0 && (
            <Typography variant="caption" color="danger">{t('event.noWritableCalendars')}</Typography>
          )}
          {multiAccountPicker ? (
            // One section per account — calendar ids are only unique inside an
            // account, so chips stay grouped by their owner.
            (accounts ?? []).map((acc) => {
              const accCals = writableCalendars.filter((c) => c.accountId === acc.id);
              if (accCals.length === 0) return null;
              return (
                <Stack key={acc.id} gap={4}>
                  <Typography variant="caption" color="secondary">
                    {acc.displayName || acc.username} — {hostnameOf(acc.baseUrl)}
                  </Typography>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.chipRow}>
                    {accCals.map((cal) => (
                      <Chip
                        key={calendarKeyOf(cal)}
                        rounded
                        active={selectedCalendarKey === calendarKeyOf(cal)}
                        activeColor={cal.color}
                        disabled={disableCalendarChange}
                        onPress={() => { setSelectedCalendarKey(calendarKeyOf(cal)); if (calendarError) setCalendarError(null); }}
                      >
                        {cal.displayName}
                      </Chip>
                    ))}
                  </ScrollView>
                </Stack>
              );
            })
          ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.chipRow}>
            {writableCalendars.map((cal) => (
              <Chip
                key={calendarKeyOf(cal)}
                rounded
                active={selectedCalendarKey === calendarKeyOf(cal)}
                activeColor={cal.color}
                disabled={disableCalendarChange}
                onPress={() => { setSelectedCalendarKey(calendarKeyOf(cal)); if (calendarError) setCalendarError(null); }}
              >
                {cal.displayName}
              </Chip>
            ))}
          </ScrollView>
          )}
          {calendarError ? (
            <Typography variant="caption" color="danger">{calendarError}</Typography>
          ) : null}
          {disableCalendarChange && (
            <Typography variant="caption" color="secondary">{t('event.calendarLockedRecurring')}</Typography>
          )}
        </Stack>

        <Stack direction="horizontal" vAlign="center" hAlign="center">
          <Typography variant="body2" color="secondary">{t('event.allDay')}</Typography>
          <View style={styles.pushRight}>
            <Toggle testID="event-form-all-day" value={allDay} onValueChange={(v) => { setAllDay(v); setEndError(null); }} />
          </View>
        </Stack>

        <Stack direction={twoColDates ? 'horizontal' : 'vertical'} gap={twoColDates ? 12 : 16}>
          {startBlock}
          {endBlock}
        </Stack>

        {!allDay && (
          <TimezonePicker value={timezone} onChange={setTimezone} />
        )}

        {Platform.OS === 'android' && androidStep !== null && (
          <DateTimePicker
            key={`android-picker-${androidStep.target}-${androidStep.step}`}
            value={androidPickerValue ?? new Date()}
            mode={androidPickerMode}
            is24Hour={use24h}
            onChange={handleAndroidChange}
          />
        )}

        <Stack
          direction={twoColDates ? 'horizontal' : 'vertical'}
          gap={twoColDates ? 12 : 16}
          hAlign="stretch"
        >
          <View style={twoColDates ? styles.grow : undefined}>
            <RecurrencePicker value={rrule} onChange={setRrule} dtstart={dtstart} allDay={allDay} />
          </View>
          <View style={twoColDates ? styles.grow : undefined}>
            <AlertPicker value={alarms} onChange={setAlarms} />
          </View>
        </Stack>

        <View onLayout={(e) => onFieldLayout('location', e)}>
          <TextField
            testID="event-form-location"
            label={t('event.location')}
            value={location}
            onChangeText={(text) => { setLocation(text); setGeo(undefined); }}
            placeholder={t('event.locationPlaceholder')}
            right={
              <IconButton
                testID="event-form-use-my-location"
                variant="plain"
                size={36}
                onPress={useCurrentLocation}
                disabled={locating}
                accessibilityRole="button"
                accessibilityLabel={t('event.useMyLocation')}
              >
                {locating ? <Spinner /> : <LocateFixed size={18} color={theme.colors.primary} />}
              </IconButton>
            }
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="off"
            textContentType="none"
            onFocus={() => scrollToField('location')}
          />
          {placeSuggestions.length > 0 ? (
            <Stack card gap={0} padding={0} hAlign="stretch" style={styles.placeSuggestions}>
              {placeSuggestions.map((place) => (
                <Chip
                  key={place.id}
                  testID={`place-suggestion-${place.id}`}
                  onPress={() => {
                    setLocation(place.label);
                    setGeo({ lat: place.lat, lon: place.lon });
                  }}
                >
                  {place.label}
                </Chip>
              ))}
            </Stack>
          ) : null}
        </View>

        <View onLayout={(e) => onFieldLayout('description', e)}>
          <Stack gap={4} hAlign="stretch">
            <TextField
              label={t('event.description')}
              value={description}
              onChangeText={setDescription}
              placeholder={t('event.descriptionPlaceholder')}
              multiline
              numberOfLines={3}
              style={styles.multiline}
              onFocus={() => scrollToField('description')}
            />
            {aiDraftVisible && (
              <>
                <Button
                  testID="event-form-ai-draft"
                  variant="link"
                  size="small"
                  inline
                  alignment="start"
                  loading={aiDraftRunning}
                  disabled={!summary.trim()}
                  icon={<Sparkles size={16} color={theme.colors.primary} />}
                  title={t('ai.descriptionDraft')}
                  onPress={handleAiDraft}
                />
                {aiDraftState === 'failed' && aiDraftError ? (
                  <Typography variant="caption" color="danger" testID="event-form-ai-draft-error">
                    {aiDraftError}
                  </Typography>
                ) : null}
              </>
            )}
          </Stack>
        </View>

        <AttendeesField
          attendees={attendees}
          onChange={setAttendees}
          account={selectedAccount}
          onInputLayout={(e) => onFieldLayout('attendee', e)}
          onInputFocus={scrollAttendeeToViewportBottom}
        />

        {attendees.length > 0 && selectedAccount && !allDay && (
          <Button
            variant="secondary"
            title={t('event.findTime')}
            onPress={() => setFindTimeVisible(true)}
          />
        )}

        {selectedAccount && (
          <FindTimeSuggestSheet
            visible={findTimeVisible}
            onClose={() => setFindTimeVisible(false)}
            account={selectedAccount}
            organizer={{ email: submitOrganizer.organizerEmail, displayName: submitOrganizer.organizerName }}
            attendees={attendees}
            start={dtstart}
            end={dtend}
            eventTitle={summary}
            onApplySlot={(slot: SuggestedSlot) => {
              setDtstart(slot.start);
              setDtend(slot.end);
              setEndError(null);
            }}
          />
        )}
        <AttachmentsField
          existing={(initialValues?.attachments ?? []).filter(
            (a) => !removedAttachments.includes(a),
          )}
          pending={pendingAttachments}
          remote={remoteAttachments}
          account={selectedAccount}
          onAdd={(f) => setPendingAttachments((prev) => [...prev, f])}
          onAddRemote={(att) =>
            // Skip if the same file is already attached to the event.
            setRemoteAttachments((prev) =>
              prev.some((r) => r.uri === att.uri) ||
              (initialValues?.attachments ?? []).some(
                (e) => e.uri === att.uri && !removedAttachments.includes(e),
              )
                ? prev
                : [...prev, att],
            )
          }
          onRemoveExisting={(a) => setRemovedAttachments((prev) => [...prev, a])}
          onRemovePending={(i) =>
            setPendingAttachments((prev) => prev.filter((_, idx) => idx !== i))
          }
          onRemoveRemote={(i) =>
            setRemoteAttachments((prev) => prev.filter((_, idx) => idx !== i))
          }
        />

        <TalkToggle
          value={withTalkRoom}
          onChange={setWithTalkRoom}
          roomType={talkRoomType}
          onRoomTypeChange={setTalkRoomType}
          accountId={selectedAccount?.id}
        />

      </Stack>
    </ScrollView>
    </KeyboardAvoidingView>
  );
});

const styles = StyleSheet.create({
  scroll: { flex: 1, padding: 20 },
  scrollContent: { paddingBottom: 40 },
  multiline: { height: 80, textAlignVertical: 'top' },
  chipRow: { gap: 8 },
  placeSuggestions: { marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 10 },
  grow: { flex: 1 },
  pushRight: { marginLeft: 'auto' },
  iosPickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
});
