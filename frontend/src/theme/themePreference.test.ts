import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_THEME_PREFERENCE,
  LEGACY_THEME_STORAGE_KEY,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  applyEffectiveTheme,
  readStoredThemePreference,
  resolveEffectiveTheme,
  systemPrefersLight,
  toThemePreference,
  writeStoredThemePreference,
} from './themePreference';

afterEach(() => {
  // Unstub FIRST: a test may have replaced localStorage with a throwing stub
  // that has no clear().
  vi.unstubAllGlobals();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('theme preference model', () => {
  it('defaults to dark for a first-run user with no stored preference', () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe('dark');
    expect(readStoredThemePreference()).toBe('dark');
    expect(resolveEffectiveTheme(readStoredThemePreference(), false)).toBe('dark');
    // Dark stays the default even where the OS asks for light: only an explicit
    // `system` choice consults the OS.
    expect(resolveEffectiveTheme(readStoredThemePreference(), true)).toBe('dark');
  });

  it('offers exactly dark, light and system', () => {
    expect([...THEME_PREFERENCES]).toEqual(['dark', 'light', 'system']);
  });

  it('narrows only the three bounded tokens', () => {
    expect(toThemePreference('dark')).toBe('dark');
    expect(toThemePreference('light')).toBe('light');
    expect(toThemePreference('system')).toBe('system');
    expect(toThemePreference('DARK')).toBeNull();
    expect(toThemePreference('sepia')).toBeNull();
    expect(toThemePreference(null)).toBeNull();
    expect(toThemePreference(undefined)).toBeNull();
    expect(toThemePreference(1)).toBeNull();
  });

  it('round-trips a stored preference under the versioned key', () => {
    writeStoredThemePreference('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(readStoredThemePreference()).toBe('light');

    writeStoredThemePreference('system');
    expect(readStoredThemePreference()).toBe('system');
  });

  it('falls back to dark for a stored value it does not recognise', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'solarized');
    expect(readStoredThemePreference()).toBe('dark');
  });

  it('falls back to dark when localStorage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    expect(readStoredThemePreference()).toBe('dark');
    // Writing must not propagate the failure to the caller.
    expect(() => writeStoredThemePreference('light')).not.toThrow();
  });

  // The NubArca rename moved the key. Nobody may lose the theme they chose.
  describe('pre-rebrand key migration', () => {
    it('uses the new key, not the old one', () => {
      expect(THEME_STORAGE_KEY).toBe('nubarca.theme');
      expect(LEGACY_THEME_STORAGE_KEY).toBe('nanocloud.theme');
    });

    it('adopts a valid pre-rebrand preference and moves it to the new key', () => {
      window.localStorage.setItem(LEGACY_THEME_STORAGE_KEY, 'light');

      expect(readStoredThemePreference()).toBe('light');
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
      // Moved, not copied — the fallback runs once per browser.
      expect(window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY)).toBeNull();
    });

    it('migrates each of the three bounded tokens', () => {
      for (const preference of THEME_PREFERENCES) {
        window.localStorage.clear();
        window.localStorage.setItem(LEGACY_THEME_STORAGE_KEY, preference);
        expect(readStoredThemePreference()).toBe(preference);
        expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(preference);
      }
    });

    it('lets the new key win outright when both exist', () => {
      window.localStorage.setItem(LEGACY_THEME_STORAGE_KEY, 'light');
      window.localStorage.setItem(THEME_STORAGE_KEY, 'system');

      expect(readStoredThemePreference()).toBe('system');
      // A stale legacy value must not resurrect itself later.
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
    });

    it('discards an unreadable legacy value instead of migrating it', () => {
      window.localStorage.setItem(LEGACY_THEME_STORAGE_KEY, 'solarized');

      expect(readStoredThemePreference()).toBe('dark');
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
      // Dropped, so the fallback does not re-run on every single read.
      expect(window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY)).toBeNull();
    });

    it('still defaults to dark for a browser that has neither key', () => {
      expect(readStoredThemePreference()).toBe('dark');
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    });

    it('writes only the new key from then on', () => {
      window.localStorage.setItem(LEGACY_THEME_STORAGE_KEY, 'light');
      readStoredThemePreference();
      writeStoredThemePreference('dark');

      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
      expect(window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY)).toBeNull();
    });
  });

  it('resolves system against the OS light signal', () => {
    expect(resolveEffectiveTheme('system', true)).toBe('light');
    expect(resolveEffectiveTheme('system', false)).toBe('dark');
    // Explicit choices ignore the OS entirely.
    expect(resolveEffectiveTheme('light', false)).toBe('light');
    expect(resolveEffectiveTheme('dark', true)).toBe('dark');
  });

  it('reports no light system preference when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(systemPrefersLight()).toBe(false);
  });

  it('reads the OS light preference through matchMedia', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q === '(prefers-color-scheme: light)',
      media: q,
    }));
    expect(systemPrefersLight()).toBe(true);
  });

  it('stamps the effective theme on the document element', () => {
    applyEffectiveTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    applyEffectiveTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
