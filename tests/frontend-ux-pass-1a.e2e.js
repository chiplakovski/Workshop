'use strict';

const assert = require('node:assert/strict');
const { monitorPage, startBrowserHarness } = require('./helpers/browser-harness');

const DESKTOP_PAGES = [
  'hub-desktop.html',
  'customers-desktop.html',
  'documents-desktop.html',
  'equipment-machines-desktop.html',
  'estimations-desktop.html',
  'hours-desktop.html',
  'jobcard-desktop.html',
  'marketing-desktop.html',
  'planning-desktop.html',
  'projects-desktop.html',
  'purchasing-desktop.html',
  'quality-desktop.html',
  'reports-desktop.html',
  'store-desktop.html',
  'suppliers-desktop.html'
];

const EXCLUDED_PAGES = ['login.html', 'hub-mobile.html', 'hours-mobile.html'];

const HUB_SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3840, height: 1080 }
];

function step(message) {
  console.log(`OK   ${message}`);
}

const RADIO_WIDGET_IDS = ['radio', 'radioPanel', 'stationList', 'radioVol', 'radioAudio', 'radioBtn', 'radioIcon', 'radioName', 'radioSub', 'radioExp'];

// Mirrors workshop-radio.js's own TRANSLATIONS table — kept here as an independent reference so
// this test actually proves the widget's rendered text matches the intended translation, not
// just that it changed to *something*.
const RADIO_TRANSLATIONS = {
  en: { player: 'Radio player', panel: 'Radio stations and volume', stations: 'Stations', volume: 'Volume', play: 'Play', pause: 'Pause', live: 'DAB · Live', unavailable: 'Unavailable' },
  sv: { player: 'Radiospelare', panel: 'Radiokanaler och volym', stations: 'Kanaler', volume: 'Volym', play: 'Spela', pause: 'Pausa', live: 'DAB · Sänds nu', unavailable: 'Otillgänglig' },
  mk: { player: 'Radio plejer', panel: 'Radio stanici i jačina na zvuk', stations: 'Stanici', volume: 'Jačina na zvuk', play: 'Pušti', pause: 'Pauza', live: 'DAB · Vo živo', unavailable: 'Nedostapno' }
};

async function checkOneRadioPerPage(context, baseUrl) {
  for (const file of DESKTOP_PAGES) {
    const page = await context.newPage();
    const monitor = monitorPage(page, baseUrl);
    try {
      await page.goto(`${baseUrl}/${file}`, { waitUntil: 'load' });
      await page.waitForTimeout(100);
      const radioCount = await page.locator('#radio').count();
      assert.equal(radioCount, 1, `${file}: expected exactly one #radio widget, found ${radioCount}`);
      // Scoped to the radio widget's own ids — proves the widget was never injected twice (which
      // would duplicate every id inside it). A page-wide id-uniqueness audit is a separate,
      // pre-existing-content concern outside this pass's scope.
      const duplicateRadioIds = await page.evaluate((ids) => ids.filter((id) => document.querySelectorAll(`#${id}`).length > 1), RADIO_WIDGET_IDS);
      assert.deepEqual(duplicateRadioIds, [], `${file}: duplicate radio widget element ids found: ${duplicateRadioIds.join(', ')}`);
      monitor.assertClean();
    } finally {
      await page.close();
    }
  }
  for (const file of EXCLUDED_PAGES) {
    const page = await context.newPage();
    try {
      await page.goto(`${baseUrl}/${file}`, { waitUntil: 'load' });
      await page.waitForTimeout(100);
      const radioCount = await page.locator('#radio').count();
      assert.equal(radioCount, 0, `${file}: radio widget must not be loaded here`);
    } finally {
      await page.close();
    }
  }
  step(`exactly one radio widget (no duplicate ids) on all ${DESKTOP_PAGES.length} desktop pages; absent on ${EXCLUDED_PAGES.join(', ')}`);
}

async function checkPersistence(context, baseUrl) {
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/hub-desktop.html`, { waitUntil: 'load' });
    await page.waitForTimeout(100);

    await page.locator('#radioExp').click();
    await page.waitForTimeout(50);
    await page.locator('#stationList .st').nth(2).click();
    await page.waitForTimeout(50);
    await page.locator('#radioVol').evaluate((el) => {
      el.value = '0.3';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(50);
    const stationName = await page.locator('#radioName').textContent();
    assert.notEqual(stationName, 'P4 Malmöhus', 'station selection did not change from the default');

    await page.goto(`${baseUrl}/customers-desktop.html`, { waitUntil: 'load' });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#radioName').textContent(), stationName, 'station did not persist across navigation to another desktop page');
    assert.equal(await page.locator('#radioVol').inputValue(), '0.3', 'volume did not persist across navigation to another desktop page');
    step('radio station and volume persist when navigating between desktop modules');

    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#radioName').textContent(), stationName, 'station did not persist across reload');
    assert.equal(await page.locator('#radioVol').inputValue(), '0.3', 'volume did not persist across reload');
    step('radio station and volume persist across reload');
  } finally {
    await page.close();
  }
}

async function checkUnavailableState(context, baseUrl) {
  const page = await context.newPage();
  const monitor = monitorPage(page, baseUrl);
  try {
    await page.goto(`${baseUrl}/hub-desktop.html`, { waitUntil: 'load' });
    await page.waitForTimeout(100);

    // The harness blocks every non-local request (returns 204), so the real stream URLs can
    // never actually play here — this deterministically exercises the "stream cannot start"
    // path without depending on real network conditions.
    await page.locator('#radioBtn').click();
    await page.waitForTimeout(600);

    const state = await page.locator('#radio').evaluate((el) => ({
      playing: el.classList.contains('playing'),
      unavailable: el.classList.contains('unavailable')
    }));
    assert.equal(state.playing, false, 'radio must never show "playing" once audio.play() has failed');
    assert.equal(state.unavailable, true, 'radio must show a non-blocking unavailable state when a user-initiated play fails');
    assert.equal(await page.locator('body').isVisible(), true, 'the unavailable state must not be blocking');
    monitor.assertClean();
    step('radio degrades to a non-blocking unavailable state, never "playing", when a stream cannot start, with no console errors');
  } finally {
    await page.close();
  }
}

async function checkLanguagesAndAccessibility(context, baseUrl) {
  const page = await context.newPage();
  const monitor = monitorPage(page, baseUrl);
  try {
    await page.goto(`${baseUrl}/hub-desktop.html`, { waitUntil: 'load' });
    await page.waitForTimeout(100);

    assert.ok((await page.locator('body').innerText()).includes('Choose a module'), 'default EN text missing');
    await page.locator('#langtoggle').click();
    await page.locator('button[data-lang="sv"]').click();
    await page.waitForTimeout(50);
    assert.ok((await page.locator('body').innerText()).includes('Välj en modul'), 'SV translation did not apply');
    await page.locator('#langtoggle').click();
    await page.locator('button[data-lang="mk"]').click();
    await page.waitForTimeout(50);
    assert.ok((await page.locator('body').innerText()).includes('Izberi modul'), 'MK translation did not apply');
    await page.locator('#langtoggle').click();
    await page.locator('button[data-lang="en"]').click();
    await page.waitForTimeout(50);
    step('EN/SV/MK language switching renders the translated hub text correctly');

    await page.locator('#radioBtn').focus();
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'radioBtn', 'radio play button is not keyboard-focusable');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(50);
    await page.locator('#radioExp').focus();
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'radioExp', 'stations button is not keyboard-focusable');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(50);
    assert.equal(await page.locator('#radio').evaluate((el) => el.classList.contains('open')), true, 'stations panel did not open via keyboard activation');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
    assert.equal(await page.locator('#radio').evaluate((el) => el.classList.contains('open')), false, 'Escape did not close the stations panel');
    step('radio controls are keyboard-reachable and operable (Enter to activate, Escape to close)');

    const ariaOk = await page.evaluate(() => {
      const btn = document.getElementById('radioBtn');
      const exp = document.getElementById('radioExp');
      const vol = document.getElementById('radioVol');
      const group = document.getElementById('radio');
      return Boolean(btn.getAttribute('aria-label') && exp.getAttribute('aria-label') && vol.getAttribute('aria-label') && group.getAttribute('aria-label'));
    });
    assert.ok(ariaOk, 'radio controls are missing ARIA labels');
    step('radio controls carry ARIA labels');

    monitor.assertClean();
  } finally {
    await page.close();
  }
}

async function readRadioText(page) {
  return page.evaluate(() => ({
    lang: document.documentElement.lang,
    playerAria: document.getElementById('radio').getAttribute('aria-label'),
    panelAria: document.getElementById('radioPanel').getAttribute('aria-label'),
    heading: document.getElementById('radioStationsHeading').textContent,
    expAria: document.getElementById('radioExp').getAttribute('aria-label'),
    listAria: document.getElementById('stationList').getAttribute('aria-label'),
    volAria: document.getElementById('radioVol').getAttribute('aria-label'),
    btnAria: document.getElementById('radioBtn').getAttribute('aria-label'),
    sub: document.getElementById('radioSub').textContent,
    radioCount: document.querySelectorAll('#radio').length
  }));
}

async function checkRadioLocalization(context, baseUrl) {
  const page = await context.newPage();
  const monitor = monitorPage(page, baseUrl);
  try {
    await page.goto(`${baseUrl}/hub-desktop.html`, { waitUntil: 'load' });
    await page.waitForTimeout(100);

    let text = await readRadioText(page);
    assert.equal(text.lang, 'en');
    assert.equal(text.playerAria, RADIO_TRANSLATIONS.en.player, 'EN radio player aria-label incorrect');
    assert.equal(text.panelAria, RADIO_TRANSLATIONS.en.panel, 'EN radio panel aria-label incorrect');
    assert.equal(text.heading, RADIO_TRANSLATIONS.en.stations, 'EN stations heading incorrect');
    assert.equal(text.expAria, RADIO_TRANSLATIONS.en.stations, 'EN stations button aria-label incorrect');
    assert.equal(text.listAria, RADIO_TRANSLATIONS.en.stations, 'EN station list aria-label incorrect');
    assert.equal(text.volAria, RADIO_TRANSLATIONS.en.volume, 'EN volume aria-label incorrect');
    assert.equal(text.btnAria, RADIO_TRANSLATIONS.en.play, 'EN play aria-label incorrect');
    assert.equal(text.sub, RADIO_TRANSLATIONS.en.live, 'EN live status text incorrect');
    assert.equal(text.radioCount, 1, 'EN: exactly one widget expected');

    await page.locator('#langtoggle').click();
    await page.locator('button[data-lang="sv"]').click();
    await page.waitForTimeout(100);
    text = await readRadioText(page);
    assert.equal(text.lang, 'sv');
    assert.equal(text.playerAria, RADIO_TRANSLATIONS.sv.player, 'SV radio player aria-label incorrect');
    assert.equal(text.panelAria, RADIO_TRANSLATIONS.sv.panel, 'SV radio panel aria-label incorrect');
    assert.equal(text.heading, RADIO_TRANSLATIONS.sv.stations, 'SV stations heading incorrect');
    assert.equal(text.expAria, RADIO_TRANSLATIONS.sv.stations, 'SV stations button aria-label incorrect');
    assert.equal(text.listAria, RADIO_TRANSLATIONS.sv.stations, 'SV station list aria-label incorrect');
    assert.equal(text.volAria, RADIO_TRANSLATIONS.sv.volume, 'SV volume aria-label incorrect');
    assert.equal(text.btnAria, RADIO_TRANSLATIONS.sv.play, 'SV play aria-label incorrect');
    assert.equal(text.sub, RADIO_TRANSLATIONS.sv.live, 'SV live status text incorrect');
    assert.equal(text.radioCount, 1, 'SV: widget must not be duplicated when the language changes');

    await page.locator('#langtoggle').click();
    await page.locator('button[data-lang="mk"]').click();
    await page.waitForTimeout(100);
    text = await readRadioText(page);
    assert.equal(text.lang.toLowerCase().indexOf('mk'), 0, `expected an mk* lang attribute, got "${text.lang}"`);
    assert.equal(text.playerAria, RADIO_TRANSLATIONS.mk.player, 'MK radio player aria-label incorrect');
    assert.equal(text.panelAria, RADIO_TRANSLATIONS.mk.panel, 'MK radio panel aria-label incorrect');
    assert.equal(text.heading, RADIO_TRANSLATIONS.mk.stations, 'MK stations heading incorrect');
    assert.equal(text.expAria, RADIO_TRANSLATIONS.mk.stations, 'MK stations button aria-label incorrect');
    assert.equal(text.listAria, RADIO_TRANSLATIONS.mk.stations, 'MK station list aria-label incorrect');
    assert.equal(text.volAria, RADIO_TRANSLATIONS.mk.volume, 'MK volume aria-label incorrect');
    assert.equal(text.btnAria, RADIO_TRANSLATIONS.mk.play, 'MK play aria-label incorrect');
    assert.equal(text.sub, RADIO_TRANSLATIONS.mk.live, 'MK live status text incorrect');
    assert.equal(text.radioCount, 1, 'MK: widget must not be duplicated when the language changes');
    step('radio ARIA labels, stations heading, and live status translate correctly across EN/SV/MK, updating the already-injected widget in place without duplicating it');

    // Play/pause aria-label and the unavailable status text must also translate, and must
    // reflect the CURRENT state (not just reset to a default) — still in MK from above.
    await page.locator('#radioBtn').click();
    await page.waitForTimeout(600);
    const afterFailedPlay = await readRadioText(page);
    assert.equal(afterFailedPlay.btnAria, RADIO_TRANSLATIONS.mk.play, 'MK play aria-label after a failed play() is incorrect');
    assert.equal(afterFailedPlay.sub, RADIO_TRANSLATIONS.mk.unavailable, 'MK unavailable status text incorrect');
    assert.equal(afterFailedPlay.radioCount, 1, 'still exactly one widget after the unavailable state is shown');
    step('unavailable status text and the play/pause ARIA label translate correctly for the current widget state');

    monitor.assertClean();
  } finally {
    await page.close();
  }

  const noSwitcherPage = await context.newPage();
  const noSwitcherMonitor = monitorPage(noSwitcherPage, baseUrl);
  try {
    // documents-desktop.html has no language switcher at all — its <html lang> attribute never
    // changes away from the page's own default, so the widget must stay English there.
    await noSwitcherPage.goto(`${baseUrl}/documents-desktop.html`, { waitUntil: 'load' });
    await noSwitcherPage.waitForTimeout(100);
    const text = await readRadioText(noSwitcherPage);
    assert.equal(text.lang, 'en', 'a page with no language switcher must stay English');
    assert.equal(text.playerAria, RADIO_TRANSLATIONS.en.player, 'a page with no language switcher must show English radio text');
    noSwitcherMonitor.assertClean();
    step('radio stays in English on a page with no language switcher (documents-desktop.html)');
  } finally {
    await noSwitcherPage.close();
  }
}

async function setLanguage(page, lang) {
  if (lang === 'en') return; // hub-desktop.html already defaults to EN — nothing to do
  await page.locator('#langtoggle').click();
  await page.locator(`button[data-lang="${lang}"]`).click();
  await page.waitForTimeout(50);
}

async function readPlayPauseState(page) {
  return page.evaluate(() => ({
    playing: document.getElementById('radio').classList.contains('playing'),
    unavailable: document.getElementById('radio').classList.contains('unavailable'),
    btnAria: document.getElementById('radioBtn').getAttribute('aria-label'),
    sub: document.getElementById('radioSub').textContent,
    radioCount: document.querySelectorAll('#radio').length
  }));
}

async function stubSuccessfulPlay(page) {
  // A deterministic, network-independent stand-in for a genuinely successful audio.play() —
  // the real stream is irrelevant to what these tests verify (the localized label/status text),
  // only that play() resolves. Installed via addInitScript so it is in place before
  // workshop-radio.js runs, and scoped to this one page/context only — every other test in this
  // file keeps exercising the real (harness-network-blocked, always-rejecting) play().
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () {
      return Promise.resolve();
    };
  });
}

// Covers the gap an earlier review found: checkRadioLocalization above only ever checked the
// Play label (in EN/SV/MK) and the Unavailable status (in MK only); Pause was never checked in
// any language. Every assertion here is driven by clicking the real #radioBtn or dispatching a
// real 'error' event on the real #radioAudio element — i.e. the production event handlers — never
// by writing the label/status text directly.
async function checkPlayPauseUnavailableLocalization(context, baseUrl) {
  for (const lang of ['en', 'sv', 'mk']) {
    const t = RADIO_TRANSLATIONS[lang];

    // 1 & 2: a successful play() sets the localized Pause label; pausing restores Play.
    const playPage = await context.newPage();
    const playMonitor = monitorPage(playPage, baseUrl);
    await stubSuccessfulPlay(playPage);
    try {
      await playPage.goto(`${baseUrl}/hub-desktop.html`, { waitUntil: 'load' });
      await playPage.waitForTimeout(100);
      await setLanguage(playPage, lang);

      await playPage.locator('#radioBtn').click(); // real click handler -> real play(true)
      await playPage.waitForTimeout(150);
      let state = await readPlayPauseState(playPage);
      assert.equal(state.playing, true, `${lang}: a successful play() did not set the playing state`);
      assert.equal(state.btnAria, t.pause, `${lang}: Pause aria-label incorrect after a successful play()`);
      assert.equal(state.radioCount, 1, `${lang}: widget duplicated after play()`);

      await playPage.locator('#radioBtn').click(); // real click handler -> real pause()
      await playPage.waitForTimeout(100);
      state = await readPlayPauseState(playPage);
      assert.equal(state.playing, false, `${lang}: pause() did not clear the playing state`);
      assert.equal(state.btnAria, t.play, `${lang}: Play aria-label incorrect after pause()`);
      playMonitor.assertClean();
      step(`${lang}: a successful play() sets the localized Pause label, and pausing restores the localized Play label`);
    } finally {
      await playPage.close();
    }

    // 3a: a failed user-initiated play() (the harness blocks every non-local request, so the
    // real stream URL always fails here — no stub needed or used for this half of the test).
    const failPage = await context.newPage();
    const failMonitor = monitorPage(failPage, baseUrl);
    try {
      await failPage.goto(`${baseUrl}/hub-desktop.html`, { waitUntil: 'load' });
      await failPage.waitForTimeout(100);
      await setLanguage(failPage, lang);

      await failPage.locator('#radioBtn').click(); // real click handler -> real play(true), rejects
      await failPage.waitForTimeout(600);
      const state = await readPlayPauseState(failPage);
      assert.equal(state.playing, false, `${lang}: a failed user-initiated play() must not show "playing"`);
      assert.equal(state.btnAria, t.play, `${lang}: Play aria-label incorrect after a failed user-initiated play()`);
      assert.equal(state.sub, t.unavailable, `${lang}: Unavailable status text incorrect after a failed user-initiated play()`);
      failMonitor.assertClean();
      step(`${lang}: a failed user-initiated play() removes the playing state, restores the localized Play label, and shows the localized Unavailable status`);
    } finally {
      await failPage.close();
    }

    // 3b: a native audio 'error' event — a distinct failure path from a rejected play() promise
    // (e.g. a stream that starts, then drops mid-playback).
    const errPage = await context.newPage();
    const errMonitor = monitorPage(errPage, baseUrl);
    try {
      await errPage.goto(`${baseUrl}/hub-desktop.html`, { waitUntil: 'load' });
      await errPage.waitForTimeout(100);
      await setLanguage(errPage, lang);

      await errPage.locator('#radioAudio').evaluate((el) => el.dispatchEvent(new Event('error'))); // real error listener
      await errPage.waitForTimeout(100);
      const state = await readPlayPauseState(errPage);
      assert.equal(state.playing, false, `${lang}: an audio error must clear the playing state`);
      assert.equal(state.btnAria, t.play, `${lang}: Play aria-label incorrect after an audio error`);
      assert.equal(state.sub, t.unavailable, `${lang}: Unavailable status text incorrect after an audio error`);
      errMonitor.assertClean();
      step(`${lang}: a native audio error clears the playing state and shows the localized Unavailable status`);
    } finally {
      await errPage.close();
    }
  }
}

// Requirement 4: changing the language while the radio is already playing, or already
// unavailable, must retranslate its current state immediately, in place — never by recreating
// or duplicating the widget. A custom marker attribute (never touched by buildMarkup() or
// applyTranslations()) proves the exact same DOM node survives the language change, not just
// that some #radio element happens to exist afterward.
async function checkLanguageChangeWhilePlayingOrUnavailable(context, baseUrl) {
  const playingPage = await context.newPage();
  const playingMonitor = monitorPage(playingPage, baseUrl);
  await stubSuccessfulPlay(playingPage);
  try {
    await playingPage.goto(`${baseUrl}/hub-desktop.html`, { waitUntil: 'load' });
    await playingPage.waitForTimeout(100);
    await playingPage.locator('#radioBtn').click();
    await playingPage.waitForTimeout(150);
    assert.equal(await playingPage.locator('#radio').evaluate((el) => el.classList.contains('playing')), true, 'setup: radio should be playing before the language change');
    await playingPage.evaluate(() => { document.getElementById('radio').dataset.testMarker = 'still-here'; });

    await setLanguage(playingPage, 'sv');
    let state = await readPlayPauseState(playingPage);
    assert.equal(state.playing, true, 'playing state must survive a language change');
    assert.equal(state.btnAria, RADIO_TRANSLATIONS.sv.pause, 'Pause label must retranslate immediately while playing (SV)');
    assert.equal(state.radioCount, 1, 'widget must not be duplicated by a language change while playing');
    assert.equal(await playingPage.evaluate(() => document.getElementById('radio').dataset.testMarker), 'still-here', 'the same widget element must be reused (not recreated) on language change while playing');

    await setLanguage(playingPage, 'mk');
    state = await readPlayPauseState(playingPage);
    assert.equal(state.playing, true, 'playing state must survive a second language change');
    assert.equal(state.btnAria, RADIO_TRANSLATIONS.mk.pause, 'Pause label must retranslate immediately while playing (MK)');
    assert.equal(state.radioCount, 1, 'widget must not be duplicated by a second language change while playing');
    assert.equal(await playingPage.evaluate(() => document.getElementById('radio').dataset.testMarker), 'still-here', 'the same widget element must still be reused (not recreated) after a second language change while playing');

    playingMonitor.assertClean();
    step('a language change while the radio is playing retranslates the Pause label immediately, in place, without recreating or duplicating the widget');
  } finally {
    await playingPage.close();
  }

  const unavailablePage = await context.newPage();
  const unavailableMonitor = monitorPage(unavailablePage, baseUrl);
  try {
    await unavailablePage.goto(`${baseUrl}/hub-desktop.html`, { waitUntil: 'load' });
    await unavailablePage.waitForTimeout(100);
    await unavailablePage.locator('#radioBtn').click();
    await unavailablePage.waitForTimeout(600);
    assert.equal(await unavailablePage.locator('#radio').evaluate((el) => el.classList.contains('unavailable')), true, 'setup: radio should be unavailable before the language change');
    await unavailablePage.evaluate(() => { document.getElementById('radio').dataset.testMarker = 'still-here'; });

    await setLanguage(unavailablePage, 'sv');
    let state = await readPlayPauseState(unavailablePage);
    assert.equal(state.unavailable, true, 'unavailable state must survive a language change');
    assert.equal(state.sub, RADIO_TRANSLATIONS.sv.unavailable, 'Unavailable status text must retranslate immediately (SV)');
    assert.equal(state.radioCount, 1, 'widget must not be duplicated by a language change while unavailable');
    assert.equal(await unavailablePage.evaluate(() => document.getElementById('radio').dataset.testMarker), 'still-here', 'the same widget element must be reused (not recreated) on language change while unavailable');

    await setLanguage(unavailablePage, 'mk');
    state = await readPlayPauseState(unavailablePage);
    assert.equal(state.unavailable, true, 'unavailable state must survive a second language change');
    assert.equal(state.sub, RADIO_TRANSLATIONS.mk.unavailable, 'Unavailable status text must retranslate immediately (MK)');
    assert.equal(state.radioCount, 1, 'widget must not be duplicated by a second language change while unavailable');
    assert.equal(await unavailablePage.evaluate(() => document.getElementById('radio').dataset.testMarker), 'still-here', 'the same widget element must still be reused (not recreated) after a second language change while unavailable');

    unavailableMonitor.assertClean();
    step('a language change while the radio is unavailable retranslates the Unavailable status immediately, in place, without recreating or duplicating the widget');
  } finally {
    await unavailablePage.close();
  }
}

async function checkReducedMotion(harness) {
  const ctx = await harness.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const monitor = monitorPage(page, harness.baseUrl);
  try {
    await page.goto(`${harness.baseUrl}/hub-desktop.html`, { waitUntil: 'load' });
    await page.waitForTimeout(100);
    // Force the "playing" state directly rather than depending on a real (harness-blocked)
    // stream, so this isolates exactly what prefers-reduced-motion is supposed to affect: the
    // equalizer bar animation.
    await page.locator('#radio').evaluate((el) => el.classList.add('playing'));
    const animationName = await page.locator('.radio .eq span').first().evaluate((el) => getComputedStyle(el).animationName);
    assert.equal(animationName, 'none', 'equalizer animation must be disabled under prefers-reduced-motion');
    monitor.assertClean();
    step('radio equalizer animation is disabled under prefers-reduced-motion');
  } finally {
    await ctx.close();
  }

  const normalCtx = await harness.newContext();
  const normalPage = await normalCtx.newPage();
  try {
    await normalPage.goto(`${harness.baseUrl}/hub-desktop.html`, { waitUntil: 'load' });
    await normalPage.waitForTimeout(100);
    await normalPage.locator('#radio').evaluate((el) => el.classList.add('playing'));
    const animationName = await normalPage.locator('.radio .eq span').first().evaluate((el) => getComputedStyle(el).animationName);
    assert.notEqual(animationName, 'none', 'equalizer animation should run when motion is not reduced (positive control)');
    step('radio equalizer animation runs normally when motion is not reduced (positive control)');
  } finally {
    await normalCtx.close();
  }
}

async function checkHubViewport(harness) {
  for (const size of HUB_SIZES) {
    const ctx = await harness.newContext({ viewport: size });
    const page = await ctx.newPage();
    const monitor = monitorPage(page, harness.baseUrl);
    try {
      await page.goto(`${harness.baseUrl}/hub-desktop.html`, { waitUntil: 'load' });
      await page.waitForTimeout(150);
      const data = await page.evaluate(() => {
        const de = document.documentElement;
        const rectOf = (el) => {
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
        };
        const tiles = Array.from(document.querySelectorAll('.tile'));
        const teamtalk = document.querySelector('.teamtalk');
        return {
          scrollWidth: de.scrollWidth,
          clientWidth: de.clientWidth,
          scrollHeight: de.scrollHeight,
          clientHeight: de.clientHeight,
          tileCount: tiles.length,
          tileRects: tiles.map(rectOf),
          teamtalkRect: rectOf(teamtalk),
          radioRect: rectOf(document.getElementById('radio')),
          ttSendRect: rectOf(document.getElementById('ttSend'))
        };
      });

      const label = `${size.width}x${size.height}`;
      assert.equal(data.scrollWidth, data.clientWidth, `${label}: unexpected horizontal scroll`);
      assert.ok(data.scrollHeight <= data.clientHeight + 1, `${label}: unexpected vertical scroll (scrollHeight=${data.scrollHeight}, clientHeight=${data.clientHeight})`);
      assert.equal(data.tileCount, 14, `${label}: expected 14 module tiles`);
      for (const rect of data.tileRects) {
        assert.ok(rect.width > 0 && rect.height > 0, `${label}: a tile has zero size`);
        assert.ok(rect.top >= 0 && rect.bottom <= data.clientHeight + 1, `${label}: a tile is clipped by the viewport`);
        assert.ok(rect.height >= 60, `${label}: a tile is excessively small (${Math.round(rect.height)}px)`);
      }
      assert.ok(data.teamtalkRect.width > 0 && data.teamtalkRect.height > 0, `${label}: Team Talk panel is not visible`);
      assert.ok(data.teamtalkRect.bottom <= data.clientHeight + 1, `${label}: Team Talk panel is clipped by the viewport`);

      const overlapsSend =
        data.radioRect.left < data.ttSendRect.right &&
        data.radioRect.right > data.ttSendRect.left &&
        data.radioRect.top < data.ttSendRect.bottom &&
        data.radioRect.bottom > data.ttSendRect.top;
      assert.equal(overlapsSend, false, `${label}: radio widget overlaps the Team Talk send button`);

      // Radio stays fixed at the bottom-right corner region regardless of resolution.
      assert.ok(data.radioRect.right > data.clientWidth - 400, `${label}: radio widget is not anchored to the right side`);
      assert.ok(data.radioRect.bottom > data.clientHeight - 200, `${label}: radio widget is not anchored to the bottom`);

      monitor.assertClean();
      step(`Hub fits ${label} without scrolling — all 14 tiles and Team Talk visible, radio clear of controls`);
    } finally {
      await ctx.close();
    }
  }
}

async function main() {
  const harness = await startBrowserHarness();
  try {
    await checkOneRadioPerPage(harness.context, harness.baseUrl);
    await checkPersistence(harness.context, harness.baseUrl);
    await checkUnavailableState(harness.context, harness.baseUrl);
    await checkLanguagesAndAccessibility(harness.context, harness.baseUrl);
    await checkRadioLocalization(harness.context, harness.baseUrl);
    await checkPlayPauseUnavailableLocalization(harness.context, harness.baseUrl);
    await checkLanguageChangeWhilePlayingOrUnavailable(harness.context, harness.baseUrl);
    await checkReducedMotion(harness);
    await checkHubViewport(harness);
    console.log('\nFrontend UX Pass 1A browser E2E passed.');
  } finally {
    await harness.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
