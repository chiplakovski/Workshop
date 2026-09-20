'use strict';

// Every defect found in the last three passes was found by measuring, never by looking: a KPI
// card and a tab panel sharing an id so the panel never opened, two status controls that could
// disagree and silently empty a list, a new function written beside the old one so the old one
// kept running, thirteen orphaned markup fragments rendering as loose text down a sidebar.
// None of them threw. None of them failed a test. All of them were visible to anyone who
// checked the right thing.
//
// This is that check, made permanent and run over every page. It asserts the boring structural
// promises the app makes to itself, so the next one of these is caught on the day it is written
// rather than three passes later.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { appPages, startBrowserHarness } = require('./helpers/browser-harness');

const ROOT = path.resolve(__dirname, '..');
const LANGS = ['en', 'sv', 'mk'];

// A page is checked at the width it is for. The mobile pages and the login screen are what a
// welder opens on a phone in the workshop, so they are held to a phone; the desktop pages are
// held to a laptop. Sideways scrolling on a phone is how a form loses its Save button.
const PHONE = { width: 390, height: 780 };
const LAPTOP = { width: 1440, height: 900 };
const PHONE_PAGES = new Set(['hours-mobile.html', 'hub-mobile.html', 'login.html']);
function viewportFor(file) { return PHONE_PAGES.has(file) ? PHONE : LAPTOP; }

// A figure a person reads as fact. On a system with no records these may only say nothing —
// 0, N/A, a dash. Anything else is a number the app invented about a workshop it knows nothing
// about, which is the one failure this project treats as unacceptable.
const HONEST_EMPTY = /^(n\/a|—|-|0|0%|0h|0 h|sek 0|0 kr|—h|)$/i;

function readPage(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

// ── Static checks: things readable from the file itself ────────────────────────────────────

function duplicateFunctionDeclarations(source) {
  const counts = new Map();
  for (const match of source.matchAll(/^function ([A-Za-z_$][\w$]*)\(/gm)) {
    counts.set(match[1], (counts.get(match[1]) || 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([name]) => name);
}

// ── Live checks: things only the rendered page can answer ──────────────────────────────────

async function liveDuplicateIds(page) {
  return page.evaluate(() => {
    const seen = new Set();
    const dupes = new Set();
    document.querySelectorAll('[id]').forEach((el) => {
      if (seen.has(el.id)) dupes.add(el.id);
      seen.add(el.id);
    });
    return [...dupes];
  });
}

async function horizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

// A label that renders its own key is a translation that was never written. Checked in every
// language, because a key present in English and missing in Swedish reads as gibberish to the
// person who actually opens it in Swedish.
async function untranslatedKeys(page) {
  const missing = new Set();
  for (const lang of LANGS) {
    const switched = await page.evaluate((code) => {
      const button = document.querySelector(`[data-lang="${code}"]`);
      if (!button) return false;
      button.click();
      return true;
    }, lang);
    if (!switched) continue;
    await page.waitForTimeout(60);
    const found = await page.evaluate((code) => [...document.querySelectorAll('[data-i]')]
      .filter((el) => !el.querySelector('*') && el.textContent.trim() === el.getAttribute('data-i'))
      .map((el) => `${code}:${el.getAttribute('data-i')}`), lang);
    found.forEach((key) => missing.add(key));
  }
  return [...missing];
}

// The Quality sidebar bug: removing a nav button left its <span> behind, so thirteen labels
// rendered as loose text down the side of the page. A nav's own group captions are headings
// and mark themselves as such (<b class="navgroup">); a bare <span> among the buttons is the
// wreckage of a button that was deleted around it.
async function orphanedNavLabels(page) {
  return page.evaluate(() => [...document.querySelectorAll('nav span[data-i]')]
    .filter((el) => el.offsetParent && !el.closest('button,a,label,summary'))
    .map((el) => el.getAttribute('data-i')));
}

async function invented(page) {
  return page.evaluate((pattern) => {
    const honest = new RegExp(pattern, 'i');
    return [...document.querySelectorAll('.kv')]
      .filter((el) => el.offsetParent && !honest.test(el.textContent.trim()))
      .map((el) => `${el.id || '(unnamed)'}=${el.textContent.trim()}`);
  }, HONEST_EMPTY.source);
}

async function everySection(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-section]')].map((b) => b.dataset.section));
}

// ── The run ────────────────────────────────────────────────────────────────────────────────

async function checkPage(context, baseUrl, file, failures) {
  const fail = (what) => failures.push(`${file}: ${what}`);
  const source = readPage(file);

  const shadowed = duplicateFunctionDeclarations(source);
  if (shadowed.length) {
    fail(`two declarations of ${shadowed.join(', ')} — in JS the later one wins, so the earlier is dead`);
  }
  const page = await context.newPage();
  await page.setViewportSize(viewportFor(file));
  page.on('dialog', (dialog) => dialog.dismiss());
  try {
    // Demo data first: this is the page as a person with a running workshop sees it.
    await page.goto(`${baseUrl}/${file}`, { waitUntil: 'load' });
    await page.evaluate(() => window.WorkshopData && window.WorkshopData.loadDemoData());
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(120);

    const dupes = await liveDuplicateIds(page);
    if (dupes.length) {
      fail(`two elements share an id: ${dupes.join(', ')} — getElementById can only ever return one`);
    }
    const orphans = await orphanedNavLabels(page);
    if (orphans.length) {
      fail(`text loose in the navigation, belonging to no button: ${orphans.slice(0, 6).join(', ')}`);
    }
    const overflow = await horizontalOverflow(page);
    if (overflow > 0) {
      const { width } = viewportFor(file);
      fail(`at ${width}px the page is ${overflow}px wider than the window — it scrolls sideways`);
    }

    const untranslated = await untranslatedKeys(page);
    if (untranslated.length) {
      fail(`labels showing their own key instead of a translation: ${untranslated.slice(0, 6).join(', ')}`);
    }

    // Then the same page with nothing in it, which is how it opens for a new workshop.
    await page.evaluate(() => window.WorkshopData && window.WorkshopData.reset());
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(120);

    const sections = await everySection(page);
    const visited = sections.length ? sections : [null];
    for (const section of visited) {
      if (section) {
        const button = page.locator(`[data-section="${section}"]`).first();
        if (await button.isVisible() && await button.isEnabled()) {
          await button.click();
          await page.waitForTimeout(90);
        }
      }
      const figures = await invented(page);
      if (figures.length) {
        fail(`${section || 'page'} shows a figure on an empty system: ${figures.slice(0, 5).join(', ')}`);
      }
    }
  } finally {
    await page.close();
  }
}

async function main() {
  const harness = await startBrowserHarness();
  const failures = [];
  try {
    for (const file of appPages()) {
      await checkPage(harness.context, harness.baseUrl, file, failures);
      console.log(`OK   ${file}`);
    }
  } finally {
    await harness.close();
  }
  if (failures.length) {
    console.error(`\n${failures.length} integrity problem(s):\n`);
    failures.forEach((line) => console.error(`  ${line}`));
    assert.fail(`${failures.length} integrity problem(s) — see above`);
  }
  console.log(`\nIntegrity checks passed for ${appPages().length} pages.`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
