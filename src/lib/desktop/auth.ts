// Desktop Google sign-in: system browser + loopback redirect.
//
// The web app lets Supabase redirect the current tab to Google and back. In the
// desktop shell that is impossible (Tauri blocks top-level cross-origin navigation
// of the main webview), so instead:
//
//   1. `oauth_listen` (Rust) binds 127.0.0.1 on one of ports 53672-53674 and
//      returns the port.
//   2. supabase.auth.signInWithOAuth({ skipBrowserRedirect: true, redirectTo:
//      http://localhost:<port>/callback }) produces the Google authorize URL
//      without navigating anywhere.
//   3. That URL opens in the *system* browser (full Google/Supabase identity
//      flow, unchanged — no credentials ever touch this app).
//   4. Supabase redirects the browser to the loopback server. Because the app
//      uses the implicit grant, the tokens ride in the URL *fragment*, which
//      browsers never send to a server — so the Rust side serves a tiny relay
//      page that posts the fragment back and emits `oauth-callback`.
//   5. Here we parse the fragment and hand the session to supabase-js exactly
//      like the web flow would; all ERP profile/permission loading then happens
//      through the existing onAuthStateChange path (RLS untouched).
//
// The three loopback URLs must be present in the Supabase Dashboard →
// Authentication → URL Configuration → Redirect URL allow-list
// (see docs/desktop/AUTH_SETUP.md).

import { supabase } from '@/lib/supabase';

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000; // matches the Rust listener's window

interface CallbackParams {
  access_token: string | null;
  refresh_token: string | null;
  error: string | null;
  error_description: string | null;
}

function parseCallbackPayload(payload: string): CallbackParams {
  const hash = payload.includes('#') ? payload.slice(payload.indexOf('#') + 1) : '';
  const params = new URLSearchParams(hash);
  return {
    access_token: params.get('access_token'),
    refresh_token: params.get('refresh_token'),
    error: params.get('error'),
    error_description: params.get('error_description'),
  };
}

/**
 * Runs the full desktop sign-in. Resolves once the Supabase session has been
 * established (the ERP then loads its profile through onAuthStateChange), or
 * throws with a message suitable for the login screen.
 */
export async function desktopGoogleSignIn(): Promise<void> {
  const core = await import('@tauri-apps/api/core');
  const events = await import('@tauri-apps/api/event');
  const { invoke, listen } = { invoke: core.invoke, listen: events.listen };

  // 1. Bind the loopback port first so redirectTo can include it.
  const port = await invoke<number>('oauth_listen').catch((err: unknown) => {
    throw new Error(String(err));
  });
  const redirectTo = `http://localhost:${port}/callback`;

  // 2. Build the Google authorize URL without navigating the webview.
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) {
    await invoke('oauth_cancel').catch(() => { /* nothing to cancel */ });
    throw new Error(error.message);
  }
  if (!data.url) {
    await invoke('oauth_cancel').catch(() => { /* nothing to cancel */ });
    throw new Error('Google sign-in could not be started (no authorization URL).');
  }

  // 3+4. Listen for the loopback capture *before* opening the browser.
  const payload = await new Promise<string>((resolve, reject) => {
    let settled = false;
    let unlisten: (() => void) | undefined;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      unlisten?.();
      fn();
    };
    const timer = window.setTimeout(() => {
      finish(() => reject(new Error('Sign-in was not completed within 5 minutes. Please try again.')));
      void invoke('oauth_cancel').catch(() => { /* already stopped */ });
    }, CALLBACK_TIMEOUT_MS);

    listen<string>('oauth-callback', (event: { payload: string }) => {
      finish(() => resolve(event.payload));
    })
      .then((fn: () => void) => {
        if (settled) { fn(); return; }
        unlisten = fn;
      })
      .catch((err: unknown) => {
        finish(() => reject(new Error(`Could not listen for the sign-in result: ${String(err)}`)));
      });

    // 5. Open the system browser once the listener is in place.
    invoke('open_external', { url: data.url })
      .catch((err: unknown) => {
        finish(() => reject(new Error(`Could not open the browser: ${String(err)}`)));
        void invoke('oauth_cancel').catch(() => { /* ignore */ });
      });
  });

  // Parse the implicit-flow fragment and establish the session.
  const params = parseCallbackPayload(payload);
  if (params.error || !params.access_token) {
    const detail = params.error_description || params.error || 'the browser did not return a session';
    throw new Error(`Google sign-in failed: ${decodeURIComponent(detail)}`);
  }
  if (!params.refresh_token) {
    throw new Error(
      'Google sign-in returned no refresh token. Please sign out everywhere in Supabase and try again.',
    );
  }

  const { error: sessionError } = await supabase.auth.setSession({
    access_token: params.access_token,
    refresh_token: params.refresh_token,
  });
  if (sessionError) {
    throw new Error(sessionError.message);
  }
  // onAuthStateChange (AuthContext) picks the session up from here.
}
