#!/usr/bin/env bash
set -euo pipefail

# Publish an already-built NanoCloud TV APK without ever exposing a partial
# upload. Override these only when deploying to a different installation.
apk_path="${1:-tv/android/app/build/outputs/apk/release/app-release.apk}"
target="${NANOCLOUD_PRODUCTION_SSH:-stefano@192.168.1.180}"
remote_dir="${NANOCLOUD_TV_APK_DIR:-/srv/nanocloud/tv-apk}"
remote_name="nanocloud-tv.apk"
temporary_name=".${remote_name}.$$.upload"

if [[ ! -f "$apk_path" ]]; then
  echo "APK not found: $apk_path" >&2
  exit 1
fi

if [[ ! "$remote_dir" =~ ^/[A-Za-z0-9._/-]+$ ]]; then
  echo "Unsafe remote directory: $remote_dir" >&2
  exit 1
fi

local_sha="$(sha256sum "$apk_path" | awk '{print $1}')"
local_bytes="$(stat -c %s "$apk_path")"

ssh -F /dev/null -o BatchMode=yes "$target" "install -d -m 0755 '$remote_dir'"
scp -F /dev/null -q "$apk_path" "$target:$remote_dir/$temporary_name"
ssh -F /dev/null -o BatchMode=yes "$target" \
  "set -e; chmod 0644 '$remote_dir/$temporary_name'; mv -f '$remote_dir/$temporary_name' '$remote_dir/$remote_name'; cd '$remote_dir'; sha256sum '$remote_name' > '.${remote_name}.sha256.tmp'; chmod 0644 '.${remote_name}.sha256.tmp'; mv -f '.${remote_name}.sha256.tmp' '${remote_name}.sha256'"

echo "Published: https://nanocloud.littlefly.it/tv.apk"
echo "Canonical: https://nanocloud.littlefly.it/download/tv/$remote_name"
echo "Bytes: $local_bytes"
echo "SHA-256: $local_sha"
