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
  } finally {
    await harness.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
