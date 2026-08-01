#!/usr/bin/env bash
set -euo pipefail

# Publish an already-built NubArca TV APK without ever exposing a partial
# upload. Override these only when deploying to a different installation.
#
# The canonical artifact is nubarca-tv.apk. The previously published artifact
# remains on disk under its old name as an unadvertised nginx alias; this script
# never writes to it and never deletes it.
apk_path="${1:-tv/android/app/build/outputs/apk/release/app-release.apk}"
target="${NANOCLOUD_PRODUCTION_SSH:-stefano@192.168.1.180}"
remote_dir="${NANOCLOUD_TV_APK_DIR:-/srv/nanocloud/tv-apk}"
remote_name="nubarca-tv.apk"
temporary_name=".${remote_name}.$$.upload"

if [[ ! -f "$apk_path" ]]; then
  echo "APK not found: $apk_path" >&2
  exit 1
fi

if [[ ! "$remote_dir" =~ ^/[A-Za-z0-9._/-]+$ ]]; then
  echo "Unsafe remote directory: $remote_dir" >&2
  exit 1
fi

# Refuse to publish an APK signed with the Android template debug key. The
# retired 0.2.0 TV artifact was signed that way; nubarca-tv.apk must not be.
apksigner="$(command -v apksigner || true)"
if [[ -z "$apksigner" ]]; then
  apksigner="$(ls -1 "${ANDROID_HOME:-$HOME/Android/Sdk}"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1 || true)"
fi
if [[ -z "$apksigner" ]]; then
  echo "apksigner not found; cannot verify the signature before publishing." >&2
  exit 1
fi
signer_report="$("$apksigner" verify --verbose --print-certs "$apk_path")"
if grep -q 'CN=Android Debug' <<<"$signer_report"; then
  echo "Refusing to publish: this APK is signed with the Android debug key." >&2
  exit 1
fi
if ! grep -qE '^Verified using v2 scheme \(APK Signature Scheme v2\): true' <<<"$signer_report" &&
   ! grep -qE '^Verified using v3 scheme \(APK Signature Scheme v3\): true' <<<"$signer_report"; then
  echo "Refusing to publish: APK Signature Scheme v2 or v3 is required for Fire OS." >&2
  exit 1
fi

# Refuse to publish an APK whose embedded config still points at a dev server.
# The manifest can be perfect — right package, label, leanback, signature — while
# the JS bundle carries the LAN fallback, because the bundle is produced by the
# Gradle step and picks up EXPO_PUBLIC_NANOCLOUD_API_BASE_URL separately from
# prebuild. That APK installs, launches and can never reach a server.
embedded_config="$(unzip -p "$apk_path" assets/app.config 2>/dev/null || true)"
if [[ -z "$embedded_config" ]]; then
  echo "Refusing to publish: assets/app.config is missing from the APK." >&2
  exit 1
fi
embedded_base_url="$(printf '%s' "$embedded_config" | node -e \
  'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s)?.extra?.apiBaseUrl??""))}catch{process.exit(1)}})')"
if [[ "$embedded_base_url" != https://* ]]; then
  echo "Refusing to publish: the embedded API base URL is not HTTPS: ${embedded_base_url:-<unset>}" >&2
  echo "Export EXPO_PUBLIC_NANOCLOUD_API_BASE_URL in the shell that runs Gradle." >&2
  exit 1
fi
echo "Embedded API base URL: $embedded_base_url"

local_sha="$(sha256sum "$apk_path" | awk '{print $1}')"
local_bytes="$(stat -c %s "$apk_path")"

ssh -F /dev/null -o BatchMode=yes "$target" "install -d -m 0755 '$remote_dir'"
scp -F /dev/null -q "$apk_path" "$target:$remote_dir/$temporary_name"
ssh -F /dev/null -o BatchMode=yes "$target" \
  "set -e; chmod 0644 '$remote_dir/$temporary_name'; mv -f '$remote_dir/$temporary_name' '$remote_dir/$remote_name'; cd '$remote_dir'; sha256sum '$remote_name' > '.${remote_name}.sha256.tmp'; chmod 0644 '.${remote_name}.sha256.tmp'; mv -f '.${remote_name}.sha256.tmp' '${remote_name}.sha256'"

# Confirm the bytes that landed are the bytes we sent, before announcing a URL.
remote_sha="$(ssh -F /dev/null -o BatchMode=yes "$target" "sha256sum '$remote_dir/$remote_name' | awk '{print \$1}'")"
if [[ "$remote_sha" != "$local_sha" ]]; then
  echo "Published bytes do not match: local $local_sha, remote $remote_sha" >&2
  exit 1
fi

echo "Published: https://nanocloud.littlefly.it/tv.apk"
echo "Canonical: https://nanocloud.littlefly.it/download/tv/$remote_name"
echo "Checksum:  https://nanocloud.littlefly.it/download/tv/$remote_name.sha256"
echo "Bytes: $local_bytes"
echo "SHA-256: $local_sha (verified on the server)"
