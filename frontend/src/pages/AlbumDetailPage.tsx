import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ApiError,
  getAlbum,
  getAlbumPartySettings,
  type AlbumDetail,
  type AlbumPartyStatus,
} from '@nanocloud/api-client';
import { useAuth } from '../auth/useAuth';
import { useI18n } from '../i18n';
import { AlbumSettingsPanel } from '../albums/AlbumSettingsPanel';
import { MediaWorkspace } from '../media/workspace/MediaWorkspace';
import {
  filtersToUrlParams,
  identityFromUrlParams,
  type MediaWorkspaceIdentity,
  type MediaWorkspaceSource,
} from '../media/workspace/mediaWorkspaceQuery';

// Slice 5: the album detail is now a MediaWorkspace (source=album) — the same
// Tutti/Foto/Video + In libreria/Esclusi + filters/grid/viewer/selection the
// library uses — with the album's rename/description/TV/Party/delete controls
// relocated into AlbumSettingsPanel. Albums stay mixed (no photo/video split).

type HeaderStatus =
  | { kind: 'loading' }
  | { kind: 'ready'; album: AlbumDetail; party: AlbumPartyStatus | null }
  | { kind: 'error'; message: string };

export function AlbumDetailPage() {
  const { albumId } = useParams<{ albumId: string }>();
  const navigate = useNavigate();
  const { state, invalidateAuth } = useAuth();
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<HeaderStatus>({ kind: 'loading' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const source = useMemo<MediaWorkspaceSource>(
    () => ({ kind: 'album', albumId: albumId ?? '' }),
    [albumId],
  );

  // `identity` is owned in state (source of truth), seeded ONCE from the URL.
  // Only the shareable subset is mirrored back to the URL, so session-only
  // filters (visual/GPS/dates/favorite/rating/collapse — kept out of the URL)
  // survive an Apply instead of being wiped by a URL round-trip.
  const initialParamsRef = useRef(searchParams);
  const [identity, setIdentity] = useState<MediaWorkspaceIdentity>(
    () => identityFromUrlParams(source, initialParamsRef.current),
  );

  useEffect(() => {
    if (!albumId) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStatus({ kind: 'loading' });
    Promise.all([getAlbum(albumId, ctrl.signal), getAlbumPartySettings(albumId, ctrl.signal)])
      .then(([album, party]) => setStatus({ kind: 'ready', album, party }))
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return;
        if (err instanceof ApiError && err.status === 401) { invalidateAuth(); return; }
        if (err instanceof ApiError && err.status === 404) { void navigate('/albums'); return; }
        setStatus({ kind: 'error', message: t('albumDetail.loadError') });
      });
    return () => ctrl.abort();
  }, [albumId, invalidateAuth, navigate, t]);

  const onIdentityChange = useCallback((next: MediaWorkspaceIdentity) => {
    setIdentity(next);
    setSearchParams(filtersToUrlParams(next), { replace: true });
  }, [setSearchParams]);

  if (state.status !== 'authed' || !albumId) return null;
  if (status.kind === 'loading') return <div className="page-container"><p>{t('common.loading')}</p></div>;
  if (status.kind === 'error') {
    return (
      <div className="page-container">
        <p className="page-error" role="alert">{status.message}</p>
        <Link to="/albums">{t('albumDetail.backToAlbums')}</Link>
      </div>
    );
  }

  const { album, party } = status;

  return (
    <section className="ws-page-outer" data-testid="album-detail-page">
      <header className="ws-page-header album-detail-header">
        <Link to="/albums" className="back-link">{t('albumDetail.backToAlbums')}</Link>
        <div className="album-detail-title-row">
          <div>
            <h1>{album.name}</h1>
            {album.description && <p className="album-description">{album.description}</p>}
          </div>
          <button
            type="button"
            ref={settingsButtonRef}
            className="row-action"
            data-testid="album-open-settings"
            onClick={() => setSettingsOpen(true)}
          >
            {t('mediaWs.albumSettings')}
          </button>
        </div>
      </header>

      <MediaWorkspace
        source={source}
        identity={identity}
        onIdentityChange={onIdentityChange}
        searchPlaceholder={t('mediaWs.searchAlbum')}
      />

      {settingsOpen && (
        <AlbumSettingsPanel
          albumId={albumId}
          album={album}
          party={party}
          onAlbumUpdated={(updated) => setStatus({ kind: 'ready', album: updated, party })}
          onPartyUpdated={(updatedParty) => setStatus({ kind: 'ready', album, party: updatedParty })}
          onDeleted={() => navigate('/albums')}
          onClose={() => setSettingsOpen(false)}
          returnFocusRef={settingsButtonRef}
        />
      )}
    </section>
  );
}
