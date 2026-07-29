import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';

// Video-hls slice 3: playback element for GET /api/files/{id}/video, which now
// speaks TWO contracts depending on the server's Media:VideoHlsProvider flag:
//
//   - adaptive (flag on):  200 `application/vnd.apple.mpegurl` master playlist
//     when the ladder is ready, 202 while the transcode is being prepared.
//   - legacy  (flag off):  the original Range-enabled progressive byte stream.
//
// A cheap probe (GET with `Range: bytes=0-0`) classifies the mode: the legacy
// stream answers 206 with one byte, the master answers 200 with a tiny text
// body, "preparing" answers 202. While preparing we show the poster with a
// status overlay and re-probe on an interval — the server enqueues the
// generation job on the first request, so polling is passive (each poll is
// also the idempotent re-enqueue that self-heals a dead job).
//
// HLS attachment: Safari plays HLS natively (canPlayType), everyone else gets
// hls.js over MSE. hls.js is imported DYNAMICALLY so the ~200 KB library is
// only downloaded when an adaptive video is actually opened.

const PREPARING_POLL_MS = 5000;

export type VideoPlaybackMode = 'preparing' | 'hls' | 'direct' | 'error';

// Pure resolution of a semantic-handoff timestamp against the real duration.
// Exported for tests. Returns the seconds to seek to, or null when there is
// nothing safe to do (absent/invalid timestamp, unknown duration, or a
// position at/after the end — seeking there would just show the last frame).
export function resolveInitialSeekSeconds(
  positionMilliseconds: number | null | undefined,
  durationSeconds: number,
): number | null {
  if (positionMilliseconds == null
    || !Number.isFinite(positionMilliseconds)
    || positionMilliseconds < 0) {
    return null;
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null;
  }

  const seconds = positionMilliseconds / 1000;
  // Clamp just inside the end so a timestamp at (or past) the duration still
  // lands on a playable frame rather than triggering an immediate `ended`.
  const maxSeconds = Math.max(0, durationSeconds - 0.25);
  return Math.min(seconds, maxSeconds);
}

// Exported for tests. Same-origin cookies flow automatically.
export async function probeVideoPlayback(
  url: string,
  signal?: AbortSignal,
): Promise<VideoPlaybackMode> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal });
  } catch {
    return 'error';
  }
  if (res.status === 202) return 'preparing';
  if (res.status !== 200 && res.status !== 206) return 'error';
  const type = res.headers.get('content-type') ?? '';
  return type.toLowerCase().includes('mpegurl') ? 'hls' : 'direct';
}

interface HlsVideoPlayerProps {
  fileId: string;
  className?: string;
  // VSEM-03: open at a semantic match instead of the start. Applied ONCE, only
  // after the element reports its metadata (a seek before `loadedmetadata` is
  // ignored by the browser), and clamped to the real duration — a stale or
  // out-of-range timestamp degrades to normal playback rather than breaking it.
  // Works for both playback contracts: the direct byte stream seeks via Range,
  // HLS via the segment index. Nothing is persisted.
  initialPositionMilliseconds?: number | null;
}

export function HlsVideoPlayer({
  fileId, className, initialPositionMilliseconds = null,
}: HlsVideoPlayerProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<VideoPlaybackMode | 'probing'>('probing');
  // Quality badge: the DECODED height of what is actually playing right now
  // (1080 = high rung, 480 = low rung; for the legacy direct stream it is the
  // source's intrinsic height). Fed by the media element's `resize` event,
  // which fires on every videoWidth/Height change — that covers hls.js level
  // switches, Safari's native HLS switches and plain progressive playback with
  // one uniform mechanism, no hls.js-specific listeners needed.
  const [renditionHeight, setRenditionHeight] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Fullscreen targets the WRAPPER (not the <video>): fullscreening the bare
  // video element would leave the quality badge outside the fullscreen
  // subtree and make it vanish. The native controls' own fullscreen button is
  // suppressed via controlsList for the same reason (Chrome/Edge honor it).
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // The semantic handoff seek is a ONE-SHOT: after it (or after a rejected
  // attempt) the user owns the playhead — a later `loadedmetadata` from a
  // rendition switch must not yank playback back.
  const seekAppliedRef = useRef(false);

  const videoUrl = `/api/files/${fileId}/video`;
  const posterUrl = `/api/files/${fileId}/poster`;

  // Leaving the player (close/navigate) while in wrapper-fullscreen: exit so
  // the viewer chrome comes back instead of a black fullscreen shell.
  // (Declared BEFORE the conditional returns below — rules of hooks.)
  useEffect(() => () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => { /* best effort */ });
    }
  }, []);

  // Probe on mount / file change; while preparing, re-probe on an interval.
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    setMode('probing');
    setRenditionHeight(null);
    seekAppliedRef.current = false;

    const probe = async () => {
      const result = await probeVideoPlayback(videoUrl, controller.signal);
      if (controller.signal.aborted) return;
      setMode(result);
      if (result === 'preparing') {
        timer = setTimeout(() => { void probe(); }, PREPARING_POLL_MS);
      }
    };
    void probe();

    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [videoUrl]);

  // Attach the HLS source once the element for 'hls' mode is mounted.
  useEffect(() => {
    if (mode !== 'hls') return;
    const video = videoRef.current;
    if (!video) return;

    // Safari (and iOS WebKit) plays HLS natively.
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = videoUrl;
      return;
    }

    let destroyed = false;
    let hls: { destroy(): void } | null = null;
    void import('hls.js').then(({ default: Hls }) => {
      if (destroyed || !videoRef.current) return;
      if (!Hls.isSupported()) {
        // No MSE either — nothing else to try.
        setMode('error');
        return;
      }
      const instance = new Hls();
      instance.loadSource(videoUrl);
      instance.attachMedia(videoRef.current);
      instance.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setMode('error');
      });
      hls = instance;
    });

    return () => {
      destroyed = true;
      hls?.destroy();
    };
  }, [mode, videoUrl]);

  if (mode === 'probing' || mode === 'preparing') {
    return (
      <div className="media-viewer-video-preparing">
        <img className={className} src={posterUrl} alt="" draggable={false} />
        {mode === 'preparing' && (
          <p className="media-viewer-video-preparing-label" role="status">
            {t('mediaViewer.videoPreparing')}
          </p>
        )}
      </div>
    );
  }

  if (mode === 'error') {
    return (
      <div className="media-viewer-error" role="alert">
        {t('mediaViewer.videoError')}
      </div>
    );
  }

  const onVideoDimensionsChange = () => {
    // Conventional "p" notation = the SHORT side, so a portrait 1080×1920
    // phone video reads "1080p" (not a confusing "1920p").
    const w = videoRef.current?.videoWidth ?? 0;
    const h = videoRef.current?.videoHeight ?? 0;
    const shortSide = Math.min(w, h);
    setRenditionHeight(shortSide > 0 ? shortSide : null);
  };

  // Metadata is the earliest point at which `duration` is known and a seek is
  // honoured. Applied at most once per file; an absent, negative, non-finite
  // or beyond-duration timestamp leaves playback at the start.
  const onLoadedMetadata = () => {
    onVideoDimensionsChange();
    const video = videoRef.current;
    if (!video || seekAppliedRef.current) return;
    seekAppliedRef.current = true;

    const target = resolveInitialSeekSeconds(initialPositionMilliseconds, video.duration);
    if (target === null) return;
    try {
      video.currentTime = target;
    } catch {
      // A container/browser that refuses the seek just plays from the start.
    }
  };

  // Default-fullscreen at playback start: the `play` event carries the user's
  // gesture, so the request is reliably allowed (an autoplay-triggered play
  // may lack activation — the catch swallows the rejection and the video just
  // plays inside the viewer; the next manual play retries). ESC exits, per
  // the platform convention.
  const onPlay = () => {
    if (document.fullscreenElement) return;
    wrapRef.current?.requestFullscreen?.().catch(() => { /* stay windowed */ });
  };

  return (
    <div className="media-viewer-video-wrap" ref={wrapRef}>
      <video
        key={`${fileId}:${mode}`}
        ref={videoRef}
        className={className}
        // Only the legacy stream sets src declaratively; HLS attaches via the
        // effect above (native src or MSE).
        src={mode === 'direct' ? videoUrl : undefined}
        poster={posterUrl}
        controls
        controlsList="nofullscreen"
        autoPlay
        playsInline
        preload="metadata"
        onLoadedMetadata={onLoadedMetadata}
        onResize={onVideoDimensionsChange}
        onPlay={onPlay}
      />
      {renditionHeight != null && (
        <span className="media-viewer-quality-badge" role="status" aria-live="polite">
          {renditionHeight}p
        </span>
      )}
    </div>
  );
}
