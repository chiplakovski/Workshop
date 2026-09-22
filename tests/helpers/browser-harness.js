'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..', '..');
const HOST = '127.0.0.1';
const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

function appPages() {
  return fs.readdirSync(ROOT).filter((name) => name.endsWith('.html')).sort();
}

function createStaticServer() {
  return http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, `http://${HOST}`).pathname);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    if (pathname === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }

    const relative = pathname === '/' ? 'login.html' : pathname.replace(/^\/+/, '');
    const target = path.resolve(ROOT, relative);
    const insideRoot = target === ROOT || target.startsWith(`${ROOT}${path.sep}`);
    if (!insideRoot || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      res.writeHead(404).end('Not found');
      return;
    }

    res.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': CONTENT_TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream'
    });
    fs.createReadStream(target).pipe(res);
  });
}

function findBrowser() {
  const configured = process.env.PLAYWRIGHT_CHROME_PATH;
  const defaults = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const executable = [configured, ...defaults].filter(Boolean).find((candidate) => fs.existsSync(candidate));
  if (!executable) {
    throw new Error('No supported browser found. Set PLAYWRIGHT_CHROME_PATH to a Chrome/Edge/Chromium executable.');
  }
  return executable;
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, resolve);
  });
  return server.address().port;
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function startBrowserHarness() {
  const server = createStaticServer();
  let browser;
  try {
    const port = await listen(server);
    const baseUrl = `http://${HOST}:${port}`;
    browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route('**/*', async (route) => {
      if (route.request().url().startsWith(baseUrl)) await route.continue();
      else await route.fulfill({ status: 204, body: '' });
    });
    return {
      baseUrl,
      context,
      async close() {
        await context.close();
        await browser.close();
        await closeServer(server);
      }
    };
  } catch (error) {
    if (browser) await browser.close();
    await closeServer(server);
    throw error;
  }
}

// Every page now asks once, on load, whether there is a backend to talk to — and in these suites
// there is not, because they serve the pages from a static server on purpose: this is the app in
// browser-storage mode, which is how it is built and how the workshop runs it today. The probe coming
// back 404 is the designed answer, not a fault, and the page handles it by staying local.
//
// Narrow on purpose. Only /api/ is forgiven, and only its 404: a missing script or a page reaching
// for something that is not there is still a failure here, which is what this monitor is for.
const PROBING_FOR_A_BACKEND = /\/api\//;

function monitorPage(page, baseUrl) {
  const browserErrors = [];
  const badResponses = [];
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    // The browser logs a console error for any non-2xx fetch, including the backend probe above.
    // The response handler below is what judges our own responses, so this one can ignore the pair.
    if (/Failed to load resource/.test(message.text())) return;
    const source = message.location().url;
    browserErrors.push(`console${source ? ` (${source})` : ''}: ${message.text()}`);
  });
  page.on('response', (response) => {
    if (!response.url().startsWith(baseUrl) || response.status() < 400) return;
    if (response.status() === 404 && PROBING_FOR_A_BACKEND.test(response.url())) return;
    badResponses.push(`${response.status()} ${response.url()}`);
  });
  return {
    assertClean() {
      assert.deepEqual(badResponses, [], `failed local responses:\n${badResponses.join('\n')}`);
      assert.deepEqual(browserErrors, [], `browser errors:\n${browserErrors.join('\n')}`);
    }
  };
}

// The application now opens on an empty system, the way a workshop meets it on its first day.
// These suites exercise workflows over a populated one - a board with projects on it, a store with
// stock in it - so each asks for the demonstration fixture explicitly before it starts.
async function loadDemoData(page) {
  await page.evaluate(() => window.WorkshopData.loadDemoData());
  await page.reload({ waitUntil: 'load' });
  await settle(page);
}

// The pages load their headings from a web font. Until it arrives they are laid out in the
// fallback, and when it swaps in the toolbar buttons change width — enough, on Store, to wrap
// the top bar onto a second row and push the board 38px down the page. A test that measured
// where something was before that happened then aimed at where it used to be, and a drag test
// landed one lane out. It looked like a flaky drag; it was a font arriving late.
//
// Anything that measures geometry waits for this first. It is cheap, and the alternative is a
// suite nobody trusts.
async function settle(page) {
  await page.evaluate(async () => {
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (_) { /* no font API */ }
    // fonts.ready resolves as soon as nothing is pending, which is immediately true while the
    // stylesheet itself is still in flight. So rather than trust one signal, wait for the page
    // to stop moving: the same height twice in a row, or give up after a second and carry on.
    const height = () => document.documentElement.scrollHeight + ':' + document.body.clientWidth +
      ':' + Math.round((document.querySelector('.top,.topfull,header') || document.body).getBoundingClientRect().height);
    let last = height();
    for (let i = 0; i < 20; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const now = height();
      if (now === last) return;
      last = now;
    }
  });
}

module.exports = { appPages, monitorPage, startBrowserHarness, loadDemoData, settle };
