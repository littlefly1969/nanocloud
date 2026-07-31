// Dynamic Expo config for the NubArca TV app.
//
// The API base URL is configurable for real Fire Stick / Android TV testing
// against a production server, WITHOUT hardcoding any host or secret in source:
//
//   EXPO_PUBLIC_NANOCLOUD_API_BASE_URL   (preferred; also readable at runtime via
//                                         process.env.* since it is an EXPO_PUBLIC_ var)
//   NANOCLOUD_TV_API_BASE_URL            (build-time alias, config only)
//
// RETAINED LEGACY BRAND: every NANOCLOUD_* / EXPO_PUBLIC_NANOCLOUD_* variable name
// below keeps its pre-NubArca spelling on purpose — operators already have them set
// in production environments and CI. They are recorded in the legacy-brand
// compatibility allowlist; renaming them would silently break existing builds.
//
// When neither is set, a LAN dev default is used (plain http, cleartext) so the
// normal dev workflow keeps working. Point the app at production with:
//
//   EXPO_PUBLIC_NANOCLOUD_API_BASE_URL=https://nanocloud.littlefly.it \
//     npm run tv:prebuild && (cd android && ./gradlew assembleDebug)
//
// Cleartext (unencrypted http) traffic is enabled ONLY when the resolved base
// URL is http:// (dev on the LAN). An https:// production base URL builds with
// cleartext DISABLED — production never requires cleartext.

const DEV_DEFAULT_BASE_URL = 'http://192.168.1.100:5177';
const fs = require('node:fs');
const path = require('node:path');
const { validateCodeSigningCertificate } = require('./scripts/code-signing-certificate.cjs');

const apiBaseUrl = (
  process.env.EXPO_PUBLIC_NANOCLOUD_API_BASE_URL ||
  process.env.NANOCLOUD_TV_API_BASE_URL ||
  DEV_DEFAULT_BASE_URL
).replace(/\/$/, '');

// Only permit cleartext http on non-https (LAN dev) targets. A production
// https:// base URL does not need — and does not get — cleartext traffic.
const usesCleartextTraffic = apiBaseUrl.startsWith('http://');
const updateUrl = (
  process.env.NANOCLOUD_TV_OTA_UPDATE_URL ||
  `${apiBaseUrl}/api/tv-app/updates`
).replace(/\/$/, '');
// This value identifies one exact native ABI/configuration contract. Increment
// it before every build containing native or build-time environment changes.
const runtimeVersion = process.env.NANOCLOUD_TV_RUNTIME_VERSION || 'tv-native-3';
const updateChannel = process.env.NANOCLOUD_TV_OTA_CHANNEL || 'production';
const codeSigningCertificate = process.env.NANOCLOUD_TV_OTA_CERTIFICATE;
const codeSigningCertificateConfigPath = codeSigningCertificate
  ? path.relative(__dirname, path.resolve(codeSigningCertificate))
  : null;

if (codeSigningCertificate && !fs.existsSync(codeSigningCertificate)) {
  throw new Error(`NANOCLOUD_TV_OTA_CERTIFICATE does not exist: ${codeSigningCertificate}`);
}
if (codeSigningCertificate) {
  validateCodeSigningCertificate(path.resolve(codeSigningCertificate));
}

module.exports = () => ({
  expo: {
    name: 'NubArca TV',
    // RETAINED LEGACY BRAND: `slug` is part of the EAS / OTA update identity that
    // published updates and the update URL are keyed to. It is recorded in the
    // legacy-brand compatibility allowlist and must NOT be renamed to "nubarca-tv".
    slug: 'nanocloud-tv',
    version: '0.2.0',
    runtimeVersion,
    orientation: 'landscape',
    platforms: ['android', 'ios'],
    // Approved square launcher artwork (1024x1024), copied byte-for-byte from
    // assets/brand/nubarca/ by scripts/sync-brand-assets.py.
    icon: './assets/brand/nubarca-expo-app-icon-1024.png',
    // NOTE: there is deliberately no top-level `splash` key. Expo SDK 56 removed it
    // from the app-config schema (only `web.splash` for PWAs remains) and moved
    // splash configuration into the `expo-splash-screen` config plugin, which this
    // app does not depend on. Setting `splash` here would be silently ignored by
    // prebuild. The approved `assets/brand/nubarca-tv-splash-1920x1080.png` is
    // kept ready for the day expo-splash-screen is added, and is what the
    // in-app boot screen renders in the meantime.
    plugins: [
      // SDK 56 ships an expo-status-bar config plugin; register it explicitly
      // since this is a dynamic config (`expo install --fix` cannot auto-write it).
      'expo-status-bar',
      [
        '@react-native-tvos/config-tv',
        {
          isTV: true,
          androidTVRequired: true,
          // Android TV launcher banner slot: copied into the drawable-* resource
          // directories and referenced as android:banner in the manifest.
          // Approved Android TV banner, authored at the exact 320x180 slot —
          // never the 3:2 lockup stretched into 16:9.
          androidTVBanner: './assets/brand/nubarca-android-tv-banner-320x180.png',
        },
      ],
    ],
    updates: {
      url: updateUrl,
      // The application performs exactly one non-blocking check itself. Native
      // startup must always render the embedded/cached bundle immediately.
      checkAutomatically: 'NEVER',
      fallbackToCacheTimeout: 0,
      useEmbeddedUpdate: true,
      disableAntiBrickingMeasures: false,
      requestHeaders: {
        'expo-channel-name': updateChannel,
      },
      ...(codeSigningCertificate
        ? {
            // Expo resolves this field relative to the project even when given
            // an absolute-looking string, so normalize the operator path.
            codeSigningCertificate: codeSigningCertificateConfigPath,
            codeSigningMetadata: { keyid: 'main', alg: 'rsa-v1_5-sha256' },
          }
        : {}),
    },
    extra: {
      // Consumed by resolveBaseUrl() in App.tsx as the fallback when the
      // EXPO_PUBLIC_* runtime env var is absent.
      apiBaseUrl,
      otaChannel: updateChannel,
    },
    android: {
      // RETAINED LEGACY BRAND: this is the Android applicationId. Changing it would
      // make NubArca TV install as a SEPARATE app with no upgrade path for devices
      // that already have it sideloaded. It is recorded in the legacy-brand
      // compatibility allowlist and must NOT be renamed.
      package: 'it.littlefly.nanocloudtv',
      versionCode: 3,
      usesCleartextTraffic,
      icon: './assets/brand/nubarca-fire-tv-icon-512.png',
      adaptiveIcon: {
        foregroundImage: './assets/brand/nubarca-expo-app-icon-1024.png',
        backgroundColor: '#0a0f1a',
      },
    },
    ios: {
      // iOS is only used for the phone-form-factor dev smoke test; allow arbitrary
      // loads there too only when the dev target is cleartext http.
      infoPlist: {
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: usesCleartextTraffic,
        },
      },
    },
  },
});
