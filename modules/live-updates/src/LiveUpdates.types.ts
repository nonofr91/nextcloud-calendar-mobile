export interface PermissionResponse {
  status: 'granted' | 'denied' | 'undetermined';
  granted: boolean;
  canAskAgain: boolean;
  expires: 'never' | number;
}

export interface LiveUpdateEvent {
  title: string;
  textTemplate: string;
  shortTemplate: string;
  hourUnit: string;
  minuteUnit: string;
  location: string;
  attendees: string[];
  startMs: number;
  endMs: number;
  color?: number;
}
