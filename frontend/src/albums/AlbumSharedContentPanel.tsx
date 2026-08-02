import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  listAlbumContent,
  removeAlbumContentItem,
  type AlbumContentItem,
} from '@nubarca/api-client';
import { useAuth } from '../auth/useAuth';
import { useI18n } from '../i18n';

// SHARE-ALBUM-02: the album OWNER's view of the live album — their own items
// plus every collaborator contribution, in the order members see them.
//
// WHY THIS IS A SEPARATE VIEW, NOT THE ALBUM WORKSPACE:
// contributions are media the owner does NOT own. Merging them into the
// workspace would mean widening the owner's core library query, which is what
// backs their gallery, their folders and /api/media — and every affordance
// there (delete, move, metadata, exclude, Private Vault) assumes the caller
// owns the file. This surface is additive and reads a single dedicated
// endpoint, so a collaborator's media can never acquire an owner-only action by
// inheriting one from a shared component.
//
// The only mutation offered is "Remove from album". "Delete" is deliberately
// absent for every row: for a contribution the owner has no right to delete,
// and for their own item removing it from an album is curation, not deletion.

interface Props {
  albumId: string;
  onClose(): void;
  returnFocusRef?: React.RefObject<HTMLButtonElement | null>;
}

type Status =
  | { kind: 'loading' }
  | { kind: 'ready'; items: AlbumContentItem[] }
  | { kind: 'gone' }
  | { kind: 'error'; message: string };

export function AlbumSharedContentPanel({ albumId, onClose, returnFocusRef }: Props) {
  const { t, formatDate } = useI18n();
  const { invalidateAuth } = useAuth();
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStatus({ kind: 'loading' });
    listAlbumContent(albumId, ctrl.signal)
      .then((items) => setStatus({ kind: 'ready', items }))
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return;
        if (err instanceof ApiError && err.status === 401) { invalidateAuth(); return; }
        if (err instanceof ApiError && err.status === 404) { setStatus({ kind: 'gone' }); return; }
        setStatus({ kind: 'error', message: t('albumContent.loadError') });
      });
  }, [albumId, invalidateAuth, t]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus();
    return () => returnFocusRef?.current?.focus();
  }, [returnFocusRef]);

  async function remove(item: AlbumContentItem) {
    const question = item.origin === 'contribution'
      // Names the contributor with the same disambiguated label the member list
      // uses, so an owner with two identically-named collaborators is never
      // asked to confirm an ambiguous removal.
      ? t('albumContent.confirmRemoveContribution', { name: contributorLabel(item) })
      : t('albumContent.confirmRemoveOwn');
    if (!window.confirm(question)) return;

    setBusy(item.fileItemId);
    setActionError(null);
    try {
      await removeAlbumContentItem(albumId, item.fileItemId);
      load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { invalidateAuth(); return; }
      // Already gone (a concurrent withdrawal, or a revoke that swept it):
      // reload to the current truth rather than report an error about a row
      // that no longer exists.
      if (err instanceof ApiError && err.status === 404) { load(); return; }
      setActionError(t('albumContent.removeError'));
    } finally {
      setBusy(null);
    }
  }

  function contributorLabel(item: AlbumContentItem): string {
    if (!item.contributorDisplayName) return '';
    return item.contributorMaskedEmail
      ? `${item.contributorDisplayName} (${item.contributorMaskedEmail})`
      : item.contributorDisplayName;
  }

  const items = status.kind === 'ready' ? status.items : [];

  return (
    <div
      className="ws-sheet-backdrop"
      data-testid="album-content-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        className="ws-sheet album-content-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('albumContent.heading')}
        data-testid="album-content-panel"
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
      >
        <header className="ws-sheet-head">
          <h2 className="ws-sheet-title">{t('albumContent.heading')}</h2>
          <button
            type="button"
            className="ws-icon-button"
            aria-label={t('common.close')}
            data-testid="album-content-close"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className="ws-sheet-body">
          <p className="muted">{t('albumContent.intro')}</p>

          {status.kind === 'loading' && <p>{t('common.loading')}</p>}
          {status.kind === 'gone' && (
            <p className="empty-state" role="status">{t('albumContent.loadError')}</p>
          )}
          {status.kind === 'error' && (
            <p className="inline-error" role="alert">{status.message}</p>
          )}
          {actionError && <p className="inline-error" role="alert">{actionError}</p>}

          {status.kind === 'ready' && items.length === 0 && (
            <p className="empty-state" data-testid="album-content-empty">
              {t('albumContent.empty')}
            </p>
          )}

          {status.kind === 'ready' && items.length > 0 && (
            <ul className="album-content-list" data-testid="album-content-list">
              {items.map((item, index) => (
                <li
                  key={item.fileItemId}
                  className="album-content-row"
                  data-testid="album-content-row"
                  data-origin={item.origin}
                >
                  <div className="album-content-thumb">
                    {item.sourceState === 'available' ? (
                      <img src={item.thumbnailUrl} alt="" loading="lazy" />
                    ) : (
                      <span className="album-content-thumb-missing" aria-hidden="true">⚠</span>
                    )}
                  </div>

                  <div className="album-content-meta">
                    {/* Provenance is visible but discreet: the owner's own
                        items carry no redundant badge on every card. */}
                    {item.origin === 'contribution' ? (
                      <p className="album-content-provenance" data-testid="album-content-provenance">
                        {t('albumContent.addedBy', { name: item.contributorDisplayName ?? '' })}
                        {item.contributorMaskedEmail && (
                          <span className="album-share-member-hint">
                            {' '}{item.contributorMaskedEmail}
                          </span>
                        )}
                      </p>
                    ) : (
                      <p className="album-content-provenance muted">{t('albumContent.ownerItem')}</p>
                    )}
                    <p className="muted album-content-when">{formatDate(item.addedAt)}</p>
                    {item.sourceState === 'unavailable' && (
                      <p className="album-content-unavailable" data-testid="album-content-unavailable">
                        {t('albumContent.unavailable')}
                        <span className="muted"> — {t('albumContent.unavailableHelp')}</span>
                      </p>
                    )}
                  </div>

                  {/* The ONLY mutation. No "delete original" exists here for
                      any row, collaborator's or the owner's own. */}
                  <button
                    type="button"
                    className="row-action"
                    data-testid="album-content-remove"
                    disabled={busy === item.fileItemId}
                    aria-label={t('albumContent.removeAria', {
                      index: index + 1, total: items.length,
                    })}
                    onClick={() => void remove(item)}
                  >
                    {t('albumContent.remove')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
