# NubArca TV APK distribution

The production APK is available without authentication at the short Fire TV
Downloader URL:

`https://nanocloud.littlefly.it/tv.apk`

Its canonical URL is
`https://nanocloud.littlefly.it/download/tv/nubarca-tv.apk`.

The adjacent `nubarca-tv.apk.sha256` file contains its SHA-256 checksum. The
APK is a deployment artifact and is deliberately not committed to Git. The
frontend container mounts `${NANOCLOUD_TV_APK_DIR:-/srv/nanocloud/tv-apk}`
read-only at `/download/tv`; nginx serves the APK with the Android package MIME
type, an attachment filename, and no-cache headers.

`https://nanocloud.littlefly.it/download/tv/nanocloud-tv.apk` remains as an
**unadvertised compatibility alias** so links and QR codes handed out before the
rename do not 404. It is not the canonical download, nothing publishes to it,
and it serves whatever file is still on disk under the old name. Remove the two
alias `location` blocks from `frontend/nginx.conf` once no traffic reaches
either path.

## Application identity

NubArca (mobile, future) and NubArca TV are **separate applications** that share
one backend and one account ecosystem. There is no universal mobile/TV binary.

| | NubArca TV (this app) | NubArca (mobile, reserved) |
| --- | --- | --- |
| Display name | `NubArca TV` | `NubArca` |
| Android applicationId | `it.littlefly.nubarca.tv` | `it.littlefly.nubarca` |
| Android namespace | `it.littlefly.nubarca.tv` | — |
| iOS bundle identifier | — | `it.littlefly.nubarca` |
| Expo slug | `nubarca-tv` | `nubarca` |
| Deep-link scheme | `nubarca-tv` | `nubarca` |

This identity replaces it.littlefly.nanocloudtv, which was retired in TV-ID-01.
An Android applicationId cannot be renamed in place, so there is **no upgrade
path** between the two: the old app must be uninstalled and NubArca TV installed
fresh, and the device pairs again. The single private device holding the old
package was migrated that way deliberately.

## Signing

The release APK is signed with the definitive NubArca TV release key. Every
future Fire TV and Android TV update must reuse the same certificate with a
higher `versionCode`; Android rejects an update signed by a different key.

The key is supplied to Gradle by the operator and is never committed. Set these
in `~/.gradle/gradle.properties` (or as environment variables of the same names,
for CI):

```properties
NUBARCA_TV_RELEASE_STORE_FILE=/absolute/path/to/nubarca-tv-release.jks
NUBARCA_TV_RELEASE_STORE_PASSWORD=…
NUBARCA_TV_RELEASE_KEY_ALIAS=nubarca-tv
NUBARCA_TV_RELEASE_KEY_PASSWORD=…
```

`tv/plugins/withReleaseSigning.js` re-applies this wiring on every prebuild,
because prebuild regenerates `android/` from the React Native template — whose
release build type is signed with the template's public debug keystore. If no
key is configured, `assembleRelease` **fails**; it never falls back to the debug
key. `deploy/publish-tv-apk.sh` independently refuses to publish an APK whose
signer DN is `CN=Android Debug`, or one without a v2/v3 signature.

Back up the keystore and its passwords in the operator's password manager.
Losing them means no further update can ever be installed over this package —
the only recovery is another applicationId change and another manual reinstall.

Record for each release: certificate SHA-256 fingerprint, signing schemes, and
where the key is held. Never record the passwords or the private key.

## Build

Native dependency or configuration changes require a new APK and runtime. The
current release is application version `1.0.0`, Android `versionCode` 1, runtime
`nubarca-tv-native-1`.

Before `expo prebuild --clean`, preserve the public Expo Updates certificate
outside `tv/android/`, because that directory is regenerated. The release
keystore already lives outside the project. Build with Node 22 and JDK 17:

```bash
cd tv
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$JAVA_HOME/bin:$PATH"
export NODE_ENV=production
export EXPO_PUBLIC_NANOCLOUD_API_BASE_URL=https://nanocloud.littlefly.it
export NANOCLOUD_TV_RUNTIME_VERSION=nubarca-tv-native-1
export NANOCLOUD_TV_OTA_CHANNEL=production
export NANOCLOUD_TV_OTA_UPDATE_URL=https://nanocloud.littlefly.it/api/tv-app/updates
export NANOCLOUD_TV_OTA_CERTIFICATE=/absolute/path/to/expo-root.pem
npm run tv:prebuild
cd android
./gradlew assembleRelease
```

Verify the result before publication:

```bash
BT="$ANDROID_HOME/build-tools/36.0.0"
APK=app/build/outputs/apk/release/app-release.apk
"$BT/aapt2" dump badging "$APK" | grep -E "^package|^application-label:|leanback|touchscreen|sdkVersion"
"$BT/apksigner" verify --verbose --print-certs "$APK"
sha256sum "$APK"
```

Expected: package `it.littlefly.nubarca.tv`, versionCode 1, versionName 1.0.0,
label `NubArca TV`, a `leanback-launchable-activity`, `android.software.leanback`
required, touchscreen not required, v2 (and v3) verified true, and a signer DN
that is **not** `CN=Android Debug`.

## Publish

From the repository root:

```bash
./deploy/publish-tv-apk.sh \
  tv/android/app/build/outputs/apk/release/app-release.apk
```

The default production target is `stefano@192.168.1.180`; override
`NANOCLOUD_PRODUCTION_SSH` for a different server. The script re-verifies the
signature, uploads to a temporary name, atomically replaces the public APK and
checksum, and confirms the SHA-256 of the bytes that landed on the server.

Then verify headers and bytes over HTTPS:

```bash
curl -fsSI https://nanocloud.littlefly.it/tv.apk
curl -fsS  https://nanocloud.littlefly.it/download/tv/nubarca-tv.apk.sha256
curl -fsS  https://nanocloud.littlefly.it/download/tv/nubarca-tv.apk | sha256sum
```

The `Content-Type` must be `application/vnd.android.package-archive` and the
`Content-Length` must match the local file — an HTML error page served as an APK
is the failure this check exists to catch.

## Install with Fire TV Downloader

Enable **Install unknown apps** for Downloader in Fire TV settings, enter the
direct HTTPS URL above, download it, and choose **Install**.

Installing over the retired package is **not** possible — the applicationId
differs, so Android treats NubArca TV as a new app. Uninstall the old one first;
its pairing and session data are not carried over and the TV pairs again.

Later NubArca TV releases keep the same package and certificate and only raise
`versionCode`, so those install in place and preserve the pairing.

## Android TV / Google TV

The same source targets Fire TV and Android TV; there is no Fire-only tree. The
release configuration requires `android.software.leanback`, declares
touchscreen and faketouch as not required, and ships a leanback launcher
activity with an Android TV banner — the Play Store's Android TV requirements.

A Google Play AAB needs no source change: `./gradlew bundleRelease` produces
`app/build/outputs/bundle/release/app-release.aab`, signed by the same release
config and covered by the same missing-key gate. Play submission additionally
requires a Play Console entry and store listing assets, which are outside this
repository.
