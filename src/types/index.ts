export type Account = {
    id: string;
    displayName: string;
    baseUrl: string;
    username: string;
    appPassword: string;
    davUserId: string;
    timezone?: string;
    email?: string;
    /**
     * `calendar-user-address-set` hrefs for the principal (mailto:, principal paths,
     * urn:uuid:). Fetched lazily — used to recognise ATTENDEE/ORGANIZER addresses
     * that alias this account when `email` is absent or ambiguous.
     */
    calendarUserAddresses?: string[];
};

export type CalendarMeta = {
    id: string;
    accountId: string;
    displayName: string;
    color: string;
    ctag: string;
    url: string;
    slug: string;
    isSubscribed?: boolean;
    isReadOnly?: boolean;
    sourceUrl?: string;
    supportsEvents?: boolean;
    order?: number;
    isShared?: boolean;
};

export type Attendee = {
    email: string;
    displayName?: string;
    // Scheduling parameters preserved from the original ATTENDEE line so an edit does not
    // reset the invitees' reply state. `partstat` is stored lowercase ('accepted', …).
    partstat?: string;
    role?: string;
    rsvp?: boolean;
    cutype?: string;
    member?: string[];
    delegatedTo?: string[];
    delegatedFrom?: string[];
    sentBy?: string;
    scheduleAgent?: string;
    scheduleStatus?: string;
    scheduleForceSend?: string;
    // Any other ATTENDEE parameter we do not model, keyed by lowercase param name.
    extraParams?: Record<string, string | string[]>;
};

export type RecurrenceFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export type RecurrenceRule = {
    freq: RecurrenceFreq;
    interval?: number;
    count?: number;
    until?: Date;
    byDay?: string[];
    byMonth?: number[];
    byWeekNo?: number[];
};

export type RecurrenceEditScope = 'this' | 'thisAndFollowing' | 'all';

export type EventAttachment = {
    uri?: string;
    base64?: string;
    /** True when binary content exists in the server ICS but was stripped locally (occurrence rows, oversized embeds). */
    inline?: boolean;
    /** Content fingerprint of a stripped base64 payload — lets a re-fetch pick the right ATTACH when metadata is ambiguous. */
    digest?: string;
    filename?: string;
    fmttype?: string;
    size?: number;
    /** Nextcloud file id — written as X-NC-FILE-ID so the web app can preview. */
    fileId?: number;
};

/** A file picked on the device, buffered until the event is saved. */
export type PendingAttachment = {
    name: string;
    contentBase64: string;
    mimeType?: string;
    size?: number;
};

export type TalkRoomType = 'public' | 'private';

export type TalkOpenMode = 'app' | 'browser' | 'ask';

export type InvitationStatus = 'needs-action' | 'accepted' | 'declined' | 'tentative';

export type InvitationResponse = 'accepted' | 'declined' | 'tentative';

export type CalendarInvitation = {
  uid: string;
  href: string;
  accountId: string;
  summary: string;
  description?: string;
  location?: string;
  dtstart: Date;
  dtend: Date;
  allDay: boolean;
  organizerEmail?: string;
  organizerName?: string;
  attendeeEmail: string;
  attendeeDisplayName?: string;
  partstat: InvitationStatus;
  method: string;
  ics: string;
  timezone?: string;
  talkUrl?: string;
  isRecurring: boolean;
  rrule?: string;
  alarmMinutes?: number;
};

export type CalendarEvent = {
    uid: string;
    href: string;
    calendarId: string;
    accountId: string;
    summary: string;
    description?: string;
    location?: string;
    dtstart: Date;
    dtend: Date;
    allDay: boolean;
    color: string;
    attendees: Attendee[];
    organizerEmail?: string;
    talkUrl?: string;
    /** ICS `GEO:lat;lon` (or `X-APPLE-STRUCTURED-LOCATION` fallback) — read-only. */
    geo?: { lat: number; lon: number };
    isRecurring: boolean;
    rrule?: string;
    recurrenceId?: Date;
    alarms?: number[];
    /** IANA TZID of DTSTART/DTEND; undefined for all-day (floating) events. */
    timezone?: string;
    isTask?: boolean;
    taskStatus?: string;
    taskCompletedAt?: Date;
    taskPercent?: number;
    taskCompleted?: boolean;
    readOnly?: boolean;
    attachments?: EventAttachment[];
};

export type CreateEventInput = {
    summary: string;
    calendarId: string;
    dtstart: Date;
    dtend: Date;
    allDay: boolean;
    /** Per-event IANA TZID override; defaults to the account/device zone. */
    timezone?: string;
    description?: string;
    location?: string;
    /** Fresh coordinates to write as `GEO` — replaces any stored location-bound props. */
    geo?: { lat: number; lon: number };
    attendees: Attendee[];
    withTalkRoom: boolean;
    talkRoomType?: TalkRoomType;
    organizerEmail: string;
    organizerName: string;
    rrule?: RecurrenceRule;
    alarms?: number[];
    uid?: string;
    extraLines?: string[];
    /** Device files to upload to Nextcloud and attach on save. */
    pendingAttachments?: PendingAttachment[];
    /** Files already on Nextcloud to attach by URI on save (no upload). */
    remoteAttachments?: EventAttachment[];
    /** Write new attachments as public `/s/<token>` links (for events with attendees). */
    shareAttachments?: boolean;
    /** Existing ATTACH properties to strip on save (edit only). */
    removedAttachments?: EventAttachment[];
};

export type CalendarAppStatus = 'unknown' | 'available' | 'unconfigured';

export type ServerCapabilities = {
    talkEnabled: boolean;
    calendarApp: CalendarAppStatus;
};

export type ViewMode = 'month' | 'week' | '7days' | '3days' | 'day' | 'schedule';

export type FreeBusyType = 'BUSY' | 'BUSY-UNAVAILABLE' | 'BUSY-TENTATIVE' | 'FREE';

export type BusySlot = {
  start: Date;
  end: Date;
  fbType: FreeBusyType;
  /** Emails of the attendees whose schedules occupy this slot. */
  attendees?: string[];
};

export type AttendeeAvailability = {
  email: string;
  displayName?: string;
  slots: BusySlot[];
  available: boolean;
  /** Deterministic color assigned to this attendee for the timeline. */
  color: string;
  /** Whether this attendee is treated as required in permissive mode. */
  required?: boolean;
};

export type SuggestedSlot = {
  start: Date;
  end: Date;
};
