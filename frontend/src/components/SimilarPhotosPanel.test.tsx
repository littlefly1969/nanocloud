import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router';
import { SimilarPhotosPanel } from './SimilarPhotosPanel';
import { AuthedWrapper, errorResponse, installFetchMock, jsonResponse } from '../test-utils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const FILE_ID = 'img-1';

// Minimal stand-in for the Gallery route that just surfaces the similarTo param.
function GalleryProbe() {
  const [sp] = useSearchParams();
  return <div data-testid="gallery-similar-param">{sp.get('similarTo')}</div>;
}

function renderPanel(onSelect = vi.fn()) {
  render(
    <AuthedWrapper>
      <MemoryRouter initialEntries={['/gallery']}>
        <Routes>
          <Route
            path="/gallery"
            element={<SimilarPhotosPanel fileId={FILE_ID} onSelect={onSelect} />}
          />
          <Route
            path="/gallery/files/:fileId/similar"
            element={<div>explorer for {FILE_ID}</div>}
          />
        </Routes>
      </MemoryRouter>
    </AuthedWrapper>,
  );
  return onSelect;
}

it('opens the similar set in the main Gallery workflow (similarTo bridge)', async () => {
  installFetchMock({
    'GET /api/files/img-1/similar': () =>
      jsonResponse({ profileAvailable: true, queryIndexed: true, items: [], unavailableReason: null }),
  });
  // A distinct /gallery route element so we can assert the query param arrived.
  render(
    <AuthedWrapper>
      <MemoryRouter initialEntries={['/gallery/files/img-1/similar']}>
        <Routes>
          <Route path="/gallery/files/:fileId/similar" element={<SimilarPhotosPanel fileId={FILE_ID} onSelect={vi.fn()} />} />
          <Route path="/gallery" element={<GalleryProbe />} />
        </Routes>
      </MemoryRouter>
    </AuthedWrapper>,
  );
  await userEvent.click(screen.getByTestId('show-similar-btn'));
  await userEvent.click(screen.getByTestId('open-similar-in-gallery-btn'));
  expect(await screen.findByTestId('gallery-similar-param')).toHaveTextContent('img-1');
});

function expand() {
  return userEvent.click(screen.getByTestId('show-similar-btn'));
}

it('does not fetch until expanded (collapsed by default)', async () => {
  const mock = installFetchMock({
    'GET /api/files/img-1/similar': () =>
      jsonResponse({ profileAvailable: true, queryIndexed: true, items: [], unavailableReason: null }),
  });
  renderPanel();
  // Collapsed: the header is present but no request has been made.
  expect(screen.getByTestId('show-similar-btn')).toBeTruthy();
  expect(mock.calls.some((c) => c.url.includes('/similar'))).toBe(false);
});

it('renders results with thumbnails + names and navigates on click', async () => {
  const user = userEvent.setup();
  installFetchMock({
    'GET /api/files/img-1/similar': () =>
      jsonResponse({
        profileAvailable: true,
        queryIndexed: true,
        items: [
          { fileItemId: 'img-2', name: 'forest.jpg', score: 0.98 },
          { fileItemId: 'img-3', name: 'lake.jpg', score: 0.81 },
        ],
        unavailableReason: null,
      }),
  });
  const onSelect = renderPanel();
  await expand();

  // Both results render with their names + thumbnails (small thumbnail URL).
  const forest = await screen.findByTitle('forest.jpg');
  expect(screen.getByTitle('lake.jpg')).toBeTruthy();
  const img = within(forest).getByRole('img') as HTMLImageElement;
  expect(img.getAttribute('src')).toBe('/api/files/img-2/thumbnail?size=small');

  await user.click(forest);
  expect(onSelect).toHaveBeenCalledWith('img-2');
});

it('opens the full Similar Photos Explorer from the panel', async () => {
  installFetchMock({
    'GET /api/files/img-1/similar': () =>
      jsonResponse({ profileAvailable: true, queryIndexed: true, items: [], unavailableReason: null }),
  });
  renderPanel();
  await expand();
  await userEvent.click(screen.getByTestId('explore-similar-btn'));
  // Navigated to the dedicated explorer route for this file.
  expect(await screen.findByText(`explorer for ${FILE_ID}`)).toBeTruthy();
});

it('shows the indexing copy when the profile/photo is not indexed yet', async () => {
  installFetchMock({
    'GET /api/files/img-1/similar': () =>
      jsonResponse({ profileAvailable: false, queryIndexed: false, items: [], unavailableReason: 'profile-not-found' }),
  });
  renderPanel();
  await expand();
  expect(await screen.findByText('Le foto simili appariranno man mano che l’indice delle foto viene costruito.')).toBeTruthy();
});

it('shows a "no results" message when indexed but no neighbours', async () => {
  installFetchMock({
    'GET /api/files/img-1/similar': () =>
      jsonResponse({ profileAvailable: true, queryIndexed: true, items: [], unavailableReason: null }),
  });
  renderPanel();
  await expand();
  expect(await screen.findByText('Nessuna foto simile trovata.')).toBeTruthy();
});

it('shows a graceful error state', async () => {
  installFetchMock({
    'GET /api/files/img-1/similar': () => errorResponse(500),
  });
  renderPanel();
  await expand();
  expect(await screen.findByRole('alert')).toHaveTextContent('Impossibile caricare le foto simili.');
});

it('never exposes model/profile internals, scores, or storage identifiers', async () => {
  installFetchMock({
    'GET /api/files/img-1/similar': () =>
      jsonResponse({
        profileAvailable: true,
        queryIndexed: true,
        items: [{ fileItemId: 'img-2', name: 'forest.jpg', score: 0.98765 }],
        unavailableReason: null,
      }),
  });
  const { container } = render(
    <AuthedWrapper>
      <MemoryRouter>
        <SimilarPhotosPanel fileId={FILE_ID} onSelect={vi.fn()} />
      </MemoryRouter>
    </AuthedWrapper>,
  );
  await userEvent.click(screen.getByTestId('show-similar-btn'));
  await screen.findByTitle('forest.jpg');

  const text = container.textContent ?? '';
  // No score, no profile/model key, no vector/storage identifiers.
  expect(text).not.toContain('0.98');
  expect(text.toLowerCase()).not.toContain('siglip');
  expect(text.toLowerCase()).not.toContain('profile');
  expect(text.toLowerCase()).not.toContain('vector');
  // The thumbnail src must be the small thumbnail endpoint — never originals.
  const img = container.querySelector('img');
  expect(img?.getAttribute('src')).toContain('/thumbnail?size=small');
});
