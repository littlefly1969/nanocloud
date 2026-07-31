import { BRAND_ASSETS, PRODUCT_NAME, WORDMARK_PARTS } from './brand';

// The NubArca lockup: the approved icon next to the wordmark.
//
// The wordmark is live TEXT, not an image. That is the brand contract's own
// fallback for the case we are in — no light-on-dark wordmark asset was
// supplied, and informally recoloring the dark-text one is forbidden. Text also
// stays crisp at every zoom level, respects the user's font size, and gives
// screen readers the product name without an alt-text duplicate.
//
// The icon carries the whole accessible name, so the wordmark is aria-hidden:
// otherwise "NubArca NubArca" would be announced.

interface BrandMarkProps {
  /** Icon-only, for the collapsed rail and other tight slots. */
  compact?: boolean;
  className?: string;
}

export function BrandMark({ compact = false, className }: BrandMarkProps) {
  return (
    <span
      className={['brand-mark', compact ? 'brand-mark--compact' : '', className]
        .filter(Boolean)
        .join(' ')}
      role="img"
      aria-label={PRODUCT_NAME}
      data-testid="brand-mark"
    >
      <img
        className="brand-mark__icon"
        src={compact ? BRAND_ASSETS.iconSmall : BRAND_ASSETS.icon}
        alt=""
        aria-hidden="true"
        draggable={false}
        width={compact ? 24 : 28}
        height={compact ? 24 : 28}
      />
      {!compact && (
        <span className="brand-mark__wordmark" aria-hidden="true">
          {WORDMARK_PARTS.lead}
          <span className="brand-mark__wordmark-accent">{WORDMARK_PARTS.accent}</span>
        </span>
      )}
    </span>
  );
}
