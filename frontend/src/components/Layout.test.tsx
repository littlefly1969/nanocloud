import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { Layout } from './Layout';
import { AuthedWrapper, installFetchMock, jsonResponse } from '../test-utils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderLayout({ isAdmin }: { isAdmin: boolean }) {
  return render(
    <AuthedWrapper isAdmin={isAdmin}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Layout />} />
        </Routes>
      </MemoryRouter>
    </AuthedWrapper>,
  );
}

describe('Layout primary nav', () => {
  it('shows Files / Albums / Library / Shares / Trash for non-admin users', () => {
    renderLayout({ isAdmin: false });
    // Default UI language is Italian.
    expect(screen.getByRole('link', { name: 'File' })).toBeInTheDocument();
    // Slice 5: unified library entry (replaces the split Gallery/Videos links).
    const library = screen.getByRole('link', { name: 'Libreria' });
    expect(library).toBeInTheDocument();
    expect(library).toHaveAttribute('href', '/media');
    expect(screen.getByRole('link', { name: 'Cestino' })).toBeInTheDocument();
    const shares = screen.getByRole('link', { name: 'Condivisioni' });
    expect(shares).toBeInTheDocument();
    expect(shares).toHaveAttribute('href', '/shares');
    const albums = screen.getByRole('link', { name: 'Album' });
    expect(albums).toBeInTheDocument();
    expect(albums).toHaveAttribute('href', '/albums');
    // Slice 93: the staged-upload page is for every authenticated user.
    const upload = screen.getByRole('link', { name: 'Carica' });
    expect(upload).toBeInTheDocument();
    expect(upload).toHaveAttribute('href', '/upload');
  });

  it('does not show the Admin nav link for non-admin users', () => {
    renderLayout({ isAdmin: false });
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('shows the Admin nav link for admin users', () => {
    renderLayout({ isAdmin: true });
    const admin = screen.getByRole('link', { name: 'Admin' });
    expect(admin).toBeInTheDocument();
    expect(admin).toHaveAttribute('href', '/admin');
  });

  it('does not show the admin Utenti nav link for non-admin users', () => {
    renderLayout({ isAdmin: false });
    expect(screen.queryByRole('link', { name: 'Utenti' })).not.toBeInTheDocument();
  });

  it('shows the admin Utenti nav link for admin users', () => {
    renderLayout({ isAdmin: true });
    const users = screen.getByRole('link', { name: 'Utenti' });
    expect(users).toBeInTheDocument();
    expect(users).toHaveAttribute('href', '/admin/users');
  });

  it('shows the Account link for every authenticated user', () => {
    renderLayout({ isAdmin: false });
    const account = screen.getByRole('link', { name: 'Account' });
    expect(account).toBeInTheDocument();
    expect(account).toHaveAttribute('href', '/account');
  });

  it('persists a language change to the user profile via the API', async () => {
    const updateUser = vi.fn();
    const mock = installFetchMock({
      'PUT /api/auth/me/language': () => jsonResponse({
        id: 'user-1', email: 'dev@nanocloud.local', displayName: 'Dev User',
        isAdmin: false, language: 'en',
      }),
    });

    render(
      <AuthedWrapper value={{ updateUser }}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<Layout />} />
          </Routes>
        </MemoryRouter>
      </AuthedWrapper>,
    );

    // Default UI is Italian; the selector label is "Lingua".
    await userEvent.setup().selectOptions(
      screen.getByRole('combobox', { name: 'Lingua' }),
      'en',
    );

    await waitFor(() => {
      expect(mock.calls.some((c) => c.method === 'PUT' && c.url.includes('/api/auth/me/language'))).toBe(true);
    });
    const putCall = mock.calls.find((c) => c.url.includes('/api/auth/me/language'));
    expect(JSON.parse(putCall!.body ?? '{}')).toEqual({ language: 'en' });
    await waitFor(() => expect(updateUser).toHaveBeenCalled());
  });
});
