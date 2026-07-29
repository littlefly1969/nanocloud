import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { getFileMetadata, type FileMetadata } from '@nanocloud/api-client';
import { formatSize } from './format';
import { useI18n } from '../i18n';
import { HlsVideoPlayer } from '../video/HlsVideoPlayer';

// Slice 86: a reusable, clean full-screen media viewer for images and videos.
// The media is centered on a dark backdrop with minimal chrome that auto-hides
// when idle; metadata lives in an on-demand drawer so it never clutters the
// full-screen surface. Keyboard + swipe navigation; dialog semantics.
//
// Media URLs reuse the existing endpoints:
//   image → GET /api/files/{id}/preview  (medium; never the original)
//   video → GET /api/files/{id}/video    (Range-enabled) + /poster
// Metadata is fetched lazily, only when the drawer is open (and re-fetched when
// the current item changes while open) — never per-item during scrolling.

export interface MediaViewerItem {
  id: string;
  // Original file name — kept for the download link and diagnostics.
  name: string;
  // What the chrome shows: the owner's title when set, else the file name.
  // Callers pass the DTO's displayName so a title edit is reflected here as
  // soon as the gallery patches its item.
  displayName: string;
  kind: 'image' | 'video';
  // VSEM-03: open this video at a semantic match (whole ms). Absent/null =
  // normal playback from the start; the player clamps and applies it once.
  initialPositionMilliseconds?: number | null;
}

interface MediaViewerProps {
  items: MediaViewerItem[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  // Called when navigating near the end of the loaded items so the caller can
  // prefetch the next cursor page (preserves infinite-scroll behaviour).
  onNearEnd?: () => void;
  // Optional drawer body. When provided, the on-demand details drawer renders
  // this (per current item) instead of the default minimal metadata view —
  // the image gallery uses it to inject its full metadata panel + actions
  // (edit / strip / write-DateTaken / privacy-safe download / add-to-album)
  // and the duplicate-occurrences panel. The drawer shell (header, close,
  // dialog placement) stays owned by the viewer so the chrome is consistent.
  renderDetails?: (item: MediaViewerItem) => ReactNode;
}

const IDLE_HIDE_MS = 2600;

export function MediaViewer({ items, index, onClose, onIndexChange, onNearEnd, renderDetails }: MediaViewerProps) {
  const { t } = useI18n();
  const item = items[index];
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  const [chromeVisible, setChromeVisible] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Per-image "preview failed to load" flag; reset whenever we navigate.
  const [imageFailed, setImageFailed] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setImageFailed(false); }, [index]);

  const showChrome = useCallback(() => {
    setChromeVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setChromeVisible(false), IDLE_HIDE_MS);
  }, []);

  useEffect(() => {
    showChrome();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [showChrome, index]);

  // Prefetch trigger when nearing the end of loaded items.
  useEffect(() => {
    if (onNearEnd && index >= items.length - 2) onNearEnd();
  }, [index, items.length, onNearEnd]);

  const goPrev = useCallback(() => { if (hasPrev) onIndexChange(index - 1); }, [hasPrev, index, onIndexChange]);
  const goNext = useCallback(() => { if (hasNext) onIndexChange(index + 1); }, [hasNext, index, onIndexChange]);

  // Keyboard: Escape closes, arrows navigate.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowLeft') { goPrev(); showChrome(); }
      else if (e.key === 'ArrowRight') { goNext(); showChrome(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, goPrev, goNext, showChrome]);

  // Touch swipe left/right to navigate.
  const touchStartX = useRef<number | null>(null);
  function onTouchStart(e: React.TouchEvent) { touchStartX.current = e.touches[0]?.clientX ?? null; }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? start) - start;
    if (Math.abs(dx) > 50) { if (dx > 0) goPrev(); else goNext(); showChrome(); }
  }

  if (!item) return null;

  return (
    <div
      className="media-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={t('mediaViewer.viewerAria', { name: item.displayName })}
      onMouseMove={showChrome}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Backdrop: clicking it (not the media) toggles chrome. */}
      <button
        type="button"
        className="media-viewer-backdrop"
        aria-label={t('mediaViewer.toggleControls')}
        tabIndex={-1}
        onClick={() => setChromeVisible((v) => !v)}
      />

      <div className="media-viewer-stage">
        {item.kind === 'image' ? (
          imageFailed ? (
            <div className="media-viewer-error" role="alert">
              {t('mediaViewer.imageError')}
            </div>
          ) : (
            <img
              className="media-viewer-media"
              src={`/api/files/${item.id}/preview`}
              alt={item.displayName}
              draggable={false}
              onError={() => setImageFailed(true)}
            />
          )
        ) : (
          // Video-hls slice 3: the player probes the /video contract (adaptive
          // HLS master / 202-preparing / legacy byte stream) and renders the
          // right element — poster + status while the ladder is prepared.
          // VSEM-03: a semantic result additionally hands off its matched
          // timestamp; without one this is byte-for-byte the previous call.
          <HlsVideoPlayer
            key={item.id}
            fileId={item.id}
            className="media-viewer-media"
            initialPositionMilliseconds={item.initialPositionMilliseconds ?? null}
          />
        )}
      </div>

      <div className={`media-viewer-chrome${chromeVisible ? '' : ' is-hidden'}`}>
        <div className="media-viewer-topbar">
          <span className="media-viewer-title" title={item.name} data-testid="media-viewer-title">
            {item.displayName}
          </span>
          <div className="media-viewer-actions">
            <button type="button" aria-label={t('mediaViewer.details')} aria-pressed={detailsOpen}
              onClick={() => setDetailsOpen((v) => !v)}>ⓘ</button>
            <button type="button" aria-label={t('common.close')} onClick={onClose}>✕</button>
          </div>
        </div>
        <button type="button" className="media-viewer-nav media-viewer-prev"
          aria-label={t('mediaViewer.previous')} disabled={!hasPrev} onClick={goPrev}>‹</button>
        <button type="button" className="media-viewer-nav media-viewer-next"
          aria-label={t('mediaViewer.next')} disabled={!hasNext} onClick={goNext}>›</button>
      </div>

      {detailsOpen && (
        <aside className="media-viewer-drawer" aria-label={t('mediaViewer.details')}>
          <div className="media-viewer-drawer-head">
            <h3>{t('mediaViewer.details')}</h3>
            <button type="button" aria-label={t('mediaViewer.closeDetails')} onClick={() => setDetailsOpen(false)}>✕</button>
          </div>
          {renderDetails ? renderDetails(item) : <DefaultMediaDetails item={item} />}
        </aside>
      )}
    </div>
  );
}

// Default lazy metadata body for the details drawer. Fetches
// GET /api/files/{id}/metadata when opened and whenever the item changes while
// open — never for every gallery card. Used when the caller does not supply a
// richer `renderDetails` (e.g. the video gallery).
// Formats a fractional-seconds duration as H:MM:SS (or M:SS under an hour).
function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

function DefaultMediaDetails({ item }: { item: MediaViewerItem }) {
  const { t, tn, formatDate } = useI18n();
  const [meta, setMeta] = useState<FileMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setMeta(null);
    setError(null);
    getFileMetadata(item.id, controller.signal)
      .then(setMeta)
      .catch((e) => { if (!(e instanceof DOMException && e.name === 'AbortError')) setError(t('mediaViewer.detailsLoadError')); });
    return () => controller.abort();
  }, [item.id, t]);

  return (
    <>
      {error && <p className="folder-error" role="alert">{error}</p>}
      {!meta && !error && <p role="status">{t('common.loading')}</p>}
      {meta && (
        <dl className="media-viewer-meta">
          <dt>{t('common.name')}</dt><dd>{meta.effective.displayName}</dd>
          {/* The original file name stays visible even when a title replaces
              it everywhere else — it is what the download actually produces. */}
          {meta.user.title && (
            <><dt>{t('mediaMeta.fileName')}</dt><dd>{meta.name}</dd></>
          )}
          <dt>{t('common.size')}</dt><dd>{formatSize(meta.sizeBytes)}</dd>
          {meta.blob.width && meta.blob.height && (
            <><dt>{t('gallery.mdDimensions')}</dt><dd>{meta.blob.width} × {meta.blob.height}</dd></>
          )}
          <dt>{t('common.type')}</dt><dd>{meta.blob.detectedContentType ?? meta.mimeType}</dd>
          <dt>{t('common.date')}</dt><dd>{formatDate(meta.effective.dateTaken)}</dd>
          {meta.effective.location && (
            <><dt>{t('gallery.mdLocation')}</dt><dd>{meta.effective.location}</dd></>
          )}
          {meta.blob.embedded?.hasGps && (
            // Privacy: coordinates are intentionally never exposed; we only
            // report that embedded GPS data is present.
            <><dt>{t('gallery.gps')}</dt><dd>{t('mediaViewer.gpsPresent')}</dd></>
          )}
          {meta.blob.video && (
            <>
              {meta.blob.video.durationSeconds != null && (
                <><dt>{t('gallery.mdDuration')}</dt>
                  <dd>{formatDuration(meta.blob.video.durationSeconds)}</dd></>
              )}
              {meta.blob.video.videoCodec && (
                <><dt>{t('gallery.mdVideoCodec')}</dt><dd>{meta.blob.video.videoCodec}</dd></>
              )}
              {meta.blob.video.frameRate != null && (
                <><dt>{t('gallery.mdFrameRate')}</dt>
                  <dd>{t('gallery.mdFps', { value: meta.blob.video.frameRate.toFixed(2) })}</dd></>
              )}
              {meta.blob.video.videoBitrate != null && (
                <><dt>{t('gallery.mdBitrate')}</dt>
                  <dd>{t('gallery.mdMbps', { value: (meta.blob.video.videoBitrate / 1_000_000).toFixed(1) })}</dd></>
              )}
              <dt>{t('gallery.mdAudio')}</dt>
              <dd>{meta.blob.video.hasAudio
                ? [meta.blob.video.audioCodec,
                   meta.blob.video.audioChannels != null
                     ? tn(meta.blob.video.audioChannels, 'gallery.mdAudioChannels')
                     : null]
                    .filter(Boolean).join(' · ') || t('mediaViewer.audioPresent')
                : t('mediaViewer.noAudio')}</dd>
              {meta.blob.video.rotation != null && meta.blob.video.rotation !== 0 && (
                <><dt>{t('gallery.mdRotation')}</dt><dd>{meta.blob.video.rotation}°</dd></>
              )}
            </>
          )}
        </dl>
      )}
      <a className="media-viewer-download" href={`/api/files/${item.id}/content`}>{t('common.download')}</a>
    </>
  );
}
