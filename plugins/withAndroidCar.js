const {withAndroidManifest} = require('@expo/config-plugins');

// androidx.car.app:app-automotive declares minSdk 29 while the app targets 24.
// CarAppActivity is only launched on AAOS hosts (API >= 29 anyway), so we
// accept the library manifest as-is instead of raising app minSdk.
module.exports = function withAndroidCar(config) {
    return withAndroidManifest(config, (cfg) => {
        const manifest = cfg.modResults.manifest;
        manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
        const usesSdk = manifest['uses-sdk']?.[0];
        if (usesSdk) {
            usesSdk.$['tools:overrideLibrary'] = 'androidx.car.app.automotive';
        }
        return cfg;
    });
};
