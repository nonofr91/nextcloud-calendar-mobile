import {Appearance} from 'react-native';

import {useSettingsStore} from '@/stores/settingsStore';
import i18n from '@/utils/i18n';
import {resolveUse24h} from '@/utils/timeFormat';

import {useAccountStore, anyCalendarConfigured} from '@/stores/accountStore';
import {useCalendarStore} from '@/stores/calendarStore';
import {hasCalendarFlag} from '@/utils/calendars';
import {SHARED_KEYS, setSharedString} from '@/services/shared/appGroupStorage';

import {buildAgendaTimeline} from '../core/agendaSnapshot';
import {AGENDA_DAYS} from '../core/buildTimeline';
import {readUpcomingEvents, visibleAccountIdsToRead} from '../core/readEvents';
import {selectOngoingEvent, shouldClearLiveEvent} from '../core/liveEvent';
import {readLiveEvent} from '../storage/widgetStore';
import {homeWidget} from '../surfaces/homeWidget';
import {liveActivity} from '../surfaces/liveActivity';

let running = false;
let pending = false;

async function runSync(now: Date): Promise<void> {
    try {
        if (visibleAccountIdsToRead().length === 0) {
            // Every account hidden — nothing may linger on the surfaces or in
            // the shared snapshot Siri reads without running JS.
            await homeWidget.clear();
            await liveActivity.clear();
            setSharedString(SHARED_KEYS.agendaSnapshot, JSON.stringify(null));
            return;
        }

        if (!anyCalendarConfigured(useAccountStore.getState(), visibleAccountIdsToRead())) {
            await homeWidget.clear();
            await liveActivity.clear();
            return;
        }

        const {widgetDisabledCalendarIds, notifDisabledCalendarIds} = useCalendarStore.getState();
        const events = (await readUpcomingEvents(AGENDA_DAYS, now))
            .filter((event) => !hasCalendarFlag(widgetDisabledCalendarIds, event.accountId, event.calendarId));
        const {language: locale, timeFormat} = useSettingsStore.getState();
        // Outside React, the global i18n may still sit at the init/default language.
        i18n.changeLanguage(locale);
        const use24h = resolveUse24h(timeFormat, locale);
        const scheme = Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';

        if (homeWidget.isSupported()) {
            const timeline = buildAgendaTimeline(events, {
                now,
                locale,
                scheme,
                use24h,
                days: AGENDA_DAYS,
                maxPerSection: 10
            });
            await homeWidget.update(timeline);
        }

        if (liveActivity.isSupported()) {
            const enabled = useSettingsStore.getState().liveActivityEnabled;
            const liveEvents = events.filter((event) => !hasCalendarFlag(notifDisabledCalendarIds, event.accountId, event.calendarId));
            const ongoing = enabled ? selectOngoingEvent(liveEvents, now, locale) : null;
            if (ongoing) await liveActivity.update(ongoing);
            else if (shouldClearLiveEvent(readLiveEvent(), liveEvents.length, now)) await liveActivity.clear();
        }
    } catch (error) {
        console.warn('[widget] sync failed', error);
    }
}

export async function syncWidget(now: Date = new Date()): Promise<void> {
    if (running) {
        pending = true;
        return;
    }
    running = true;
    try {
        let current = now;
        do {
            pending = false;
            await runSync(current);
            current = new Date();
        } while (pending);
    } finally {
        running = false;
    }
}
