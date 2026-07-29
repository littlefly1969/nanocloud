#!/usr/bin/env node
import { createHash, createPublicKey, randomUUID, sign, X509Certificate } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validateCodeSigningCertificate } = require('./code-signing-certificate.cjs');

const here = dirname(fileURLToPath(import.meta.url));
const tvRoot = resolve(here, '..');
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function safeSegment(value, name) {
  if (!SAFE.test(value ?? '')) throw new Error(`${name} contains unsupported characters`);
  return value;
}

export function sha256Base64Url(file) {
  return createHash('sha256').update(readFileSync(file)).digest('base64url');
}

function contentType(file) {
  const ext = file.toLowerCase().split('.').pop();
  return ({ hbc: 'application/octet-stream', js: 'application/javascript', json: 'application/json',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    gif: 'image/gif', svg: 'image/svg+xml', ttf: 'font/ttf', otf: 'font/otf',
    mp4: 'video/mp4', webm: 'video/webm' })[ext] ?? 'application/octet-stream';
}

function requireEnv(name, env = process.env) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function paths(env = process.env) {
  const storage = resolve(requireEnv('TV_OTA_STORAGE_ROOT', env));
  const runtime = safeSegment(requireEnv('NANOCLOUD_TV_RUNTIME_VERSION', env), 'runtime version');
  const channel = safeSegment(env.NANOCLOUD_TV_OTA_CHANNEL || 'production', 'channel');
  return {
    storage, runtime, channel,
    publications: join(storage, 'publications', 'android', runtime),
    pointer: join(storage, 'channels', channel, 'android', `${runtime}.json`),
  };
}

export function readPointer(file) {
  if (!existsSync(file)) return { current: null, previous: null };
  const value = JSON.parse(readFileSync(file, 'utf8'));
  for (const key of ['current', 'previous']) {
    if (value[key] !== null) safeSegment(value[key], `pointer ${key}`);
  }
  return value;
}

export function writePointerAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
  renameSync(temp, file);
}

export function validatePublication(directory, expectedRuntime) {
  const metadataFile = join(directory, 'publication.json');
  const manifestFile = join(directory, 'manifest.json');
  if (!existsSync(metadataFile) || !existsSync(manifestFile)) throw new Error('publication metadata is incomplete');
  const metadata = JSON.parse(readFileSync(metadataFile, 'utf8'));
  const manifestText = readFileSync(manifestFile, 'utf8');
  const manifest = JSON.parse(manifestText);
  if (manifest.id !== metadata.id || manifest.runtimeVersion !== expectedRuntime || metadata.runtimeVersion !== expectedRuntime ||
      metadata.platform !== 'android') {
    throw new Error('publication identity or runtime does not match');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(manifest.id)) {
    throw new Error('update id must be a UUID');
  }
  for (const asset of [manifest.launchAsset, ...manifest.assets]) {
    if (!asset || typeof asset.url !== 'string' || typeof asset.hash !== 'string') throw new Error('invalid manifest asset');
    const prefix = `/assets/${encodeURIComponent(expectedRuntime)}/${manifest.id}/`;
    const marker = asset.url.indexOf(prefix);
    if (marker < 0) throw new Error('asset URL is not immutable or belongs to another update');
    const encoded = asset.url.slice(marker + prefix.length);
    const parts = encoded.split('/').map(decodeURIComponent);
    if (parts.some((part) => !part || part === '.' || part === '..' || part.includes('/') || part.includes('\\'))) {
      throw new Error('unsafe asset path');
    }
    const file = resolve(directory, 'files', ...parts);
    const root = `${resolve(directory, 'files')}${sep}`;
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) throw new Error(`missing asset: ${encoded}`);
    if (sha256Base64Url(file) !== asset.hash) throw new Error(`asset hash mismatch: ${encoded}`);
  }
  if (metadata.signature && !/^sig="[A-Za-z0-9+/=]+", keyid="main", alg="rsa-v1_5-sha256"$/.test(metadata.signature)) {
    throw new Error('invalid signature metadata');
  }
  return { metadata, manifest, manifestText };
}

export function activate(publicationId, config = paths()) {
  safeSegment(publicationId, 'update id');
  validatePublication(join(config.publications, publicationId), config.runtime);
  const old = readPointer(config.pointer);
  if (old.current === publicationId) return old;
  const next = { current: publicationId, previous: old.current, activatedAt: new Date().toISOString() };
  writePointerAtomic(config.pointer, next);
  return next;
}

function expoEnvironment(runtime, env) {
  return { ...process.env, ...env, NANOCLOUD_TV_RUNTIME_VERSION: runtime };
}

function runExport(output, runtime, env) {
  const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['expo', 'export', '--platform', 'android', '--output-dir', output, '--clear'],
    { cwd: tvRoot, stdio: 'inherit', env: expoEnvironment(runtime, env) });
  if (result.error) throw new Error(`Unable to start Expo export: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Expo export failed with status ${result.status}`);
}

function readPublicExpoConfig(runtime, env) {
  const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['expo', 'config', '--type', 'public', '--json'],
    { cwd: tvRoot, encoding: 'utf8', env: expoEnvironment(runtime, env) });
  if (result.error) throw new Error(`Unable to start Expo config export: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Expo config export failed: ${result.stderr || result.status}`);
  if (!result.stdout.trim()) throw new Error('Expo config export returned no JSON');
  const config = JSON.parse(result.stdout);
  // This path is build-machine metadata, not client configuration. The public
  // certificate itself remains embedded natively by the config plugin.
  if (config.updates) delete config.updates.codeSigningCertificate;
  return config;
}

function assetDescriptor(source, relativePath, runtime, id, publicBase) {
  const hash = sha256Base64Url(source);
  const urlPath = relativePath.split('/').map(encodeURIComponent).join('/');
  const ext = relativePath.includes('.') ? relativePath.split('.').pop() : undefined;
  return {
    hash, key: hash, contentType: contentType(relativePath),
    ...(ext ? { fileExtension: `.${ext}` } : {}),
    url: `${publicBase}/assets/${encodeURIComponent(runtime)}/${id}/${urlPath}`,
  };
}

export function publish(env = process.env) {
  const config = paths(env);
  const publicBase = requireEnv('NANOCLOUD_TV_OTA_UPDATE_URL', env).replace(/\/$/, '');
  const parsedUrl = new URL(publicBase);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('NANOCLOUD_TV_OTA_UPDATE_URL must be HTTP(S)');
  const signingRequired = (env.TV_OTA_SIGNING_REQUIRED || 'true').toLowerCase() !== 'false';
  const privateKeyPath = env.TV_OTA_PRIVATE_KEY_PATH ? resolve(env.TV_OTA_PRIVATE_KEY_PATH) : null;
  const certificatePath = env.NANOCLOUD_TV_OTA_CERTIFICATE ? resolve(env.NANOCLOUD_TV_OTA_CERTIFICATE) : null;
  if (signingRequired && (!privateKeyPath || !existsSync(privateKeyPath))) {
    throw new Error('TV_OTA_SIGNING_REQUIRED is enabled but TV_OTA_PRIVATE_KEY_PATH is unavailable');
  }
  if (privateKeyPath && !existsSync(privateKeyPath)) throw new Error('TV_OTA_PRIVATE_KEY_PATH is unavailable');
  if (signingRequired && (!certificatePath || !existsSync(certificatePath))) {
    throw new Error('TV_OTA_SIGNING_REQUIRED is enabled but NANOCLOUD_TV_OTA_CERTIFICATE is unavailable');
  }
  if (certificatePath) validateCodeSigningCertificate(certificatePath);
  if (privateKeyPath && certificatePath) {
    const privatePublic = createPublicKey(readFileSync(privateKeyPath)).export({ type: 'spki', format: 'der' });
    const certificatePublic = new X509Certificate(readFileSync(certificatePath)).publicKey.export({ type: 'spki', format: 'der' });
    if (!privatePublic.equals(certificatePublic)) throw new Error('OTA private key does not match the signing certificate');
  }

  mkdirSync(config.publications, { recursive: true });
  const stagingRoot = join(config.storage, '.staging');
  mkdirSync(stagingRoot, { recursive: true });
  const staging = join(stagingRoot, `${process.pid}-${randomUUID()}`);
  const exported = join(staging, 'export');
  const publication = join(staging, 'publication');
  mkdirSync(publication, { recursive: true });

  try {
    const expoClient = readPublicExpoConfig(config.runtime, env);
    runExport(exported, config.runtime, env);
    const exportMetadata = JSON.parse(readFileSync(join(exported, 'metadata.json'), 'utf8'));
    const android = exportMetadata?.fileMetadata?.android;
    if (!android?.bundle || !Array.isArray(android.assets)) throw new Error('Expo export metadata is malformed');
    const exportedFiles = [android.bundle, ...android.assets.map((asset) => asset.path)];
    if (new Set(exportedFiles).size !== exportedFiles.length) throw new Error('Expo export contains duplicate asset paths');

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const filesRoot = join(publication, 'files');
    for (const relativePath of exportedFiles) {
      if (typeof relativePath !== 'string' || relativePath.startsWith('/') || relativePath.split('/').some((p) => !p || p === '.' || p === '..')) {
        throw new Error(`unsafe Expo export path: ${relativePath}`);
      }
      const source = resolve(exported, relativePath);
      if (!source.startsWith(`${resolve(exported)}${sep}`) || !existsSync(source)) throw new Error(`missing exported file: ${relativePath}`);
      const target = join(filesRoot, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(source, target, { errorOnExist: true, force: false });
    }

    const launchAsset = assetDescriptor(join(exported, android.bundle), android.bundle, config.runtime, id, publicBase);
    delete launchAsset.fileExtension;
    const assets = android.assets.map((asset) => assetDescriptor(join(exported, asset.path), asset.path, config.runtime, id, publicBase));
    const manifest = { id, createdAt, runtimeVersion: config.runtime, launchAsset, assets,
      metadata: { channel: config.channel, platform: 'android' }, extra: { expoClient } };
    const manifestText = JSON.stringify(manifest);
    const signature = privateKeyPath
      ? `sig="${sign('RSA-SHA256', Buffer.from(manifestText), readFileSync(privateKeyPath)).toString('base64')}", keyid="main", alg="rsa-v1_5-sha256"`
      : null;
    writeFileSync(join(publication, 'manifest.json'), manifestText, { flag: 'wx', mode: 0o644 });
    writeFileSync(join(publication, 'publication.json'), `${JSON.stringify({ id, createdAt, runtimeVersion: config.runtime,
      platform: 'android', channel: config.channel, signature }, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
    validatePublication(publication, config.runtime);

    const destination = join(config.publications, id);
    if (existsSync(destination)) throw new Error(`publication already exists: ${id}`);
    renameSync(publication, destination);
    activate(id, config);
    console.log(`Published and activated ${id} for android/${config.runtime}/${config.channel}`);
    return id;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export function rollback(env = process.env) {
  const config = paths(env);
  const pointer = readPointer(config.pointer);
  const target = env.TV_OTA_ROLLBACK_TO || pointer.previous;
  if (!target) throw new Error('no previous publication is available');
  validatePublication(join(config.publications, safeSegment(target, 'rollback target')), config.runtime);
  const next = { current: target, previous: pointer.current, activatedAt: new Date().toISOString() };
  writePointerAtomic(config.pointer, next);
  console.log(`Rolled back ${config.channel} to ${target}`);
}

export function cleanup(env = process.env) {
  const config = paths(env);
  const keep = Number.parseInt(env.TV_OTA_RETENTION_COUNT || '5', 10);
  if (!Number.isInteger(keep) || keep < 2) throw new Error('TV_OTA_RETENTION_COUNT must be an integer >= 2');
  const dryRun = (env.TV_OTA_CLEANUP_DRY_RUN || 'true').toLowerCase() !== 'false';
  const pointer = readPointer(config.pointer);
  if (!existsSync(config.publications)) return;
  const entries = readdirSync(config.publications, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SAFE.test(entry.name))
    .map((entry) => ({ id: entry.name, dir: join(config.publications, entry.name) }))
    .map((entry) => ({ ...entry, createdAt: validatePublication(entry.dir, config.runtime).manifest.createdAt }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const referenced = [pointer.current, pointer.previous];
  const channelsRoot = join(config.storage, 'channels');
  if (existsSync(channelsRoot)) {
    for (const channelEntry of readdirSync(channelsRoot, { withFileTypes: true })) {
      if (!channelEntry.isDirectory() || !SAFE.test(channelEntry.name)) continue;
      const candidate = join(channelsRoot, channelEntry.name, 'android', `${config.runtime}.json`);
      if (!existsSync(candidate)) continue;
      const channelPointer = readPointer(candidate);
      referenced.push(channelPointer.current, channelPointer.previous);
    }
  }
  const protectedIds = new Set([...referenced, ...entries.slice(0, keep).map((x) => x.id)].filter(Boolean));
  for (const entry of entries) {
    if (protectedIds.has(entry.id)) continue;
    console.log(`${dryRun ? 'Would remove' : 'Removing'} ${entry.dir}`);
    if (!dryRun) rmSync(entry.dir, { recursive: true });
  }
}

const command = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) ? process.argv[2] : null;
if (command) {
  try {
    if (command === 'publish') publish();
    else if (command === 'rollback') rollback();
    else if (command === 'cleanup') cleanup();
    else throw new Error('usage: ota.mjs <publish|rollback|cleanup>');
  } catch (error) {
    console.error(`OTA ${command} failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
