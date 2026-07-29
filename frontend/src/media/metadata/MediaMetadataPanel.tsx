import { useEffect, useState } from 'react';
import {
  addAlbumItem,
  ApiError,
  getFileMetadata,
  listAlbums,
  stripFileMetadata,
  writeFileDateTaken,
  type AlbumSummary,
  type FileMetadata,
} from '@nanocloud/api-client';
import { useAuth } from '../../auth/useAuth';
import { useI18n } from '../../i18n';
import { MediaMetadataEditor } from './MediaMetadataEditor';
import { MediaMetadataView } from './MediaMetadataView';

// The single metadata panel for BOTH galleries (it used to be defined inside
// GalleryPage, which is why videos only ever got a read-only view).
//
// It owns the whole interaction: load, loading/error/ready state, edit, save,
// local refresh, 401 handling, add-to-album and the image-only byte-rewriting
// actions. Photos and videos differ only in which rows and actions the view
// renders — see MediaMetadataView — so there is exactly one editor.

export type MediaKind = 'image' | 'video';

type Status =
  | { kind: 'loading' }
  | { kind: 'ready'; data: FileMetadata }
  | { kind: 'error' };

export interface MediaMetadataPanelProps {
  fileId: string;
  kind: MediaKind;
  // Fired whenever the stored metadata changes (save, strip, DateTaken write).
  // The galleries use it to patch the matching item in their loaded page
  // immutably, so a title edit is reflected on the card and in the viewer
  // header at once — no page reload, and clearing a title brings the file name
  // straight back.
  onMetadataChanged?: (fileId: string, metadata: FileMetadata) => void;
}

export function MediaMetadataPanel({ fileId, kind, onMetadataChanged }: MediaMetadataPanelProps) {
  const { invalidateAuth } = useAuth();
  const { t } = useI18n();
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [editing, setEditing] = useState(false);
  const [stripping, setStripping] = useState(false);
  const [stripError, setStripError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [selectedAlbumId, setSelectedAlbumId] = useState('');
  const [addingToAlbum, setAddingToAlbum] = useState(false);
  const [addAlbumMsg, setAddAlbumMsg] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    listAlbums(ctrl.signal)
      .then((list) => { setAlbums(list); if (list.length > 0) setSelectedAlbumId(list[0].id); })
      .catch(() => { /* non-critical: the add-to-album block just stays hidden */ });
    return () => ctrl.abort();
  }, [fileId]);

  useEffect(() => {
    const controller = new AbortController();
    setStatus({ kind: 'loading' });
    setEditing(false);
    setStripError(null);
    setWriteError(null);
    void (async () => {
      try {
        const data = await getFileMetadata(fileId, controller.signal);
        setStatus({ kind: 'ready', data });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof ApiError && err.status === 401) { invalidateAuth(); return; }
        setStatus({ kind: 'error' });
      }
    })();
    return () => controller.abort();
  }, [fileId, invalidateAuth]);

  // One place where a fresh document is adopted, so every mutation path
  // notifies the host gallery identically.
  function adopt(next: FileMetadata) {
    setStatus({ kind: 'ready', data: next });
    onMetadataChanged?.(fileId, next);
  }

  if (status.kind === 'loading') {
    return (
      <section className="lightbox-metadata" aria-label={t('mediaMeta.panelAria')}>
        <p className="muted" role="status">{t('gallery.loadingDetails')}</p>
      </section>
    );
  }

  if (status.kind === 'error') {
    return (
      <section className="lightbox-metadata" aria-label={t('mediaMeta.panelAria')}>
        <p className="muted" role="alert">{t('gallery.metadataLoadError')}</p>
      </section>
    );
  }

  const data = status.data;

  if (editing) {
    return (
      <MediaMetadataEditor
        data={data}
        onCancel={() => setEditing(false)}
        onSaved={(next) => { adopt(next); setEditing(false); }}
      />
    );
  }

  async function onStrip() {
    const confirmed = window.confirm(t('gallery.stripConfirm'));
    if (!confirmed) return;
    setStripping(true);
    setStripError(null);
    try {
      adopt(await stripFileMetadata(fileId));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { invalidateAuth(); return; }
      if (err instanceof ApiError && err.status === 415) {
        const body = err.body as { error?: unknown } | null;
        setStripError(
          typeof body?.error === 'string' && body.error.length > 0
            ? body.error
            : t('gallery.stripCantType'),
        );
        return;
      }
      setStripError(t('gallery.stripError'));
    } finally {
      setStripping(false);
    }
  }

  async function onWriteDateTaken() {
    const confirmed = window.confirm(t('gallery.writeConfirm'));
    if (!confirmed) return;
    setWriting(true);
    setWriteError(null);
    try {
      adopt(await writeFileDateTaken(fileId));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { invalidateAuth(); return; }
      if (err instanceof ApiError && (err.status === 400 || err.status === 415)) {
        const body = err.body as { error?: unknown } | null;
        setWriteError(
          typeof body?.error === 'string' && body.error.length > 0
            ? body.error
            : t('gallery.writeCantType'),
        );
        return;
      }
      setWriteError(t('gallery.writeError'));
    } finally {
      setWriting(false);
    }
  }

  async function onAddToAlbum() {
    if (!selectedAlbumId) return;
    setAddingToAlbum(true);
    setAddAlbumMsg(null);
    try {
      await addAlbumItem(selectedAlbumId, fileId);
      const album = albums.find((a) => a.id === selectedAlbumId);
      setAddAlbumMsg(t('gallery.addedToAlbum', { name: album?.name ?? t('gallery.albumFallback') }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { invalidateAuth(); return; }
      setAddAlbumMsg(t('gallery.addError'));
    } finally {
      setAddingToAlbum(false);
    }
  }

  return (
    <MediaMetadataView
      data={data}
      kind={kind}
      onEdit={() => setEditing(true)}
      onStrip={onStrip}
      stripping={stripping}
      stripError={stripError}
      onWriteDateTaken={onWriteDateTaken}
      writing={writing}
      writeError={writeError}
      albums={albums}
      selectedAlbumId={selectedAlbumId}
      onAlbumSelect={setSelectedAlbumId}
      onAddToAlbum={onAddToAlbum}
      addingToAlbum={addingToAlbum}
      addAlbumMsg={addAlbumMsg}
    />
  );
}
