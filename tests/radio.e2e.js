'use strict';

// The hub's radio says what is really happening. It used to show "playing" whatever the stream did:
// a station that had moved its address left the bar animating over silence, with the failure
// swallowed. The stations stand in here — the real ones are on the internet, which a test cannot
// depend on: the first address of each answers 404, the backup plays a short tone.

const assert = require('node:assert/strict');
const { startBrowserHarness } = require('./helpers/browser-harness');

function tone() {
  const n = 8000 * 3, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1) b.writeInt16LE(Math.round(8000 * Math.sin(i / 8)), 44 + i * 2);
  return b;
}

async function radioAfterPlay(harness, backupWorks) {
  const page = await harness.context.newPage();
  await page.route(/^https:\/\/(?!fonts\.)/, (route) => {
    if (backupWorks && route.request().url().includes('http-live.sr.se')) {
      return route.fulfill({ status: 200, contentType: 'audio/wav', body: tone() });
    }
    return route.fulfill({ status: 404, body: 'moved' });
  });
  await page.goto(`${harness.baseUrl}/hub-desktop.html`, { waitUntil: 'load' });
  await page.click('#radioBtn');
  await page.waitForFunction(() => !/…/.test(document.getElementById('radioState').textContent), null, { timeout: 10000 });
  const seen = await page.evaluate(() => ({
    state: document.getElementById('radioState').textContent,
    animating: document.getElementById('radio').classList.contains('playing'),
    why: document.getElementById('radioState').title
  }));
  await page.close();
  return seen;
}

async function main() {
  const harness = await startBrowserHarness();
  try {
    const moved = await radioAfterPlay(harness, true);
    assert.equal(moved.state, 'Live', 'a station whose first address has moved plays from its backup');
    assert.ok(moved.animating);
    console.log('OK   a station that moved its stream plays from the backup address');

    const gone = await radioAfterPlay(harness, false);
    assert.equal(gone.state, 'Unreachable', 'with no address answering, the radio says so');
    assert.ok(!gone.animating, 'and does not animate as if it were playing');
    assert.match(gone.why, /internet/, 'and says what to check');
    console.log('OK   a station nobody can reach says so instead of pretending to play');

    // ── Every page, and carried on from the last one ─────────────────────────────────────────
    // It was the hub's alone: open any other page and the music stopped, and no page had a player.
    {
      const page = await harness.context.newPage();
      await page.route(/^https:\/\/(?!fonts\.)/, (route) => (route.request().url().includes('http-live.sr.se')
        ? route.fulfill({ status: 200, contentType: 'audio/wav', body: tone() }) : route.fulfill({ status: 404, body: 'moved' })));
      await page.goto(`${harness.baseUrl}/hub-desktop.html`, { waitUntil: 'load' });
      await page.waitForSelector('#radioExp');
      await page.click('#radioExp');
      await page.click('#stationList .st:has-text("Sveriges Radio P3")');
      await page.waitForFunction(() => document.getElementById('radioState').textContent === 'Live', null, { timeout: 10000 });
      for (const next of ['store-desktop.html', 'planning-desktop.html', 'suppliers-desktop.html']) {
        await page.goto(`${harness.baseUrl}/${next}`, { waitUntil: 'load' });
        await page.waitForSelector('#radio', { timeout: 8000 });
        assert.equal(await page.locator('#radioName').textContent(), 'Sveriges Radio P3', `${next} has the radio, on the station chosen before`);
        await page.waitForFunction(() => /^(Live|Press ▶ to continue)$/.test(document.getElementById('radioState').textContent), null, { timeout: 10000 });
      }
      console.log('OK   every desktop page has the radio, on the same station, carrying on from the page before');
      await page.close();
    }

    // ── The copy on one PC: in the bar above the pages, so it never stops ───────────────────────
    {
      const os = require('node:os'), fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'varmak-radio-'));
      const file = path.join(dir, 'Varmak-Workshop.html');
      execFileSync('node', [path.join(__dirname, '..', 'tools', 'make-local.js'), path.join(__dirname, '..'), file], { stdio: 'pipe' });
      // Its own context: the harness's answers only for its own server, and this copy is a file.
      const own = await harness.context.browser().newContext({ viewport: { width: 1440, height: 900 } });
      const page = await own.newPage();
      await page.route(/^https?:\/\//, (route) => (route.request().url().includes('http-live.sr.se')
        ? route.fulfill({ status: 200, contentType: 'audio/wav', body: tone() }) : route.fulfill({ status: 404, body: 'moved' })));
      await page.goto('file://' + file, { waitUntil: 'load' });
      await page.click('#radioSlot #radioBtn');
      await page.waitForFunction(() => document.getElementById('radioState').textContent === 'Live', null, { timeout: 10000 });
      const before = await page.evaluate(() => { const a = document.getElementById('radioAudio'); a.__mark = 'same'; return a.currentSrc; });
      const frame = () => page.frames().find((f) => f !== page.mainFrame());
      for (const next of ['hub-desktop.html', 'store-desktop.html', 'planning-desktop.html']) {
        await frame().evaluate((to) => window.__nav(to), next);
        await page.waitForFunction((m) => window.frames[0] && window.frames[0].__module === m, next.replace('.html', ''), { timeout: 8000 });
        assert.equal(await frame().locator('#radio').count(), 0, `${next} inside the PC copy draws no second radio`);
      }
      const after = await page.evaluate(() => { const a = document.getElementById('radioAudio');
        return { mark: a.__mark, src: a.currentSrc, paused: a.paused, state: document.getElementById('radioState').textContent }; });
      assert.deepEqual(after, { mark: 'same', src: before, paused: false, state: 'Live' }, 'the same player, never stopped, through three pages');
      console.log('OK   in the copy on one PC the radio is in the top bar and plays on while the pages change');
      await own.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } finally {
    await harness.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
