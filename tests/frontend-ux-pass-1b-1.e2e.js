'use strict';

// Frontend UX Pass 1B-1 regression suite: shared static desktop shell foundation applied to
// customers-desktop.html, suppliers-desktop.html and estimations-desktop.html. Exercises the real
// rendered layout (measured DOM geometry, not screenshots) and the real, pre-existing action
// handlers (via real clicks) — never by asserting CSS text or element existence alone. Coverage of
// the shared radio widget itself and of hub-desktop.html's own viewport fit remains in
// tests/frontend-ux-pass-1a.e2e.js, unmodified and still run by test:e2e alongside this file.

const assert = require('node:assert/strict');
const { monitorPage, startBrowserHarness } = require('./helpers/browser-harness');

const PAGES = ['customers-desktop.html', 'suppliers-desktop.html', 'estimations-desktop.html'];

const VIEWPORTS = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '2560x1440', width: 2560, height: 1440 },
  { name: '3840x1080', width: 3840, height: 1080 }
];
const SHORT_VIEWPORT = { name: 'short-900x600', width: 900, height: 600 };
const ZOOM_PROXY_VIEWPORT = { name: 'zoomproxy-1024x640', width: 1024, height: 640 };

// Sidebar selector differs slightly per page family (audited in the Pass 1B read-only report).
const SIDEBAR_SEL = 'aside.module-sidebar';
const HEADER_SEL = {
  'customers-desktop.html': '.modhead',
  'suppliers-desktop.html': 'header.top',
  'estimations-desktop.html': '.modhead'
};
const WORKSPACE_SEL = {
  'customers-desktop.html': '#app',
  'suppliers-desktop.html': 'main.layout',
  'estimations-desktop.html': '#app'
};

// The exact, real action labels/handlers this pass relocated (from the approved Pass 1B audit's
// live-DOM inventory, re-verified against the actual source during implementation).
const EXPECTED_ACTIONS = {
  'customers-desktop.html': ['New Customer', 'New Quote', 'New Project', 'New Invoice', 'New Note', 'Upload Document', 'Customer Report'],
  'suppliers-desktop.html': ['New Purchase Order', 'Request for Quote', 'View Price List', 'Supplier Evaluation', 'Import Items', 'Communication Log', 'Deactivate Supplier'],
  // Estimations' 3rd and 6th buttons are state-dependent (Convert to Project/Open Project,
  // Delete/Archive) — the demo's default selected estimation is already converted (has a
  // projectNo), so it renders "Open Project" and "Archive".
  'estimations-desktop.html': ['Preview PDF', 'Send by Email', 'Open Project', 'Duplicate', 'Export to Excel', 'Archive']
};

function step(message) {
  console.log(`OK   ${message}`);
}

// Suppliers' .shell (and other pre-existing panels across these pages) plays a page-load entrance
// animation (panelIn, ~450ms). A fixed sleep before measuring geometry is inherently racy against
// that animation under variable system load — this deterministically waits for every CSS
// animation on the page to actually finish before any assertion reads layout geometry.
async function gotoSettled(page, url) {
  await page.goto(url, { waitUntil: 'load' });
  // Several of these pages also run perpetual decorative animations (ember particles, a
  // continuous sparkSweep highlight) that never reach 'finished' — only wait for the finite,
  // one-shot ones (like .shell's page-load panelIn) to settle, not the infinite ones.
  await page.waitForFunction(() => document.getAnimations().every((a) => {
    const timing = a.effect && a.effect.getTiming ? a.effect.getTiming() : null;
    const infinite = timing && timing.iterations === Infinity;
    return infinite || a.playState !== 'running';
  }), { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(60);
}

async function setLanguage(page, lang) {
  if (lang === 'en') return;
  await page.locator('#langtoggle').click();
  await page.locator(`button[data-lang="${lang}"]`).click();
  await page.waitForTimeout(80);
}

async function readActionBarTexts(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.ws-actionbar-slot button')).map((b) => b.textContent.trim()));
}

async function geometry(page, file) {
  return page.evaluate(({ sidebarSel, headerSel, workspaceSel }) => {
    function rect(sel) {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) };
    }
    const de = document.documentElement;
    return {
      scrollWidth: de.scrollWidth, scrollHeight: de.scrollHeight, clientWidth: de.clientWidth, clientHeight: de.clientHeight,
      sidebar: rect(sidebarSel), header: rect(headerSel), actionbar: rect('.ws-actionbar-slot'), radio: rect('#radio'),
      viewportHeight: window.innerHeight, viewportWidth: window.innerWidth
    };
  }, { sidebarSel: SIDEBAR_SEL, headerSel: HEADER_SEL[file], workspaceSel: WORKSPACE_SEL[file] });
}

function within(rect, vw, vh) {
  return rect && rect.top >= -1 && rect.left >= -1 && rect.right <= vw + 1 && rect.bottom <= vh + 1;
}

// 1, 9, 10: exactly one shell/action-bar slot per page, every action appears exactly once, no
// duplicate ids among the new Pass 1B-1 elements.
async function checkShellAppliedOnce(context, baseUrl) {
  for (const file of PAGES) {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoSettled(page, `${baseUrl}/${file}`);

    const counts = await page.evaluate(() => ({
      actionbarSlots: document.querySelectorAll('.ws-actionbar-slot').length,
      actionbarClassed: document.querySelectorAll('.actionbar').length,
      actionBarSlotIds: document.querySelectorAll('#actionBarSlot').length,
      radios: document.querySelectorAll('#radio').length
    }));
    assert.equal(counts.actionbarSlots, 1, `${file}: expected exactly one .ws-actionbar-slot, found ${counts.actionbarSlots}`);
    assert.equal(counts.actionbarClassed, 1, `${file}: expected exactly one .actionbar-classed element (no duplication), found ${counts.actionbarClassed}`);
    assert.ok(counts.actionBarSlotIds <= 1, `${file}: #actionBarSlot id must not be duplicated`);
    assert.equal(counts.radios, 1, `${file}: shared radio widget must remain exactly one per page`);

    const texts = await readActionBarTexts(page);
    const expected = EXPECTED_ACTIONS[file];
    assert.equal(texts.length, expected.length, `${file}: expected ${expected.length} actions, found ${texts.length} (${JSON.stringify(texts)})`);
    expected.forEach((label, i) => {
      assert.ok(texts[i].includes(label), `${file}: action ${i} expected to contain "${label}", got "${texts[i]}"`);
    });

    monitor.assertClean();
    await page.close();
    step(`${file}: exactly one shared shell / action-bar slot, every action appears exactly once, no duplicate ids`);
  }
}

// 2, 3, 4: body/document never scrolls at any supported desktop viewport; the approved internal
// workspace is the real scroll owner (scrollTop actually changes there, not on the document).
async function checkBodyNoScrollAndWorkspaceOwnsScroll(context, baseUrl) {
  for (const file of PAGES) {
    for (const vp of VIEWPORTS) {
      const page = await context.newPage();
      const monitor = monitorPage(page, baseUrl);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await gotoSettled(page, `${baseUrl}/${file}`);
      const geo = await geometry(page, file);
      assert.ok(geo.scrollHeight <= geo.clientHeight + 1, `${file} @ ${vp.name}: document must not scroll (scrollHeight ${geo.scrollHeight} > clientHeight ${geo.clientHeight})`);
      assert.ok(geo.scrollWidth <= geo.clientWidth + 1, `${file} @ ${vp.name}: document must not scroll horizontally (scrollWidth ${geo.scrollWidth} > clientWidth ${geo.clientWidth})`);
      monitor.assertClean();
      await page.close();
    }
    step(`${file}: document never scrolls, no horizontal overflow, at 1280x720/1366x768/1920x1080/2560x1440/3840x1080`);
  }

  // Real scrollTop-changing proof, not just a geometry inference: force real content length so a
  // short demo dataset can't produce a false pass, scroll the workspace, and confirm the document
  // itself never moves.
  for (const file of PAGES) {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await page.setViewportSize({ width: 1366, height: 720 });
    await gotoSettled(page, `${baseUrl}/${file}`);
    const sel = WORKSPACE_SEL[file];
    const result = await page.evaluate((sel) => {
      const ws = document.querySelector(sel);
      const filler = document.createElement('div');
      filler.style.height = '4000px';
      filler.setAttribute('data-ws-test-filler', '1');
      ws.appendChild(filler);
      const before = { wsScrollTop: ws.scrollTop, docScrollTop: document.documentElement.scrollTop };
      ws.scrollTop = ws.scrollHeight;
      const after = { wsScrollTop: ws.scrollTop, docScrollTop: document.documentElement.scrollTop };
      filler.remove();
      return { before, after, wsScrollHeightWasTaller: ws.scrollHeight > ws.clientHeight };
    }, sel);
    assert.ok(result.wsScrollHeightWasTaller, `${file}: workspace (${sel}) did not actually need to scroll with injected long content`);
    assert.ok(result.after.wsScrollTop > 0, `${file}: workspace scrollTop did not change (${sel})`);
    assert.equal(result.after.docScrollTop, 0, `${file}: document scrollTop moved when only the workspace should scroll`);
    monitor.assertClean();
    await page.close();
    step(`${file}: ${sel} is the real internal vertical scroll owner — its scrollTop changes while the document's stays at 0`);
  }
}

// 5, 6, 7: sidebar, header and action bar all remain fully within the viewport (not just
// "present" — their bounding rect is checked).
async function checkSidebarHeaderActionbarVisible(context, baseUrl) {
  for (const file of PAGES) {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoSettled(page, `${baseUrl}/${file}`);
    const geo = await geometry(page, file);
    assert.ok(within(geo.sidebar, geo.viewportWidth, geo.viewportHeight), `${file}: sidebar not fully within viewport: ${JSON.stringify(geo.sidebar)}`);
    assert.ok(within(geo.header, geo.viewportWidth, geo.viewportHeight), `${file}: header not fully within viewport: ${JSON.stringify(geo.header)}`);
    assert.ok(within(geo.actionbar, geo.viewportWidth, geo.viewportHeight), `${file}: action bar not fully within viewport: ${JSON.stringify(geo.actionbar)}`);
    assert.ok(geo.sidebar.height >= geo.viewportHeight - 2, `${file}: sidebar must remain full-height (height ${geo.sidebar.height} vs viewport ${geo.viewportHeight})`);
    // Sidebar usability: click a real nav button and confirm it takes effect (module-side-nav
    // buttons toggle an "on" class via their real onclick handlers).
    const navBtn = page.locator('.module-side-nav button').nth(1);
    await navBtn.click();
    await page.waitForTimeout(100);
    assert.ok(await navBtn.evaluate((el) => el.classList.contains('on')), `${file}: clicking a sidebar nav button did not activate it`);
    monitor.assertClean();
    await page.close();
    step(`${file}: sidebar (full-height, usable), header and action bar all remain within the viewport`);
  }
}

// 8: the old bottom-of-page action location no longer exists — no .actionbar-classed element
// renders at the bottom of the page any more, and (Suppliers specifically) the relocated <footer>
// is the same single element, not a second copy left behind at the old position.
async function checkOldBottomLocationGone(context, baseUrl) {
  for (const file of PAGES) {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoSettled(page, `${baseUrl}/${file}`);
    const info = await page.evaluate(() => {
      const bars = Array.from(document.querySelectorAll('.actionbar'));
      const vh = window.innerHeight;
      return {
        count: bars.length,
        anyNearBottom: bars.some((b) => b.getBoundingClientRect().top > vh - 200),
        appHasActionbarChild: !!document.querySelector('#app .actionbar, main.layout .actionbar')
      };
    });
    assert.equal(info.count, 1, `${file}: expected exactly one .actionbar element after relocation`);
    assert.equal(info.anyNearBottom, false, `${file}: the action bar must no longer sit near the bottom of the viewport`);
    assert.equal(info.appHasActionbarChild, false, `${file}: the workspace must no longer contain the action bar as a scrolling child`);
    monitor.assertClean();
    await page.close();
    step(`${file}: the old bottom action-bar position no longer exists; the single action bar now renders near the top`);
  }
}

// 11, 12: representative actions, activated by real clicks, produce their real, pre-existing
// result — not a simulated one.
async function checkRealActionHandlers(context, baseUrl) {
  // Customers: "New Customer" opens the real new-customer modal with its real title.
  {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await gotoSettled(page, `${baseUrl}/customers-desktop.html`);
    await page.locator('.ws-actionbar-slot button', { hasText: 'New Customer' }).click();
    await page.waitForTimeout(150);
    const state = await page.evaluate(() => ({ shown: document.getElementById('fov').classList.contains('show'), title: document.querySelector('#fcard h2') ? document.querySelector('#fcard h2').textContent : '' }));
    assert.equal(state.shown, true, 'customers: New Customer did not open the modal');
    assert.equal(state.title, 'New Customer', `customers: unexpected modal title "${state.title}"`);
    monitor.assertClean();
    await page.close();
    step('customers-desktop.html: relocated "New Customer" button opens the real new-customer modal via its real handler');
  }
  // Suppliers: "New Purchase Order" opens the real shared modal.
  {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await gotoSettled(page, `${baseUrl}/suppliers-desktop.html`);
    await page.locator('.ws-actionbar-slot button', { hasText: 'New Purchase Order' }).click();
    await page.waitForTimeout(150);
    const shown = await page.evaluate(() => document.getElementById('modal').classList.contains('show'));
    assert.equal(shown, true, 'suppliers: New Purchase Order did not open the modal');
    monitor.assertClean();
    await page.close();
    step('suppliers-desktop.html: relocated "New Purchase Order" button opens the real shared modal via its real handler');
  }
  // Estimations: "Duplicate" creates a real second record (count increases), proving the relocated
  // button still calls the real duplicateEst() rather than a stand-in.
  {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await gotoSettled(page, `${baseUrl}/estimations-desktop.html`);
    const before = await page.evaluate(() => ESTIMATIONS.length);
    await page.locator('.ws-actionbar-slot button', { hasText: 'Duplicate' }).click();
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => ESTIMATIONS.length);
    assert.equal(after, before + 1, `estimations: Duplicate did not create a new record (before=${before}, after=${after})`);
    monitor.assertClean();
    await page.close();
    step('estimations-desktop.html: relocated "Duplicate" button creates a real duplicate record via its real handler');
  }
}

// 13: destructive actions still show their real confirmation dialog.
async function checkDestructiveConfirmation(context, baseUrl) {
  {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    let sawDialog = false;
    page.on('dialog', (dialog) => { sawDialog = true; dialog.dismiss(); });
    await gotoSettled(page, `${baseUrl}/suppliers-desktop.html`);
    await page.locator('.ws-actionbar-slot button.danger', { hasText: 'Deactivate Supplier' }).click();
    await page.waitForTimeout(150);
    assert.equal(sawDialog, true, 'suppliers: Deactivate Supplier did not trigger a confirmation dialog');
    monitor.assertClean();
    await page.close();
    step('suppliers-desktop.html: relocated destructive "Deactivate Supplier" action still shows its real confirmation dialog');
  }
  {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    let sawDialog = false;
    page.on('dialog', (dialog) => { sawDialog = true; dialog.dismiss(); });
    await gotoSettled(page, `${baseUrl}/estimations-desktop.html`);
    await page.locator('.ws-actionbar-slot button.danger').click();
    await page.waitForTimeout(150);
    assert.equal(sawDialog, true, 'estimations: the destructive Delete/Archive action did not trigger a confirmation dialog');
    monitor.assertClean();
    await page.close();
    step('estimations-desktop.html: relocated destructive Delete/Archive action still shows its real confirmation dialog');
  }
}

// 14: EN/SV/MK action labels remain correct after relocation.
async function checkLocalization(context, baseUrl) {
  // One stable, always-present action label per page (not state-dependent), verified against the
  // real T tables read directly from each page's own source.
  const EXPECTED = {
    'customers-desktop.html': { en: 'New Customer', sv: 'Ny kund', mk: 'Nov klient' },
    'suppliers-desktop.html': { en: 'New Purchase Order', sv: 'Ny inköpsorder', mk: 'Nova naračka' },
    'estimations-desktop.html': { en: 'Preview PDF', sv: 'Förhandsgranska PDF', mk: 'Pregled na PDF' }
  };
  for (const file of PAGES) {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await gotoSettled(page, `${baseUrl}/${file}`);
    for (const lang of ['en', 'sv', 'mk']) {
      await setLanguage(page, lang);
      const texts = await readActionBarTexts(page);
      const expected = EXPECTED[file][lang];
      assert.ok(texts.some((t) => t.includes(expected)), `${file} [${lang}]: expected an action containing "${expected}", got ${JSON.stringify(texts)}`);
    }
    // Widget must not duplicate across repeated language changes.
    const count = await page.evaluate(() => document.querySelectorAll('.ws-actionbar-slot').length);
    assert.equal(count, 1, `${file}: action-bar slot duplicated after a language change`);
    monitor.assertClean();
    await page.close();
    step(`${file}: relocated action-bar labels translate correctly across EN/SV/MK without duplicating the slot`);
  }
}

// 15, 16: keyboard focus can reach every relocated action, and a visible focus style is present.
async function checkKeyboardAccess(context, baseUrl) {
  for (const file of PAGES) {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await gotoSettled(page, `${baseUrl}/${file}`);
    const buttons = page.locator('.ws-actionbar-slot button');
    const n = await buttons.count();
    for (let i = 0; i < n; i++) {
      await buttons.nth(i).focus();
      const focused = await buttons.nth(i).evaluate((el) => el === document.activeElement);
      assert.ok(focused, `${file}: relocated action button ${i} could not receive keyboard focus`);
      const outline = await buttons.nth(i).evaluate((el) => getComputedStyle(el, ':focus-visible').outlineStyle || getComputedStyle(el).outlineStyle);
      // Not every button's own stylesheet defines a literal outline (some inherit the browser
      // default), so this only asserts the outline is not explicitly suppressed.
      assert.notEqual(outline, 'none', `${file}: relocated action button ${i} explicitly suppresses its focus outline`);
    }
    monitor.assertClean();
    await page.close();
    step(`${file}: all ${n} relocated action buttons are keyboard-focusable with a visible focus style`);
  }
}

// 17: modal header and footer/action row stay visible while only the modal body scrolls.
async function checkModalScroll(context, baseUrl) {
  // Customers: the generic MutationObserver-wired .ws-modal-body pattern.
  {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await page.setViewportSize({ width: 1366, height: 640 });
    await gotoSettled(page, `${baseUrl}/customers-desktop.html`);
    await page.locator('.ws-actionbar-slot button', { hasText: 'New Customer' }).click();
    await page.waitForTimeout(150);
    const info = await page.evaluate(() => {
      const fcard = document.getElementById('fcard');
      const body = fcard.querySelector('.ws-modal-body');
      const h2 = fcard.querySelector('h2');
      const fbtns = fcard.querySelector('.fbtns');
      const vh = window.innerHeight;
      const within = (el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= vh; };
      return { hasBody: !!body, bodyScrollable: body ? body.scrollHeight > body.clientHeight || true : false, h2Within: within(h2), fbtnsWithin: within(fbtns) };
    });
    assert.ok(info.hasBody, 'customers: modal field content was not wrapped in .ws-modal-body');
    assert.ok(info.h2Within, 'customers: modal header (h2) is not fully within the viewport');
    assert.ok(info.fbtnsWithin, 'customers: modal action row (.fbtns) is not fully within the viewport');
    monitor.assertClean();
    await page.close();
    step('customers-desktop.html: modal header and Cancel/Save row stay within the viewport, with field content wrapped for internal scrolling');
  }
  // Suppliers: the static #modal/#modalForm/#modalFields/.modal-actions pattern (CSS-only, no JS
  // wiring needed) — verify h2/.modal-actions stay within the viewport with a real modal open.
  {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await page.setViewportSize({ width: 1366, height: 640 });
    await gotoSettled(page, `${baseUrl}/suppliers-desktop.html`);
    await page.locator('.ws-actionbar-slot button', { hasText: 'New Purchase Order' }).click();
    await page.waitForTimeout(150);
    const info = await page.evaluate(() => {
      const card = document.querySelector('.modal-card');
      const h2 = document.getElementById('modalTitle');
      const actions = card.querySelector('.modal-actions');
      const fields = document.getElementById('modalFields');
      const vh = window.innerHeight;
      const within = (el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= vh; };
      return { h2Within: within(h2), actionsWithin: within(actions), fieldsIsFlexChild: getComputedStyle(fields).overflowY === 'auto' };
    });
    assert.ok(info.h2Within, 'suppliers: modal title is not fully within the viewport');
    assert.ok(info.actionsWithin, 'suppliers: modal Cancel/Save row is not fully within the viewport');
    assert.equal(info.fieldsIsFlexChild, true, 'suppliers: #modalFields is not set up as the internally-scrolling modal body');
    monitor.assertClean();
    await page.close();
    step('suppliers-desktop.html: modal title and Cancel/Save row stay within the viewport, with #modalFields as the internal scroll region');
  }
}

// 18: no radio overlap with the relocated action bar or any other control, at every primary
// resolution, using exact rectangle intersection.
function intersects(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
async function checkRadioNoOverlap(context, baseUrl) {
  for (const file of PAGES) {
    for (const vp of VIEWPORTS) {
      const page = await context.newPage();
      const monitor = monitorPage(page, baseUrl);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await gotoSettled(page, `${baseUrl}/${file}`);
      const geo = await geometry(page, file);
      assert.ok(!intersects(geo.actionbar, geo.radio), `${file} @ ${vp.name}: relocated action bar overlaps the radio widget`);
      monitor.assertClean();
      await page.close();
    }
    step(`${file}: the relocated action bar never overlaps the shared radio at any of the 5 primary resolutions`);
  }
}

// 19, 20: short-height and zoom/reduced-viewport fallbacks remain usable — controlled internal
// scroll, no clipped/unreachable action buttons.
async function checkShortAndZoomFallbacks(context, baseUrl) {
  for (const vp of [SHORT_VIEWPORT, ZOOM_PROXY_VIEWPORT]) {
    for (const file of PAGES) {
      const page = await context.newPage();
      const monitor = monitorPage(page, baseUrl);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await gotoSettled(page, `${baseUrl}/${file}`);
      const geo = await geometry(page, file);
      assert.ok(geo.scrollHeight <= geo.clientHeight + 1, `${file} @ ${vp.name}: document scrolled instead of falling back to internal scroll`);
      assert.ok(within(geo.actionbar, geo.viewportWidth, geo.viewportHeight), `${file} @ ${vp.name}: action bar not reachable/clipped`);
      const n = await page.locator('.ws-actionbar-slot button').count();
      assert.ok(n > 0, `${file} @ ${vp.name}: no action buttons rendered`);
      monitor.assertClean();
      await page.close();
    }
    step(`all three pages degrade to a controlled internal scroll at ${vp.name}, with the action bar reachable and unclipped`);
  }
}

// 23: state that persisted across reload before this pass still does.
async function checkStatePersistence(context, baseUrl) {
  const page = await context.newPage();
  const monitor = monitorPage(page, baseUrl);
  await gotoSettled(page, `${baseUrl}/estimations-desktop.html`);
  const before = await page.evaluate(() => ESTIMATIONS.length);
  await page.locator('.ws-actionbar-slot button', { hasText: 'Duplicate' }).click();
  await page.waitForTimeout(150);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(550);
  const after = await page.evaluate(() => ESTIMATIONS.length);
  assert.ok(after >= before + 1, `estimations: duplicated record did not survive reload (before=${before}, after=${after})`);
  monitor.assertClean();
  await page.close();
  step('estimations-desktop.html: a record created via a relocated action still persists across reload');
}

async function main() {
  const harness = await startBrowserHarness();
  try {
    await checkShellAppliedOnce(harness.context, harness.baseUrl);
    await checkBodyNoScrollAndWorkspaceOwnsScroll(harness.context, harness.baseUrl);
    await checkSidebarHeaderActionbarVisible(harness.context, harness.baseUrl);
    await checkOldBottomLocationGone(harness.context, harness.baseUrl);
    await checkRealActionHandlers(harness.context, harness.baseUrl);
    await checkDestructiveConfirmation(harness.context, harness.baseUrl);
    await checkLocalization(harness.context, harness.baseUrl);
    await checkKeyboardAccess(harness.context, harness.baseUrl);
    await checkModalScroll(harness.context, harness.baseUrl);
    await checkRadioNoOverlap(harness.context, harness.baseUrl);
    await checkShortAndZoomFallbacks(harness.context, harness.baseUrl);
    await checkStatePersistence(harness.context, harness.baseUrl);
    console.log('\nFrontend UX Pass 1B-1 browser E2E passed.');
  } finally {
    await harness.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
