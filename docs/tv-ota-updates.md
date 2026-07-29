# Native TV OTA updates

NanoCloud's native app in `tv/` uses `expo-updates` 56.0.21 and Expo Updates Protocol v1. The API serves only Android TV update manifests at `GET /api/tv-app/updates` and immutable files below `/api/tv-app/updates/assets/...`. These routes are anonymous and do not use owner authentication, pairing state, or `TvSession`.

OTA can replace the JavaScript/Hermes bundle and Metro-bundled assets. It cannot change the APK, Expo SDK, React Native TV, a native dependency, a config plugin, AndroidManifest, permissions, Kotlin/Java, Gradle/native build settings, or a build-time native environment value. Those changes require a new APK and a new runtime version.

## Runtime and launch behavior

`NANOCLOUD_TV_RUNTIME_VERSION` is a manually managed native contract. The legacy APK uses `tv-native-1`; the native-video APK with `expo-video` uses `tv-native-2`. This explicit value is intentionally not derived from the application version: operators must increment it for every native/configuration change listed above, including changing native environment values embedded while building. TypeScript, React UI/layout, business logic, and bundled asset changes keep the existing runtime.

The APK always embeds a bundle. `fallbackToCacheTimeout` is zero and the native automatic check is disabled, so the existing app renders immediately. App startup fires one background `checkForUpdateAsync`; overlapping/repeated checks in that JS process are suppressed. If an update exists it is downloaded, but `reloadAsync` is never called. It is selected only on a later cold launch. Network, HTTP, malformed manifest, signature, asset, storage, interruption, and damaged-update handling remains in the native `expo-updates` downloader/error-recovery path; failures are logged and the running or embedded update remains usable. Killing the app during a download leaves the prior complete update intact.

SDK 56's manual Updates API does not expose a configurable per-check HTTP timeout. NanoCloud therefore does not add a JavaScript timeout that would only abandon the promise while leaving the native request running. There is no retry loop.

Diagnostics are logged once per launch as `[OTA]` and include runtime version, current/embedded update ID when available, embedded/OTA state, pending state, result, and sanitized error text. No secret is logged.

## Configuration

Build/export and server publication must use matching values:

```sh
export EXPO_PUBLIC_NANOCLOUD_API_BASE_URL=https://nanocloud.littlefly.it
export NANOCLOUD_TV_OTA_UPDATE_URL=https://nanocloud.littlefly.it/api/tv-app/updates
export NANOCLOUD_TV_RUNTIME_VERSION=tv-native-2
export NANOCLOUD_TV_OTA_CHANNEL=production
export TV_OTA_STORAGE_ROOT=/srv/nanocloud/tv-updates
export TV_OTA_RETENTION_COUNT=5
```

The API reads `TvUpdates__RootPath` (default `/var/lib/nanocloud/tv-updates` in production Compose). Keep the host directory outside a public web root. In the required local production override, map the publication directory read-only into the API:

```yaml
# docker-compose.prod.local.yml
services:
  api:
    volumes:
      - /srv/nanocloud/tv-updates:/var/lib/nanocloud/tv-updates:ro
```

Continue using the repository's overlay pattern:

```sh
docker compose -f docker-compose.prod.yml -f docker-compose.prod.local.yml --env-file .env up -d
```

## Signing and bootstrap trust

Protocol v1 code signing is supported with `rsa-v1_5-sha256`. Generate material in controlled storage; do not generate or keep the private key in this repository:

```sh
install -d -m 0700 /secure/nanocloud-tv-ota/keys /secure/nanocloud-tv-ota/cert
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 \
  -out /secure/nanocloud-tv-ota/keys/private-key.pem
chmod 0600 /secure/nanocloud-tv-ota/keys/private-key.pem
openssl req -x509 -new -sha256 \
  -key /secure/nanocloud-tv-ota/keys/private-key.pem \
  -out /secure/nanocloud-tv-ota/cert/certificate.pem \
  -days 1825 -subj '/CN=NanoCloud TV OTA' \
  -addext 'basicConstraints=critical,CA:FALSE' \
  -addext 'keyUsage=critical,digitalSignature' \
  -addext 'extendedKeyUsage=critical,codeSigning' \
  -addext 'subjectKeyIdentifier=hash' \
  -addext 'authorityKeyIdentifier=keyid:always'
chmod 0644 /secure/nanocloud-tv-ota/cert/certificate.pem
openssl verify -purpose codesign \
  -CAfile /secure/nanocloud-tv-ota/cert/certificate.pem \
  /secure/nanocloud-tv-ota/cert/certificate.pem
```

For the bootstrap APK set `NANOCLOUD_TV_OTA_CERTIFICATE=/secure/nanocloud-tv-ota/cert/certificate.pem`. Only that public certificate is embedded. Publication uses `TV_OTA_PRIVATE_KEY_PATH=/secure/nanocloud-tv-ota/keys/private-key.pem`; the private key is read locally and never served. `TV_OTA_SIGNING_REQUIRED` defaults to `true`, so publication fails before export if the key is absent. An unsigned publication is never returned to a client that sends `expo-expect-signature`.

The certificate must be currently valid, self-signed, and contain both `Key Usage: Digital Signature` and `Extended Key Usage: Code Signing`. The app configuration and publisher validate both X.509 extensions before use; this mirrors the validation performed by `expo-updates` on Android.

Back up the private key and certificate separately with restricted permissions. To rotate or recover from a compromised/expired key, create a new pair, increment the runtime, build and manually install a new APK containing the new certificate, then publish only with the new key. Existing APKs cannot trust a new root certificate over OTA. Removing signing likewise requires a new runtime and APK.

## Publish, activate, rollback, and clean up

From `tv/`, with the variables above and the private key configured:

```sh
npm run publish:ota
```

The command runs `expo export --platform android` (never Gradle/EAS/APK build), validates Expo metadata, copies all referenced files into staging on the storage filesystem, computes base64url SHA-256 hashes, creates a UUID update ID and creation timestamp, writes and signs the exact manifest bytes, verifies every reference/hash, atomically renames the immutable publication, and only then atomically replaces the channel pointer. A failed export, verification, or signature leaves the active pointer and previous publication untouched.

Layout:

```text
tv-updates/
  publications/android/<runtime>/<update-uuid>/
    manifest.json
    publication.json
    files/...
  channels/production/android/<runtime>.json
  .staging/
```

Rollback swaps `current` and `previous` after validating the target's runtime and complete manifest:

```sh
npm run rollback:ota
```

To select an older compatible immutable ID explicitly, set `TV_OTA_ROLLBACK_TO=<uuid>` for that command. Rollback changes only the atomic pointer; it does not modify a publication. Devices that already downloaded a newer update follow Expo's monotonic selection rules, so validate rollback behavior on a real device; the server pointer mainly governs checks that have not downloaded that release.

Cleanup is dry-run by default and retains at least two newest releases plus current and immediate previous, never deleting a referenced publication:

```sh
npm run cleanup:ota
TV_OTA_CLEANUP_DRY_RUN=false TV_OTA_RETENTION_COUNT=5 npm run cleanup:ota
```

## Native APK and safe OTA test

Create each native APK using the production API URL, update URL, runtime, channel, and signing certificate above. Run `EXPO_TV=1 npm run tv:prebuild`, then the repository's normal signed Android release process. Publish the APK through the stable Downloader URL documented in [tv-apk-distribution.md](tv-apk-distribution.md). Any future native/config change needs an incremented runtime and another installed APK before updates for that runtime are published.

For a harmless end-to-end test, install the bootstrap APK, change one visible static TV label, publish with the same runtime, launch once and wait for the `[OTA] ... downloaded` diagnostic, fully force-stop the application, then launch again and confirm the label and update ID changed. Also test with the server offline, a deliberately incompatible runtime pointer, and a bad signature in a non-production test storage root; the prior UI must continue to launch.

The physical Fire Stick remains the final authority for cold-launch semantics, available storage behavior, certificate verification, and Android TV process force-stop behavior.
