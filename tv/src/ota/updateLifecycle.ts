export type OtaDiagnostics = {
  runtimeVersion: string | null;
  runningUpdateId: string | null;
  embeddedUpdateId: string | null;
  isEmbedded: boolean;
  pending: boolean;
  lastResult: 'idle' | 'disabled' | 'checking' | 'no-update' | 'downloaded' | 'already-downloaded' | 'error';
  lastError: string | null;
};

export type UpdatesApi = {
  isEnabled: boolean;
  runtimeVersion: string | null;
  updateId: string | null;
  isEmbeddedLaunch: boolean;
  checkForUpdateAsync(): Promise<{ isAvailable: boolean }>;
  fetchUpdateAsync(): Promise<{ isNew: boolean }>;
};

let started = false;
let inFlight: Promise<OtaDiagnostics> | null = null;
let diagnostics: OtaDiagnostics = {
  runtimeVersion: null,
  runningUpdateId: null,
  embeddedUpdateId: null,
  isEmbedded: false,
  pending: false,
  lastResult: 'idle',
  lastError: null,
};

export function getOtaDiagnostics(): OtaDiagnostics {
  return { ...diagnostics };
}

/** Starts at most one check for this JS process and never reloads the app. */
export function startBackgroundUpdateCheck(api: UpdatesApi): Promise<OtaDiagnostics> {
  if (inFlight) return inFlight;
  if (started) return Promise.resolve(getOtaDiagnostics());
  started = true;

  diagnostics = {
    ...diagnostics,
    runtimeVersion: api.runtimeVersion,
    runningUpdateId: api.updateId,
    embeddedUpdateId: api.isEmbeddedLaunch ? api.updateId : null,
    isEmbedded: api.isEmbeddedLaunch,
    lastResult: api.isEnabled ? 'checking' : 'disabled',
    lastError: null,
  };

  if (!api.isEnabled) {
    console.info('[OTA]', diagnostics);
    return Promise.resolve(getOtaDiagnostics());
  }

  inFlight = (async () => {
    try {
      const check = await api.checkForUpdateAsync();
      if (!check.isAvailable) {
        diagnostics = { ...diagnostics, lastResult: 'no-update' };
        return getOtaDiagnostics();
      }

      const fetched = await api.fetchUpdateAsync();
      const pending = fetched.isNew === true;
      diagnostics = {
        ...diagnostics,
        pending,
        lastResult: pending ? 'downloaded' : 'already-downloaded',
      };
      return getOtaDiagnostics();
    } catch (error) {
      diagnostics = {
        ...diagnostics,
        lastResult: 'error',
        lastError: error instanceof Error ? error.message : String(error),
      };
      return getOtaDiagnostics();
    } finally {
      console.info('[OTA]', diagnostics);
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Test-only reset; not used by application code. */
export function resetUpdateLifecycleForTests(): void {
  started = false;
  inFlight = null;
  diagnostics = {
    runtimeVersion: null, runningUpdateId: null, embeddedUpdateId: null,
    isEmbedded: false, pending: false, lastResult: 'idle', lastError: null,
  };
}
