# Desktop Google sign-in — one-time Supabase setup

The desktop app signs in with Google through the **system browser** (full,
unchanged Google/Supabase identity flow) and returns the session to the app via
a loopback redirect on `127.0.0.1`. Supabase refuses redirect URLs that are not
allow-listed, so the three loopback URLs must be added once — this is dashboard
configuration only, no code or database changes.

## Redirect URLs to add

In **Supabase Dashboard → your project → Authentication → URL Configuration →
Redirect URLs**, add:

```
http://localhost:53672/callback
http://localhost:53673/callback
http://localhost:53674/callback
```

The app tries the ports in this order and uses the first one that binds. Keep
all three entries even if you only ever see one in use — a port can be occupied
by another program, and the app silently falls back to the next one.

## Do not change

* **Site URL** — stays as-is (the web app's own sign-in uses it).
* Existing web redirect URLs (e.g. `https://with-cnc.vercel.app/dashboard`) —
  the deployed web app keeps working exactly as before.
* Provider settings, RLS, migrations — untouched by the desktop shell.

## Why this works without browser changes

Google redirects back to `http://localhost:<port>/callback`, where the app's
Rust loopback server is listening (bound to `127.0.0.1` only, single-shot,
5-minute timeout). The app uses Supabase's **implicit** flow, so the tokens
travel in the URL *fragment*, which browsers never send to a server — the
loopback server therefore serves a tiny relay page that posts the fragment back
to the app, where `supabase.auth.setSession()` stores it exactly like the web
flow. The private tokens never leave the local machine.

## Verifying

1. Add the three URLs.
2. Launch the desktop app → **Sign in with Google**.
3. The default browser opens Google; after choosing the account you see
   "Sign-in complete — You can close this window".
4. The desktop app completes sign-in and loads the ERP.
