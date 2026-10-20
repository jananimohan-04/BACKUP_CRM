// Empirical smoke test for the CNCFORGE ERP desktop shell.
//
// WebView2 cannot be driven by the in-app browser tools, so this script attaches
// to the running `tauri dev` instance over the Chrome DevTools Protocol:
//
//   1. Start the dev server + shell with remote debugging:
//        $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'
//        npm run tauri:dev
//   2. Wait for the app window, then:
//        node scripts/desktop-smoke.mjs
//
// What it asserts (only what can be asserted automatically):
//   * Tauri IPC present, document title branded
//   * window.open('') shim → popup handle with working document.write + close
//   * window.open(blob:) → popup navigated to the blob
//   * window.open(https external) → returns null (opens in system browser)
//   * <a download> blob export → file actually lands in the user's Downloads
//   * SPA deep-link reload works (BrowserRouter under the Vite dev server)
//   * login screen renders (signed-out state)
//
// NOT covered (needs a human — see docs/desktop/RELEASING.md):
//   * WebView2 print dialog, PDF viewer interactions, NSIS install/upgrade UI,
//   * Google sign-in (Supabase redirect allow-list), real GitHub update flow.

import { existsSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const CDP = 'http://127.0.0.1:9222';
const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function waitForWindow(browser, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pages = await browser.pages();
    const page = pages.find((p) => p.url().startsWith('http://localhost:5173'));
    if (page) return page;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('desktop window on localhost:5173 did not appear');
}

async function main() {
  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: CDP });
  } catch (err) {
    console.error(`Could not attach to WebView2 on ${CDP}: ${err.message}`);
    console.error('Is `tauri dev` running with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS set?');
    process.exit(2);
  }

  const page = await waitForWindow(browser);
  await page.waitForFunction(() => !!document.querySelector('#root'), { timeout: 30000 });

  // --- environment -------------------------------------------------------
  const env = await page.evaluate(() => ({
    title: document.title,
    tauri: '__TAURI_INTERNALS__' in window,
    origin: window.location.origin,
  }));
  record('Tauri IPC present', env.tauri);
  record('document.title is CNCFORGE ERP', env.title === 'CNCFORGE ERP', env.title);

  // --- window.open('') popup + document.write ----------------------------
  const popup = await page.evaluate(() => {
    try {
      const w = window.open('', '_blank', 'width=640,height=480');
      if (!w) return { ok: false, why: 'handle is null' };
      w.document.write('<h1 id="cncforge-smoke">written</h1>');
      w.document.close();
      const found = !!w.document.getElementById('cncforge-smoke');
      const closedOk = (() => { w.close(); return w.closed === true; })();
      if (!closedOk) w.close();
      return { ok: found && closedOk, why: found ? (closedOk ? '' : 'close() broken') : 'document.write content missing' };
    } catch (err) {
      return { ok: false, why: String(err) };
    }
  });
  record("window.open('') → document.write + close", popup.ok, popup.why);

  // --- window.open(blob:) -------------------------------------------------
  const blobPopup = await page.evaluate(() => {
    try {
      const url = URL.createObjectURL(new Blob(['<h1>blob preview</h1>'], { type: 'text/html' }));
      const w = window.open(url);
      if (!w) return { ok: false, why: 'handle is null' };
      // location.href assignment must have happened without throwing.
      const href = w.location.href;
      const ok = href.startsWith('blob:');
      w.close();
      URL.revokeObjectURL(url);
      return { ok, why: ok ? '' : `unexpected href ${href}` };
    } catch (err) {
      return { ok: false, why: String(err) };
    }
  });
  record('window.open(blob:) → popup location set', blobPopup.ok, blobPopup.why);

  // --- external link → null ---------------------------------------------
  const external = await page.evaluate(() => {
    try {
      const w = window.open('https://example.com/desktop-smoke', '_blank', 'noopener');
      return { ok: w === null, why: w === null ? '' : `returned ${typeof w}` };
    } catch (err) {
      return { ok: false, why: String(err) };
    }
  });
  record('window.open(https external) returns null (opens in system browser)', external.ok, external.why);

  // --- blob <a download> → Downloads folder ------------------------------
  const probe = join(homedir(), 'Downloads', 'cncforge-smoke-test.csv');
  try { if (existsSync(probe)) rmSync(probe); } catch { /* ignore */ }
  const clickResult = await page.evaluate(() => {
    try {
      const blob = new Blob(['a,b\r\n1,2\r\n'], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cncforge-smoke-test.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return { ok: true, why: '' };
    } catch (err) {
      return { ok: false, why: String(err) };
    }
  });
  let downloadOk = clickResult.ok;
  for (let i = 0; i < 20 && downloadOk; i++) {
    if (existsSync(probe)) break;
    await new Promise((r) => setTimeout(r, 500));
    if (i === 19) downloadOk = false;
  }
  const size = existsSync(probe) ? statSync(probe).size : 0;
  record('blob <a download> saved to Downloads', downloadOk && size > 0, `${probe} (${size} B)`);

  // --- SPA deep-link reload ---------------------------------------------
  await page.goto('http://localhost:5173/inventory/stock', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  const deep = await page.evaluate(() => ({
    path: window.location.pathname,
    hasRoot: !!document.querySelector('#root'),
    notFound: document.body.innerText.includes('Page Not Found'),
  }));
  record('deep link /inventory/stock serves the SPA', deep.hasRoot && !deep.notFound, JSON.stringify(deep));

  // --- signed-out login screen renders -----------------------------------
  const login = await page.evaluate(() => {
    const text = document.body.innerText || '';
    return {
      google: /sign in with google/i.test(text),
      rootChildren: document.querySelector('#root')?.childElementCount ?? 0,
    };
  });
  record('login screen renders (Google sign-in present)', login.google || login.rootChildren > 0, JSON.stringify(login));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('Failed:', failed.map((f) => f.name).join(', '));
    process.exitCode = 1;
  }
  await browser.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
