import assert from 'node:assert/strict';
import test from 'node:test';
import { resetUpdateLifecycleForTests, startBackgroundUpdateCheck } from './updateLifecycle.ts';

function api(overrides: Record<string, unknown> = {}) {
  return {
    isEnabled: true, runtimeVersion: 'tv-native-1', updateId: 'embedded', isEmbeddedLaunch: true,
    checkForUpdateAsync: async () => ({ isAvailable: false }),
    fetchUpdateAsync: async () => ({ isNew: false }),
    ...overrides,
  } as never;
}

test.beforeEach(resetUpdateLifecycleForTests);

test('starts in the background and prevents overlapping or repeated checks', async () => {
  let checks = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fake = api({ checkForUpdateAsync: async () => { checks += 1; await gate; return { isAvailable: false }; } });
  const first = startBackgroundUpdateCheck(fake);
  const second = startBackgroundUpdateCheck(fake);
  assert.equal(first, second);
  assert.equal(checks, 1);
  release();
  assert.equal((await first).lastResult, 'no-update');
  await startBackgroundUpdateCheck(fake);
  assert.equal(checks, 1);
});

test('downloads without reloading and records a pending update', async () => {
  let fetches = 0;
  const result = await startBackgroundUpdateCheck(api({
    checkForUpdateAsync: async () => ({ isAvailable: true }),
    fetchUpdateAsync: async () => { fetches += 1; return { isNew: true }; },
  }));
  assert.equal(fetches, 1);
  assert.equal(result.pending, true);
  assert.equal(result.lastResult, 'downloaded');
});

test('swallows and records update errors', async () => {
  const result = await startBackgroundUpdateCheck(api({
    checkForUpdateAsync: async () => { throw new Error('offline'); },
  }));
  assert.equal(result.lastResult, 'error');
  assert.equal(result.lastError, 'offline');
});
