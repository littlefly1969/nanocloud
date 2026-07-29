import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaItem, MediaListResponse } from '@nanocloud/api-client';
import { AuthedWrapper, installFetchMock, jsonResponse } from '../../test-utils';
import { MediaWorkspace } from './MediaWorkspace';
import { emptyIdentity, type MediaWorkspaceIdentity, type MediaWorkspaceSource } from './mediaWorkspaceQuery';

const LIBRARY: MediaWorkspaceSource = { kind: 'library' };

const imageItem: MediaItem = {
  id: 'i1', kind: 'image', name: 'photo.jpg', title: null, displayName: 'photo.jpg',
  mimeType: 'image/jpeg', sizeBytes: 1000, width: 100, height: 100,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: null, takenAt: null,
  favorite: false, rating: null, thumbnailUrl: '/api/files/i1/thumbnail?size=small',
  occurrenceCount: 1, hasDuplicates: false, hasGps: null,
};
const videoItem: MediaItem = {
  id: 'v1', kind: 'video', name: 'clip.mp4', title: null, displayName: 'clip.mp4',
  mimeType: 'video/mp4', sizeBytes: 2000, width: 1920, height: 1080,
  createdAt: '2026-01-02T00:00:00Z', updatedAt: null, takenAt: null,
  favorite: false, rating: null, thumbnailUrl: '/api/files/v1/poster',
  occurrenceCount: 1, hasDuplicates: false,
  posterUrl: '/api/files/v1/poster', durationSeconds: 65, videoCodec: 'h264',
  hasAudio: true, posterSource: 'ffmpeg', previewStripUrl: null,
};

function page(items: MediaItem[], extra?: Partial<MediaListResponse>): MediaListResponse {
  const images = items.filter((i) => i.kind === 'image').length;
  return {
    items, limit: 50, count: items.length, nextCursor: null, hasMore: false,
    total: items.length, photoCount: images, videoCount: items.length - images, ...extra,
  };
}

function renderWorkspace(
  response: MediaListResponse,
  identity: MediaWorkspaceIdentity = emptyIdentity(LIBRARY),
) {
  const onIdentityChange = vi.fn();
  installFetchMock({ 'GET /api/media': () => jsonResponse(response) });
  render(
    <MemoryRouter>
      <AuthedWrapper>
        <MediaWorkspace
          source={LIBRARY}
          identity={identity}
          onIdentityChange={onIdentityChange}
          searchPlaceholder="Cerca"
        />
      </AuthedWrapper>
    </MemoryRouter>,
  );
  return onIdentityChange;
}

// The media grid lays out only after it measures a real container width; jsdom
// reports 0 for every rect, so stub a width and a no-op ResizeObserver so the
// grid renders its tiles (rather than the pre-measurement skeleton).
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ width: 1024, height: 768, top: 0, left: 0, right: 1024, bottom: 768, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
  );
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('MediaWorkspace', () => {
  it('keeps loading pages while the sentinel stays in view (chains without a scroll-up)', async () => {
    const mk = (id: string): MediaItem => ({ ...imageItem, id, name: `${id}.jpg`, displayName: `${id}.jpg` });
    installFetchMock({
      'GET /api/media': (req: { url: string }) => {
        const cursor = new URL(req.url, 'http://localhost').searchParams.get('cursor');
        if (!cursor) return jsonResponse(page([mk('a')], { nextCursor: 'c1', hasMore: true }));
        if (cursor === 'c1') {
          return jsonResponse(page([mk('b')], { nextCursor: 'c2', hasMore: true, total: -1, photoCount: -1, videoCount: -1 }));
        }
        return jsonResponse(page([mk('c')], { nextCursor: null, hasMore: false, total: -1, photoCount: -1, videoCount: -1 }));
      },
    });
    render(
      <MemoryRouter>
        <AuthedWrapper>
          <MediaWorkspace
            source={LIBRARY}
            identity={emptyIdentity(LIBRARY)}
            onIdentityChange={vi.fn()}
            searchPlaceholder="Cerca"
          />
        </AuthedWrapper>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getAllByTestId('media-open')).toHaveLength(1));

    // The sentinel enters the preload margin ONCE. Loading must then chain
    // through the remaining pages on its own — the old bug stalled here until the
    // user scrolled up and back down (the observer gives no fresh callback while
    // the sentinel stays continuously intersecting).
    act(() => {
      (globalThis as unknown as { __fireIntersection: (v?: boolean) => void }).__fireIntersection(true);
    });
    await waitFor(() => expect(screen.getAllByTestId('media-open')).toHaveLength(3));
  });

  it('renders a mixed grid with photos and videos and marks videos', async () => {
    renderWorkspace(page([imageItem, videoItem]));
    expect(await screen.findByText('photo.jpg')).toBeInTheDocument();
    expect(screen.getByText('clip.mp4')).toBeInTheDocument();
    // Exactly one video badge + duration overlay (for the video only).
    expect(screen.getByTestId('media-video-badge')).toBeInTheDocument();
    expect(screen.getByTestId('media-video-duration')).toHaveTextContent('1:05');
  });

  it('shows server-authoritative per-kind counts on the tabs', async () => {
    renderWorkspace(page([imageItem, videoItem]));
    await screen.findByText('photo.jpg');
    expect(screen.getByTestId('media-kind-count-all')).toHaveTextContent('2');
    expect(screen.getByTestId('media-kind-count-image')).toHaveTextContent('1');
    expect(screen.getByTestId('media-kind-count-video')).toHaveTextContent('1');
  });

  it('switching to the Foto tab requests a new identity with kind=image', async () => {
    const onIdentityChange = renderWorkspace(page([imageItem, videoItem]));
    await screen.findByText('photo.jpg');
    await userEvent.click(screen.getByTestId('media-kind-tab-image'));
    expect(onIdentityChange).toHaveBeenCalledWith(expect.objectContaining({ mediaKind: 'image' }));
  });

  it('renders the empty state when there is no content', async () => {
    renderWorkspace(page([]));
    expect(await screen.findByTestId('ws-empty')).toBeInTheDocument();
  });

  it('selecting an item reveals the capability-gated selection bar', async () => {
    renderWorkspace(page([imageItem, videoItem]));
    await screen.findByText('photo.jpg');
    const controls = screen.getAllByTestId('media-select-control');
    await userEvent.click(controls[0]);
    expect(await screen.findByTestId('media-selection-bar')).toBeInTheDocument();
    // A single image selection offers photo-only destinations + move-to-excluded.
    expect(screen.getByTestId('media-sel-excluded')).toBeInTheDocument();
    expect(screen.queryByTestId('media-sel-restore')).not.toBeInTheDocument();
  });

  it('find-similar from the viewer sets a photo similarity anchor', async () => {
    const onIdentityChange = renderWorkspace(page([imageItem]));
    await screen.findByText('photo.jpg');
    // Open the viewer on the image, then its details drawer (ⓘ).
    await userEvent.click(screen.getAllByTestId('media-open')[0]);
    await userEvent.click(await screen.findByText('ⓘ'));
    await userEvent.click(await screen.findByTestId('viewer-find-similar'));
    expect(onIdentityChange).toHaveBeenCalledWith(expect.objectContaining({
      mediaKind: 'image',
      filters: expect.objectContaining({ photo: expect.objectContaining({ similarTo: 'i1' }) }),
    }));
  });

  it('a similarity anchor routes the photo tab to /api/images (server-scoped), not /api/media', async () => {
    const identity = emptyIdentity(LIBRARY);
    identity.mediaKind = 'image';
    identity.filters.photo.similarTo = 'i1';
    const imageListResponse = {
      items: [{
        id: 'i1', name: 'photo.jpg', title: null, displayName: 'photo.jpg', mimeType: 'image/jpeg',
        sizeBytes: 1000, width: 100, height: 100, createdAt: 'x', updatedAt: null,
        thumbnailUrl: '/api/files/i1/thumbnail?size=small', occurrenceCount: 1, hasDuplicates: false,
      }],
      limit: 50, offset: 0, count: 1, nextCursor: null, hasMore: false, total: 1,
    };
    const mock = installFetchMock({
      'GET /api/media': () => jsonResponse(page([imageItem])),
      'GET /api/images': () => jsonResponse(imageListResponse),
    });
    render(
      <MemoryRouter>
        <AuthedWrapper>
          <MediaWorkspace source={LIBRARY} identity={identity} onIdentityChange={vi.fn()} searchPlaceholder="Cerca" />
        </AuthedWrapper>
      </MemoryRouter>,
    );
    await screen.findByText('photo.jpg');
    const urls = mock.calls.map((c) => c.url);
    expect(urls.some((u) => u.startsWith('/api/images'))).toBe(true);
    expect(urls.some((u) => u.startsWith('/api/media'))).toBe(false);
  });
});
