// One bounded migration for the browser-storage keys the NubArca rename moved.
//
// The rule everywhere: the CURRENT key wins outright; the pre-rename key is
// consulted only when the current one is absent, and a value found there is
// moved forward and the old key deleted, so the fallback runs at most once per
// browser. A reader never loses a preference to the rename, and a stale value
// can never resurrect itself later.
//
// The theme preference deliberately does NOT use this helper: its rules are
// duplicated verbatim in the pre-paint bootstrap in index.html, which cannot
// import a module. See src/theme/themePreference.ts.

/**
 * Read `key`, falling back once to `legacyKey` and migrating what it finds.
 * Returns null when neither key holds a value, or when storage is unavailable.
 */
export function readMigratedItem(key: string, legacyKey: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const current = window.localStorage.getItem(key);
    if (current !== null) return current;

    const legacy = window.localStorage.getItem(legacyKey);
    if (legacy === null) return null;

    window.localStorage.setItem(key, legacy);
    window.localStorage.removeItem(legacyKey);
    return legacy;
  } catch {
    // Blocked storage / private mode: the caller falls back to its default.
    return null;
  }
}
