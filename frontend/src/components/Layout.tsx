import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { updateMyLanguage } from '@nanocloud/api-client';
import { useAuth } from '../auth/useAuth';
import { useI18n, type Language } from '../i18n';
import { LanguageSwitcher } from './LanguageSwitcher';
import { MediaWallLayoutContext } from './mediaWallLayout';

// App shell shown to authenticated users. Displays the current user's
// display name + email, a primary nav (localized) and a logout button, plus a
// language selector that persists the choice to the user's profile.
export function Layout() {
  const { state, logout, updateUser } = useAuth();
  const { t } = useI18n();
  const [langError, setLangError] = useState(false);
  const [langBusy, setLangBusy] = useState(false);
  // Media-wall pages opt into a full-width main via useMediaWallLayout(); every
  // other page keeps the centred, max-width shell.
  const [mediaFullWidth, setMediaFullWidth] = useState(false);

  if (state.status !== 'authed') {
    // ProtectedRoute already guards this; the branch keeps TS happy.
    return null;
  }

  const isAdmin = state.user.isAdmin;

  const handleLanguage = (next: Language) => {
    setLangError(false);
    setLangBusy(true);
    // Persist to the user's profile; the returned user (with the new language)
    // is pushed into auth state, which re-applies the language via the provider.
    updateMyLanguage(next)
      .then((user) => updateUser(user))
      .catch(() => setLangError(true))
      .finally(() => setLangBusy(false));
  };

  return (
    <>
      <header className="app-header">
        <div className="app-header-brand">
          <h1>NanoCloud</h1>
          <nav className="app-nav" aria-label={t('nav.primary')}>
            <NavLink to="/" end className={navLinkClass}>
              {t('nav.files')}
            </NavLink>
            {/* Slice 5: one unified library entry (Tutti / Foto / Video live
                inside the workspace as tabs). */}
            <NavLink to="/media" className={navLinkClass}>
              {t('mediaLib.title')}
            </NavLink>
            <NavLink to="/albums" className={navLinkClass}>
              {t('nav.albums')}
            </NavLink>
            <NavLink to="/people" className={navLinkClass}>
              {t('nav.people')}
            </NavLink>
            <NavLink to="/plates" className={navLinkClass}>
              {t('nav.plates')}
            </NavLink>
            <NavLink to="/lab/aesthetics" className={navLinkClass}>
              {t('nav.aestheticsLab')}
            </NavLink>
            <NavLink to="/shares" className={navLinkClass}>
              {t('nav.shares')}
            </NavLink>
            <NavLink to="/tv-devices" className={navLinkClass}>
              {t('nav.tvDevices')}
            </NavLink>
            {/* Slice 93: staged (resumable) upload. */}
            <NavLink to="/upload" className={navLinkClass}>
              {t('nav.upload')}
            </NavLink>
            <NavLink to="/cloud-functions" className={navLinkClass}>
              {t('nav.cloudFunctions')}
            </NavLink>
            <NavLink to="/private" className={navLinkClass}>
              {t('nav.private')}
            </NavLink>
            <NavLink to="/trash" className={navLinkClass}>
              {t('nav.trash')}
            </NavLink>
            {isAdmin && (
              // Slice 47: only admins see the Admin entry. The backend
              // still gates `/api/admin/*` independently — this is UX,
              // not security.
              <NavLink to="/admin" end className={navLinkClass}>
                {t('nav.admin')}
              </NavLink>
            )}
            {isAdmin && (
              // Slice 81: admin-only server-side import.
              <NavLink to="/admin/import" className={navLinkClass}>
                {t('nav.import')}
              </NavLink>
            )}
            {isAdmin && (
              // Slice 90: admin-only background-jobs dashboard.
              <NavLink to="/admin/jobs" className={navLinkClass}>
                {t('nav.jobs')}
              </NavLink>
            )}
            {isAdmin && (
              // Admin-only user management (list/create/reset password/
              // grant admin/enable-disable).
              <NavLink to="/admin/users" className={navLinkClass}>
                {t('nav.users')}
              </NavLink>
            )}
          </nav>
        </div>
        <div className="user-info">
          <LanguageSwitcher onSelect={handleLanguage} disabled={langBusy} />
          {langError && (
            <span className="language-switcher-error" role="alert">
              {t('language.updateError')}
            </span>
          )}
          <span aria-label={t('nav.signedInAs')}>{state.user.displayName}</span>
          <span>({state.user.email})</span>
          <NavLink to="/account" className="app-nav-link">
            {t('nav.account')}
          </NavLink>
          <button type="button" className="logout" onClick={() => void logout()}>
            {t('nav.signOut')}
          </button>
        </div>
      </header>
      <main className={`app-main${mediaFullWidth ? ' app-main--media' : ''}`}>
        <MediaWallLayoutContext.Provider value={setMediaFullWidth}>
          <Outlet />
        </MediaWallLayoutContext.Provider>
      </main>
    </>
  );
}

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'app-nav-link app-nav-link-active' : 'app-nav-link';
}
