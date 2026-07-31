import { useTheme } from '../theme/useTheme';
import {
  LOGO_CLEAR_SPACE_RATIO,
  MIN_ICON_SIZE_PX,
  MIN_WORDMARK_WIDTH_PX,
  PRODUCT_NAME,
  flatMarkUrl,
  wordmarkAsset,
} from './brand';

// The NubArca lockup, in the two forms the brand guidelines distinguish.
//
//   'mark'     the approved FLAT mark alone — shell, navigation, dense chrome.
//              Never the launcher/PWA icon: that artwork is luminous and
//              framed, and at 24 px its glow smears and its frame fights the
//              surrounding UI.
//
//   'wordmark' the approved full lockup (symbol + NubArca) — login and other
//              prominent placements, at or above the 120 px minimum width.
//
// Both come in an ON-DARK and an ON-LIGHT variant, selected from the RESOLVED
// theme so the Cloud White artwork never lands on Cloud White. Everything is a
// byte-exact approved asset: nothing here recolours, rotates or restyles.
//
// The element carries the accessible name once, so the artwork inside is
// aria-hidden rather than announced a second time.

interface BrandMarkProps {
  /** 'mark' (default) for chrome; 'wordmark' for prominent placements. */
  variant?: 'mark' | 'wordmark';
  /**
   * Rendered size in CSS px: the icon's box for 'mark', the VISIBLE lockup's
   * width for 'wordmark'. Both are clamped to the brand minimums.
   */
  size?: number;
  className?: string;
}

export function BrandMark({ variant = 'mark', size, className }: BrandMarkProps) {
  const { effective } = useTheme();
  const classes = ['brand-mark', `brand-mark--${variant}`, className].filter(Boolean).join(' ');

  if (variant === 'wordmark') {
    // Never below the minimum wordmark width, whatever a caller asks for.
    const contentWidth = Math.max(size ?? 200, MIN_WORDMARK_WIDTH_PX);
    const { src, elementWidthPx } = wordmarkAsset(effective, contentWidth);
    return (
      <span
        className={classes}
        role="img"
        aria-label={PRODUCT_NAME}
        data-testid="brand-mark"
        data-variant="wordmark"
        // Clear space: 25% of the rendered logo height on every side.
        style={{ padding: `${Math.round(contentWidth / 3.75 * LOGO_CLEAR_SPACE_RATIO)}px` }}
      >
        <img
          className="brand-mark__wordmark-img"
          src={src}
          alt=""
          aria-hidden="true"
          draggable={false}
          width={elementWidthPx}
          style={{ width: `${elementWidthPx}px` }}
        />
      </span>
    );
  }

  const px = Math.max(size ?? 28, MIN_ICON_SIZE_PX);
  return (
    <span
      className={classes}
      role="img"
      aria-label={PRODUCT_NAME}
      data-testid="brand-mark"
      data-variant="mark"
      style={{ padding: `${Math.round(px * LOGO_CLEAR_SPACE_RATIO)}px` }}
    >
      <img
        className="brand-mark__icon"
        src={flatMarkUrl(effective, px)}
        alt=""
        aria-hidden="true"
        draggable={false}
        width={px}
        height={px}
        style={{ width: `${px}px`, height: `${px}px` }}
      />
    </span>
  );
}
