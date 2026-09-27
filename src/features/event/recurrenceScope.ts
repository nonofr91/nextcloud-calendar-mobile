import { Alert } from 'react-native';
import type { RecurrenceEditScope } from '@/types';

export interface RecurrenceScopeStrings {
  message: string;
  thisOnly: string;
  thisAndFollowing: string;
  all: string;
  cancel: string;
}

export function askRecurrenceScope(
  title: string,
  strings: RecurrenceScopeStrings,
  onSelect: (scope: RecurrenceEditScope) => void,
) {
  Alert.alert(title, strings.message, [
    {
      text: strings.thisOnly,
      onPress: () => onSelect('this'),
    },
    {
      text: strings.thisAndFollowing,
      onPress: () => onSelect('thisAndFollowing'),
    },
    {
      text: strings.all,
      onPress: () => onSelect('all'),
    },
    { text: strings.cancel, style: 'cancel' },
  ],
    {
      cancelable: true,
    },
 );
}
