import { createContext, useContext, useEffect } from 'react';

// Explicit, page-declared opt-in to the full-width media-wall shell. The app
// uses a component router (<BrowserRouter>/<Routes>), so route `handle` +
// useMatches are unavailable; rather than sniff the pathname (fragile: /albums
// the list vs /albums/:id the workspace), a page that renders MediaWorkspace
// declares its layout need directly. The Layout shell owns the actual class.
export const MediaWallLayoutContext = createContext<(active: boolean) => void>(() => {});

// Call from a page that should render inside the full-width media shell. The
// shell widens while the page is mounted and restores the default afterwards.
export function useMediaWallLayout(): void {
  const setActive = useContext(MediaWallLayoutContext);
  useEffect(() => {
    setActive(true);
    return () => setActive(false);
  }, [setActive]);
}
