'use strict';

// Frontend UX Pass 1B-2 regression suite: shared static desktop shell foundation applied to
// store-desktop.html, purchasing-desktop.html and documents-desktop.html, reusing the exact
// contract approved in Frontend UX Pass 1B-1 (tests/frontend-ux-pass-1b-1.e2e.js, unmodified and
// still run by test:e2e alongside this file — this pass must not regress it, since
// workshop-desktop-shell.css is shared by both). Exercises the real rendered layout (measured DOM
// geometry, not screenshots) and the real, pre-existing action handlers (via real clicks and real
// keyboard input) — never by asserting CSS text or element existence alone.

const assert = require('node:assert/strict');
const { monitorPage, startBrowserHarness } = require('./helpers/browser-harness');

const PAGES = ['store-desktop.html', 'purchasing-desktop.html', 'documents-desktop.html'];

const VIEWPORTS = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '2560x1440', width: 2560, height: 1440 },
  { name: '3840x1080', width: 3840, height: 1080 }
];
const SHORT_VIEWPORT = { name: 'short-900x600', width: 900, height: 600 };
const ZOOM_PROXY_VIEWPORT = { name: 'zoomproxy-1024x640', width: 1024, height: 640 };

const SIDEBAR_SEL = 'aside.sidebar';
const HEADER_SEL = 'header.top';
const WORKSPACE_SEL = '.ws-shell-scroll';

const EXPECTED_ACTIONS = {
  'store-desktop.html': ['New Item', 'Receive Goods', 'Issue to Project', 'Transfer Stock', 'Stock Count', 'Export Report'],
  'purchasing-desktop.html': ['Create RFQ', 'Compare Suppliers', 'New Purchase Order', 'Approve Orders', 'Receive Goods', 'Purchasing Report'],
  'documents-desktop.html': ['Upload Document', 'Scan Document', 'Link to Record', 'Create Folder', 'Templates', 'Document Report']
};

// The representative modal used for the deep-dive scroll/keyboard/radio checks on each page —
// opened via its own real relocated action-bar button.
const REP_MODAL = {
  'store-desktop.html': { openLabel: 'New Item', overlay: '#newItemModal', card: '#newItemModal .modalcard', body: '#newItemModal .formbody', heading: '#newItemModal .phead h3', footer: '#newItemModal .actions', cancel: '#newItemModal .actions button:first-child' },
  'purchasing-desktop.html': { openLabel: 'New Purchase Order', overlay: '#modal', card: '#modal .modal-card', body: '#modal .formgrid', heading: '#modal h2', footer: '#modal .modal-actions', cancel: '#modal .modal-actions button:first-child' },
  'documents-desktop.html': { openLabel: 'Upload Document', overlay: '#uploadModal', card: '#uploadModal .modal-card', body: '#uploadModal .formgrid', heading: '#uploadModal h2', footer: '#uploadModal .modal-actions', cancel: '#uploadModal .modal-actions button:first-child' }
};

// Every other real modal on each page, audited more lightly (contract + open/close integrity,
// not the full injected-overflow deep dive) — per the task's explicit "audit every real modal".
const OTHER_MODALS = {
  'store-desktop.html': [
    { name: 'operationModal', open: () => window.openOperation('return'), overlay: '#operationModal', card: '#operationModal .modalcard', body: '#operationModal .formbody', footer: '#operationModal .actions' },
    { name: 'certificateModal', open: () => window.openCertificateForm(), overlay: '#certificateModal', card: '#certificateModal .modalcard', body: '#certificateModal .formbody', footer: '#certificateModal .actions' }
  ],
  'purchasing-desktop.html': [
    { name: 'rfqModal', open: () => window.openRFQ(), overlay: '#rfqModal', card: '#rfqModal .modal-card', body: '#rfqModal .formgrid', footer: '#rfqModal .modal-actions' },
    { name: 'invoiceModal', open: () => window.openInvoice(), overlay: '#invoiceModal', card: '#invoiceModal .modal-card', body: '#invoiceModal .formgrid', footer: '#invoiceModal .modal-actions' }
  ],
  'documents-desktop.html': [
    { name: 'linkModal', open: () => window.openLink(), overlay: '#linkModal', card: '#linkModal .modal-card', body: '#linkModal .formgrid', footer: '#linkModal .modal-actions' },
    { name: 'folderModal', open: () => window.openFolder(), overlay: '#folderModal', card: '#folderModal .modal-card', body: '#folderModal .formgrid', footer: '#folderModal .modal-actions' },
    { name: 'reportModal', open: () => window.openDocumentReport(), overlay: '#reportModal', card: '#reportModal .modal-card', body: '#reportModal .formgrid', footer: '#reportModal .modal-actions' }
  ]
};

function step(message) {
  console.log(`OK   ${message}`);
}

async function gotoSettled(page, url) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getAnimations().every((a) => {
    const timing = a.effect && a.effect.getTiming ? a.effect.getTiming() : null;
    const infinite = timing && timing.iterations === Infinity;
    return infinite || a.playState !== 'running';
  }), { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(60);
}

async function readActionBarTexts(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.ws-actionbar-slot button')).map((b) => b.textContent.trim()));
}

async function geometry(page) {
  return page.evaluate(({ sidebarSel, headerSel }) => {
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
  }, { sidebarSel: SIDEBAR_SEL, headerSel: HEADER_SEL });
}

function within(rect, vw, vh) {
  return rect && rect.top >= -1 && rect.left >= -1 && rect.right <= vw + 1 && rect.bottom <= vh + 1;
}

async function closeRealModal(page, cancelSel) {
  await page.locator(cancelSel).click();
  await page.waitForTimeout(120);
}

function elementsIntersectingRadio() {
  const radio = document.getElementById('radio');
  if (!radio) return [];
  const rr = radio.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const sel = 'button, a[href], input, select, textarea, [role="button"], [tabindex]';
  function clippedAway(el, rect) {
    let node = el.parentElement;
    while (node && node !== document.documentElement) {
      const cs = getComputedStyle(node);
      if (/(auto|hidden|scroll)/.test(cs.overflowY) || /(auto|hidden|scroll)/.test(cs.overflowX)) {
        const ar = node.getBoundingClientRect();
        if (rect.bottom <= ar.top || rect.top >= ar.bottom || rect.right <= ar.left || rect.left >= ar.right) return true;
      }
      node = node.parentElement;
    }
    return false;
  }
  const hits = [];
  document.querySelectorAll(sel).forEach((el) => {
    if (radio.contains(el)) return;
    if (el.tabIndex === -1 && el.getAttribute('tabindex') === '-1' && el.tagName !== 'DIV') return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) return;
    if (clippedAway(el, r)) return;
    const intersects = r.left < rr.right && r.right > rr.left && r.top < rr.bottom && r.bottom > rr.top;
    if (intersects) hits.push({ tag: el.tagName, id: el.id, cls: String(el.className).slice(0, 60) });
  });
  return hits;
}

// ===================================================================================
// Shared shell contract (reused verbatim from Pass 1B-1) — opt-in classes present exactly once,
// and an unrelated bare .modal-card is never accidentally styled.
// ===================================================================================
async function checkSharedShellContract(context, baseUrl) {
  for (const file of PAGES) {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await gotoSettled(page, `${baseUrl}/${file}`);

    const contract = await page.evaluate(() => ({
      htmlOptIn: document.documentElement.classList.contains('ws-shell-root'),
      bodyOptIn: document.body.classList.contains('ws-desktop-shell'),
      columnCount: document.querySelectorAll('.ws-shell-column').length,
      headerCount: document.querySelectorAll('.ws-shell-header').length,
      scrollCount: document.querySelectorAll('.ws-shell-scroll').length,
      actionbarCount: document.querySelectorAll('.ws-actionbar-slot').length
    }));
    assert.equal(contract.htmlOptIn, true, `${file}: <html> is missing the ws-shell-root opt-in class`);
    assert.equal(contract.bodyOptIn, true, `${file}: <body> is missing the ws-desktop-shell opt-in class`);
    assert.equal(contract.columnCount, 1, `${file}: expected exactly one .ws-shell-column`);
    assert.equal(contract.headerCount, 1, `${file}: expected exactly one .ws-shell-header`);
    assert.equal(contract.scrollCount, 1, `${file}: expected exactly one .ws-shell-scroll`);
    assert.equal(contract.actionbarCount, 1, `${file}: expected exactly one .ws-actionbar-slot`);

    const leaked = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'modal-card';
      probe.textContent = 'unrelated probe element';
      document.body.appendChild(probe);
      const cs = getComputedStyle(probe);
      const result = { display: cs.display, maxHeight: cs.maxHeight };
      probe.remove();
      return result;
    });
    assert.notEqual(leaked.display, 'flex', `${file}: an unrelated bare .modal-card element was accidentally styled as flex by the shared stylesheet`);
    assert.ok(!/calc\(100(vh|dvh)/.test(leaked.maxHeight), `${file}: an unrelated bare .modal-card element was accidentally given the shared modal max-height`);

    monitor.assertClean();
    await page.close();
    step(`${file}: opts into the shared ws-shell-root/ws-desktop-shell/ws-shell-column/ws-shell-header/ws-shell-scroll/ws-actionbar-slot contract, and an unrelated bare .modal-card element is not accidentally styled by it`);
  }
}

// ===================================================================================
// Body never scrolls; the one internal workspace is the real scroll owner.
// ===================================================================================
async function checkBodyNoScrollAndWorkspaceOwnsScroll(context, baseUrl) {
  for (const file of PAGES) {
    for (const vp of VIEWPORTS) {
      const page = await context.newPage();
      const monitor = monitorPage(page, baseUrl);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await gotoSettled(page, `${baseUrl}/${file}`);
      const geo = await geometry(page);
      assert.ok(geo.scrollHeight <= geo.clientHeight + 1, `${file} @ ${vp.name}: document must not scroll (scrollHeight ${geo.scrollHeight} > clientHeight ${geo.clientHeight})`);
      assert.ok(geo.scrollWidth <= geo.clientWidth + 1, `${file} @ ${vp.name}: document must not scroll horizontally (scrollWidth ${geo.scrollWidth} > clientWidth ${geo.clientWidth})`);
      monitor.assertClean();
      await page.close();
    }
    step(`${file}: document never scrolls, no horizontal overflow, at 1280x720/1366x768/1920x1080/2560x1440/3840x1080`);
  }

  for (const file of PAGES) {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await page.setViewportSize({ width: 1366, height: 720 });
    await gotoSettled(page, `${baseUrl}/${file}`);
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
    }, WORKSPACE_SEL);
    assert.ok(result.wsScrollHeightWasTaller, `${file}: workspace did not actually need to scroll with injected long content`);
    assert.ok(result.after.wsScrollTop > 0, `${file}: workspace scrollTop did not change`);
    assert.equal(result.after.docScrollTop, 0, `${file}: document scrollTop moved when only the workspace should scroll`);
    monitor.assertClean();
    await page.close();
    step(`${file}: .ws-shell-scroll is the real internal vertical scroll owner — its scrollTop changes while the document's stays at 0`);
  }
}

// ===================================================================================
// Sidebar/header/action bar/radio geometry at all 5 primary resolutions.
// ===================================================================================
async function checkSidebarHeaderActionbarVisible(context, baseUrl) {
  for (const file of PAGES) {
    for (const vp of VIEWPORTS) {
      const page = await context.newPage();
      const monitor = monitorPage(page, baseUrl);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await gotoSettled(page, `${baseUrl}/${file}`);
      const geo = await geometry(page);
      assert.ok(within(geo.sidebar, geo.viewportWidth, geo.viewportHeight), `${file} @ ${vp.name}: sidebar not fully within viewport: ${JSON.stringify(geo.sidebar)}`);
      assert.ok(within(geo.header, geo.viewportWidth, geo.viewportHeight), `${file} @ ${vp.name}: header not fully within viewport: ${JSON.stringify(geo.header)}`);
      assert.ok(within(geo.actionbar, geo.viewportWidth, geo.viewportHeight), `${file} @ ${vp.name}: action bar not fully within viewport: ${JSON.stringify(geo.actionbar)}`);
      assert.ok(within(geo.radio, geo.viewportWidth, geo.viewportHeight), `${file} @ ${vp.name}: radio not fully within viewport: ${JSON.stringify(geo.radio)}`);
      assert.ok(geo.sidebar.height >= geo.viewportHeight - 2, `${file} @ ${vp.name}: sidebar must remain full-height (height ${geo.sidebar.height} vs viewport ${geo.viewportHeight})`);
      monitor.assertClean();
      await page.close();
    }
    step(`${file}: sidebar (full-height), header, action bar and radio all remain within the viewport at all 5 primary resolutions`);
  }
}

// ===================================================================================
// The old bottom action-bar position no longer exists; exact action order preserved.
// ===================================================================================
async function checkOldBottomLocationGoneAndActionOrder(context, baseUrl) {
  for (const file of PAGES) {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoSettled(page, `${baseUrl}/${file}`);

    const info = await page.evaluate(() => {
      const vh = window.innerHeight;
      const ab = document.querySelector('.ws-actionbar-slot');
      const rect = ab.getBoundingClientRect();
      return { nearBottom: rect.top > vh - 200, insideWorkspace: !!document.querySelector('.ws-shell-scroll .ws-actionbar-slot') };
    });
    assert.equal(info.nearBottom, false, `${file}: the action bar must no longer sit near the bottom of the viewport`);
    assert.equal(info.insideWorkspace, false, `${file}: the action bar must not be a scrolling child of the workspace`);

    const texts = await readActionBarTexts(page);
    const expected = EXPECTED_ACTIONS[file];
    assert.equal(texts.length, expected.length, `${file}: expected ${expected.length} actions, found ${texts.length} (${JSON.stringify(texts)})`);
    expected.forEach((label, i) => {
      assert.ok(texts[i].includes(label), `${file}: action ${i} expected to contain "${label}", got "${texts[i]}" (order: ${JSON.stringify(texts)})`);
    });

    monitor.assertClean();
    await page.close();
    step(`${file}: the old bottom action-bar position no longer exists; all ${expected.length} actions appear exactly once, in the original order`);
  }
}

// ===================================================================================
// Real action handlers, per page.
// ===================================================================================
async function checkRealActionHandlers(context, baseUrl) {
  // Store: "New Item" opens the real modal; a full real submission creates a real inventory item.
  {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await gotoSettled(page, `${baseUrl}/store-desktop.html`);
    await page.locator('.ws-actionbar-slot button', { hasText: 'New Item' }).click();
    await page.waitForTimeout(150);
    const opened = await page.evaluate(() => document.getElementById('newItemModal').classList.contains('show'));
    assert.equal(opened, true, 'store: New Item did not open the real modal');
    const code = `WS-TEST-${Date.now()}`;
    await page.fill('#newCode', code);
    await page.fill('#newDescription', 'Pass 1B-2 regression test item');
    await page.fill('#newCategory', 'Test');
    await page.fill('#newLocation', 'T1-01-01');
    const before = await page.evaluate(() => STOCK.length);
    await page.locator('#newItemModal .actions button.primary').click();
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => STOCK.length);
    assert.equal(after, before + 1, `store: creating a real inventory item did not update STOCK (before=${before}, after=${after})`);
    monitor.assertClean();
    await page.close();
    step('store-desktop.html: relocated "New Item" button opens the real modal and a real submission creates a real inventory item');
  }
  // Purchasing: "New Purchase Order" opens the real modal.
  {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await gotoSettled(page, `${baseUrl}/purchasing-desktop.html`);
    await page.locator('.ws-actionbar-slot button', { hasText: 'New Purchase Order' }).click();
    await page.waitForTimeout(150);
    const state = await page.evaluate(() => ({ shown: document.getElementById('modal').classList.contains('show'), title: document.getElementById('modalTitle').textContent }));
    assert.equal(state.shown, true, 'purchasing: New Purchase Order did not open the real modal');
    assert.equal(state.title, 'New Purchase Order', `purchasing: unexpected modal title "${state.title}"`);
    monitor.assertClean();
    await page.close();
    step('purchasing-desktop.html: relocated "New Purchase Order" button opens the real modal via its real handler');
  }
  // Documents: "Upload Document" opens the real modal; "Create Folder" makes a real, persisted folder.
  {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await gotoSettled(page, `${baseUrl}/documents-desktop.html`);
    await page.locator('.ws-actionbar-slot button', { hasText: 'Upload Document' }).click();
    await page.waitForTimeout(150);
    const opened = await page.evaluate(() => document.getElementById('uploadModal').classList.contains('show'));
    assert.equal(opened, true, 'documents: Upload Document did not open the real modal');
    await page.locator('#uploadModal .modal-actions button:first-child').click(); // Cancel — close before opening the next real modal
    await page.waitForTimeout(100);

    await page.locator('.ws-actionbar-slot button', { hasText: 'Create Folder' }).click();
    await page.waitForTimeout(150);
    const folderName = `Pass1B2Test-${Date.now()}`;
    await page.fill('#folderName', folderName);
    const before = await page.evaluate(() => WorkshopData.getDocumentFolders().length);
    await page.locator('#folderModal .modal-actions button.primary').click();
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => WorkshopData.getDocumentFolders().length);
    assert.equal(after, before + 1, `documents: creating a real folder did not update the shared folder list (before=${before}, after=${after})`);
    monitor.assertClean();
    await page.close();
    step('documents-desktop.html: relocated "Upload Document" opens the real modal; "Create Folder" creates a real, shared folder record via its real handler');
  }
}

// ===================================================================================
// Internal navigation / deep links target the real scroll owner, not the document.
// ===================================================================================
async function checkScrollNavigationTargetsRealOwner(context, baseUrl) {
  // Store: focusSection() must scroll .ws-shell-scroll, not the document, and respect
  // reduced motion.
  {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await page.setViewportSize({ width: 1366, height: 700 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoSettled(page, `${baseUrl}/store-desktop.html`);
    const result = await page.evaluate(() => {
      const ws = document.querySelector('.ws-shell-scroll');
      ws.scrollTop = 200;
      const before = { wsScrollTop: ws.scrollTop, docScrollTop: document.documentElement.scrollTop };
      focusSection('stockcount');
      return { before, after: { wsScrollTop: ws.scrollTop, docScrollTop: document.documentElement.scrollTop } };
    });
    assert.ok(result.before.wsScrollTop > 0, 'store: setup failed — workspace did not scroll to a non-zero position');
    assert.notEqual(result.after.wsScrollTop, result.before.wsScrollTop, 'store: focusSection() did not move the workspace scroll position');
    assert.equal(result.after.docScrollTop, 0, 'store: focusSection() moved the document instead of (or in addition to) the workspace');
    monitor.assertClean();
    await page.close();
    step('store-desktop.html: focusSection() scrolls the real internal workspace (.ws-shell-scroll), not the document, and resolves immediately under reduced motion');
  }
  // Store: real reduced-motion behavior selection.
  {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoSettled(page, `${baseUrl}/store-desktop.html`);
    const behaviorUsed = await page.evaluate(() => {
      const target = document.getElementById('stockcount');
      const original = target.scrollIntoView.bind(target);
      let captured = null;
      target.scrollIntoView = (opts) => { captured = opts && opts.behavior; return original(opts); };
      focusSection('stockcount');
      return captured;
    });
    assert.equal(behaviorUsed, 'auto', `store: reduced-motion focusSection() should use behavior:'auto', got "${behaviorUsed}"`);
    monitor.assertClean();
    await page.close();
    step('store-desktop.html: reduced-motion preference makes focusSection() scroll immediately (behavior:"auto"), not smoothly');
  }
  // Store: the #receiving deep link reveals the Receiving section inside the real workspace.
  {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await page.setViewportSize({ width: 1366, height: 720 });
    await gotoSettled(page, `${baseUrl}/store-desktop.html#receiving`);
    const result = await page.evaluate(() => {
      const el = document.getElementById('receiving');
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, viewportHeight: window.innerHeight, docScrollTop: document.documentElement.scrollTop, withinViewport: r.top < window.innerHeight && r.bottom > 0 };
    });
    assert.ok(result.withinViewport, `store: #receiving deep link did not reveal the Receiving section (rect top=${result.top}, bottom=${result.bottom})`);
    assert.equal(result.docScrollTop, 0, 'store: #receiving deep link scrolled the document instead of the internal workspace');
    monitor.assertClean();
    await page.close();
    step('store-desktop.html: store-desktop.html#receiving reveals the Receiving section inside the internal workspace, without scrolling the document');
  }
  // Purchasing: view changes reset the workspace to the top. Reduced motion is emulated so the
  // reset (behavior:'auto') is synchronous and deterministic to assert on; the smooth-scroll case
  // itself is exercised for real by the browser and is not something a script should race against.
  {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await page.setViewportSize({ width: 1366, height: 700 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoSettled(page, `${baseUrl}/purchasing-desktop.html`);
    const result = await page.evaluate(() => {
      const ws = document.getElementById('main');
      ws.scrollTop = 200;
      const before = ws.scrollTop;
      setView('orders');
      return { before, after: ws.scrollTop };
    });
    assert.ok(result.before > 0, 'purchasing: setup failed — workspace did not scroll to a non-zero position');
    assert.equal(result.after, 0, `purchasing: setView() did not reset the workspace to the top (scrollTop=${result.after})`);
    monitor.assertClean();
    await page.close();
    step('purchasing-desktop.html: real setView() navigation resets the workspace (#main) to the top');
  }
  // Documents: setView() resets #main itself (not scrollIntoView on the scroll owner, not the doc).
  // Reduced motion is emulated so the reset (behavior:'auto') is synchronous and deterministic.
  {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await page.setViewportSize({ width: 1366, height: 700 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoSettled(page, `${baseUrl}/documents-desktop.html`);
    const result = await page.evaluate(() => {
      const ws = document.getElementById('main');
      ws.scrollTop = 200;
      const before = { wsScrollTop: ws.scrollTop, docScrollTop: document.documentElement.scrollTop };
      setView('recent');
      return { before, after: { wsScrollTop: ws.scrollTop, docScrollTop: document.documentElement.scrollTop } };
    });
    assert.ok(result.before.wsScrollTop > 0, 'documents: setup failed — workspace did not scroll to a non-zero position');
    assert.equal(result.after.wsScrollTop, 0, `documents: setView() did not reset #main itself to the top (scrollTop=${result.after.wsScrollTop})`);
    assert.equal(result.after.docScrollTop, 0, 'documents: setView() moved the document instead of (or in addition to) #main');
    monitor.assertClean();
    await page.close();
    step('documents-desktop.html: real setView() navigation resets #main itself to the top, without moving the document');
  }
  // Sidebar/header/action-bar positions stay put during workspace navigation (spot check on Store).
  {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await page.setViewportSize({ width: 1366, height: 700 });
    await gotoSettled(page, `${baseUrl}/store-desktop.html`);
    const before = await geometry(page);
    await page.evaluate(() => focusSection('stockcount'));
    await page.waitForTimeout(400);
    const after = await geometry(page);
    assert.deepEqual(after.header, before.header, 'store: header position changed during workspace navigation');
    assert.deepEqual(after.actionbar, before.actionbar, 'store: action bar position changed during workspace navigation');
    assert.equal(after.sidebar.height, before.sidebar.height, 'store: sidebar height changed during workspace navigation');
    monitor.assertClean();
    await page.close();
    step('store-desktop.html: sidebar/header/action-bar geometry is unchanged by workspace-internal navigation');
  }
}

// ===================================================================================
// Print media (all 3 pages generically; Store's label-print path specifically).
// ===================================================================================
async function checkPrintMedia(context, baseUrl) {
  for (const file of PAGES) {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await page.setViewportSize({ width: 1366, height: 720 });
    await gotoSettled(page, `${baseUrl}/${file}`);

    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(80);
    const printState = await page.evaluate(() => {
      const html = document.documentElement, body = document.body;
      const scrollArea = document.querySelector('.ws-shell-scroll');
      const sidebar = document.querySelector('aside.sidebar');
      const actionbar = document.querySelector('.ws-actionbar-slot');
      const radio = document.getElementById('radio');
      return {
        htmlOverflow: getComputedStyle(html).overflow,
        bodyOverflow: getComputedStyle(body).overflow,
        scrollAreaOverflowY: getComputedStyle(scrollArea).overflowY,
        sidebarDisplay: getComputedStyle(sidebar).display,
        actionbarDisplay: getComputedStyle(actionbar).display,
        radioDisplay: radio ? getComputedStyle(radio).display : null,
        radioSafeMargin: getComputedStyle(scrollArea).marginBottom
      };
    });
    assert.equal(printState.htmlOverflow, 'visible', `${file}: <html> overflow must become visible in print media`);
    assert.equal(printState.bodyOverflow, 'visible', `${file}: <body> overflow must become visible in print media`);
    assert.equal(printState.scrollAreaOverflowY, 'visible', `${file}: .ws-shell-scroll overflow-y must become visible in print media`);
    assert.equal(printState.sidebarDisplay, 'none', `${file}: the navigation sidebar should not print`);
    assert.equal(printState.actionbarDisplay, 'none', `${file}: the relocated action bar should not print`);
    assert.equal(printState.radioDisplay, 'none', `${file}: the shared radio widget should not print`);
    assert.equal(printState.radioSafeMargin, '0px', `${file}: the screen-only 96px radio-safe margin was not reset to 0 in print media`);

    await page.emulateMedia({ media: 'screen' });
    await page.waitForTimeout(80);
    const screenState = await page.evaluate(() => ({
      bodyOverflow: getComputedStyle(document.body).overflow,
      sidebarDisplay: getComputedStyle(document.querySelector('aside.sidebar')).display
    }));
    assert.notEqual(screenState.bodyOverflow, 'visible', `${file}: screen-media body overflow regressed after exercising print media (still print's visible override)`);
    assert.notEqual(screenState.sidebarDisplay, 'none', `${file}: screen-media sidebar visibility regressed after exercising print media`);

    monitor.assertClean();
    await page.close();
    step(`${file}: print media resets the fixed shell to visible-overflow and hides navigation chrome (including the radio-safe margin), without affecting screen layout`);
  }

  // Store's label print: only the label prints; the live app cannot create blank pages.
  {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await page.setViewportSize({ width: 1366, height: 720 });
    await gotoSettled(page, `${baseUrl}/store-desktop.html`);
    await page.locator('.ws-actionbar-slot button', { hasText: 'Receive Goods' }).click();
    await page.waitForTimeout(300);
    await page.locator('button[onclick="showLabel($(\'receiveItem\').value)"]').click();
    await page.waitForTimeout(150);
    const shown = await page.evaluate(() => document.getElementById('labelModal').classList.contains('show'));
    assert.equal(shown, true, 'store: Print Label did not open the real label modal');

    let printCalled = false;
    await page.exposeFunction('__wsStorePrintCalled', () => { printCalled = true; });
    await page.evaluate(() => { window.print = () => window.__wsStorePrintCalled(); });
    await page.locator('#labelModal .actions button.primary').click();
    await page.waitForTimeout(100);
    assert.equal(printCalled, true, 'store: the label modal\'s Print label button did not trigger window.print()');

    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(80);
    const printGeo = await page.evaluate(() => {
      const app = document.querySelector('.app');
      const bg = document.querySelector('.bg');
      const labelBody = document.getElementById('labelBody');
      const phead = document.querySelector('#labelModal .phead');
      const actions = document.querySelector('#labelModal .actions');
      const r = labelBody.getBoundingClientRect();
      return {
        appDisplay: getComputedStyle(app).display,
        bgDisplay: getComputedStyle(bg).display,
        labelBodyDisplay: getComputedStyle(labelBody).display,
        labelBodyHeight: r.height,
        pheadDisplay: getComputedStyle(phead).display,
        actionsDisplay: getComputedStyle(actions).display,
        bodyScrollHeight: document.body.scrollHeight
      };
    });
    assert.equal(printGeo.appDisplay, 'none', 'store: the live application (.app) is not hidden in print media — it can create blank/extra pages around the label');
    assert.equal(printGeo.bgDisplay, 'none', 'store: the decorative background is not hidden in print media');
    assert.equal(printGeo.labelBodyDisplay, 'block', 'store: the label content is not in normal print flow');
    assert.ok(printGeo.labelBodyHeight > 0, 'store: the label content has no printable height');
    assert.equal(printGeo.pheadDisplay, 'none', 'store: the label modal\'s own title bar (UI chrome, not the label) still prints');
    assert.equal(printGeo.actionsDisplay, 'none', 'store: the label modal\'s own Close/Print buttons (UI chrome, not the label) still print');
    assert.ok(printGeo.bodyScrollHeight < printGeo.labelBodyHeight + 100, `store: printable body height (${printGeo.bodyScrollHeight}px) is far larger than the label content (${printGeo.labelBodyHeight}px) — something other than the label is still contributing to the printed page`);

    await page.emulateMedia({ media: 'screen' });
    await page.waitForTimeout(80);
    const screenState = await page.evaluate(() => getComputedStyle(document.querySelector('.app')).display);
    assert.equal(screenState, 'grid', 'store: screen layout (.app) did not return to normal after print media was exercised');

    monitor.assertClean();
    await page.close();
    step('store-desktop.html: printing the material label shows only the label content (no sidebar/header/actionbar/workspace/background/modal-chrome), with the live application contributing no extra printable height, and screen layout is restored afterward');
  }
}

// ===================================================================================
// Modal audit: the representative modal per page gets the full deep-dive (real overflow,
// real scrollTop change, pinned header/footer, reopen integrity); every other real modal gets
// a lighter but still real contract check.
// ===================================================================================
async function checkModalScrollAllPages(context, baseUrl) {
  for (const file of PAGES) {
    const rep = REP_MODAL[file];
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await page.setViewportSize({ width: 1366, height: 640 });
    await gotoSettled(page, `${baseUrl}/${file}`);

    await page.locator('.ws-actionbar-slot button', { hasText: rep.openLabel }).click();
    await page.waitForTimeout(150);

    await page.evaluate((bodySel) => {
      const body = document.querySelector(bodySel);
      const filler = document.createElement('div');
      filler.style.height = '3000px';
      filler.setAttribute('data-ws-modal-test-filler', '1');
      body.appendChild(filler);
    }, rep.body);
    await page.waitForTimeout(50);

    const overflowState = await page.evaluate((bodySel) => {
      const body = document.querySelector(bodySel);
      return { scrollHeight: body.scrollHeight, clientHeight: body.clientHeight };
    }, rep.body);
    assert.ok(overflowState.scrollHeight > overflowState.clientHeight, `${file}: modal body does not actually overflow (scrollHeight=${overflowState.scrollHeight}, clientHeight=${overflowState.clientHeight})`);

    const scrollResult = await page.evaluate((bodySel) => {
      const body = document.querySelector(bodySel);
      const before = body.scrollTop;
      body.scrollTop = body.scrollHeight;
      return { before, after: body.scrollTop };
    }, rep.body);
    assert.equal(scrollResult.before, 0, `${file}: modal body should start unscrolled`);
    assert.ok(scrollResult.after > 0, `${file}: modal body scrollTop did not actually change`);

    const pins = await page.evaluate(({ headingSel, footerSel }) => {
      const vh = window.innerHeight, vw = window.innerWidth;
      function withinVp(el) {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.left >= 0 && r.bottom <= vh && r.right <= vw;
      }
      const heading = document.querySelector(headingSel);
      const footer = document.querySelector(footerSel);
      return { headingWithin: heading ? withinVp(heading) : null, footerWithin: footer ? withinVp(footer) : null };
    }, { headingSel: rep.heading, footerSel: rep.footer });
    assert.equal(pins.headingWithin, true, `${file}: modal heading left the viewport while the body scrolled`);
    assert.equal(pins.footerWithin, true, `${file}: modal action/footer row left the viewport while the body scrolled`);

    const owners = await page.evaluate((overlaySel) => ({
      overlayScrollTop: document.querySelector(overlaySel).scrollTop,
      docScrollTop: document.documentElement.scrollTop
    }), rep.overlay);
    assert.equal(owners.overlayScrollTop, 0, `${file}: the modal overlay scrolled instead of the modal body`);
    assert.equal(owners.docScrollTop, 0, `${file}: the document scrolled instead of the modal body`);

    await page.evaluate((bodySel) => {
      const filler = document.querySelector(bodySel + ' [data-ws-modal-test-filler]');
      if (filler) filler.remove();
    }, rep.body);

    const beforeCloseFieldIds = await page.evaluate((cardSel) => Array.from(document.querySelector(cardSel).querySelectorAll('[id]')).map((e) => e.id), rep.card);
    await closeRealModal(page, rep.cancel);
    await page.locator('.ws-actionbar-slot button', { hasText: rep.openLabel }).click();
    await page.waitForTimeout(150);
    const afterReopen = await page.evaluate((cardSel) => Array.from(document.querySelector(cardSel).querySelectorAll('[id]')).map((e) => e.id), rep.card);
    assert.deepEqual(afterReopen.sort(), beforeCloseFieldIds.sort(), `${file}: reopening the modal changed its set of field ids`);
    const bodyCountAfterReopen = await page.evaluate((bodySel) => document.querySelectorAll(bodySel).length, rep.body);
    assert.equal(bodyCountAfterReopen, 1, `${file}: reopening the modal produced ${bodyCountAfterReopen} body regions instead of exactly one`);

    monitor.assertClean();
    await page.close();
    step(`${file}: representative modal (${rep.overlay}) body genuinely overflows and scrolls, header/footer stay pinned, overlay/document never scroll, and reopening preserves every field id`);
  }

  // Every other real modal: lighter contract check (opens, is bounded, body scrolls, footer
  // pinned, closes and reopens without duplicating).
  for (const file of PAGES) {
    for (const modal of OTHER_MODALS[file]) {
      const page = await context.newPage();
      const monitor = monitorPage(page, baseUrl);
      await page.setViewportSize({ width: 1366, height: 640 });
      await gotoSettled(page, `${baseUrl}/${file}`);

      await page.evaluate(modal.open);
      await page.waitForTimeout(150);
      const info = await page.evaluate(({ overlaySel, cardSel, bodySel, footerSel }) => {
        const overlay = document.querySelector(overlaySel);
        const card = document.querySelector(cardSel);
        const body = document.querySelector(bodySel);
        const footer = document.querySelector(footerSel);
        const vh = window.innerHeight;
        function withinVp(el) { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= vh; }
        return {
          shown: overlay.classList.contains('show'),
          cardOverflow: getComputedStyle(card).overflow,
          bodyOverflowY: getComputedStyle(body).overflowY,
          footerWithin: footer ? withinVp(footer) : null
        };
      }, { overlaySel: modal.overlay, cardSel: modal.card, bodySel: modal.body, footerSel: modal.footer });
      assert.equal(info.shown, true, `${file}/${modal.name}: did not open via its real handler`);
      assert.equal(info.cardOverflow, 'hidden', `${file}/${modal.name}: modal card is not bounded (overflow=${info.cardOverflow})`);
      assert.equal(info.bodyOverflowY, 'auto', `${file}/${modal.name}: modal body is not set up to scroll internally (overflow-y=${info.bodyOverflowY})`);
      assert.equal(info.footerWithin, true, `${file}/${modal.name}: modal footer/action row is not within the viewport`);

      // Close and reopen — no duplicate body regions.
      const cancelSel = `${modal.overlay} button`;
      await page.locator(cancelSel).first().click();
      await page.waitForTimeout(100);
      await page.evaluate(modal.open);
      await page.waitForTimeout(150);
      const bodyCount = await page.evaluate((bodySel) => document.querySelectorAll(bodySel).length, modal.body);
      assert.equal(bodyCount, 1, `${file}/${modal.name}: reopening produced ${bodyCount} body regions instead of exactly one`);

      monitor.assertClean();
      await page.close();
      step(`${file}/${modal.name}: opens via its real handler, is bounded with an internally-scrolling body and a pinned footer, and reopens without duplication`);
    }
  }
}

// ===================================================================================
// Radio safe area: every visible interactive control, 5 states, all 5 primary resolutions.
// ===================================================================================
async function checkRadioSafeAreaComplete(context, baseUrl) {
  for (const file of PAGES) {
    const rep = REP_MODAL[file];
    for (const vp of VIEWPORTS) {
      const page = await context.newPage();
      const monitor = monitorPage(page, baseUrl);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await gotoSettled(page, `${baseUrl}/${file}`);

      let hits = await page.evaluate(elementsIntersectingRadio);
      assert.deepEqual(hits, [], `${file} @ ${vp.name} [initial]: interactive elements overlap the radio: ${JSON.stringify(hits)}`);

      await page.evaluate((sel) => { const el = document.querySelector(sel); el.scrollTop = Math.round(el.scrollHeight / 2); }, WORKSPACE_SEL);
      await page.waitForTimeout(60);
      hits = await page.evaluate(elementsIntersectingRadio);
      assert.deepEqual(hits, [], `${file} @ ${vp.name} [scrolled-middle]: interactive elements overlap the radio: ${JSON.stringify(hits)}`);

      await page.evaluate((sel) => { const el = document.querySelector(sel); el.scrollTop = el.scrollHeight; }, WORKSPACE_SEL);
      await page.waitForTimeout(60);
      hits = await page.evaluate(elementsIntersectingRadio);
      assert.deepEqual(hits, [], `${file} @ ${vp.name} [scrolled-bottom]: interactive elements overlap the radio: ${JSON.stringify(hits)}`);

      await page.evaluate((sel) => { const el = document.querySelector(sel); el.scrollTop = 0; }, WORKSPACE_SEL);
      await page.locator('.ws-actionbar-slot button', { hasText: rep.openLabel }).click();
      await page.waitForTimeout(150);
      hits = await page.evaluate(elementsIntersectingRadio);
      assert.deepEqual(hits, [], `${file} @ ${vp.name} [modal-open]: interactive elements overlap the radio: ${JSON.stringify(hits)}`);
      await closeRealModal(page, rep.cancel);

      monitor.assertClean();
      await page.close();
    }
    step(`${file}: no visible interactive control (header controls, action bar, representative modal) overlaps the shared radio at initial/scrolled-middle/scrolled-bottom/modal-open, at all 5 primary resolutions`);
  }

  // Store's own language <select> in the header, specifically named in the task.
  {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await page.setViewportSize({ width: 1366, height: 768 });
    await gotoSettled(page, `${baseUrl}/store-desktop.html`);
    const hits = await page.evaluate(elementsIntersectingRadio);
    const langSelectHit = hits.find((h) => h.id === 'lang');
    assert.equal(langSelectHit, undefined, `store: the language selector overlaps the radio: ${JSON.stringify(hits)}`);
    monitor.assertClean();
    await page.close();
    step('store-desktop.html: the language selector does not overlap the shared radio');
  }
}

// ===================================================================================
// Real keyboard traversal (Tab/Shift+Tab), plus strengthened short-height/zoom-proxy checks.
// ===================================================================================
async function checkRealKeyboardTraversal(context, baseUrl) {
  const PRE_ACTIONBAR_SEL = {
    'store-desktop.html': 'header.top select#lang',
    'purchasing-desktop.html': 'header.top .btn.primary',
    'documents-desktop.html': 'header.top .btn.primary'
  };
  for (const file of PAGES) {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await gotoSettled(page, `${baseUrl}/${file}`);

    await page.locator(PRE_ACTIONBAR_SEL[file]).focus();
    const labels = await readActionBarTexts(page);

    for (let i = 0; i < labels.length; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el, ':focus-visible');
        return { text: el.textContent.trim(), top: r.top, left: r.left, visible: r.width > 0 && r.height > 0, outline: cs.outlineStyle || getComputedStyle(el).outlineStyle };
      });
      assert.ok(info.text.includes(labels[i]) || labels[i].includes(info.text), `${file}: Tab order at position ${i} landed on "${info.text}", expected an action containing "${labels[i]}"`);
      assert.ok(info.visible, `${file}: focused action ${i} ("${info.text}") is not visible`);
      assert.ok(info.top >= 0 && info.left >= 0, `${file}: focused action ${i} ("${info.text}") is hidden off the top/left of the viewport`);
      assert.notEqual(info.outline, 'none', `${file}: focused action ${i} ("${info.text}") suppresses its focus outline`);
    }

    for (let i = labels.length - 1; i >= 0; i--) {
      const text = await page.evaluate(() => document.activeElement.textContent.trim());
      assert.ok(text.includes(labels[i]) || labels[i].includes(text), `${file}: Shift+Tab reverse order at position ${i} found "${text}", expected an action containing "${labels[i]}"`);
      if (i > 0) await page.keyboard.press('Shift+Tab');
    }

    monitor.assertClean();
    await page.close();
    step(`${file}: real Tab reaches every relocated action in logical order with a visible focus style, and real Shift+Tab reverses correctly`);
  }

  // Real Enter/Space activation of a representative safe action per page.
  {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await gotoSettled(page, `${baseUrl}/store-desktop.html`);
    await page.locator('.ws-actionbar-slot button', { hasText: 'New Item' }).focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    const opened = await page.evaluate(() => document.getElementById('newItemModal').classList.contains('show'));
    assert.equal(opened, true, 'store: Enter on the focused "New Item" action did not activate it');
    monitor.assertClean();
    await page.close();
    step('store-desktop.html: Enter activates a focused relocated action via real keyboard input');
  }
  {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    await gotoSettled(page, `${baseUrl}/purchasing-desktop.html`);
    await page.locator('.ws-actionbar-slot button', { hasText: 'Compare Suppliers' }).focus();
    await page.keyboard.press(' ');
    await page.waitForTimeout(150);
    const active = await page.evaluate(() => activeView);
    assert.equal(active, 'comparison', `purchasing: Space on "Compare Suppliers" did not set the real activeView (was "${active}")`);
    monitor.assertClean();
    await page.close();
    step('purchasing-desktop.html: Space activates a focused relocated action via real keyboard input');
  }

  // Strengthened short-height / zoom-proxy fallback.
  for (const vp of [SHORT_VIEWPORT, ZOOM_PROXY_VIEWPORT]) {
    for (const file of PAGES) {
      const page = await context.newPage();
      const monitor = monitorPage(page, baseUrl);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await gotoSettled(page, `${baseUrl}/${file}`);

      const result = await page.evaluate((sel) => {
        const ws = document.querySelector(sel);
        const marker = document.createElement('button');
        marker.id = 'ws-fallback-test-end-marker';
        marker.textContent = 'end of content marker';
        marker.style.marginTop = '2500px';
        marker.style.display = 'block';
        ws.appendChild(marker);
        const before = { wsScrollTop: ws.scrollTop, docScrollTop: document.documentElement.scrollTop };
        ws.scrollTop = ws.scrollHeight;
        const after = { wsScrollTop: ws.scrollTop, docScrollTop: document.documentElement.scrollTop };
        const markerRect = marker.getBoundingClientRect();
        const markerReachable = markerRect.top >= 0 && markerRect.bottom <= window.innerHeight;
        marker.remove();
        return { before, after, markerReachable, wsClientHeight: ws.clientHeight };
      }, WORKSPACE_SEL);

      assert.ok(result.after.wsScrollTop > result.before.wsScrollTop, `${file} @ ${vp.name}: workspace scrollTop did not change`);
      assert.equal(result.after.docScrollTop, 0, `${file} @ ${vp.name}: document scrolled instead of the workspace`);
      assert.ok(result.markerReachable, `${file} @ ${vp.name}: a control at the end of injected content was not reachable by scrolling`);
      assert.ok(result.wsClientHeight >= 80, `${file} @ ${vp.name}: workspace usable height (${result.wsClientHeight}px) is not a meaningful minimum`);

      const geo = await geometry(page);
      assert.ok(geo.actionbar.height < vp.height * 0.5, `${file} @ ${vp.name}: the action bar (${geo.actionbar.height}px) consumes more than half of the usable viewport height (${vp.height}px)`);

      monitor.assertClean();
      await page.close();
    }
    step(`all three pages: at ${vp.name}, the internal workspace genuinely scrolls (proven scrollTop change) while the document stays at 0, an end-of-content control becomes reachable, workspace height stays meaningful, and the action bar does not consume the viewport`);
  }
}

// ===================================================================================
// Localization: Store's existing EN/SV/MK continues working; Purchasing/Documents keep their
// current (no-switcher, English-only) behavior — no new translation system is introduced.
// ===================================================================================
async function checkLocalization(context, baseUrl) {
  const page = await context.newPage();
  const monitor = monitorPage(page, baseUrl);
  await gotoSettled(page, `${baseUrl}/store-desktop.html`);
  for (const [lang, expected] of [['sv', 'Ny artikel'], ['mk', 'Нов артикл'], ['en', 'New Item']]) {
    await page.selectOption('#lang', lang);
    await page.waitForTimeout(100);
    const texts = await readActionBarTexts(page);
    assert.ok(texts.some((t) => t.includes(expected)), `store [${lang}]: expected an action containing "${expected}", got ${JSON.stringify(texts)}`);
  }
  const count = await page.evaluate(() => document.querySelectorAll('.ws-actionbar-slot').length);
  assert.equal(count, 1, 'store: action-bar slot duplicated after a language change');
  monitor.assertClean();
  await page.close();
  step('store-desktop.html: relocated action-bar labels translate correctly across EN/SV/MK without duplicating the slot');

  for (const file of ['purchasing-desktop.html', 'documents-desktop.html']) {
    const p2 = await context.newPage();
    const monitor2 = monitorPage(p2, baseUrl);
    await gotoSettled(p2, `${baseUrl}/${file}`);
    const info = await p2.evaluate(() => ({ lang: document.documentElement.lang, hasSwitcher: !!document.querySelector('select[aria-label*="anguage" i], #langtoggle') }));
    assert.equal(info.lang, 'en', `${file}: expected to remain in English (no new translation system introduced), found lang="${info.lang}"`);
    assert.equal(info.hasSwitcher, false, `${file}: a language switcher appeared where none existed before — this pass must not invent one`);
    monitor2.assertClean();
    await p2.close();
    step(`${file}: keeps its existing English-only behavior — no language switcher was invented by this pass`);
  }
}

// ===================================================================================
// State persistence for a safe mutation per page (reload survival).
// ===================================================================================
async function checkStatePersistence(context, baseUrl) {
  const page = await context.newPage();
  const monitor = monitorPage(page, baseUrl);
  await gotoSettled(page, `${baseUrl}/documents-desktop.html`);
  const before = await page.evaluate(() => WorkshopData.getDocumentFolders().length);
  await page.locator('.ws-actionbar-slot button', { hasText: 'Create Folder' }).click();
  await page.waitForTimeout(150);
  const folderName = `Pass1B2Persist-${Date.now()}`;
  await page.fill('#folderName', folderName);
  await page.locator('#folderModal .modal-actions button.primary').click();
  await page.waitForTimeout(150);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => WorkshopData.getDocumentFolders().length);
  assert.ok(after >= before + 1, `documents: folder created via a relocated action did not survive reload (before=${before}, after=${after})`);
  monitor.assertClean();
  await page.close();
  step('documents-desktop.html: a folder created via a relocated action still persists across reload');
}

async function main() {
  const harness = await startBrowserHarness();
  try {
    await checkSharedShellContract(harness.context, harness.baseUrl);
    await checkBodyNoScrollAndWorkspaceOwnsScroll(harness.context, harness.baseUrl);
    await checkSidebarHeaderActionbarVisible(harness.context, harness.baseUrl);
    await checkOldBottomLocationGoneAndActionOrder(harness.context, harness.baseUrl);
    await checkRealActionHandlers(harness.context, harness.baseUrl);
    await checkScrollNavigationTargetsRealOwner(harness.context, harness.baseUrl);
    await checkPrintMedia(harness.context, harness.baseUrl);
    await checkModalScrollAllPages(harness.context, harness.baseUrl);
    await checkRadioSafeAreaComplete(harness.context, harness.baseUrl);
    await checkRealKeyboardTraversal(harness.context, harness.baseUrl);
    await checkLocalization(harness.context, harness.baseUrl);
    await checkStatePersistence(harness.context, harness.baseUrl);
    console.log('\nFrontend UX Pass 1B-2 browser E2E passed.');
  } finally {
    await harness.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
