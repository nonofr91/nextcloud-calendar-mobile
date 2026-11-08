import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useTheme } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react-native';
import dayjs from 'dayjs';
import localizedFormat from 'dayjs/plugin/localizedFormat';

import { useAccounts, useVisibleAccounts } from '@/hooks/useAccounts';
import { useMultiCalendars } from '@/hooks/useCalendars';
import { useCreateEvent } from '@/features/event/hooks/useMutateEvent';
import { useImportIcs } from '@/features/event/hooks/useImportIcs';
import { resolveOrganizer } from '@/features/event/utils/organizer';
import {
  eventToFormValues,
  extractOrganizerName,
} from '@/features/event/utils/icsImport';
import { eventExists } from '@/database/eventWrites';
import { goBackOrHome } from '@/utils/navigationGuard';
import { EventForm, type EventFormHandle } from '@/features/event/components/EventForm';
import {
  ViewContainer,
  Stack,
  Typography,
  Button,
  Spinner,
  ScreenHeader,
  IconButton,
  List,
  Item,
} from '@/ui/components';
import type { CalendarEvent, CreateEventInput } from '@/types';

dayjs.extend(localizedFormat);

interface Props {
  uri: string;
}

function formatEventDate(event: CalendarEvent): string {
  const start = dayjs(event.dtstart).format('lll');
  const end = dayjs(event.dtend).format('lll');
  return event.allDay ? dayjs(event.dtstart).format('LL') : `${start} – ${end}`;
}

export function IcsImportScreen({ uri }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const formRef = useRef<EventFormHandle>(null);
  const { loading, error, events, originalIcs, reload } = useImportIcs(uri);

  // The import target may be any visible account's calendar — the owner is
  // resolved from the chosen calendarId, like in EventForm.
  const accounts = useAccounts();
  const visibleAccounts = useVisibleAccounts();
  const { data: calendars = [] } = useMultiCalendars(visibleAccounts);

  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [savedUids, setSavedUids] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSavedUids(new Set());
    setSelectedEvent(null);
  }, [uri]);

  const visibleEvents = useMemo(
    () => events.filter((e) => !savedUids.has(e.uid)),
    [events, savedUids],
  );

  const createMutation = useCreateEvent(visibleAccounts, calendars);

  const runImport = useCallback(
    async (input: CreateEventInput) => {
      try {
        await createMutation.mutateAsync(input);
        const nextSaved = new Set(savedUids);
        nextSaved.add(input.uid!);
        setSavedUids(nextSaved);
        const remaining = events.filter((e) => !nextSaved.has(e.uid));
        if (remaining.length === 0) {
          goBackOrHome(router);
        } else {
          setSelectedEvent(null);
        }
      } catch {
        // useCreateEvent already shows an alert
      }
    },
    [createMutation, events, router, savedUids],
  );

  const handleSubmit = useCallback(
    async (input: CreateEventInput) => {
      const uid = input.uid;
      // The form emits the chosen calendar's owner — remote ids collide across
      // accounts, so the duplicate check must not resolve on the bare id.
      const targetAccountId =
        input.calendarAccountId ??
        calendars.find((c) => c.id === input.calendarId)?.accountId;
      if (
        uid &&
        targetAccountId &&
        (await eventExists(targetAccountId, input.calendarId, uid))
      ) {
        Alert.alert(t('import.duplicateTitle'), t('import.duplicateMessage'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('import.overwrite'),
            style: 'destructive',
            onPress: () => void runImport(input),
          },
        ]);
        return;
      }
      await runImport(input);
    },
    [calendars, runImport, t],
  );

  if (accounts.length === 0 || visibleAccounts.length === 0) {
    return (
      <ViewContainer>
        <SafeAreaView style={styles.flex}>
          <ScreenHeader title={t('import.title')} onBack={() => router.back()} />
          <Stack flex vAlign="center" hAlign="center" gap={16}>
            <Typography variant="body1" color="secondary">{t('import.errorNoAccount')}</Typography>
            <Button variant="primary" title={t('import.back')} onPress={() => router.back()} />
          </Stack>
        </SafeAreaView>
      </ViewContainer>
    );
  }

  if (loading) {
    return (
      <ViewContainer>
        <SafeAreaView style={styles.flex}>
          <ScreenHeader title={t('import.title')} onBack={() => router.back()} />
          <Stack flex vAlign="center" hAlign="center">
            <Spinner size="large" />
          </Stack>
        </SafeAreaView>
      </ViewContainer>
    );
  }

  if (error) {
    return (
      <ViewContainer>
        <SafeAreaView style={styles.flex}>
          <ScreenHeader title={t('import.title')} onBack={() => router.back()} />
          <Stack padding={20} gap={16} vAlign="center" hAlign="center">
            <Typography variant="body1" color="danger">{t(`import.${error}`)}</Typography>
            <Button variant="primary" title={t('import.retry')} onPress={reload} />
          </Stack>
        </SafeAreaView>
      </ViewContainer>
    );
  }

  if (visibleEvents.length === 0) {
    return (
      <ViewContainer>
        <SafeAreaView style={styles.flex}>
          <ScreenHeader title={t('import.title')} onBack={() => router.back()} />
          <Stack flex vAlign="center" hAlign="center" gap={16}>
            <Typography variant="body1" color="secondary">{t('import.noEventsFound')}</Typography>
            <Button variant="primary" title={t('import.back')} onPress={() => router.back()} />
          </Stack>
        </SafeAreaView>
      </ViewContainer>
    );
  }

  if (selectedEvent) {
    const { organizerEmail, organizerName } = resolveOrganizer(visibleAccounts[0]);
    const importedEmail = selectedEvent.organizerEmail ?? organizerEmail;
    const importedName =
      extractOrganizerName(originalIcs, selectedEvent.uid) ?? organizerName;

    return (
      <ViewContainer>
        <SafeAreaView style={styles.flex}>
          <ScreenHeader
            title={t('import.importEvent')}
            onBack={() => setSelectedEvent(null)}
            right={
              <IconButton
                glass
                round
                size={40}
                onPress={createMutation.isPending ? undefined : () => formRef.current?.submit()}
                accessibilityRole="button"
                accessibilityLabel={createMutation.isPending ? t('event.saving') : t('import.importEvent')}
              >
                {createMutation.isPending
                  ? <Spinner />
                  : <Check size={22} color={colors.primary} />}
              </IconButton>
            }
          />
          <EventForm
            ref={formRef}
            calendars={calendars}
            organizerEmail={importedEmail}
            organizerName={importedName}
            onSubmit={handleSubmit}
            accounts={visibleAccounts}
            initialValues={eventToFormValues(selectedEvent, originalIcs)}
          />
        </SafeAreaView>
      </ViewContainer>
    );
  }

  return (
    <ViewContainer>
      <SafeAreaView style={styles.flex}>
        <ScreenHeader title={t('import.title')} onBack={() => router.back()} />
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Stack padding={20} gap={16}>
            <Typography variant="body1" color="secondary">
              {t('import.selectEvent')}
            </Typography>
            <List>
              {visibleEvents.map((event) => (
                <Item
                  key={event.uid}
                  title={event.summary || t('import.untitledEvent')}
                  description={formatEventDate(event)}
                  onPress={() => setSelectedEvent(event)}
                />
              ))}
            </List>
          </Stack>
        </ScrollView>
      </SafeAreaView>
    </ViewContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
});
