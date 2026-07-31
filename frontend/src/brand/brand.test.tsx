import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '../i18n';
// Aliased: a bare `it` import would shadow vitest's `it`.
import enMessages from '../i18n/en';
import itMessages from '../i18n/it';
import { BrandMark } from './BrandMark';
import {
  BRAND_ASSETS,
  MIN_ICON_SIZE_PX,
  MIN_WORDMARK_WIDTH_PX,
  PRODUCT_NAME,
  TV_PRODUCT_NAME,
  WORDMARK_PARTS,
} from './brand';

const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(here, '../..');
const PUBLIC = resolve(FRONTEND, 'public');
const CSS = readFileSync(resolve(FRONTEND, 'src/styles.css'), 'utf8');
const INDEX_HTML = readFileSync(resolve(FRONTEND, 'index.html'), 'utf8');

// The former product name. Written split so this file does not itself trip the
// repository-wide brand-cleanliness check it exists to complement.
const OLD_NAME = ['Nano', 'Cloud'].join('');

afterEach(cleanup);

describe('product name', () => {
  it('is NubArca, with a capital A', () => {
    expect(PRODUCT_NAME).toBe('NubArca');
    expect(TV_PRODUCT_NAME).toBe('NubArca TV');
    // The forbidden spellings.
    for (const wrong of ['Nubarca', 'NUBARCA', 'nubarca', 'Nub Arca']) {
      expect(PRODUCT_NAME).not.toBe(wrong);
    }
  });

  it('splits the wordmark without changing its capitalization', () => {
    expect(WORDMARK_PARTS.lead + WORDMARK_PARTS.accent).toBe(PRODUCT_NAME);
    expect(WORDMARK_PARTS.accent.startsWith('A')).toBe(true);
  });
});

describe('locale resources', () => {
  const locales = { en: enMessages, it: itMessages } as const;

  it('names the product identically in every locale — brand names are not translated', () => {
    for (const [tag, messages] of Object.entries(locales)) {
      expect(messages['app.name'], `${tag} app.name`).toBe(PRODUCT_NAME);
      expect(messages['tv.title'], `${tag} tv.title`).toBe(TV_PRODUCT_NAME);
    }
  });

  it('leaves the former name in no message of any locale, fallback included', () => {
    for (const [tag, messages] of Object.entries(locales)) {
      for (const [key, value] of Object.entries(messages)) {
        if (typeof value !== 'string') continue;
        expect(value.toLowerCase(), `${tag} → ${key}`).not.toContain(OLD_NAME.toLowerCase());
      }
    }
  });

  it('keeps the FALLBACK locale brand-clean, since an untranslated key renders it', () => {
    // English is Partial over the Italian keys: anything it omits renders the
    // Italian string. Italian is therefore the locale a stale brand would leak
    // through, so it is checked explicitly rather than only as one of many.
    const italianOnly = Object.keys(itMessages).filter((key) => !(key in enMessages));
    for (const key of italianOnly) {
      const value = (itMessages as Record<string, string>)[key];
      expect(value.toLowerCase(), `fallback → ${key}`).not.toContain(OLD_NAME.toLowerCase());
    }
    // And the brand keys themselves are defined in both, never left to fall back.
    for (const key of ['app.name', 'tv.title'] as const) {
      expect(enMessages[key], `en must define ${key}`).toBeDefined();
      expect(itMessages[key], `it must define ${key}`).toBeDefined();
    }
  });
});

describe('document head', () => {
  it('titles the document NubArca', () => {
    expect(INDEX_HTML).toContain('<title>NubArca</title>');
    expect(INDEX_HTML).not.toContain(OLD_NAME);
  });

  it('carries a description, an application name and the brand theme colour', () => {
    expect(INDEX_HTML).toMatch(/<meta\s+name="description"/);
    expect(INDEX_HTML).toContain('NubArca — your files, your hardware, your private cloud.');
    expect(INDEX_HTML).toContain('name="application-name" content="NubArca"');
    // Midnight Navy, the brand's principal dark background.
    expect(INDEX_HTML).toContain('content="#0a0f1a"');
  });

  it('links a favicon, an apple touch icon and the manifest', () => {
    expect(INDEX_HTML).toContain('href="/brand/favicon.ico"');
    expect(INDEX_HTML).toContain('rel="apple-touch-icon"');
    expect(INDEX_HTML).toContain('href="/manifest.webmanifest"');
  });
});

describe('PWA manifest', () => {
  const manifest = JSON.parse(
    readFileSync(resolve(PUBLIC, 'manifest.webmanifest'), 'utf8'),
  ) as {
    name: string; short_name: string; description: string;
    background_color: string; theme_color: string;
    icons: Array<{ src: string; sizes: string; purpose: string }>;
  };

  it('installs as NubArca', () => {
    expect(manifest.name).toBe('NubArca');
    expect(manifest.short_name).toBe('NubArca');
    expect(JSON.stringify(manifest)).not.toContain(OLD_NAME);
  });

  it('uses the brand background so the splash is Midnight Navy', () => {
    expect(manifest.background_color).toBe('#0a0f1a');
    expect(manifest.theme_color).toBe('#0a0f1a');
  });

  it('declares 192, 512 and a maskable icon, all present on disk', () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      expect(existsSync(resolve(PUBLIC, icon.src.replace(/^\//, ''))), icon.src).toBe(true);
    }
  });
});

describe('brand artwork', () => {
  it('ships every asset the code references', () => {
    for (const [role, path] of Object.entries(BRAND_ASSETS)) {
      expect(existsSync(resolve(PUBLIC, path.replace(/^\//, ''))), `${role} → ${path}`).toBe(true);
    }
  });

  it('keeps the guideline boards out of the served directory', () => {
    // The reference boards are documentation, never runtime UI.
    const served = readdirSync(resolve(PUBLIC, 'brand'));
    expect(served.filter((f) => f.startsWith('reference-'))).toEqual([]);
  });

  it('leaves no old-brand artwork behind in the served directory', () => {
    for (const file of readdirSync(resolve(PUBLIC, 'brand'))) {
      expect(file.toLowerCase()).not.toContain('nanocloud');
    }
  });

  it('ships the font licences alongside the bundled faces', () => {
    expect(existsSync(resolve(PUBLIC, 'fonts/space-grotesk-OFL.txt'))).toBe(true);
    expect(existsSync(resolve(PUBLIC, 'fonts/exo-2-OFL.txt'))).toBe(true);
    for (const name of ['space-grotesk-OFL.txt', 'exo-2-OFL.txt']) {
      expect(readFileSync(resolve(PUBLIC, 'fonts', name), 'utf8'))
        .toContain('SIL Open Font License');
    }
  });
});

describe('brand mark', () => {
  function renderMark(compact = false) {
    return render(
      <I18nProvider>
        <BrandMark compact={compact} />
      </I18nProvider>,
    );
  }

  it('announces the product name exactly once', () => {
    renderMark();
    const mark = screen.getByTestId('brand-mark');
    expect(mark).toHaveAttribute('aria-label', PRODUCT_NAME);
    // The visible wordmark is decorative: the label already carries the name.
    expect(mark.querySelector('.brand-mark__wordmark')).toHaveAttribute('aria-hidden', 'true');
    expect(mark.querySelector('img')).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders the wordmark two-tone, without altering the capitalization', () => {
    renderMark();
    expect(screen.getByTestId('brand-mark').textContent).toBe(PRODUCT_NAME);
    expect(document.querySelector('.brand-mark__wordmark-accent')?.textContent).toBe('Arca');
  });

  it('drops to the icon alone in compact mode rather than shrinking the wordmark', () => {
    renderMark(true);
    expect(document.querySelector('.brand-mark__wordmark')).toBeNull();
    expect(screen.getByTestId('brand-mark').querySelector('img')).not.toBeNull();
  });

  it('uses the transparent icon, never a guideline board', () => {
    renderMark();
    const src = screen.getByTestId('brand-mark').querySelector('img')!.getAttribute('src')!;
    expect(src).toBe(BRAND_ASSETS.icon);
    expect(src).not.toContain('reference-');
  });
});

describe('brand geometry and palette tokens', () => {
  function ruleBody(selector: string): string {
    const pattern = new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`, 'm');
    const match = pattern.exec(CSS);
    if (match === null) throw new Error(`No rule for "${selector}".`);
    const start = CSS.indexOf('{', match.index);
    return CSS.slice(start + 1, CSS.indexOf('}', start));
  }

  it('defines the official palette verbatim', () => {
    const root = ruleBody(':root');
    const official: Array<[string, string]> = [
      ['--brand-midnight-navy', '#0a0f1a'],
      ['--brand-deep-blue', '#0f1e3a'],
      ['--brand-electric-blue', '#1565ff'],
      ['--brand-cyan-glow', '#00d4ff'],
      ['--brand-soft-violet', '#9a6cff'],
      ['--brand-cloud-white', '#f5f7fb'],
    ];
    for (const [token, hex] of official) {
      expect(root, `${token} must be exactly ${hex}`).toContain(`${token}: ${hex}`);
    }
  });

  it('maps the dark surfaces onto the brand backgrounds', () => {
    const root = ruleBody(':root');
    expect(root).toContain('--surface-canvas: var(--brand-midnight-navy)');
    expect(root).toContain('--surface-raised: var(--brand-deep-blue)');
    expect(root).toContain('--text-primary: var(--brand-cloud-white)');
  });

  it('keeps Soft Violet off the primary action colour', () => {
    const root = ruleBody(':root');
    expect(root).toContain('--accent-secondary: var(--brand-soft-violet)');
    expect(root).not.toMatch(/--accent:\s*var\(--brand-soft-violet\)/);
    expect(ruleBody(":root[data-theme='light']")).not.toContain('9a6cff');
  });

  it('states the brand geometry as tokens', () => {
    const root = ruleBody(':root');
    expect(root).toContain('--space-unit: 8px');
    expect(root).toContain('--radius-card: 16px');
    expect(root).toContain('--radius-button: 12px');
  });

  it('sets both brand faces with a usable fallback stack', () => {
    const root = ruleBody(':root');
    expect(root).toMatch(/--font-heading:\s*'Space Grotesk',/);
    expect(root).toMatch(/--font-ui:\s*'Exo 2',/);
    // A font-load failure must still leave readable text.
    expect(root).toMatch(/--font-heading:[^;]*sans-serif/);
    expect(root).toMatch(/--font-ui:[^;]*sans-serif/);
    // Monospace is deliberately unchanged — logs and hashes need fixed pitch.
    expect(root).toContain('--font-mono: ui-monospace');
  });

  it('gives controls the UI face explicitly', () => {
    expect(CSS).toMatch(/button,\s*\n\s*input,\s*\n\s*select,\s*\n\s*textarea,\s*\n\s*optgroup\s*\{\s*\n\s*font-family: var\(--font-ui\);/);
  });

  it('respects the minimum icon and wordmark sizes from the guidelines', () => {
    expect(MIN_ICON_SIZE_PX).toBe(24);
    expect(MIN_WORDMARK_WIDTH_PX).toBe(120);
    expect(ruleBody('.brand-mark__icon')).toContain(`min-width: ${MIN_ICON_SIZE_PX}px`);
  });

  it('loads no font from a third-party origin', () => {
    // Everything is bundled from node_modules by Vite and served same-origin.
    expect(CSS).not.toMatch(/@import\s+url\(['"]?https?:/);
    expect(CSS).not.toContain('fonts.googleapis.com');
    expect(CSS).not.toContain('fonts.gstatic.com');
    expect(INDEX_HTML).not.toContain('fonts.googleapis.com');
    expect(INDEX_HTML).not.toContain('fonts.gstatic.com');
  });
});
