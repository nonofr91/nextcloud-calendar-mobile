import { registerWebModule, NativeModule } from 'expo';

class LiveUpdatesModule extends NativeModule<{}> {}

export default registerWebModule(LiveUpdatesModule, 'LiveUpdatesModule');
