import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const galleryScreen = readFileSync(
  new URL('../screens/PersonalGalleryScreen.tsx', import.meta.url),
  'utf8',
);
const appConfig = readFileSync(new URL('../../app.config.js', import.meta.url), 'utf8');

test('native gallery routes search through one workspace and typed bulk panels', () => {
  assert.match(galleryScreen, /GalleryWorkspacePanel/);
  assert.match(galleryScreen, /GalleryDestinationPanel/);
  assert.match(galleryScreen, /GalleryTrashConfirmPanel/);
  assert.doesNotMatch(galleryScreen, /GalleryFiltersPanel/);
  assert.doesNotMatch(galleryScreen, /GallerySortPanel/);
  assert.doesNotMatch(galleryScreen, /GallerySearchPanel/);
  assert.doesNotMatch(galleryScreen, /GalleryCommandPanel/);
});

test('the native video build uses the current OTA runtime contract', () => {
  assert.match(appConfig, /NANOCLOUD_TV_RUNTIME_VERSION \|\| 'tv-native-3'/);
  assert.match(appConfig, /versionCode: 3/);
  assert.match(appConfig, /checkAutomatically: 'NEVER'/);
  assert.match(appConfig, /fallbackToCacheTimeout: 0/);
});
