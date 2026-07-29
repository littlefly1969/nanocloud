import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HlsVideoPlayer, probeVideoPlayback } from './HlsVideoPlayer';
import { AuthedWrapper } from '../test-utils';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockFetchResponse(status: number, contentType?: string) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    status,
    headers: new Headers(contentType ? { 'content-type': contentType } : {}),
  }));
}

// Video-hls slice 3 — the /video contract probe: the endpoint speaks either
// the adaptive contract (200 master playlist | 202 preparing) or the legacy
// Range-enabled byte stream (206 for the 1-byte probe), and the player picks
// its rendering mode from the answer.
describe('probeVideoPlayback', () => {
  it('classifies a 202 as preparing', async () => {
    mockFetchResponse(202);
    expect(await probeVideoPlayback('/api/files/x/video')).toBe('preparing');
  });

  it('classifies a 200 mpegurl master as hls', async () => {
    mockFetchResponse(200, 'application/vnd.apple.mpegurl');
    expect(await probeVideoPlayback('/api/files/x/video')).toBe('hls');
  });

  it('classifies a 206 byte-range answer as the legacy direct stream', async () => {
    mockFetchResponse(206, 'video/mp4');
    expect(await probeVideoPlayback('/api/files/x/video')).toBe('direct');
  });

  it('classifies a 200 video answer as the legacy direct stream', async () => {
    mockFetchResponse(200, 'video/quicktime');
    expect(await probeVideoPlayback('/api/files/x/video')).toBe('direct');
  });

  it('classifies 404 and network failures as error', async () => {
    mockFetchResponse(404);
    expect(await probeVideoPlayback('/api/files/x/video')).toBe('error');

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('net')));
    expect(await probeVideoPlayback('/api/files/x/video')).toBe('error');
  });

  it('sends the 1-byte range header so a legacy probe never downloads the file', async () => {
    mockFetchResponse(206, 'video/mp4');
    await probeVideoPlayback('/api/files/x/video');
    const call = vi.mocked(fetch).mock.calls[0]!;
    expect((call[1] as RequestInit).headers).toMatchObject({ Range: 'bytes=0-0' });
  });
});

// The quality badge shows the DECODED height actually playing and tracks the
// media element's `resize` event, so it updates live on adaptive switches.
describe('HlsVideoPlayer quality badge', () => {
  it('shows the current rendition height and follows switches', async () => {
    mockFetchResponse(206, 'video/mp4'); // legacy direct mode
    render(<AuthedWrapper><HlsVideoPlayer fileId="x" /></AuthedWrapper>);

    const video = await waitFor(() => {
      const v = document.querySelector('video');
      expect(v).not.toBeNull();
      return v!;
    });
    // No badge before the element knows its dimensions.
    expect(screen.queryByText(/\d+p/)).toBeNull();

    Object.defineProperty(video, 'videoWidth', { value: 1920, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 1080, configurable: true });
    fireEvent(video, new Event('resize'));
    expect(await screen.findByText('1080p')).toBeInTheDocument();

    // Adaptive down-switch → the badge follows.
    Object.defineProperty(video, 'videoWidth', { value: 854, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 480, configurable: true });
    fireEvent(video, new Event('resize'));
    expect(await screen.findByText('480p')).toBeInTheDocument();
    expect(screen.queryByText('1080p')).toBeNull();
  });

  it('labels a portrait video by its short side (1080×1920 → 1080p, not 1920p)', async () => {
    mockFetchResponse(206, 'video/mp4');
    render(<AuthedWrapper><HlsVideoPlayer fileId="x" /></AuthedWrapper>);
    const video = await waitFor(() => {
      const v = document.querySelector('video');
      expect(v).not.toBeNull();
      return v!;
    });

    Object.defineProperty(video, 'videoWidth', { value: 1080, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 1920, configurable: true });
    fireEvent(video, new Event('resize'));
    expect(await screen.findByText('1080p')).toBeInTheDocument();
  });
});
