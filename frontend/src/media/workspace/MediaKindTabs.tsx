import { useRef, type KeyboardEvent } from 'react';
import { useI18n } from '../../i18n';
import type { MediaKindScope } from './mediaWorkspaceQuery';

// Primary in-workspace navigation: "Tutti | Foto | Video". A real ARIA tablist
// (roving tabindex, arrow/Home/End keyboard nav) so the kind selection reads as
// navigation, not a hidden filter. Counts come from the server response so the
// labels never trigger extra queries. Controlled: the page owns the URL sync.

const ORDER: MediaKindScope[] = ['all', 'image', 'video'];

interface Props {
  value: MediaKindScope;
  onChange(kind: MediaKindScope): void;
  counts?: { all: number; image: number; video: number } | null;
  panelId?: string;
}

export function MediaKindTabs({ value, onChange, counts, panelId }: Props) {
  const { t } = useI18n();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const label = (kind: MediaKindScope): string =>
    kind === 'image' ? t('mediaWs.kindImage') : kind === 'video' ? t('mediaWs.kindVideo') : t('mediaWs.kindAll');

  const count = (kind: MediaKindScope): number | null => {
    if (!counts) return null;
    return kind === 'image' ? counts.image : kind === 'video' ? counts.video : counts.all;
  };

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % ORDER.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + ORDER.length) % ORDER.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = ORDER.length - 1;
    else return;
    e.preventDefault();
    const kind = ORDER[next];
    onChange(kind);
    refs.current[next]?.focus();
  }

  return (
    <div
      className="media-kind-tabs"
      role="tablist"
      aria-label={t('mediaWs.kindTabsAria')}
      data-testid="media-kind-tabs"
    >
      {ORDER.map((kind, i) => {
        const selected = kind === value;
        const c = count(kind);
        return (
          <button
            key={kind}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            id={`media-kind-tab-${kind}`}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            className={`media-kind-tab${selected ? ' is-active' : ''}`}
            data-testid={`media-kind-tab-${kind}`}
            onClick={() => onChange(kind)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <span className="media-kind-tab-label">{label(kind)}</span>
            {c !== null && (
              <span className="media-kind-tab-count" data-testid={`media-kind-count-${kind}`}>
                {c.toLocaleString()}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
