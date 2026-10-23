import { Capacitor } from '@capacitor/core';
import { supabase } from '@/lib/supabase';

// Sign-in inside the Android app. Google does not allow sign-in inside an app's own web view, and the page the app
// shows lives at https://localhost (so an ordinary redirect would land on "localhost" in the browser). So:
//   1. Supabase builds the Google sign-in address with skipBrowserRedirect;
//   2. it opens in the phone's own browser (Chrome Custom Tab);
//   3. Google -> Supabase -> redirects to com.arguscnc.erp://auth/callback, a link only this app answers to;
//   4. the app receives that link, reads the session out of it and signs in.
// The redirect address com.arguscnc.erp://auth/callback must be listed in Supabase > Authentication > URL Configuration.

export const ANDROID_REDIRECT = 'com.arguscnc.erp://auth/callback';
const TIMEOUT_MS = 5 * 60 * 1000;

export const isAndroidApp = (): boolean => {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
};

function parseReturnUrl(url: string) {
  const hash = url.includes('#') ? url.slice(url.indexOf('#') + 1) : '';
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1).split('#')[0] : '';
  const params = new URLSearchParams(hash || query);
  if (!params.get('access_token') && query) { const q = new URLSearchParams(query); q.forEach((v, k) => { if (!params.has(k)) params.set(k, v); }); }
  return {
    access_token: params.get('access_token'),
    refresh_token: params.get('refresh_token'),
    code: params.get('code'),
    error: params.get('error'),
    error_description: params.get('error_description'),
  };
}

export async function androidGoogleSignIn(): Promise<void> {
  const [{ App }, { Browser }] = await Promise.all([import('@capacitor/app'), import('@capacitor/browser')]);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: ANDROID_REDIRECT, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
  });
  if (error) throw new Error(error.message);
  if (!data.url) throw new Error('Google sign-in could not be started (no authorization address).');

  // Listen for the app being opened by the sign-in link BEFORE opening the browser.
  const returned = await new Promise<string>((resolve, reject) => {
    let done = false;
    let handle: { remove: () => Promise<void> } | undefined;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      void handle?.remove();
      fn();
    };
    const timer = window.setTimeout(() => finish(() => reject(new Error('Sign-in was not completed within 5 minutes. Please try again.'))), TIMEOUT_MS);
    void App.addListener('appUrlOpen', (event: { url: string }) => {
      if (event.url.startsWith(ANDROID_REDIRECT)) finish(() => resolve(event.url));
    }).then((h) => { handle = h; if (done) void h.remove(); });
    Browser.open({ url: data.url }).catch((err: unknown) => finish(() => reject(new Error(`Could not open the browser: ${String(err)}`))));
  });
  try { await Browser.close(); } catch { /* the browser already closed itself */ }

  const p = parseReturnUrl(returned);
  if (p.error) throw new Error(`Google sign-in failed: ${decodeURIComponent(p.error_description || p.error)}`);
  if (p.access_token && p.refresh_token) {
    const { error: e } = await supabase.auth.setSession({ access_token: p.access_token, refresh_token: p.refresh_token });
    if (e) throw new Error(e.message);
    return;
  }
  if (p.code) {
    const { error: e } = await supabase.auth.exchangeCodeForSession(p.code);
    if (e) throw new Error(e.message);
    return;
  }
  throw new Error('Google sign-in returned no session. Check that com.arguscnc.erp://auth/callback is in the Supabase redirect URLs.');
}
