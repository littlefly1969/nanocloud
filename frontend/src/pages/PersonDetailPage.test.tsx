import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { PersonDetailPage } from './PersonDetailPage';
import { AuthedWrapper, installFetchMock, jsonResponse, emptyResponse, type MockHandler } from '../test-utils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const box = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };

function person(name: string): MockHandler {
  return () => jsonResponse({ personId: 'p-1', name, faceCount: 1, representative: { faceId: 'f-1', fileItemId: 'file-1', name: 'a.png', box } });
}
function photos(): MockHandler {
  return () => jsonResponse([{ fileItemId: 'file-1', name: 'a.png', faces: [{ faceId: 'f-1', box }] }]);
}
function similar(available: boolean): MockHandler {
  return () =>
    jsonResponse({
      profileAvailable: available,
      threshold: 0.35,
      items: available ? [{ faceId: 'f-2', fileItemId: 'file-2', name: 'b.png', box, score: 0.8 }] : [],
      nextCursor: null,
      hasMore: false,
      unavailableReason: available ? null : 'vector-backend-unavailable',
    });
}

function renderDetail(handlers: Record<string, MockHandler>) {
  installFetchMock(handlers);
  return render(
    <AuthedWrapper>
      <MemoryRouter initialEntries={['/people/p-1']}>
        <Routes>
          <Route path="/people/:personId" element={<PersonDetailPage />} />
          <Route path="/people" element={<div>people list</div>} />
        </Routes>
      </MemoryRouter>
    </AuthedWrapper>,
  );
}

it('shows the person, their photos, and similar faces', async () => {
  renderDetail({
    'GET /api/people/p-1': person('Alice'),
    'GET /api/people/p-1/photos': photos(),
    'GET /api/people/p-1/similar-faces': similar(true),
  });
  expect(await screen.findByRole('heading', { name: 'Alice' })).toBeTruthy();
  expect(await screen.findByText('Foto (1)')).toBeTruthy();
  // Similar face result with its score.
  expect(await screen.findByText(/80%/)).toBeTruthy();
});

it('renames the person', async () => {
  const mock = installFetchMock({
    'GET /api/people/p-1': person('Alice'),
    'GET /api/people/p-1/photos': photos(),
    'GET /api/people/p-1/similar-faces': similar(true),
    'PUT /api/people/p-1': person('Alice R'),
  });
  render(
    <AuthedWrapper>
      <MemoryRouter initialEntries={['/people/p-1']}>
        <Routes>
          <Route path="/people/:personId" element={<PersonDetailPage />} />
        </Routes>
      </MemoryRouter>
    </AuthedWrapper>,
  );
  await screen.findByRole('heading', { name: 'Alice' });
  const input = screen.getByLabelText('Nome persona');
  await userEvent.clear(input);
  await userEvent.type(input, 'Alice R');
  await userEvent.click(screen.getByRole('button', { name: 'Rinomina' }));
  await waitFor(() => expect(mock.calls.some((c) => c.method === 'PUT' && c.url.endsWith('/api/people/p-1'))).toBe(true));
});

it('shows the unavailable state when face search is not available', async () => {
  renderDetail({
    'GET /api/people/p-1': person('Alice'),
    'GET /api/people/p-1/photos': photos(),
    'GET /api/people/p-1/similar-faces': similar(false),
  });
  expect(await screen.findByText('Ricerca volti non disponibile in questo ambiente.')).toBeTruthy();
});

it('refetches similar faces when the threshold changes', async () => {
  const mock = installFetchMock({
    'GET /api/people/p-1': person('Alice'),
    'GET /api/people/p-1/photos': photos(),
    'GET /api/people/p-1/similar-faces': similar(true),
  });
  render(
    <AuthedWrapper>
      <MemoryRouter initialEntries={['/people/p-1']}>
        <Routes>
          <Route path="/people/:personId" element={<PersonDetailPage />} />
        </Routes>
      </MemoryRouter>
    </AuthedWrapper>,
  );
  await screen.findByText(/80%/);
  const before = mock.calls.filter((c) => c.url.includes('/similar-faces')).length;

  // Move the threshold slider → debounced refetch with the new value.
  fireEvent.change(screen.getByLabelText('Soglia similarità'), { target: { value: '80' } });

  await waitFor(() => {
    const calls = mock.calls.filter((c) => c.url.includes('/similar-faces'));
    expect(calls.length).toBeGreaterThan(before);
    expect(calls.some((c) => c.url.includes('minSimilarity=0.8'))).toBe(true);
  });
});

it('adds a similar face to the person', async () => {
  const mock = installFetchMock({
    'GET /api/people/p-1': person('Alice'),
    'GET /api/people/p-1/photos': photos(),
    'GET /api/people/p-1/similar-faces': similar(true),
    'POST /api/people/p-1/faces': () => emptyResponse(),
  });
  render(
    <AuthedWrapper>
      <MemoryRouter initialEntries={['/people/p-1']}>
        <Routes>
          <Route path="/people/:personId" element={<PersonDetailPage />} />
        </Routes>
      </MemoryRouter>
    </AuthedWrapper>,
  );
  await screen.findByText(/80%/);
  await userEvent.click(screen.getByRole('button', { name: 'Aggiungi' }));
  await waitFor(() =>
    expect(mock.calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/people/p-1/faces'))).toBe(true),
  );
});
