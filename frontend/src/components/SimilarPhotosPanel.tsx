import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '@nanocloud/api-client';
import { getSimilarPhotos, type SimilarPhotoItem } from '@nanocloud/api-client';
import { useAuth } from '../auth/useAuth';
import { smallThumbnailUrl } from './files/types';
import { useI18n } from '../i18n';

// Owner-private "Similar Photos" section for the image viewer's details drawer.
// It only renders for the owner's own image (the gallery viewer is owner-scoped
// and image-only; there is no public-share viewer in the frontend). It is a
// collapsible section that fetches ON EXPAND (never per grid card, never just by
// opening the drawer) — mirroring the Duplicates panel. It calls the existing
// sanitized endpoint GET /api/files/{id}/similar and shows small thumbnails +
// names. It never surfaces model/profile internals, scores, raw vectors, or any
// storage identifier.

interface SimilarPhotosPanelProps {
  fileId: string;
  // Open/navigate to a similar photo (the gallery jumps the viewer to it when
  // the file is in the loaded set).
  onSelect: (fileItemId: string) => void;
  limit?: number;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error' }
  // Nothing to show: no usable active profile / this photo not indexed yet
  // (indexing=true → friendly "being built" copy), or simply no neighbours.
  | { kind: 'empty'; indexing: boolean }
  | { kind: 'ready'; items: SimilarPhotoItem[] };

export function SimilarPhotosPanel({ fileId, onSelect, limit = 12 }: SimilarPhotosPanelProps) {
  const { invalidateAuth } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function load() {
    setOpen(true);
    // Already loaded successfully → keep the result; only (re)fetch from idle/error.
    if (status.kind !== 'idle' && status.kind !== 'error') return;
    setStatus({ kind: 'loading' });
    try {
      const result = await getSimilarPhotos(fileId, limit);
      if (!result.profileAvailable || !result.queryIndexed) {
        setStatus({ kind: 'empty', indexing: true });
      } else if (result.items.length === 0) {
        setStatus({ kind: 'empty', indexing: false });
      } else {
        setStatus({ kind: 'ready', items: result.items });
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        invalidateAuth();
        return;
      }
      setStatus({ kind: 'error' });
    }
  }

  return (
    <section className="lightbox-metadata similar-photos" aria-label={t('similarPanel.aria')}>
      <button
        type="button"
        className="row-action"
        data-testid="show-similar-btn"
        onClick={() => (open ? setOpen(false) : void load())}
        style={{ width: '100%', justifyContent: 'flex-start' }}
      >
        {open ? '▾' : '▸'} {t('similarPanel.toggle')}
      </button>

      {open && (
        <div style={{ marginTop: '0.5rem' }}>
          <button
            type="button"
            className="row-action"
            data-testid="explore-similar-btn"
            onClick={() => navigate(`/gallery/files/${fileId}/similar`)}
            style={{ width: '100%', justifyContent: 'flex-start', marginBottom: '0.5rem' }}
          >
            {t('similarPanel.explore')}
          </button>
          {/* Bring the similar set into the main Gallery so it shares the same
              selection + bulk-action model (add-to-album, etc.). */}
          <button
            type="button"
            className="row-action"
            data-testid="open-similar-in-gallery-btn"
            onClick={() => navigate(`/gallery?similarTo=${encodeURIComponent(fileId)}`)}
            style={{ width: '100%', justifyContent: 'flex-start', marginBottom: '0.5rem' }}
          >
            {t('similar.openInGallery')}
          </button>
          {status.kind === 'loading' && (
            <p className="muted" role="status">{t('similar.finding')}</p>
          )}
          {status.kind === 'error' && (
            <p className="muted" role="alert">{t('similar.loadError')}</p>
          )}
          {status.kind === 'empty' && (
            <p className="muted">{status.indexing ? t('similarPanel.indexing') : t('similarPanel.none')}</p>
          )}
          {status.kind === 'ready' && (
            <ul className="similar-photos-grid">
              {status.items.map((item) => (
                <li key={item.fileItemId}>
                  <button
                    type="button"
                    className="similar-photos-item"
                    title={item.name}
                    onClick={() => onSelect(item.fileItemId)}
                  >
                    <img
                      className="similar-photos-thumb"
                      src={smallThumbnailUrl(item.fileItemId)}
                      alt={item.name}
                      loading="lazy"
                      draggable={false}
                    />
                    <span className="similar-photos-name">{item.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
