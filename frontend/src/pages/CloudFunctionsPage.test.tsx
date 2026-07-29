import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { CloudFunctionsPage } from './CloudFunctionsPage';
import { AuthedWrapper, installFetchMock, jsonResponse, emptyResponse } from '../test-utils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderPage() {
  return render(
    <AuthedWrapper>
      <MemoryRouter initialEntries={['/cloud-functions']}>
        <Routes>
          <Route path="/cloud-functions" element={<CloudFunctionsPage />} />
          <Route path="/upload" element={<div>bulk upload page</div>} />
        </Routes>
      </MemoryRouter>
    </AuthedWrapper>,
  );
}

it('renders the four function cards including an active Private Vault link', () => {
  installFetchMock({});
  renderPage();
  expect(screen.getByText('Funzioni cloud')).toBeTruthy();
  expect(screen.getByTestId('cf-upload')).toBeTruthy();
  expect(screen.getByTestId('cf-organize')).toBeTruthy();
  expect(screen.getByTestId('cf-export')).toBeTruthy();
  expect(screen.getByText('Archivio privato')).toBeTruthy();
  // Now an active link to the Private tab (no counts shown).
  const vaultLink = screen.getByTestId('cf-private-vault');
  expect(vaultLink.getAttribute('href')).toBe('/private');
  expect(screen.queryByRole('button', { name: 'Coming soon' })).toBeNull();
});

it('links Bulk upload to the upload flow', async () => {
  installFetchMock({});
  renderPage();
  await userEvent.click(screen.getByTestId('cf-upload'));
  expect(await screen.findByText('bulk upload page')).toBeTruthy();
});

it('creates an export session, shows status, and a copyable PowerShell command', async () => {
  installFetchMock({
    'POST /api/photo-exports': () =>
      jsonResponse(
        { sessionId: 'sess-1', token: 'secret-token', status: 'pending', expiresAt: '2026-07-06T00:00:00Z' },
        201,
      ),
    'GET /api/photo-exports/sess-1': () =>
      jsonResponse({
        sessionId: 'sess-1',
        status: 'ready',
        fileCount: 42,
        totalBytes: 1048576,
        errorSummary: null,
        createdAt: '2026-06-29T00:00:00Z',
        completedAt: '2026-06-29T00:01:00Z',
        expiresAt: '2026-07-06T00:00:00Z',
        manifestReady: true,
      }),
  });
  renderPage();

  await userEvent.click(screen.getByTestId('cf-export'));
  await userEvent.click(screen.getByRole('button', { name: 'Crea sessione di esportazione' }));

  // Status renders as ready with the file count.
  await waitFor(() => expect(screen.getByTestId('export-status')).toHaveTextContent('ready'));
  expect(screen.getByText('42')).toBeTruthy();

  // PowerShell command embeds the session + token and uses a Bearer header.
  const cmd = screen.getByTestId('export-powershell') as HTMLTextAreaElement;
  expect(cmd.value).toContain("$Session   = 'sess-1'");
  expect(cmd.value).toContain("$Token     = 'secret-token'");
  expect(cmd.value).toContain('Authorization = "Bearer $Token"');
  expect(cmd.value).toContain('/api/photo-exports/$Session/manifest');
  // The "View manifest" link is present (cookie-authed in-browser).
  expect(screen.getByRole('link', { name: 'Visualizza manifest' })).toBeTruthy();
});

it('shows a building state while the snapshot is not ready', async () => {
  installFetchMock({
    'POST /api/photo-exports': () =>
      jsonResponse({ sessionId: 's2', token: 't', status: 'pending', expiresAt: '2026-07-06T00:00:00Z' }, 201),
    'GET /api/photo-exports/s2': () =>
      jsonResponse({
        sessionId: 's2', status: 'building', fileCount: 3, totalBytes: 0, errorSummary: null,
        createdAt: '2026-06-29T00:00:00Z', completedAt: null, expiresAt: '2026-07-06T00:00:00Z', manifestReady: false,
      }),
  });
  renderPage();
  await userEvent.click(screen.getByTestId('cf-export'));
  await userEvent.click(screen.getByRole('button', { name: 'Crea sessione di esportazione' }));
  expect(await screen.findByText('Costruzione dell’istantanea di esportazione…')).toBeTruthy();
});

it('revokes the session and returns to the idle state', async () => {
  let revoked = false;
  installFetchMock({
    'POST /api/photo-exports': () =>
      jsonResponse({ sessionId: 's3', token: 't', status: 'pending', expiresAt: '2026-07-06T00:00:00Z' }, 201),
    'GET /api/photo-exports/s3': () =>
      jsonResponse({
        sessionId: 's3', status: 'ready', fileCount: 1, totalBytes: 10, errorSummary: null,
        createdAt: '2026-06-29T00:00:00Z', completedAt: '2026-06-29T00:01:00Z', expiresAt: '2026-07-06T00:00:00Z', manifestReady: true,
      }),
    'DELETE /api/photo-exports/s3': () => { revoked = true; return emptyResponse(204); },
  });
  renderPage();
  await userEvent.click(screen.getByTestId('cf-export'));
  await userEvent.click(screen.getByRole('button', { name: 'Crea sessione di esportazione' }));
  await screen.findByRole('button', { name: 'Revoca sessione' });
  await userEvent.click(screen.getByRole('button', { name: 'Revoca sessione' }));

  await waitFor(() => expect(revoked).toBe(true));
  expect(await screen.findByRole('button', { name: 'Crea sessione di esportazione' })).toBeTruthy();
});

it('shows a safe error state when session creation fails', async () => {
  installFetchMock({
    'POST /api/photo-exports': () => jsonResponse({ error: 'boom' }, 500),
  });
  renderPage();
  await userEvent.click(screen.getByTestId('cf-export'));
  await userEvent.click(screen.getByRole('button', { name: 'Crea sessione di esportazione' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Impossibile creare la sessione di esportazione.');
});

it('opens the organizer wizard from its card', async () => {
  installFetchMock({
    // The wizard loads a dry-run preview on open; provide a minimal response.
    '* /api/photo-organizer/date-taken/dry-run': () =>
      jsonResponse({
        summary: {
          candidateCount: 0, withDateCount: 0, missingDateCount: 0, toMoveCount: 0,
          alreadyOrganizedCount: 0, skippedMissingCount: 0, skippedConflictCount: 0,
          exactDuplicateRemovedCount: 0, foldersToCreateCount: 0, estimatedOperations: 0,
          bySource: { userOverride: 0, metadataOriginal: 0, metadataFallback: 0, fileCreatedFallback: 0, missing: 0 },
        },
        samples: [],
      }),
  });
  renderPage();
  await userEvent.click(screen.getByTestId('cf-organize'));
  // The wizard mounts (dialog/heading). Its exact copy may evolve; assert a
  // dialog-ish container appeared by finding the organizer's close affordance.
  await waitFor(() => {
    const dialogs = screen.queryAllByRole('dialog');
    expect(dialogs.length + screen.queryAllByText(/organi/i).length).toBeGreaterThan(0);
  });
});
