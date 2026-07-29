import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { SimilarPhotosExplorerPage } from './SimilarPhotosExplorerPage';
import { AuthedWrapper, installFetchMock, jsonResponse, type MockHandler } from '../test-utils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SOURCE = 'src-1';

function meta(name: string): MockHandler {
  return () =>
    jsonResponse({
      id: SOURCE,
      name,
      mimeType: 'image/jpeg',
      sizeBytes: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: null,
      blob: {},
      user: {},
      effective: {},
    });
}

function page(
  items: { fileItemId: string; name: string; score: number }[],
  opts: { hasMore?: boolean; nextCursor?: string | null; profileAvailable?: boolean; queryIndexed?: boolean } = {},
): MockHandler {
  return () =>
    jsonResponse({
      profileAvailable: opts.profileAvailable ?? true,
      queryIndexed: opts.queryIndexed ?? true,
      items,
      nextCursor: opts.nextCursor ?? null,
      hasMore: opts.hasMore ?? false,
      unavailableReason: null,
    });
}

function renderExplorer() {
  return render(
    <AuthedWrapper>
      <MemoryRouter initialEntries={[`/gallery/files/${SOURCE}/similar`]}>
        <Routes>
          <Route path="/gallery/files/:fileId/similar" element={<SimilarPhotosExplorerPage />} />
          <Route path="/gallery" element={<div>gallery list</div>} />
        </Routes>
      </MemoryRouter>
    </AuthedWrapper>,
  );
}

it('shows the source context and renders results with similarity percentage', async () => {
  installFetchMock({
    'GET /api/files/src-1/metadata': meta('beach.jpg'),
    'GET /api/files/src-1/similar': page([
      { fileItemId: 'r-1', name: 'forest.jpg', score: 0.92 },
      { fileItemId: 'r-2', name: 'lake.jpg', score: 0.81 },
    ]),
  });
  renderExplorer();

  // Source name visible in the header.
  expect(await screen.findByText('beach.jpg')).toBeTruthy();

  // Result cards show name + similarity percentage + small thumbnail.
  const forest = await screen.findByTitle('forest.jpg');
  expect(within(forest).getByText('92%')).toBeTruthy();
  const img = within(forest).getByRole('img') as HTMLImageElement;
  expect(img.getAttribute('src')).toBe('/api/files/r-1/thumbnail?size=small');
  expect(screen.getByText('81%')).toBeTruthy();
});

it('sends the default 75% threshold then refetches when the slider changes', async () => {
  const mock = installFetchMock({
    'GET /api/files/src-1/metadata': meta('beach.jpg'),
    'GET /api/files/src-1/similar': page([{ fileItemId: 'r-1', name: 'a.jpg', score: 0.9 }]),
  });
  renderExplorer();
  await screen.findByTitle('a.jpg');

  // First call uses the default 0.75 threshold.
  const firstSimilar = mock.calls.find((c) => c.url.includes('/similar'));
  expect(firstSimilar?.url).toContain('minSimilarity=0.75');

  // Move the slider to 60% → debounced refetch with the new threshold.
  const slider = screen.getByLabelText('Percentuale di similarità minima');
  fireEvent.change(slider, { target: { value: '60' } });

  await waitFor(
    () => {
      expect(mock.calls.some((c) => c.url.includes('minSimilarity=0.6'))).toBe(true);
    },
    { timeout: 2000 },
  );
});

it('updates the threshold from a preset button', async () => {
  const mock = installFetchMock({
    'GET /api/files/src-1/metadata': meta('beach.jpg'),
    'GET /api/files/src-1/similar': page([{ fileItemId: 'r-1', name: 'a.jpg', score: 0.9 }]),
  });
  renderExplorer();
  await screen.findByTitle('a.jpg');

  await userEvent.click(screen.getByRole('button', { name: /Rigorosa · 85%/ }));
  await waitFor(
    () => {
      expect(mock.calls.some((c) => c.url.includes('minSimilarity=0.85'))).toBe(true);
    },
    { timeout: 2000 },
  );
});

it('appends results via Load more and follows the cursor', async () => {
  let call = 0;
  installFetchMock({
    'GET /api/files/src-1/metadata': meta('beach.jpg'),
    'GET /api/files/src-1/similar': (req) => {
      call += 1;
      if (req.url.includes('cursor=')) {
        return page([{ fileItemId: 'r-2', name: 'second.jpg', score: 0.7 }])(req);
      }
      return page([{ fileItemId: 'r-1', name: 'first.jpg', score: 0.9 }], {
        hasMore: true,
        nextCursor: 'CURSOR1',
      })(req);
    },
  });
  renderExplorer();

  await screen.findByTitle('first.jpg');
  await userEvent.click(screen.getByRole('button', { name: 'Carica altri' }));

  expect(await screen.findByTitle('second.jpg')).toBeTruthy();
  // First page still present (appended, not replaced).
  expect(screen.getByTitle('first.jpg')).toBeTruthy();
  expect(call).toBeGreaterThanOrEqual(2);
});

it('shows the empty state with the broaden hint', async () => {
  installFetchMock({
    'GET /api/files/src-1/metadata': meta('beach.jpg'),
    'GET /api/files/src-1/similar': page([]),
  });
  renderExplorer();

  expect(await screen.findByText('Nessuna foto simile trovata con questa soglia.')).toBeTruthy();
  expect(screen.getByText('Abbassa la soglia di similarità per ampliare i risultati.')).toBeTruthy();
});

it('shows the indexing state when the profile/photo is not indexed', async () => {
  installFetchMock({
    'GET /api/files/src-1/metadata': meta('beach.jpg'),
    'GET /api/files/src-1/similar': page([], { profileAvailable: false, queryIndexed: false }),
  });
  renderExplorer();

  expect(
    await screen.findByText(/L’indice di similarità è ancora in costruzione\./),
  ).toBeTruthy();
});

it('shows an error state when the search fails', async () => {
  installFetchMock({
    'GET /api/files/src-1/metadata': meta('beach.jpg'),
    'GET /api/files/src-1/similar': () => new Response(null, { status: 500 }),
  });
  renderExplorer();

  expect(await screen.findByRole('alert')).toHaveTextContent('Impossibile caricare le foto simili.');
});

it('selects results with the checkbox and drives the bulk action bar', async () => {
  installFetchMock({
    'GET /api/files/src-1/metadata': meta('beach.jpg'),
    'GET /api/files/src-1/similar': page([
      { fileItemId: 'r-1', name: 'forest.jpg', score: 0.92 },
      { fileItemId: 'r-2', name: 'lake.jpg', score: 0.81 },
    ]),
  });
  renderExplorer();
  await screen.findByTitle('forest.jpg');

  // No selection bar until something is selected.
  expect(screen.queryByTestId('ws-selection-bar')).toBeNull();

  const controls = screen.getAllByTestId('gallery-select-control');
  await userEvent.click(controls[0]);
  await userEvent.click(controls[1]);

  // Same bar + actions as the Gallery: count, add-to-album, add-to menu, trash, clear.
  const bar = screen.getByTestId('ws-selection-bar');
  expect(within(bar).getByTestId('ws-selection-count').textContent).toContain('2');
  expect(within(bar).getByTestId('ws-sel-album')).toBeTruthy();
  expect(within(bar).getByTestId('ws-sel-trash')).toBeTruthy();

  await userEvent.click(screen.getByTestId('ws-sel-clear'));
  expect(screen.queryByTestId('ws-selection-bar')).toBeNull();
});

it('moves a selected result to Trash and removes it from the results', async () => {
  installFetchMock({
    'GET /api/files/src-1/metadata': meta('beach.jpg'),
    'GET /api/files/src-1/similar': page([
      { fileItemId: 'r-1', name: 'forest.jpg', score: 0.92 },
      { fileItemId: 'r-2', name: 'lake.jpg', score: 0.81 },
    ]),
    'DELETE /api/files/r-1': () => new Response(null, { status: 204 }),
  });
  renderExplorer();
  await screen.findByTitle('forest.jpg');

  await userEvent.click(screen.getAllByTestId('gallery-select-control')[0]); // select forest
  await userEvent.click(screen.getByTestId('ws-sel-trash')); // open confirmation
  await screen.findByTestId('ws-trash-confirm');
  await userEvent.click(screen.getByTestId('ws-trash-confirm-btn')); // confirm

  // The trashed result disappears in place; the other stays.
  await waitFor(() => expect(screen.queryByTitle('forest.jpg')).toBeNull());
  expect(screen.getByTitle('lake.jpg')).toBeTruthy();
});

it('does not expose internal identifiers in the rendered page', async () => {
  const { container } = renderExplorerWithInternals();
  await screen.findByTitle('forest.jpg');
  const text = (container.textContent ?? '').toLowerCase();
  expect(text).not.toContain('siglip');
  expect(text).not.toContain('profile');
  expect(text).not.toContain('vector');
  expect(text).not.toContain('blobobject');
  // Thumbnails are small derivatives, never originals.
  const img = container.querySelector('.gallery-thumb');
  expect(img?.getAttribute('src')).toContain('/thumbnail?size=small');
});

function renderExplorerWithInternals() {
  installFetchMock({
    'GET /api/files/src-1/metadata': meta('beach.jpg'),
    'GET /api/files/src-1/similar': page([
      { fileItemId: 'r-1', name: 'forest.jpg', score: 0.987654 },
    ]),
  });
  return renderExplorer();
}
