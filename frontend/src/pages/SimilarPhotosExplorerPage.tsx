import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import {
  addAestheticLabFromGallery,
  addPlateImagesFromGallery,
  ApiError,
  getFileMetadata,
  getSimilarPhotosPage,
  type SimilarPhotoItem,
} from '@nanocloud/api-client';
import { useAuth } from '../auth/useAuth';
import { smallThumbnailUrl } from '../components/files/types';
import { useI18n, type MessageKey } from '../i18n';
import { useMediaSelection } from '../gallery/useMediaSelection';
import { MediaSelectionBar } from '../gallery/workspace/MediaSelectionBar';
import type { GalleryDestinationAction } from '../gallery/workspace/DestinationMenu';
import { moveFilesToTrash } from '../gallery/workspace/bulkTrash';
import { AlbumPickerModal } from '../gallery/AlbumPickerModal';
import { TrashConfirmation } from '../gallery/workspace/TrashConfirmation';

// Similar Photos Explorer — a dedicated, owner-private page that lists all
// photos similar to a source image above a manually chosen similarity
// threshold, with keyset "load more" pagination. Results share the SAME
// selection + bulk-action model as the Gallery (useMediaSelection +
// MediaSelectionBar): checkbox / Ctrl-/Shift-click to select, then add to an
// album, add to a destination (Beauty Lab / Plates), or move to Trash. Grid uses
// SMALL thumbnails; the source header uses the MEDIUM preview; originals are
// never auto-loaded. No model / profile internals, raw vectors, distances, or
// storage ids are shown.

const PAGE_SIZE = 60;
const MIN_PCT = 50;
const MAX_PCT = 95;
const DEFAULT_PCT = 75;
const DEBOUNCE_MS = 400;

const PRESETS: ReadonlyArray<{ labelKey: MessageKey; pct: number }> = [
  { labelKey: 'similar.presetStrict', pct: 85 },
  { labelKey: 'similar.presetBalanced', pct: 75 },
  { labelKey: 'similar.presetBroad', pct: 65 },
];

// Medium preview for the source header (never the original full-res).
function mediumPreviewUrl(fileId: string): string {
  return `/api/files/${fileId}/preview`;
}

function clampPct(value: number): number {
  if (Number.isNaN(value)) return DEFAULT_PCT;
  return Math.min(MAX_PCT, Math.max(MIN_PCT, Math.round(value)));
}

// Read the threshold from the URL (?minSimilarity=0.75, a 0..1 fraction).
function pctFromParams(params: URLSearchParams): number {
  const raw = params.get('minSimilarity');
  if (raw === null) return DEFAULT_PCT;
  const fraction = Number.parseFloat(raw);
  return Number.isFinite(fraction) ? clampPct(fraction * 100) : DEFAULT_PCT;
}

type Phase = 'loading' | 'ready' | 'empty' | 'indexing' | 'notfound' | 'error';

export function SimilarPhotosExplorerPage() {
  const { fileId } = useParams<{ fileId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { invalidateAuth } = useAuth();
  const { t, tn } = useI18n();

  // `pct` drives the controls (50–95); `debouncedPct` drives the fetch.
  const [pct, setPct] = useState(() => pctFromParams(searchParams));
  const [debouncedPct, setDebouncedPct] = useState(pct);

  const [sourceName, setSourceName] = useState<string | null>(null);
  const [items, setItems] = useState<SimilarPhotoItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);

  // Shared media selection + bulk-action state (identical model to the Gallery).
  const selection = useMediaSelection();
  const [actionBusy, setActionBusy] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashBusy, setTrashBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Visible ids in display order — the range anchor for Shift-select.
  const orderedIds = useMemo(() => items.map((it) => it.fileItemId), [items]);

  const minSimilarity = debouncedPct / 100;

  // Debounce the slider/input so dragging doesn't spam the API.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedPct(pct), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [pct]);

  // Keep the threshold in the URL (shareable/bookmarkable within the app).
  useEffect(() => {
    const fraction = (debouncedPct / 100).toFixed(2);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('minSimilarity', fraction);
        return next;
      },
      { replace: true },
    );
  }, [debouncedPct, setSearchParams]);

  // Load the source photo's display name (also an ownership guard: 404 for a
  // foreign/missing file).
  useEffect(() => {
    if (fileId === undefined) return;
    const controller = new AbortController();
    setSourceName(null);
    getFileMetadata(fileId, controller.signal)
      .then((m) => setSourceName(m.name))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          invalidateAuth();
        } else if (err instanceof ApiError && err.status === 404) {
          setPhase('notfound');
        }
      });
    return () => controller.abort();
  }, [fileId, invalidateAuth]);

  // (Re)load the first page whenever the source or threshold changes.
  useEffect(() => {
    if (fileId === undefined) return;
    const controller = new AbortController();
    setPhase('loading');
    setItems([]);
    setCursor(null);
    setHasMore(false);
    setMoreError(false);
    setNotice(null);
    selection.clear(); // a new source/threshold invalidates any stale selection
    (async () => {
      try {
        const page = await getSimilarPhotosPage(
          fileId,
          { minSimilarity, limit: PAGE_SIZE },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (!page.profileAvailable || !page.queryIndexed) {
          setPhase('indexing');
          return;
        }
        setItems(page.items);
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
        setPhase(page.items.length === 0 ? 'empty' : 'ready');
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) {
          invalidateAuth();
          return;
        }
        if (err instanceof ApiError && err.status === 404) {
          setPhase('notfound');
          return;
        }
        setPhase('error');
      }
    })();
    return () => controller.abort();
  }, [fileId, minSimilarity, invalidateAuth, selection.clear]);

  async function loadMore() {
    if (fileId === undefined || !hasMore || cursor === null || loadingMore) return;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const page = await getSimilarPhotosPage(fileId, {
        minSimilarity,
        limit: PAGE_SIZE,
        cursor,
      });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        invalidateAuth();
        return;
      }
      setMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  // ---- Bulk actions on the selection (same handlers as the Gallery) --------

  const runDestination = useCallback(
    async (
      execute: (ids: string[]) => Promise<{ added: unknown[]; skipped: unknown[] }>,
      noticeKey: 'aesthetics' | 'plates',
    ) => {
      const ids = [...selection.selected];
      if (ids.length === 0) return;
      setActionBusy(true);
      setNotice(null);
      try {
        const result = await execute(ids);
        if (noticeKey === 'aesthetics') {
          setNotice(
            t('aesthetics.addedFromGallery', { added: result.added.length, skipped: result.skipped.length }),
          );
        } else {
          const base = result.added.length === 1
            ? t('gallery.ws.plates.added_one', { count: 1 })
            : t('gallery.ws.plates.added_other', { count: result.added.length });
          const extra = result.skipped.length > 0
            ? t('gallery.ws.plates.skipped', { count: result.skipped.length })
            : '';
          setNotice(base + extra);
        }
        selection.clear();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          invalidateAuth();
          return;
        }
        setNotice(noticeKey === 'aesthetics' ? t('aesthetics.addError') : t('gallery.ws.plates.error'));
      } finally {
        setActionBusy(false);
      }
    },
    [selection, t, invalidateAuth],
  );

  const destinations = useMemo<GalleryDestinationAction[]>(
    () => [
      {
        id: 'beauty-lab',
        label: t('gallerySel.addToAestheticsLab'),
        isAvailable: true,
        run: () => void runDestination((ids) => addAestheticLabFromGallery(ids), 'aesthetics'),
      },
      {
        id: 'plates',
        label: t('gallery.ws.destPlates'),
        isAvailable: true,
        run: () => void runDestination((ids) => addPlateImagesFromGallery(ids), 'plates'),
      },
    ],
    [t, runDestination],
  );

  async function confirmTrash() {
    const ids = [...selection.selected];
    if (ids.length === 0) {
      setTrashOpen(false);
      return;
    }
    setTrashBusy(true);
    const result = await moveFilesToTrash(ids, { onAuthError: invalidateAuth });
    const movedSet = new Set(result.moved);
    // Trashed items disappear from the results in place; failed ids stay selected
    // for retry (mirrors the Gallery's confirmTrash).
    setItems((prev) => prev.filter((it) => !movedSet.has(it.fileItemId)));
    selection.selectAll(result.failed);
    const done = result.moved.length === 1
      ? t('gallery.ws.trash.done_one', { count: 1 })
      : t('gallery.ws.trash.done_other', { count: result.moved.length });
    const failedNote = result.failed.length > 0
      ? t('gallery.ws.trash.failed', { count: result.failed.length })
      : '';
    setNotice(done + failedNote);
    setTrashBusy(false);
    setTrashOpen(false);
  }

  // Re-root the explorer on a clicked result (keeps the chosen threshold).
  function openResult(id: string) {
    navigate(`/gallery/files/${id}/similar?minSimilarity=${minSimilarity.toFixed(2)}`);
  }

  const skeletons = useMemo(
    () => Array.from({ length: 12 }, (_, i) => i),
    [],
  );
  const liveRef = useRef<HTMLParagraphElement>(null);

  return (
    <section className="similar-explorer">
      <header className="similar-explorer-header">
        <button
          type="button"
          className="row-action"
          onClick={() => navigate('/gallery')}
        >
          {t('similar.backToGallery')}
        </button>
        {fileId !== undefined && (
          // Open the same similar set in the main Gallery so it shares the
          // gallery's selection + bulk-action model (add-to-album, etc.).
          <button
            type="button"
            className="row-action-primary"
            data-testid="open-similar-in-gallery"
            onClick={() => navigate(`/gallery?similarTo=${encodeURIComponent(fileId)}`)}
          >
            {t('similar.openInGallery')}
          </button>
        )}
      </header>

      {phase === 'notfound' ? (
        <p className="muted" role="alert">
          {t('similar.notAvailable')}
        </p>
      ) : (
        <>
          {/* Source photo context — stays visible above the results. */}
          {fileId !== undefined && (
            <div className="similar-explorer-source">
              <div className="similar-explorer-source-thumb">
                <img
                  src={mediumPreviewUrl(fileId)}
                  alt={sourceName ?? t('similar.sourceAlt')}
                  draggable={false}
                />
              </div>
              <div className="similar-explorer-source-meta">
                <span className="similar-explorer-eyebrow">{t('similar.eyebrow')}</span>
                <h1 className="similar-explorer-title" title={sourceName ?? undefined}>
                  {sourceName ?? t('similar.photoFallback')}
                </h1>
              </div>
            </div>
          )}

          {/* Threshold filter bar (sticky on desktop). */}
          <div className="similar-explorer-filter">
            <div className="similar-explorer-filter-row">
              <label htmlFor="minsim-slider" className="similar-explorer-filter-label">
                {t('similar.minSimilarity')}
              </label>
              <div className="similar-explorer-value">{pct}%</div>
            </div>
            <input
              id="minsim-slider"
              type="range"
              min={MIN_PCT}
              max={MAX_PCT}
              step={1}
              value={pct}
              onChange={(e) => setPct(clampPct(Number(e.target.value)))}
              className="similar-explorer-slider"
              aria-label={t('similar.minSimilarityAria')}
            />
            <div className="similar-explorer-controls">
              <div className="similar-explorer-presets" role="group" aria-label={t('similar.presetsGroup')}>
                {PRESETS.map((p) => (
                  <button
                    key={p.labelKey}
                    type="button"
                    className={
                      pct === p.pct
                        ? 'similar-explorer-preset is-active'
                        : 'similar-explorer-preset'
                    }
                    onClick={() => setPct(p.pct)}
                  >
                    {t(p.labelKey)} · {p.pct}%
                  </button>
                ))}
              </div>
              <label className="similar-explorer-number">
                <span className="visually-hidden">{t('similar.minSimilarityAria')}</span>
                <input
                  type="number"
                  min={MIN_PCT}
                  max={MAX_PCT}
                  step={1}
                  value={pct}
                  onChange={(e) => setPct(clampPct(Number(e.target.value)))}
                  aria-label={t('similar.minSimilarityNumericAria')}
                />
                <span aria-hidden="true">%</span>
              </label>
            </div>
            <p className="muted similar-explorer-help">
              {t('similar.help')}
            </p>
          </div>

          {/* Result count / status. */}
          <p className="muted similar-explorer-status" role="status" ref={liveRef}>
            {phase === 'ready'
              ? tn(items.length, 'similar.countStatus', { plus: hasMore ? '+' : '', pct })
              : phase === 'loading'
                ? t('similar.finding')
                : ''}
          </p>

          {phase === 'loading' && (
            <ul className="gallery-grid" aria-hidden="true">
              {skeletons.map((i) => (
                <li key={i} className="gallery-card">
                  <div className="gallery-thumb-wrap similar-explorer-skeleton" />
                </li>
              ))}
            </ul>
          )}

          {phase === 'error' && (
            <div className="folder-error" role="alert">
              {t('similar.loadError')}
              <button
                type="button"
                className="retry-button"
                onClick={() => setDebouncedPct((v) => v)}
              >
                {t('common.tryAgain')}
              </button>
            </div>
          )}

          {phase === 'indexing' && (
            <p className="muted">
              {t('similar.indexing')}
            </p>
          )}

          {phase === 'empty' && (
            <div className="similar-explorer-empty">
              <p className="muted">{t('similar.emptyTitle')}</p>
              <p className="muted">{t('similar.emptyHint')}</p>
            </div>
          )}

          {phase === 'ready' && (
            <>
              <ul className="gallery-grid">
                {items.map((item, index) => {
                  const selected = selection.isSelected(item.fileItemId);
                  return (
                    <li
                      key={item.fileItemId}
                      className={`gallery-card${selected ? ' is-selected' : ''}`}
                      data-selected={selected}
                    >
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={selected}
                        className={`gallery-select-control${selected ? ' is-selected' : ''}`}
                        aria-label={t(
                          selected ? 'gallerySel.deselectAria' : 'gallerySel.selectAria',
                          { name: item.name },
                        )}
                        data-testid="gallery-select-control"
                        onClick={(e) =>
                          selection.toggleViaControl(item.fileItemId, index, orderedIds, e.shiftKey)
                        }
                      >
                        <span aria-hidden="true">{selected ? '✓' : ''}</span>
                      </button>
                      <button
                        type="button"
                        className="gallery-thumb-button"
                        title={item.name}
                        onClick={(e) => {
                          const result = selection.handleTileClick(
                            item.fileItemId,
                            index,
                            orderedIds,
                            { ctrlOrMeta: e.ctrlKey || e.metaKey, shift: e.shiftKey },
                          );
                          if (result === 'open') openResult(item.fileItemId);
                        }}
                      >
                        <span className="gallery-thumb-wrap">
                          <img
                            className="gallery-thumb"
                            src={smallThumbnailUrl(item.fileItemId)}
                            alt={item.name}
                            loading="lazy"
                            draggable={false}
                          />
                          <span className="similar-explorer-badge">
                            {Math.round(item.score * 100)}%
                          </span>
                        </span>
                      </button>
                      <div className="gallery-meta">
                        <span className="gallery-name">{item.name}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="gallery-scroll-footer">
                {hasMore && (
                  <button
                    type="button"
                    className="row-action-primary"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                  >
                    {loadingMore ? t('common.loading') : t('common.loadMore')}
                  </button>
                )}
                {moreError && (
                  <p className="muted" role="alert">
                    {t('similar.loadMoreError')}
                  </p>
                )}
                {!hasMore && (
                  <p className="muted gallery-scroll-end">
                    {t('similar.endOfResults')}
                  </p>
                )}
              </div>
            </>
          )}
        </>
      )}

      <MediaSelectionBar
        count={selection.count}
        busy={actionBusy || trashBusy}
        destinations={destinations}
        onAddToAlbum={() => setPickerOpen(true)}
        onMoveToTrash={() => setTrashOpen(true)}
        onClear={selection.clear}
      />

      {notice && (
        <div className="gallery-notice" role="status">
          {notice}
        </div>
      )}

      {trashOpen && (
        <TrashConfirmation
          count={selection.count}
          busy={trashBusy}
          onConfirm={confirmTrash}
          onCancel={() => setTrashOpen(false)}
        />
      )}

      {pickerOpen && (
        <AlbumPickerModal
          fileItemIds={[...selection.selected]}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </section>
  );
}
