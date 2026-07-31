// The product's identity, in one place.
//
// Capitalization is part of the brand contract: it is always "NubArca", with a
// capital A. Never "Nubarca", "NUBARCA" or "Nub Arca", and never the former
// name. Brand names are NOT translated, so these are plain constants rather
// than i18n keys — every locale renders the identical string. (`app.name` still
// exists in the locale files and resolves to PRODUCT_NAME, so the existing
// translation call sites keep working.)

export const PRODUCT_NAME = 'NubArca';

/** The television product. Also untranslated. */
export const TV_PRODUCT_NAME = 'NubArca TV';

/**
 * The two halves the wordmark is set in: "Nub" in the primary text colour,
 * "Arca" in the brand accent. Split here so no component re-slices the string
 * and risks producing a different capitalization.
 */
export const WORDMARK_PARTS = { lead: 'Nub', accent: 'Arca' } as const;

/**
 * Runtime brand artwork, generated from the approved sources by
 * `scripts/generate-brand-assets.py`. Served from our own origin.
 *
 * There is deliberately NO light-on-dark wordmark image here. The only approved
 * transparent wordmark has DARK text (#000829 / #0160D9), which would be
 * invisible on the dark default theme, and recoloring an official asset is not
 * permitted. The shell therefore uses the standalone icon plus live UI text —
 * the sanctioned fallback — which also scales and translates better than a
 * bitmap would.
 */
export const BRAND_ASSETS = {
  /** Transparent primary icon, light-on-dark. Safe on either theme. */
  icon: '/brand/icon-192.png',
  iconSmall: '/brand/icon-64.png',
  /** Opaque app-icon artwork (favicon, PWA, mobile home screen). */
  appIcon: '/brand/app-icon-192.png',
  /** Approved dark-text wordmark. LIGHT backgrounds only. */
  wordmarkDarkText: '/brand/wordmark-dark-text-480.png',
} as const;

/** Minimum rendered wordmark width, from the brand development guidelines. */
export const MIN_WORDMARK_WIDTH_PX = 120;

/** Minimum rendered icon size, from the brand development guidelines. */
export const MIN_ICON_SIZE_PX = 24;
