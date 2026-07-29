import { privacySafeDownloadUrl, type AlbumSummary, type FileMetadata } from '@nanocloud/api-client';
import { formatSize } from '../../components/format';
import { useI18n } from '../../i18n';
import type { MediaKind } from './MediaMetadataPanel';

// Read-only metadata body shared by both galleries.
//
// The rows common to every medium (dates, size, user annotations) are built
// once; the kind-specific blocks live in their own small builders below so
// neither gallery grows `if (kind === …)` branches inline. Image-only ACTIONS
// (strip embedded metadata, bake DateTaken into the JPEG, privacy-safe
// download) are gated on kind AND on the detected content type, so they never
// appear on a video.

type Row = [string, string];

// Formats a fractional-seconds duration as H:MM:SS (or M:SS under an hour).
function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

interface Props {
  data: FileMetadata;
  kind: MediaKind;
  onEdit(): void;
  onStrip(): void;
  stripping: boolean;
  stripError: string | null;
  onWriteDateTaken(): void;
  writing: boolean;
  writeError: string | null;
  albums: AlbumSummary[];
  selectedAlbumId: string;
  onAlbumSelect(id: string): void;
  onAddToAlbum(): void;
  addingToAlbum: boolean;
  addAlbumMsg: string | null;
}

export function MediaMetadataView({
  data,
  kind,
  onEdit,
  onStrip,
  stripping,
  stripError,
  onWriteDateTaken,
  writing,
  writeError,
  albums,
  selectedAlbumId,
  onAlbumSelect,
  onAddToAlbum,
  addingToAlbum,
  addAlbumMsg,
}: Props) {
  const { t, tn, formatDate } = useI18n();
  const { blob, user, effective } = data;
  const e = blob.embedded;

  const rows: Row[] = [];

  // Identity first: the title (when set) and ALWAYS the original file name, so
  // the name used for downloads and diagnostics never becomes unreachable.
  if (user.title) rows.push([t('mediaMeta.title'), user.title]);
  rows.push([t('mediaMeta.fileName'), data.name]);

  const dateLabel =
    effective.dateTakenSource === 'user' ? t('gallery.mdDateTakenOverride')
      : effective.dateTakenSource === 'embedded' ? t('gallery.mdDateTaken')
      : t('gallery.mdUploaded');
  rows.push([dateLabel, formatDate(effective.dateTaken)]);

  if (blob.width !== null && blob.height !== null) {
    rows.push([t('gallery.mdDimensions'), `${blob.width}×${blob.height}`]);
  }
  rows.push([t('gallery.mdFileSize'), formatSize(data.sizeBytes)]);

  // --- kind-specific technical blocks --------------------------------------
  if (kind === 'image' && e) {
    const camera = [e.cameraMake, e.cameraModel].filter(Boolean).join(' ');
    if (camera) rows.push([t('gallery.mdCamera'), camera]);
    if (e.lensModel) rows.push([t('gallery.mdLens'), e.lensModel]);
    if (e.iso != null) rows.push(['ISO', String(e.iso)]);
    if (e.aperture != null) rows.push([t('gallery.mdAperture'), `f/${e.aperture}`]);
    if (e.exposureTime) rows.push([t('gallery.mdExposure'), e.exposureTime]);
    if (e.focalLength != null) rows.push([t('gallery.mdFocalLength'), `${e.focalLength} mm`]);
    if (e.colorSpace) rows.push([t('gallery.mdColorSpace'), e.colorSpace]);
    if (e.orientation != null) rows.push([t('gallery.mdOrientation'), String(e.orientation)]);
    // Privacy: presence only. Coordinates are never exposed here.
    rows.push([t('gallery.gps'), e.hasGps ? t('gallery.gpsPresent') : t('gallery.gpsNoneValue')]);
  }

  const v = blob.video;
  if (kind === 'video' && v) {
    if (v.durationSeconds != null) {
      rows.push([t('gallery.mdDuration'), formatDuration(v.durationSeconds)]);
    }
    if (v.videoCodec) rows.push([t('gallery.mdVideoCodec'), v.videoCodec]);
    if (v.audioCodec) rows.push([t('gallery.mdAudioCodec'), v.audioCodec]);
    if (v.frameRate != null) {
      rows.push([t('gallery.mdFrameRate'), t('gallery.mdFps', { value: v.frameRate.toFixed(2) })]);
    }
    if (v.videoBitrate != null) {
      rows.push([
        t('gallery.mdBitrate'),
        t('gallery.mdMbps', { value: (v.videoBitrate / 1_000_000).toFixed(1) }),
      ]);
    }
    rows.push([
      t('gallery.mdAudio'),
      v.hasAudio ? t('mediaViewer.audioPresent') : t('mediaViewer.noAudio'),
    ]);
    if (v.audioChannels != null) {
      rows.push([t('gallery.mdAudioChannelsLabel'), tn(v.audioChannels, 'gallery.mdAudioChannels')]);
    }
    if (v.audioSampleRate != null) {
      rows.push([t('gallery.mdSampleRate'), t('gallery.mdHz', { value: v.audioSampleRate })]);
    }
    if (v.rotation != null && v.rotation !== 0) {
      rows.push([t('gallery.mdRotation'), `${v.rotation}°`]);
    }
  }

  // --- user annotations -----------------------------------------------------
  if (user.description) rows.push([t('gallery.mdDescription'), user.description]);
  if (user.tags.length > 0) rows.push([t('gallery.mdTags'), user.tags.join(', ')]);
  if (user.rating != null) rows.push([t('gallery.mdRating'), `${user.rating}/5`]);
  if (user.favorite) rows.push([t('gallery.mdFavorite'), t('gallery.yes')]);
  if (effective.location) rows.push([t('gallery.mdLocation'), effective.location]);

  const detected = blob.detectedContentType?.toLowerCase();
  // Image-only byte-rewriting actions. `kind === 'image'` is the primary gate so
  // a video can never reach them even if its detected type looked image-ish.
  const canStrip = kind === 'image' && (detected === 'image/jpeg' || detected === 'image/png');
  const canWriteDate = kind === 'image' && detected === 'image/jpeg' && user.dateTakenOverride !== null;
  const canPrivacySafe = canStrip;

  const noTechnicalDetails = kind === 'image' ? e === null : v === null;

  return (
    <section className="lightbox-metadata" aria-label={t('mediaMeta.panelAria')}>
      {noTechnicalDetails && (
        <p className="muted">
          {kind === 'video' ? t('mediaMeta.noVideoDetails') : t('gallery.noEmbedded')}
        </p>
      )}
      <dl className="metadata-list">
        {rows.map(([label, value]) => (
          <div key={label} className="metadata-row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="metadata-actions">
        <button type="button" className="row-action" data-testid="media-edit-metadata" onClick={onEdit}>
          {t('gallery.editMetadata')}
        </button>
        {canStrip && (
          <button
            type="button"
            className="row-action row-action-destructive"
            data-testid="media-strip-metadata"
            onClick={onStrip}
            disabled={stripping}
          >
            {stripping ? t('gallery.stripping') : t('gallery.stripBtn')}
          </button>
        )}
        {canWriteDate && (
          <button
            type="button"
            className="row-action"
            data-testid="media-write-datetaken"
            onClick={onWriteDateTaken}
            disabled={writing}
          >
            {writing ? t('gallery.writing') : t('gallery.writeBtn')}
          </button>
        )}
        {canPrivacySafe && (
          <a className="row-action" href={privacySafeDownloadUrl(data.id)} data-testid="privacy-safe-download">
            {t('gallery.downloadPrivacySafe')}
          </a>
        )}
      </div>
      {stripError !== null && <p className="metadata-edit-error" role="alert">{stripError}</p>}
      {writeError !== null && <p className="metadata-edit-error" role="alert">{writeError}</p>}
      {albums.length > 0 && (
        <div className="album-add-section" data-testid="add-to-album-section">
          <select
            value={selectedAlbumId}
            onChange={(ev) => onAlbumSelect(ev.target.value)}
            aria-label={t('gallery.selectAlbumAria')}
          >
            {albums.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <button
            type="button"
            className="row-action"
            onClick={onAddToAlbum}
            disabled={addingToAlbum}
            data-testid="add-to-album-btn"
          >
            {addingToAlbum ? t('gallery.adding') : t('gallery.addToAlbum')}
          </button>
          {addAlbumMsg && <p className="muted" role="status">{addAlbumMsg}</p>}
        </div>
      )}
    </section>
  );
}
