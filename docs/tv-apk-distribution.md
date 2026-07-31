# NubArca TV APK distribution

The production APK is available without authentication at the short Fire TV
Downloader URL:

`https://nanocloud.littlefly.it/tv.apk`

Its canonical URL is
`https://nanocloud.littlefly.it/download/tv/nanocloud-tv.apk`.

The adjacent `nanocloud-tv.apk.sha256` file contains its SHA-256 checksum. The
APK is a deployment artifact and is deliberately not committed to Git. The
frontend container mounts `${NANOCLOUD_TV_APK_DIR:-/srv/nanocloud/tv-apk}`
read-only at `/download/tv`; nginx serves the APK with the Android package MIME
type, an attachment filename, and no-cache headers.

## Build

Native dependency or configuration changes require a new APK and runtime. The
current native-video release is application version `0.2.0`, Android
`versionCode` 3, runtime `tv-native-3`.

Before `expo prebuild --clean`, preserve the Android signing keystore and the
public Expo Updates certificate outside `tv/android/`, because that directory
is regenerated. Build with Node 22 and JDK 17:

```bash
cd tv
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$JAVA_HOME/bin:$PATH"
export NODE_ENV=production
export EXPO_PUBLIC_NANOCLOUD_API_BASE_URL=https://nanocloud.littlefly.it
export NANOCLOUD_TV_RUNTIME_VERSION=tv-native-3
export NANOCLOUD_TV_OTA_CHANNEL=production
export NANOCLOUD_TV_OTA_UPDATE_URL=https://nanocloud.littlefly.it/api/tv-app/updates
export NANOCLOUD_TV_OTA_CERTIFICATE=/absolute/path/to/expo-root.pem
npm run tv:prebuild
# Restore android/app/debug.keystore before the release build.
cd android
./gradlew assembleRelease
```

Verify package name, version/runtime, signer and checksum before publication.
The signer must remain the same as the APK already installed or Android will
reject the in-place update.

## Publish

From the repository root:

```bash
./deploy/publish-tv-apk.sh \
  tv/android/app/build/outputs/apk/release/app-release.apk
```

The default production target is `stefano@192.168.1.180`; override
`NANOCLOUD_PRODUCTION_SSH` for a different server. The script uploads to a
temporary name, then atomically replaces the public APK and checksum.

After the compose/config deployment, verify both headers and bytes:

```bash
curl -fsSI https://nanocloud.littlefly.it/tv.apk
curl -fsS https://nanocloud.littlefly.it/download/tv/nanocloud-tv.apk.sha256
```

## Install with Fire TV Downloader

Enable **Install unknown apps** for Downloader in Fire TV settings, enter the
direct HTTPS URL above, download it, and choose **Install**. Since the package
and Android signer are unchanged, Android updates the existing NubArca TV app
without deleting its pairing/session data. Downloader can delete the APK after
installation.

The first native-video build already embeds its JavaScript bundle. Future
JavaScript-only releases can use OTA on `tv-native-3`; never publish a bundle
to a runtime built from a different native dependency/configuration contract.
