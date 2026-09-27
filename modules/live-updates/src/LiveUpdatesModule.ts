import { NativeModule, requireNativeModule } from 'expo';

import type { LiveUpdateEvent, PermissionResponse } from './LiveUpdates.types';

declare class LiveUpdatesModule extends NativeModule<Record<string, never>> {
  isSupported(): boolean;
  canPromote(): boolean;
  isPromoted(): boolean;
  hasPermission(): boolean;
  requestPermission(): Promise<PermissionResponse>;
  update(event: LiveUpdateEvent): Promise<void>;
  clear(): Promise<void>;
}

export default requireNativeModule<LiveUpdatesModule>('LiveUpdates');
