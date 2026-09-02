'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const HOST = '127.0.0.1';
const SAFE_NAV_SELECTOR = [
  'button[data-lang]',
  'button[data-filter]',
  'button[data-section]:not(.actionitem)',
  'button[data-view]:not([data-view="new-equipment"])',
  'button[data-tab]'
].join(',');

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
  return fs.readdirSync(ROOT)
    .filter((name) => name.endsWith('.html'))
    .sort();
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

function browserCandidates() {
  const configured = process.env.PLAYWRIGHT_CHROME_PATH;
  const platformCandidates = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return [configured, ...platformCandidates].filter(Boolean);
}

function findBrowser() {
  const executable = browserCandidates().find((candidate) => fs.existsSync(candidate));
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
  await new Promise((resolve) => server.close(resolve));
}

async function smokePage(context, baseUrl, file) {
  const page = await context.newPage();
  const errors = [];
  const badResponses = [];
  page.on('dialog', (dialog) => dialog.dismiss());
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const source = message.location().url;
      errors.push(`console${source ? ` (${source})` : ''}: ${message.text()}`);
    }
  });
  page.on('response', (response) => {
    if (response.url().startsWith(baseUrl) && response.status() >= 400) {
      badResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  try {
    await page.goto(`${baseUrl}/${file}`, { waitUntil: 'load' });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('body').isVisible(), true, 'body is not visible');
    assert.ok((await page.locator('body').innerText()).trim().length > 0, 'page rendered no visible text');

    const navCount = await page.locator(SAFE_NAV_SELECTOR).count();
    for (let index = 0; index < navCount; index += 1) {
      const button = page.locator(SAFE_NAV_SELECTOR).nth(index);
      if (await button.isVisible() && await button.isEnabled()) {
        await button.click();
        await page.waitForTimeout(20);
      }
    }

    assert.deepEqual(badResponses, [], `failed local responses:\n${badResponses.join('\n')}`);
    assert.deepEqual(errors, [], `browser errors:\n${errors.join('\n')}`);
  } finally {
    await page.close();
  }
}

async function main() {
  const pages = appPages();
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

    for (const file of pages) {
      await smokePage(context, baseUrl, file);
      console.log(`OK   ${file}`);
    }

    await context.close();
    console.log(`\nBrowser smoke passed for ${pages.length} pages.`);
  } finally {
    if (browser) await browser.close();
    await closeServer(server);
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
