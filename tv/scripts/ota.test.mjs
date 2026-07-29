import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { activate, cleanup, publish, readPointer, rollback, validatePublication } from './ota.mjs';

const require = createRequire(import.meta.url);
const { validateCodeSigningCertificate } = require('./code-signing-certificate.cjs');

const runtime = 'tv-native-1';
const channel = 'production';
let root;
let env;

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nanocloud-ota-test-'));
  env = { TV_OTA_STORAGE_ROOT: root, NANOCLOUD_TV_RUNTIME_VERSION: runtime, NANOCLOUD_TV_OTA_CHANNEL: channel };
});
test.afterEach(() => rmSync(root, { recursive: true, force: true }));

function publication(id = randomUUID(), createdAt = new Date().toISOString()) {
  const directory = join(root, 'publications', 'android', runtime, id);
  const relative = '_expo/static/js/android/index.hbc';
  const file = join(directory, 'files', relative);
  mkdirSync(join(directory, 'files', '_expo/static/js/android'), { recursive: true });
  writeFileSync(file, `bundle-${id}`);
  const hash = createHash('sha256').update(readFileSync(file)).digest('base64url');
  const url = `https://nanocloud.test/api/tv-app/updates/assets/${runtime}/${id}/${relative}`;
  const manifest = { id, createdAt, runtimeVersion: runtime,
    launchAsset: { hash, key: hash, contentType: 'application/octet-stream', url },
    assets: [], metadata: { channel, platform: 'android' }, extra: {} };
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(directory, 'publication.json'), JSON.stringify({ id, createdAt, runtimeVersion: runtime, platform: 'android', channel, signature: null }));
  return { id, directory };
}

test('activation is atomic, retains previous, and rollback swaps pointers without changing publications', () => {
  const first = publication('11111111-1111-4111-8111-111111111111', '2026-01-01T00:00:00Z');
  const second = publication('22222222-2222-4222-8222-222222222222', '2026-01-02T00:00:00Z');
  activate(first.id, { ...config(), runtime });
  activate(second.id, { ...config(), runtime });
  assert.deepEqual(readPointer(config().pointer).current, second.id);
  assert.deepEqual(readPointer(config().pointer).previous, first.id);
  rollback(env);
  assert.equal(readPointer(config().pointer).current, first.id);
  assert.equal(readPointer(config().pointer).previous, second.id);
  assert.equal(validatePublication(first.directory, runtime).manifest.id, first.id);
  assert.equal(readdirSync(join(root, 'channels', channel, 'android')).filter((x) => x.endsWith('.tmp')).length, 0);
});

test('malformed and traversing publications are rejected', () => {
  const item = publication();
  const manifestPath = join(item.directory, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.launchAsset.url = `https://nanocloud.test/api/tv-app/updates/assets/${runtime}/${item.id}/../secret`;
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => validatePublication(item.directory, runtime), /unsafe|immutable|missing/i);
});

test('cleanup protects active, previous and the configured newest retention set', () => {
  const ids = [1, 2, 3, 4].map((day) => publication(`00000000-0000-4000-8000-00000000000${day}`, `2026-01-0${day}T00:00:00Z`));
  activate(ids[0].id, config());
  activate(ids[1].id, config());
  cleanup({ ...env, TV_OTA_RETENTION_COUNT: '2', TV_OTA_CLEANUP_DRY_RUN: 'false' });
  const remaining = new Set(readdirSync(join(root, 'publications', 'android', runtime)));
  assert.deepEqual(remaining, new Set([ids[0].id, ids[1].id, ids[2].id, ids[3].id]));
  // Once current/previous are newest, the older unreferenced releases can go.
  activate(ids[2].id, config());
  activate(ids[3].id, config());
  cleanup({ ...env, TV_OTA_RETENTION_COUNT: '2', TV_OTA_CLEANUP_DRY_RUN: 'false' });
  assert.deepEqual(new Set(readdirSync(join(root, 'publications', 'android', runtime))), new Set([ids[2].id, ids[3].id]));
});

test('cleanup preserves publications referenced by another channel', () => {
  const protectedItem = publication('11111111-1111-4111-8111-111111111111', '2025-01-01T00:00:00Z');
  publication('22222222-2222-4222-8222-222222222222', '2026-01-01T00:00:00Z');
  publication('33333333-3333-4333-8333-333333333333', '2026-01-02T00:00:00Z');
  const pointerDir = join(root, 'channels', 'staging', 'android');
  mkdirSync(pointerDir, { recursive: true });
  writeFileSync(join(pointerDir, `${runtime}.json`), JSON.stringify({ current: protectedItem.id, previous: null }));
  cleanup({ ...env, TV_OTA_RETENTION_COUNT: '2', TV_OTA_CLEANUP_DRY_RUN: 'false' });
  assert.ok(readdirSync(join(root, 'publications', 'android', runtime)).includes(protectedItem.id));
});

test('missing required signing key fails before export and leaves current untouched', () => {
  const current = publication('11111111-1111-4111-8111-111111111111');
  activate(current.id, config());
  assert.throws(() => publish({ ...env, NANOCLOUD_TV_OTA_UPDATE_URL: 'https://nanocloud.test/api/tv-app/updates',
    TV_OTA_SIGNING_REQUIRED: 'true' }), /private.key/i);
  assert.equal(readPointer(config().pointer).current, current.id);

  const fakeKey = join(root, 'private-key.pem');
  writeFileSync(fakeKey, 'not-a-key');
  assert.throws(() => publish({ ...env, NANOCLOUD_TV_OTA_UPDATE_URL: 'https://nanocloud.test/api/tv-app/updates',
    TV_OTA_PRIVATE_KEY_PATH: fakeKey, TV_OTA_SIGNING_REQUIRED: 'true' }), /certificate.*unavailable/i);
  assert.equal(readPointer(config().pointer).current, current.id);
});

test('certificate validation enforces the Android expo-updates code-signing purpose', () => {
  const certRoot = mkdtempSync(join(tmpdir(), 'nanocloud-ota-cert-test-'));
  try {
    const key = join(certRoot, 'key.pem');
    const valid = join(certRoot, 'valid.pem');
    const invalid = join(certRoot, 'invalid.pem');
    for (const args of [
      ['genpkey', '-quiet', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', key],
      ['req', '-x509', '-new', '-key', key, '-out', invalid, '-days', '1', '-subj', '/CN=Invalid OTA'],
      ['req', '-x509', '-new', '-key', key, '-out', valid, '-days', '1', '-subj', '/CN=Valid OTA',
        '-addext', 'basicConstraints=critical,CA:FALSE', '-addext', 'keyUsage=critical,digitalSignature',
        '-addext', 'extendedKeyUsage=critical,codeSigning'],
    ]) {
      const result = spawnSync('openssl', args, { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    }
    assert.throws(() => validateCodeSigningCertificate(invalid), /Code Signing/i);
    assert.doesNotThrow(() => validateCodeSigningCertificate(valid));
  } finally {
    rmSync(certRoot, { recursive: true, force: true });
  }
});

function config() {
  return {
    storage: root, runtime, channel,
    publications: join(root, 'publications', 'android', runtime),
    pointer: join(root, 'channels', channel, 'android', `${runtime}.json`),
  };
}
