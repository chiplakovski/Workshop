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
// The conversion tool's detector, so the check and the tool cannot disagree about which Latin belongs
// in a Macedonian string. Two lists for one question is how the first version of both got it wrong.
const { latinLeftIn } = require('../tools/translit.js');

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
// Each en:{...}/sv:{...}/mk:{...} table in a page, as { lang, body }. Brace-counting rather than a
// regex, and it skips over quoted text, because a translation of "Hold {reason}" contains braces and
// a naive scan stops at the first one.
function translationTables(source) {
  const tables = [];
  for (const table of source.matchAll(/\n\s*(en|sv|mk):\{/g)) {
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
    tables.push({ lang: table[1], body: source.slice(start, i - 1) });
  }
  return tables;
}

function shadowedTranslationKeys(source) {
  const found = new Set();
  for (const { body } of translationTables(source)) {
    const seen = new Set();
    for (const key of body.matchAll(/(?:^|,)\s*'?([A-Za-z_][\w]*)'?\s*:/gm)) {
      if (seen.has(key[1])) found.add(key[1]);
      seen.add(key[1]);
    }
  }
  return [...found];
}


// A sentence with a hole in it, and a translation with no hole to fill. `notify(tr('wps_approved')
// .replace('{no}', ref))` read "Approved" on every screen and in every language, because
// `wps_approved` was already the name of a KPI card — one key, two meanings, and the substitution
// quietly did nothing. Nothing threw: `String.replace` with no match returns the string unchanged,
// which is the whole reason this needs checking rather than noticing.
//
// So: whatever a page substitutes into, every language's value for that key has to have the hole.
function placeholdersWithNothingToFill(source) {
  const tables = translationTables(source);
  if (!tables.length) return [];
  const values = new Map();
  for (const { lang, body } of tables) {
    const seen = new Map();
    for (const entry of body.matchAll(/(?:^|[\s,{])'?([A-Za-z_][\w]*)'?\s*:\s*'((?:\\.|[^'\\])*)'/g)) {
      seen.set(entry[1], entry[2]);
    }
    values.set(lang, seen);
  }
  const wrong = [];
  // Every tr('key') followed by one or more .replace('{hole}', …) — the chained ones each count,
  // because a sentence taking two substitutions needs both holes in all three languages.
  for (const use of source.matchAll(/\btr\(\s*'([A-Za-z_][\w]*)'\s*\)((?:\s*\.replace\(\s*'\{[a-zA-Z]+\}'[^)]*\))+)/g)) {
    const key = use[1];
    const holes = [...use[2].matchAll(/'(\{[a-zA-Z]+\})'/g)].map((m) => m[1]);
    for (const [lang, seen] of values) {
      if (!seen.has(key)) { wrong.push(`${lang}:${key} is substituted into and does not exist`); continue; }
      for (const hole of holes) {
        if (!seen.get(key).includes(hole)) {
          wrong.push(`${lang}:${key} is given ${hole} and has nowhere to put it`);
        }
      }
    }
  }
  return [...new Set(wrong)];
}

// Keys reached through a variable, which the eye and the rendered page both miss. submitQual loops over
// [['wq_no','err_qual_no'],['wq_process','err_process'],['wq_issuedby','err_issued_by']] and calls tr(key)
// — two of those three keys did not exist in any language, so the form would have told a welder
// "err_qual_no". No label on the page renders them, so the live sweep could not see them either.
//
// The invariant: in a literal list of pairs where some second element is a translation key, they all are.
// A list holding one real key and two invented ones is a list nobody was checking.
function keysNamedInAListThatDoNotExist(source) {
  const tables = translationTables(source);
  if (!tables.length) return [];
  const known = new Map();
  for (const { lang, body } of tables) {
    const seen = new Set();
    for (const entry of body.matchAll(/(?:^|[\s,{])'?([A-Za-z_][\w]*)'?\s*:\s*['"`]/g)) seen.add(entry[1]);
    known.set(lang, seen);
  }
  const anywhere = new Set([...known.values()].flatMap((s) => [...s]));
  const missing = [];
  for (const list of source.matchAll(/\[\s*(\[\s*'[^']*'\s*,\s*'[^']*'\s*\]\s*,?\s*){2,}\]/g)) {
    const pairs = [...list[0].matchAll(/\[\s*'([^']*)'\s*,\s*'([^']*)'\s*\]/g)].map((m) => m[2]);
    if (!pairs.some((key) => anywhere.has(key))) continue;
    for (const key of pairs) {
      if (!anywhere.has(key)) { missing.push(`${key} is named beside real keys and is not one`); continue; }
      for (const [lang, seen] of known) {
        if (!seen.has(key)) missing.push(`${lang}:${key}`);
      }
    }
  }
  return [...new Set(missing)];
}

// wPrompt(message, initial, onOk) — three arguments, and the callback is the third. Called with two, the
// callback lands in `initial`: the box opens with the source text of a function typed into its input, and
// OK does nothing at all. Nothing throws and nothing is logged; the person clicks OK and the repair they
// just described is not recorded.
//
// Written down because it happened twice in one file, on the two prompts a welder would actually use.
function promptsThatGoNowhere(source) {
  const wrong = [];
  const looksLikeAFunction = /^\s*(async\b|function\b|\(\s*[A-Za-z_$,\s]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/;
  for (const call of source.matchAll(/\bwPrompt\(/g)) {
    let i = call.index + call[0].length;
    let depth = 0;
    let firstComma = -1;
    for (; i < source.length; i += 1) {
      const c = source[i];
      if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' || c === ']' || c === '}') { if (!depth) break; depth -= 1; }
      else if (c === "'" || c === '"' || c === '`') {
        const quote = c;
        i += 1;
        while (i < source.length && source[i] !== quote) { if (source[i] === '\\') i += 1; i += 1; }
      } else if (c === ',' && !depth) { firstComma = i; break; }
    }
    if (firstComma < 0) { wrong.push('a wPrompt with one argument and no callback at all'); continue; }
    const second = source.slice(firstComma + 1, firstComma + 40);
    if (looksLikeAFunction.test(second)) {
      wrong.push(`a wPrompt whose callback is its second argument: ${second.trim().slice(0, 30)}…`);
    }
  }
  return [...new Set(wrong)];
}

// A screen that calls its own records a demonstration.
//
// Every page shipped with at least one line saying so, because when they were written it was true. It
// stopped being true and the lines stayed: Reports said "Reports use browser demonstration data" over
// figures read out of Postgres and printed "Report status: Demonstration data" on the sheet somebody files;
// Equipment said safety controls, permissions and audit logging "require the future secured backend", all
// three of which are enforced in the database and tested; Quality said the same about approvals. A page
// that calls a real record a demonstration is worse than one that says nothing, because the reader stops
// believing the true half either — and the true half is the part that says what is genuinely still missing.
//
// So the words are not allowed loose. A value may say "demo" or "prototype" only where it is one of these:
const MAY_SAY_DEMONSTRATION = new Map([
  // The login screen's own demonstration door, which is exactly what it is.
  ['btn', 'the login screen\'s "Open local demo" button, which opens the demonstration'],
  ['hint', 'the login screen saying authentication is off on the local demonstration'],
  // The pair the page picks between at paint time. The demo half is shown only on browser storage.
  ['reporting_status_text', 'shown only when the snapshot did come from browser storage'],
  ['print_from_browser', 'the printed provenance line, shown only on browser storage'],
  // The demonstration state the data layer ships, described where it is described.
  ['demo_reset', 'the control that puts the demonstration data back'],
  ['demo_state', 'a description of the demonstration state itself']
]);
const SAYS_DEMONSTRATION = /\b(prototype|prototyp|demonstration|demo|демо|прототип)\b/i;

function screensThatCallTheirRecordsADemonstration(source, file) {
  const wrong = [];
  for (const { lang, body } of translationTables(source)) {
    for (const entry of body.matchAll(/(?:^|[\s,{])'?([A-Za-z_][\w]*)'?\s*:\s*'((?:\\.|[^'\\])*)'/g)) {
      const [, key, value] = entry;
      if (MAY_SAY_DEMONSTRATION.has(key)) continue;
      // A category somebody picks from a list — a lead wanting a prototype made — is the word as a noun
      // about the customer's work, not a claim about this software. Those are one word long.
      if (!/\s/.test(value)) continue;
      if (!SAYS_DEMONSTRATION.test(value)) continue;
      wrong.push(`${lang}:${key}`);
    }
  }
  return [...new Set(wrong)];
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
  const unfilled = placeholdersWithNothingToFill(source);
  if (unfilled.length) {
    fail(`a substitution with nothing to substitute into: ${unfilled.slice(0, 6).join('; ')}`);
  }
  // Not `invented` — this file already has a function by that name, and shadowing it broke the figures
  // check three lines further down. Which is the very fault this file was written to catch.
  const inventedKeys = keysNamedInAListThatDoNotExist(source);
  if (inventedKeys.length) {
    fail(`a translation key named in a list and never written: ${inventedKeys.slice(0, 6).join('; ')}`);
  }
  const deadPrompts = promptsThatGoNowhere(source);
  if (deadPrompts.length) {
    fail(`${deadPrompts.join('; ')} — the box opens and OK does nothing`);
  }
  const pretendingToBeADemo = screensThatCallTheirRecordsADemonstration(source, file);
  if (pretendingToBeADemo.length) {
    fail(`calls its own records a demonstration: ${pretendingToBeADemo.slice(0, 8).join(', ')}`
      + ' — say what is actually missing, or mark the element data-when-demo so it is shown only then');
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

// The list of wired pages inside the guard, against the pages that actually declare themselves wired.
//
// Two lists, in two files, that have to agree — and they did not: the guard offered a signed-in person
// two pages to go to while twelve were wired, so an administrator who landed on an unwired screen was
// sent to the welders' phone screen or nowhere. Nothing failed, because the notice worked perfectly; it
// just pointed at the wrong world. A list nobody checks is a list that is already wrong.
function theGuardKnowsWhichPagesAreWired(failures) {
  const guard = fs.readFileSync(path.join(ROOT, 'workshop-guard.js'), 'utf8');
  const block = guard.slice(guard.indexOf('const WIRED = ['), guard.indexOf('];', guard.indexOf('const WIRED = [')));
  const offered = new Set([...block.matchAll(/\['([^']+\.html)'/g)].map((m) => m[1]));
  const declared = new Set(appPages().filter((file) =>
    /window\.WORKSHOP_SERVER_READY\s*=\s*true/.test(readPage(file))));

  for (const file of declared) {
    if (!offered.has(file)) {
      failures.push(`${file} declares itself wired, and the guard does not offer it — a signed-in `
        + 'person on an unwired page is never sent there');
    }
  }
  for (const file of offered) {
    if (!declared.has(file)) {
      failures.push(`workshop-guard.js offers ${file} as wired and that page does not declare itself `
        + 'wired — the notice would send somebody to a screen that refuses them');
    }
  }
  if (!failures.length) {
    console.log(`OK   the guard offers exactly the ${declared.size} pages that declare themselves wired`);
  }
}

// A reference written into the markup, where a record's own reference belongs.
//
// The Store screen's shortage panel carried "P-2026-014 — Ventilation Duct System" and a jobcard number
// under it, in the HTML, and nothing ever replaced them — while the rows beneath came from whichever
// project happened to be first in the register. So the panel labelled its own figures with the name of
// a different job, and on an empty system it named a project that did not exist. Nothing threw, and
// every check passed: the list was simply about something other than the line above it said.
//
// This looks for the shape rather than that one case: a project, jobcard, order or supplier reference
// sitting in a page's markup outside a <script>. They belong to records, and a page has no business
// knowing one.
const A_RECORD_REFERENCE = /\b(P|JC|PO|INS|NCR|HOLD|DEL|EST|SUP|MV|EQ|DOC|OFF|CAPA|ITP)-\d{3,4}(-\d{3,4})?\b/g;

function noPageNamesARecordItCannotKnow(failures) {
  for (const file of appPages()) {
    // Scripts and the translation dictionaries are where a placeholder, an example in a hint and a
    // format string legitimately live. What this is about is markup a browser renders as fact.
    const markup = readPage(file).replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '');
    const named = [...new Set((markup.match(A_RECORD_REFERENCE) || []))]
      // A placeholder in a form field is telling somebody what to type, not stating a fact.
      .filter((ref) => !new RegExp(`placeholder="[^"]*${ref}`).test(markup));
    if (named.length) {
      failures.push(`${file} names ${named.join(', ')} in its markup — a reference belongs to a record, `
        + 'and a page that writes one in states a fact about work that may not exist');
    }
  }
  if (!failures.length) console.log('OK   no page names a project, order or jobcard in its own markup');
}

// The badge that says whose session it is — the avatar, the name, and on some screens the role beside it.
//
// On every page that had one, the name in the markup was "Aleksandar" and the avatar "AK", and on six of
// them the role said "Admin". Every write those pages make is attributed by the server to the real session,
// so the screen said one person and the database recorded another. A welder opening Quality read
// "Aleksandar · Admin".
//
// It is painted from the snapshot now, in workshop-ui.js, into the elements the markup marks for it
// (`data-session-name`, `data-session-initials`, `data-session-role`). Each ships holding an em dash, the
// app's word for "nobody has said", so a page whose snapshot never arrives shows no name rather than
// somebody else's.
//
// The check below does NOT look at the badges. The first version did, enumerating the class names they use
// — and passed while five pages still named a person: four in the bar across the top, which it had not
// thought of, and one in a fifth wrapper class with its own dictionary key. A list of the places a bug can
// hide is a list that will be short by one. So the rule is the whole page instead: nobody's name appears in
// any page's markup, anywhere, in text or in an attribute. Names belong to records, and records arrive from
// the database.
const A_PERSON = /Aleksandar|Marko K\.|Elena N\.|Lars |Petra |Anna |Erik |David /;

// A role word as an element's entire content. The exception is a page offering the roles as a vocabulary —
// admin.html's role picker has an <option> per role, and its dictionary translates them under `role_admin`,
// which is the honest way to name a role: as one of the values, not as this reader's.
const A_ROLE_AS_TEXT = />\s*(Admin|Administrator|Администратор)\s*</;

function markupOf(file) {
  return readPage(file)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

function noPageNamesWhoIsSignedIn(failures) {
  for (const file of appPages()) {
    const markup = markupOf(file);
    const named = markup.match(A_PERSON);
    if (named) {
      failures.push(`${file} writes the name ${named[0].trim()} into its markup — the badge is painted `
        + 'from the snapshot, and a name written into a page cannot be told from a real one');
    }
    // The role, only where the element holding it is bound to the dictionary. An <option> naming a role is
    // the vocabulary; a <small> beside somebody's name is a claim about the reader.
    for (const at of markup.matchAll(/<(?:small|span|b|strong)[^>]*\bdata-i="([^"]+)"[^>]*>[^<]*</g)) {
      if (!at[1].startsWith('role_') && A_ROLE_AS_TEXT.test(at[0] + '<')) {
        failures.push(`${file} states the role "Admin" in an element the dictionary writes over — a welder `
          + 'reading it is being told they are an administrator');
      }
    }
  }
  // And the dictionary itself, which is how this came back on the phone hub after being fixed once: the
  // language sweep writes every [data-i] entry over whatever the session painted. Under a `role_` key the
  // value is a translation of one role; under any other key it is a word about to be written over somebody.
  for (const file of appPages()) {
    for (const at of readPage(file).matchAll(
      /\b([A-Za-z_]\w*)\s*:\s*("(?:Admin|Administrator)"|'(?:Admin|Administrator|Администратор)')/g)) {
      if (at[1].startsWith('role_')) continue;
      failures.push(`${file} keeps a dictionary entry ${at[0]} — nothing reads it, and an entry like it `
        + 'put "Admin" back over a welder\'s role the last time this was fixed');
    }
  }
  if (!failures.length) console.log('OK   no page states whose session it is, or what they may do, in its markup');
}

// The Macedonian stays Macedonian.
//
// It was 727 strings in Cyrillic and 1616 in Latin — the same app reading two ways depending on which
// screen somebody opened — and converting them was a one-off pass over sixteen dictionaries. A one-off pass
// is exactly what this project has watched drift back three times: the badge naming one person was fixed
// per page and came back on the next page somebody wrote. So the rule is checked rather than remembered.
//
// The exceptions are not a pattern. Each was read once and written down, because every rule-shaped guess
// tried here was wrong about something: "all caps" would have protected PRISTAP, a Macedonian word in
// capitals, and "looks like a language tag" would have protected `od` and `da`, which are Macedonian words
// for "by" and "yes".
const STAYS_LATIN = new Set([
  // Codes, formats and units, which are written the same on any shop floor.
  'SEK', 'PIN', 'PDF', 'CSV', 'JSON', 'XML', 'Excel', 'NCR', 'NDT', 'WPS', 'ITP', 'CAPA', 'RFQ',
  'ID', 'Rev', 'Hub', 'Incoterms', 'LinkedIn', 'Kanban', 'Varmak AB',
  'JC-0000', 'PO-0000', 'DN-00000', '#', '—', '★', '×',
  // The one value that is not prose at all: a BCP-47 tag handed to toLocaleDateString. `мк` is not a
  // language any browser knows, so converting it would have broken every date on every Macedonian screen.
  'mk'
]);
const CYRILLIC = /[Ѐ-ӿ]/;
const A_PLACEHOLDER_ONLY = /^[\s\d%{}()\[\]<>→≥≤.,:;·—–…+\-*/]*$/;

function theMacedonianIsCyrillic(failures) {
  let checked = 0;
  for (const file of appPages()) {
    const source = readPage(file);
    // The mk dictionary, by walking braces from its opening one rather than by matching to a close — these
    // objects contain braces inside their strings.
    const opened = /(?:\bmk\s*:\s*\{|T\.mk\s*=\s*\{)/.exec(source);
    if (!opened) continue;
    let at = source.indexOf('{', opened.index);
    let depth = 0;
    let end = at;
    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1;
      else if (source[end] === '}') { depth -= 1; if (!depth) break; }
    }
    const block = source.slice(at, end + 1);
    for (const found of block.matchAll(/(?<!\\)(["'])((?:\\.|(?!\1)[^\\])*)\1/g)) {
      const value = found[2];
      // A quoted KEY, not a value: the keys with a hyphen in them have to be quoted, and `nt_machine-problem`
      // is a key rather than a string anybody reads. The colon after it is what tells them apart.
      const next = block.slice(found.index + found[0].length).match(/^\s*(.)/);
      if (next && next[1] === ':') continue;
      if (!value.trim() || STAYS_LATIN.has(value)) continue;
      // A value made only of a placeholder, a number and punctuation has no letters to be in any script.
      if (A_PLACEHOLDER_ONLY.test(value.replace(/\{[^}]*\}/g, ''))) continue;
      checked += 1;
      if (!CYRILLIC.test(value)) {
        // Latin left in a Macedonian string: either it was never translated, or somebody added a new one in
        // the transliteration the rest of the app has stopped using.
        failures.push(`${file} has Macedonian in Latin script: ${JSON.stringify(value.slice(0, 60))} — `
          + 'the Macedonian is Cyrillic, and two scripts in one app is one app reading two ways');
        continue;
      }
      // And the half of the question the first version did not ask. "Contains a Cyrillic letter" was
      // satisfied by `Meѓuzbir` and `Režiski troшoci` — Latin transliteration with only the letters that
      // have no ASCII form converted — so 138 strings across three screens passed this check while being
      // unreadable in either language. The same wrong question was in the conversion tool, which skipped
      // every value that already held one Cyrillic character and therefore never finished these.
      //
      // Asked through the tool's own detector so there is one keep-list rather than two that drift: a
      // Macedonian string may hold a code, a unit, a placeholder, a path or a brand name, and may not hold
      // a Latin word.
      const stillLatin = latinLeftIn(value);
      if (stillLatin.length) {
        failures.push(`${file} has a half-converted Macedonian string: ${JSON.stringify(value.slice(0, 60))}`
          + ` — ${JSON.stringify(stillLatin.slice(0, 4))} is Latin inside Cyrillic, which reads as neither`);
      }
    }
  }
  if (!failures.length) {
    console.log(`OK   all ${checked} Macedonian strings are in Cyrillic, with no Latin word left inside one`);
  }
}

async function main() {
  const harness = await startBrowserHarness();
  const failures = [];
  theGuardKnowsWhichPagesAreWired(failures);
  noPageNamesARecordItCannotKnow(failures);
  noPageNamesWhoIsSignedIn(failures);
  theMacedonianIsCyrillic(failures);
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
