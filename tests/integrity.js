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

// The same failure as two functions sharing a name, in the translation tables: whichever copy
// is written last silently wins, so a key defined twice is a label nobody can predict. Found
// f_worker written three times per language on Jobcards - identical values, and therefore
// harmless right up until somebody edits one of them.
function shadowedTranslationKeys(source) {
  const found = new Set();
  for (const table of source.matchAll(/\n\s*(?:en|sv|mk):\{/g)) {
    let depth = 1;
    let i = table.index + table[0].length;
    const start = i;
    while (depth && i < source.length) {
      const c = source[i];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === "'" || c === '"') {
        const quote = c;
        i += 1;
        while (i < source.length && source[i] !== quote) {
          if (source[i] === '\\') i += 1;
          i += 1;
        }
      }
      i += 1;
    }
    const seen = new Set();
    for (const key of source.slice(start, i - 1).matchAll(/(?:^|,)\s*'?([A-Za-z_][\w]*)'?\s*:/gm)) {
      if (seen.has(key[1])) found.add(key[1]);
      seen.add(key[1]);
    }
  }
  return [...found];
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

// Three buttons on the hours screens only ever toggled their own colour — "More detail",
// "Share to team feed" — and the photographs a fourth collected were never read by anything.
// A control whose `on` class nothing downstream reads is a promise the page cannot keep. Where
// the class IS read back (the worker chips on a jobcard are a real multi-select) it is a control,
// so the source is asked whether anything looks for it.
function decorativeToggles(source) {
  const found = [];
  for (const match of source.matchAll(/onclick="this\.classList\.toggle\('([\w-]+)'\)\s*"/g)) {
    const cls = match[1];
    const readBack = new RegExp(`\\.${cls}\\b(?!['"])|classList\\.contains\\(['"]${cls}['"]\\)`);
    const elsewhere = source.split(match[0]).join('');
    if (!readBack.test(elsewhere)) found.push(cls);
  }
  return [...new Set(found)];
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

  const pretending = decorativeToggles(source);
  if (pretending.length) {
    fail(`a button only toggles its own '${pretending.join("', '")}' class — nothing reads it, so it does nothing`);
  }
  const shadowedKeys = shadowedTranslationKeys(source);
  if (shadowedKeys.length) {
    fail(`a translation key is written twice: ${shadowedKeys.join(', ')} — the later one silently wins`);
  }
  const shadowed = duplicateFunctionDeclarations(source);
  if (shadowed.length) {
    fail(`two declarations of ${shadowed.join(', ')} — in JS the later one wins, so the earlier is dead`);
  }
  const page = await context.newPage();
  await page.setViewportSize(viewportFor(file));
  page.on('dialog', (dialog) => dialog.dismiss());
  // Written after this sweep passed a page whose Save button had been deleted by a bad edit -
  // the markup was clean, the ids were unique, and the script threw on load reaching for a
  // button that was no longer there. A page that throws has not been checked, whatever else
  // came back green.
  const thrown = [];
  page.on('pageerror', (error) => thrown.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (/ERR_CERT|favicon|net::/.test(message.text())) return;
    // Every page asks once, on load, whether there is a backend. These suites serve the pages from a
    // static server on purpose — this is the app in browser-storage mode — so the probe comes back
    // 404 and the page handles it by staying local. That is the designed answer, not a throw.
    //
    // Forgiven only for /api/, and only for a failed fetch: a page reaching for a script that is not
    // there still fails here, which is most of what this check is for.
    const from = (message.location() && message.location().url) || '';
    if (/Failed to load resource/.test(message.text()) && /\/api\//.test(from)) return;
    thrown.push(message.text());
  });
  try {
    // Demo data first: this is the page as a person with a running workshop sees it.
    await page.goto(`${baseUrl}/${file}`, { waitUntil: 'load' });
    await page.evaluate(() => window.WorkshopData && window.WorkshopData.loadDemoData());
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(120);

    if (thrown.length) fail(`throws on load: ${[...new Set(thrown)].slice(0, 3).join(' / ')}`);

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
      if (thrown.length) fail(`throws while in use: ${[...new Set(thrown)].slice(0, 3).join(' / ')}`);
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
