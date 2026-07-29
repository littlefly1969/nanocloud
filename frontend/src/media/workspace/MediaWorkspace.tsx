import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  bulkRemoveAlbumItems,
  restoreToMediaLibrary,
  type FileMetadata,
  type ImageSortDirection,
  type ImageSortField,
} from '@nanocloud/api-client';
import { useAuth } from '../../auth/useAuth';
import { useI18n } from '../../i18n';
import { useMediaWallLayout } from '../../components/mediaWallLayout';
import { MediaViewer, type MediaViewerItem } from '../../components/MediaViewer';
import { SimilarPhotosPanel } from '../../components/SimilarPhotosPanel';
import { MediaMetadataPanel } from '../metadata/MediaMetadataPanel';
import { AlbumPickerModal } from '../../gallery/AlbumPickerModal';
import { MoveToPersonalDialog } from '../actions/MoveToPersonalDialog';
import { useMoveToPersonal } from '../actions/useMoveToPersonal';
import { MoveToExcludedDialog } from '../actions/MoveToExcludedDialog';
import { useMoveToExcluded } from '../actions/useMoveToExcluded';
import { usePeopleIndex } from '../../gallery/workspace/usePeopleIndex';
import { TrashConfirmation } from '../../gallery/workspace/TrashConfirmation';
import { moveFilesToTrash } from '../../gallery/workspace/bulkTrash';
import type { GalleryDestinationAction } from '../../gallery/workspace/DestinationMenu';

// A photo-only bulk destination (Beauty Lab, Plates, …). `run` receives the
// selected ids; the shell binds the live selection so the page never has to
// reach inside the workspace.
export interface MediaPhotoDestination {
  id: string;
  label: string;
  // Returns an optional already-localized notice to surface on success.
  run(ids: string[]): Promise<string | void> | string | void;
}
import { useMediaWorkspace } from './useMediaWorkspace';
import { MediaKindTabs } from './MediaKindTabs';
import { MediaLibraryScopeTabs } from './MediaLibraryScopeTabs';
import { MediaFilterChips } from './MediaFilterChips';
import { MediaFilterSheet } from './MediaFilterSheet';
import { MediaGrid } from './MediaGrid';
import { MediaWorkspaceSelectionBar } from './MediaWorkspaceSelectionBar';
import { getMediaSelectionCapabilities } from './mediaSelectionCapabilities';
import {
  clearActiveFilters,
  clearChip,
  isSemanticActive,
  type FilterChipKind,
  type MediaKindScope,
  type MediaLibraryScope,
  type MediaWorkspaceFilters,
  type MediaWorkspaceIdentity,
  type MediaWorkspaceSource,
} from './mediaWorkspaceQuery';

const PANEL_ID = 'media-workspace-panel';
const SORT_FIELDS: ImageSortField[] = ['created', 'datetaken', 'name', 'size'];

interface Props {
  source: MediaWorkspaceSource;
  identity: MediaWorkspaceIdentity;
  onIdentityChange(next: MediaWorkspaceIdentity): void;
  searchPlaceholder: string;
  photoDestinations?: MediaPhotoDestination[];
  // Album-context callback so the page can refresh its header counts/cover after
  // a membership change. Ignored for the library source.
  onAlbumMembershipChanged?(): void;
}

export function MediaWorkspace({
  source,
  identity,
  onIdentityChange,
  searchPlaceholder,
  photoDestinations = [],
  onAlbumMembershipChanged,
}: Props) {
  const { t, tn } = useI18n();
  const { invalidateAuth } = useAuth();
  const people = usePeopleIndex();
  // Render inside the full-width media shell (no-op outside the app Layout).
  useMediaWallLayout();

  const ws = useMediaWorkspace({
    source,
    identity,
    onAuthError: invalidateAuth,
    translate: {
      loadError: t('mediaWs.loadError'),
      loadMoreError: t('mediaWs.loadError'),
      semanticUnavailable: t('gallery.command.noticeUnavailable'),
      semanticIndexing: t('gallery.command.noticeIndexing'),
    },
  });
  const { selection, viewer } = ws;

  const [sheetOpen, setSheetOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [srMessage, setSrMessage] = useState('');
  const [searchText, setSearchText] = useState(identity.filters.common.metadataQuery);
  const filtersButtonRef = useRef<HTMLButtonElement>(null);

  const announce = useCallback((m: string) => setSrMessage(m), []);

  useEffect(() => { setSearchText(identity.filters.common.metadataQuery); }, [identity.filters.common.metadataQuery]);

  // ---- identity mutations (all flow to the URL via onIdentityChange) --------
  const mutate = useCallback((next: MediaWorkspaceIdentity) => onIdentityChange(next), [onIdentityChange]);
  const changeKind = (mediaKind: MediaKindScope) => mutate({ ...identity, mediaKind });
  const changeScope = (libraryScope: MediaLibraryScope) => mutate({ ...identity, libraryScope });
  const applyFilters = (filters: MediaWorkspaceFilters) => { mutate({ ...identity, filters }); setSheetOpen(false); };
  const removeChip = (kind: FilterChipKind) => mutate({ ...identity, filters: clearChip(identity.filters, kind) });
  const clearAll = () => mutate({ ...identity, filters: clearActiveFilters(identity) });
  const changeSort = (sort: ImageSortField, direction: ImageSortDirection) => mutate({ ...identity, sort, direction });
  // Start a similar-image search from a real image (viewer action): pin the
  // photo tab, set the anchor, clear any visual query (the two are mutually
  // exclusive), close the viewer. Routing to /api/images happens in the hook.
  const applySimilar = (imageId: string) => {
    viewer.close();
    mutate({
      ...identity,
      mediaKind: 'image',
      filters: { ...identity.filters, photo: { ...identity.filters.photo, similarTo: imageId, visualQuery: '', semanticTopK: 0 } },
    });
  };
  const submitSearch = () => {
    if (searchText === identity.filters.common.metadataQuery) return;
    mutate({ ...identity, filters: { ...identity.filters, common: { ...identity.filters.common, metadataQuery: searchText } } });
  };

  // ---- bulk reconciliation --------------------------------------------------
  const pruneMoved = useCallback((ids: string[], message: string) => {
    ws.removeLoadedIds(ids);
    setNotice(message);
    announce(message);
  }, [ws, announce]);
  const reconcile = useCallback((message: string) => {
    ws.reconcileAfterPartialMutation();
    setNotice(message);
    announce(message);
  }, [ws, announce]);

  const moveToPersonal = useMoveToPersonal({
    onFullSuccess: (ids) => pruneMoved(ids, tn(ids.length, 'moveToPersonal.movedAll')),
    onPartialSuccess: ({ moved, total }) => reconcile(t('moveToPersonal.movedPartial', { moved, total })),
  });
  const moveToExcluded = useMoveToExcluded({
    onFullSuccess: (ids) => pruneMoved(ids, tn(ids.length, 'moveToExcluded.movedAll')),
    onPartialSuccess: ({ moved, total }) => reconcile(t('moveToExcluded.movedPartial', { moved, total })),
  });

  const restoreSelected = useCallback(async () => {
    const ids = [...selection.selected];
    if (ids.length === 0 || restoreBusy) return;
    setRestoreBusy(true);
    setNotice(null);
    try {
      const result = await restoreToMediaLibrary(ids);
      if (result.changed === ids.length) pruneMoved(ids, tn(ids.length, 'moveToExcluded.restoredAll'));
      else reconcile(t('moveToExcluded.restoredPartial', { moved: result.changed, total: ids.length }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { invalidateAuth(); return; }
      setNotice(t('moveToExcluded.restoreError'));
    } finally {
      setRestoreBusy(false);
    }
  }, [selection, restoreBusy, pruneMoved, reconcile, t, tn, invalidateAuth]);

  const removeFromAlbum = useCallback(async () => {
    if (source.kind !== 'album') return;
    const ids = [...selection.selected];
    if (ids.length === 0 || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await bulkRemoveAlbumItems(source.albumId, ids);
      if (result.succeeded === ids.length) pruneMoved(ids, tn(result.succeeded, 'mediaWs.removedFromAlbum'));
      else reconcile(tn(result.succeeded, 'mediaWs.removedFromAlbum'));
      onAlbumMembershipChanged?.();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { invalidateAuth(); return; }
      setNotice(t('mediaWs.removeFromAlbumError'));
    } finally {
      setBusy(false);
    }
  }, [source, selection, busy, pruneMoved, reconcile, tn, t, invalidateAuth, onAlbumMembershipChanged]);

  async function confirmTrash() {
    const ids = [...selection.selected];
    if (ids.length === 0) { setTrashOpen(false); return; }
    setBusy(true);
    const result = await moveFilesToTrash(ids, { onAuthError: invalidateAuth });
    ws.removeLoadedIds(result.moved);
    selection.selectAll(result.failed);
    const done = tn(result.moved.length, 'gallery.ws.trash.done');
    setNotice(done);
    announce(done);
    setBusy(false);
    setTrashOpen(false);
  }

  const onMetadataChanged = useCallback((fileId: string, metadata: FileMetadata) => {
    ws.patchItem(fileId, { title: metadata.user.title, displayName: metadata.effective.displayName });
  }, [ws]);

  // ---- keyboard: Escape clears selection; Ctrl/Cmd+A selects loaded ---------
  const anyOverlayOpen = viewer.isOpen || sheetOpen || trashOpen || pickerOpen || moveToPersonal.isOpen || moveToExcluded.isOpen;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !anyOverlayOpen && selection.count > 0) { selection.clear(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (anyOverlayOpen || ws.orderedIds.length === 0) return;
        e.preventDefault();
        selection.selectAll(ws.orderedIds);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [anyOverlayOpen, selection, ws.orderedIds]);

  // ---- infinite scroll sentinel --------------------------------------------
  const observerRef = useRef<IntersectionObserver | null>(null);
  // Latest intersection state of the sentinel. An IntersectionObserver only
  // fires on a TRANSITION, so when a load leaves the sentinel still inside the
  // (large) preload margin no further callback comes — this ref lets the effect
  // below keep loading until the sentinel is finally pushed out of the margin.
  const sentinelVisibleRef = useRef(false);
  const loadMoreRef = useRef(ws.loadMore);
  loadMoreRef.current = ws.loadMore;
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (node && typeof IntersectionObserver !== 'undefined') {
      const observer = new IntersectionObserver(
        // Fetch the next page well before the sentinel reaches the viewport so a
        // fast scroll rarely hits the end of the loaded set (was 600px).
        (entries) => {
          sentinelVisibleRef.current = entries.some((e) => e.isIntersecting);
          if (sentinelVisibleRef.current) loadMoreRef.current();
        },
        { rootMargin: '1400px 0px' },
      );
      observer.observe(node);
      observerRef.current = observer;
    }
  }, []);
  useEffect(() => () => observerRef.current?.disconnect(), []);

  // After each page settles, if the sentinel is STILL inside the preload margin
  // and there is more to load, fetch the next page. Without this the chain
  // stalls at the bottom (the observer gives no fresh callback while the
  // sentinel stays continuously intersecting) until the user scrolls up and back
  // down. The observer updates sentinelVisibleRef to false once enough rows
  // (or a scroll-up) push the sentinel out, which ends the chain.
  useEffect(() => {
    if (ws.phase.kind === 'ready' && ws.hasMore && sentinelVisibleRef.current) {
      loadMoreRef.current();
    }
  }, [ws.phase, ws.hasMore]);

  // VSEM-03: a video opened from a semantic result starts at its matched
  // timestamp; every other item keeps normal playback (undefined → start).
  const viewerItems = useMemo<MediaViewerItem[]>(
    () => ws.items.map((it) => ({
      id: it.id,
      name: it.name,
      displayName: it.displayName,
      kind: it.kind,
      initialPositionMilliseconds: it.kind === 'video'
        ? ws.semanticEvidence.get(it.id)?.bestMatch.representativeMilliseconds ?? null
        : null,
    })),
    [ws.items, ws.semanticEvidence],
  );

  // Representative timestamps for the grid badge (videos only).
  const semanticTimestamps = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const [id, evidence] of ws.semanticEvidence) {
      map.set(id, evidence.bestMatch.representativeMilliseconds);
    }
    return map;
  }, [ws.semanticEvidence]);

  const selectedItems = useMemo(
    () => ws.items.filter((it) => selection.isSelected(it.id)),
    [ws.items, selection],
  );
  // Bind the live selection to the page-supplied photo-only destinations so the
  // page never reaches inside the workspace's selection.
  const boundPhotoDestinations = useMemo<GalleryDestinationAction[]>(
    () => photoDestinations.map((d) => ({
      id: d.id,
      label: d.label,
      isAvailable: true,
      run: () => {
        const ids = [...selection.selected];
        if (ids.length === 0) return;
        void (async () => {
          const msg = await d.run(ids);
          if (typeof msg === 'string') { setNotice(msg); announce(msg); selection.clear(); }
        })();
      },
    })),
    [photoDestinations, selection, announce],
  );
  const capabilities = getMediaSelectionCapabilities({
    items: selectedItems,
    source: source.kind,
    scope: identity.libraryScope,
  });

  const semantic = isSemanticActive(identity);
  const isEmpty = ws.items.length === 0;
  const hasActiveText = identity.filters.common.metadataQuery.length > 0
    || identity.filters.photo.visualQuery.trim().length > 0;

  function emptyLabel(): string {
    if (hasActiveText) return t('mediaWs.noResults');
    if (identity.libraryScope === 'excluded') return t('mediaWs.emptyExcluded');
    if (identity.mediaKind === 'image') return t('mediaWs.emptyPhotos');
    if (identity.mediaKind === 'video') return t('mediaWs.emptyVideos');
    return t('mediaWs.empty');
  }

  return (
    <section className={`ws-page${selection.isSelectionActive ? ' has-bulk-bar' : ''}`} aria-busy={ws.loading}>
      <MediaKindTabs
        value={identity.mediaKind}
        onChange={changeKind}
        panelId={PANEL_ID}
        counts={ws.total !== null ? { all: ws.total, image: ws.photoCount ?? 0, video: ws.videoCount ?? 0 } : null}
      />

      <MediaLibraryScopeTabs value={identity.libraryScope} onChange={changeScope} />

      <div className="ws-toolbar">
        <form
          className="ws-search"
          onSubmit={(e) => { e.preventDefault(); submitSearch(); }}
          role="search"
        >
          <input
            type="search"
            aria-label={searchPlaceholder}
            placeholder={searchPlaceholder}
            data-testid="ws-search-input"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onBlur={submitSearch}
          />
        </form>
        <button
          type="button"
          ref={filtersButtonRef}
          className="row-action"
          data-testid="ws-open-filters"
          onClick={() => setSheetOpen(true)}
        >
          {t('mediaWs.filters')}
        </button>
        {!semantic && (
          <label className="ws-sort" data-testid="ws-sort">
            <span className="visually-hidden">{t('mediaSort.label')}</span>
            <select
              value={`${identity.sort}:${identity.direction}`}
              onChange={(e) => {
                const [s, d] = e.target.value.split(':') as [ImageSortField, ImageSortDirection];
                changeSort(s, d);
              }}
            >
              {SORT_FIELDS.map((f) => (
                <optgroup key={f} label={t(`mediaSort.${f}` as 'mediaSort.created')}>
                  <option value={`${f}:desc`}>{t(`mediaSort.${f}` as 'mediaSort.created')} · {t('mediaSort.desc')}</option>
                  <option value={`${f}:asc`}>{t(`mediaSort.${f}` as 'mediaSort.created')} · {t('mediaSort.asc')}</option>
                </optgroup>
              ))}
            </select>
          </label>
        )}
      </div>

      <MediaFilterChips identity={identity} people={people} items={ws.items} onRemove={removeChip} onClearAll={clearAll} />

      {ws.semanticNotice && (
        <p className="muted" role="status" data-testid="ws-semantic-notice">{ws.semanticNotice}</p>
      )}

      <div className="visually-hidden" role="status" aria-live="polite" data-testid="ws-sr-live">{srMessage}</div>

      <div id={PANEL_ID} role="tabpanel" aria-labelledby={`media-kind-tab-${identity.mediaKind}`}>
        {ws.loading && <p className="muted" role="status">{t('mediaWs.loading')}</p>}

        {ws.phase.kind === 'errorInitial' && (
          <div className="folder-error" role="alert">
            {ws.error}
            <button type="button" className="retry-button" onClick={ws.refresh}>{t('common.tryAgain')}</button>
          </div>
        )}

        {!ws.loading && ws.phase.kind !== 'errorInitial' && isEmpty && (
          <p className="muted" data-testid="ws-empty">{emptyLabel()}</p>
        )}

        {!isEmpty && (
          <MediaGrid
            items={ws.items}
            orderedIds={ws.orderedIds}
            selection={selection}
            onOpen={(index) => viewer.open(index)}
            semanticTimestamps={semanticTimestamps}
          />
        )}

        <div className="gallery-scroll-footer">
          {(ws.phase.kind === 'ready' || ws.phase.kind === 'loadingMore') && ws.hasMore && (
            <div ref={sentinelRef} className="gallery-scroll-sentinel" aria-hidden="true" />
          )}
          <p className="muted" role="status" aria-live="polite">
            {ws.loadingMore ? t('mediaWs.loadingMore') : ''}
          </p>
          {ws.phase.kind === 'end' && !isEmpty && <p className="muted">{t('mediaWs.reachedEnd')}</p>}
          {ws.phase.kind === 'errorMore' && (
            <div className="folder-error" role="alert">
              {ws.error}
              <button type="button" className="retry-button" onClick={ws.retryMore}>{t('common.tryAgain')}</button>
            </div>
          )}
        </div>
      </div>

      {viewer.index !== null && ws.items[viewer.index] !== undefined && (
        <MediaViewer
          items={viewerItems}
          index={viewer.index}
          onClose={viewer.close}
          onIndexChange={viewer.setIndex}
          onNearEnd={() => loadMoreRef.current()}
          renderDetails={(vi) => {
            const current = ws.items.find((it) => it.id === vi.id);
            if (!current) return null;
            return (
              <>
                <MediaMetadataPanel fileId={current.id} kind={current.kind} onMetadataChanged={onMetadataChanged} />
                {vi.kind === 'image' && (
                  <>
                    <button
                      type="button"
                      className="row-action"
                      data-testid="viewer-find-similar"
                      onClick={() => applySimilar(current.id)}
                    >
                      {t('mediaWs.findSimilar')}
                    </button>
                    <SimilarPhotosPanel
                      key={current.id}
                      fileId={current.id}
                      onSelect={(id) => {
                        const idx = ws.items.findIndex((it) => it.id === id);
                        if (idx >= 0) viewer.setIndex(idx);
                      }}
                    />
                  </>
                )}
              </>
            );
          }}
        />
      )}

      <MediaWorkspaceSelectionBar
        count={selection.count}
        busy={busy}
        capabilities={capabilities}
        restoreBusy={restoreBusy}
        photoDestinations={boundPhotoDestinations}
        onAddToAlbum={() => setPickerOpen(true)}
        onRemoveFromAlbum={() => void removeFromAlbum()}
        onMoveToPersonal={() => moveToPersonal.open([...selection.selected])}
        onMoveToExcluded={() => moveToExcluded.open([...selection.selected])}
        onRestore={() => void restoreSelected()}
        onMoveToTrash={() => setTrashOpen(true)}
        onClear={selection.clear}
      />

      {notice && <div className="gallery-notice" role="status" data-testid="ws-notice">{notice}</div>}

      <MediaFilterSheet
        open={sheetOpen}
        mediaKind={identity.mediaKind}
        applied={identity.filters}
        people={people.people}
        // Visual search has no album scope on the unified endpoint, so it is
        // offered only where the workspace can actually route it.
        showVisualQuery={source.kind === 'library' || identity.mediaKind === 'image'}
        onApply={applyFilters}
        onClose={() => setSheetOpen(false)}
        returnFocusRef={filtersButtonRef}
      />

      {trashOpen && (
        <TrashConfirmation
          count={selection.count}
          busy={busy}
          onConfirm={confirmTrash}
          onCancel={() => setTrashOpen(false)}
        />
      )}

      {pickerOpen && (
        <AlbumPickerModal fileItemIds={[...selection.selected]} onClose={() => setPickerOpen(false)} />
      )}

      {moveToPersonal.isOpen && (
        <MoveToPersonalDialog fileIds={moveToPersonal.ids} onClose={moveToPersonal.close} execute={moveToPersonal.execute} />
      )}

      {moveToExcluded.isOpen && (
        <MoveToExcludedDialog count={moveToExcluded.ids.length} onClose={moveToExcluded.close} execute={moveToExcluded.execute} />
      )}
    </section>
  );
}
