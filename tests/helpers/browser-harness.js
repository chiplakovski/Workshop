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

function monitorPage(page, baseUrl) {
  const browserErrors = [];
  const badResponses = [];
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const source = message.location().url;
      browserErrors.push(`console${source ? ` (${source})` : ''}: ${message.text()}`);
    }
  });
  page.on('response', (response) => {
    if (response.url().startsWith(baseUrl) && response.status() >= 400) {
      badResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  return {
    assertClean() {
      assert.deepEqual(badResponses, [], `failed local responses:\n${badResponses.join('\n')}`);
      assert.deepEqual(browserErrors, [], `browser errors:\n${browserErrors.join('\n')}`);
    }
  };
}

module.exports = { appPages, monitorPage, startBrowserHarness };
