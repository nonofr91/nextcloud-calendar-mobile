import type { CalendarEvent, RecurrenceEditScope } from '@/types';
import { parseRrule } from './parseRrule';

export type MoveEventDecision =
  | { kind: 'commit'; scope: RecurrenceEditScope }
  | { kind: 'prompt' };

export function decideMoveEventScope(
  event: Pick<CalendarEvent, 'isRecurring' | 'rrule'>,
): MoveEventDecision {
  if (!event.isRecurring) return { kind: 'commit', scope: 'all' };
  if (parseRrule(event.rrule) === undefined) return { kind: 'commit', scope: 'this' };
  return { kind: 'prompt' };
}
