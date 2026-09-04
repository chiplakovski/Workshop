// Varmak Workshop — shared desktop radio widget (Frontend UX Pass 1A).
//
// Builds and wires the DAB/web-radio widget that previously existed only as inline markup/CSS/JS
// inside hub-desktop.html. Loaded (alongside workshop-radio.css) on every desktop application
// page except login.html and the mobile pages. Injects its own markup on DOMContentLoaded so no
// page needs to duplicate the widget's HTML — pairs with workshop-radio.css, which is hardcoded
// rather than depending on any host page's own CSS custom properties.
//
// Localization: every host page implements its own language switching differently (a private
// `T`/`current`/`LANG`-shaped table, a `state.language` field, a plain <select>, and so on — no
// two pages agree on a shape), so this widget deliberately does not read any page-private
// variable. It instead reads document.documentElement.lang directly (matching en/en-*, sv/sv-*,
// mk/mk-Latn/mk-* by prefix — every host page's own setLang()-equivalent already keeps that
// attribute current) and watches it with a MutationObserver, so the widget's own text updates
// immediately when a user switches language on the host page, with no reload and no coupling to
// how that page implements its switcher. A page with no language switcher never changes `lang`
// away from its default "en", so the widget correctly stays in English there.
'use strict';

(function () {
  var STATIONS = [
    { name: 'P4 Malmöhus', url: 'https://http-live.sr.se/p4malmo-mp3-192' },
    { name: 'Sveriges Radio P1', url: 'https://http-live.sr.se/p1-mp3-192' },
    { name: 'Sveriges Radio P2', url: 'https://http-live.sr.se/p2-mp3-192' },
    { name: 'Sveriges Radio P3', url: 'https://http-live.sr.se/p3-mp3-192' },
    { name: 'Mix Megapol', url: 'https://fm02-icecast.mediatop.se/mix_128' }
  ];
  var STORAGE_KEY = 'workshopRadioState';
  var PLAY_ICON = '<path d="M8 5v14l11-7z"/>';
  var PAUSE_ICON = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';

  // Station names are proper nouns (real broadcast station names) and are never translated.
  var TRANSLATIONS = {
    en: {
      player: 'Radio player',
      panel: 'Radio stations and volume',
      stations: 'Stations',
      stationsButton: 'Stations',
      stationList: 'Stations',
      volume: 'Volume',
      play: 'Play',
      pause: 'Pause',
      live: 'DAB · Live',
      unavailable: 'Unavailable'
    },
    sv: {
      player: 'Radiospelare',
      panel: 'Radiokanaler och volym',
      stations: 'Kanaler',
      stationsButton: 'Kanaler',
      stationList: 'Kanaler',
      volume: 'Volym',
      play: 'Spela',
      pause: 'Pausa',
      live: 'DAB · Sänds nu',
      unavailable: 'Otillgänglig'
    },
    mk: {
      player: 'Radio plejer',
      panel: 'Radio stanici i jačina na zvuk',
      stations: 'Stanici',
      stationsButton: 'Stanici',
      stationList: 'Stanici',
      volume: 'Jačina na zvuk',
      play: 'Pušti',
      pause: 'Pauza',
      live: 'DAB · Vo živo',
      unavailable: 'Nedostapno'
    }
  };

  function detectLang() {
    var raw = (document.documentElement.lang || '').toLowerCase();
    if (raw.indexOf('sv') === 0) return 'sv';
    if (raw.indexOf('mk') === 0) return 'mk';
    return 'en';
  }

  function loadState() {
    var fallback = { station: 0, volume: 0.7, playing: false };
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      var station = Number.isInteger(parsed.station) && parsed.station >= 0 && parsed.station < STATIONS.length ? parsed.station : 0;
      var volume = typeof parsed.volume === 'number' && isFinite(parsed.volume) && parsed.volume >= 0 && parsed.volume <= 1 ? parsed.volume : 0.7;
      var playing = parsed.playing === true;
      return { station: station, volume: volume, playing: playing };
    } catch (e) {
      return fallback;
    }
  }

  function saveState(state) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* localStorage unavailable (private mode, quota) — degrade to session-only, no crash. */
    }
  }

  function buildMarkup() {
    var wrap = document.createElement('div');
    wrap.className = 'radio';
    wrap.id = 'radio';
    wrap.setAttribute('role', 'group');
    wrap.innerHTML =
      '<div class="radio-panel" id="radioPanel" role="region">' +
        '<div class="ph" id="radioStationsHeading">Stations</div>' +
        '<div id="stationList" role="listbox"></div>' +
        '<div class="vol">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14"/></svg>' +
          '<input type="range" id="radioVol" min="0" max="1" step="0.05" value="0.7">' +
        '</div>' +
      '</div>' +
      '<div class="radio-bar">' +
        '<svg class="rico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="M4 10h16v10H4z"/><circle cx="16" cy="15" r="2.5"/><path d="M8 14h2M8 17h2M4 10l13-5"/></svg>' +
        '<div class="rmeta"><span class="rstation" id="radioName">P4 Malmöhus</span><span class="rsub" id="radioSub">DAB · Live</span></div>' +
        '<div class="eq" aria-hidden="true"><span></span><span></span><span></span><span></span></div>' +
        '<button type="button" class="rbtn" id="radioBtn"><svg id="radioIcon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M8 5v14l11-7z"/></svg></button>' +
        '<button type="button" class="rexp" id="radioExp" aria-haspopup="true" aria-expanded="false" aria-controls="radioPanel"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6"/></svg></button>' +
      '</div>' +
      '<audio id="radioAudio" preload="none"></audio>';
    return wrap;
  }

  function init() {
    if (document.getElementById('radio')) return; // never inject a second widget on one page

    var wrap = buildMarkup();
    document.body.appendChild(wrap);

    var rAudio = wrap.querySelector('#radioAudio');
    var rBtn = wrap.querySelector('#radioBtn');
    var rIcon = wrap.querySelector('#radioIcon');
    var rName = wrap.querySelector('#radioName');
    var rSub = wrap.querySelector('#radioSub');
    var rExp = wrap.querySelector('#radioExp');
    var rVol = wrap.querySelector('#radioVol');
    var rList = wrap.querySelector('#stationList');
    var rPanel = wrap.querySelector('#radioPanel');
    var rHeading = wrap.querySelector('#radioStationsHeading');

    var state = loadState();
    var curStation = state.station;

    // Translated text/labels are re-applied here and again whenever document.documentElement's
    // lang attribute changes (see the MutationObserver below) — always derived from the CURRENT
    // playing/unavailable state, never a fixed default, so a language change mid-playback (or
    // mid-error) shows the correctly translated text for whatever is actually happening.
    function applyTranslations() {
      var t = TRANSLATIONS[detectLang()];
      wrap.setAttribute('aria-label', t.player);
      rPanel.setAttribute('aria-label', t.panel);
      rHeading.textContent = t.stations;
      rExp.setAttribute('aria-label', t.stationsButton);
      rList.setAttribute('aria-label', t.stationList);
      rVol.setAttribute('aria-label', t.volume);
      rBtn.setAttribute('aria-label', wrap.classList.contains('playing') ? t.pause : t.play);
      rSub.textContent = wrap.classList.contains('unavailable') ? t.unavailable : t.live;
    }

    STATIONS.forEach(function (station, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'st';
      button.textContent = station.name;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', index === curStation ? 'true' : 'false');
      button.addEventListener('click', function () {
        selectStation(index);
      });
      rList.appendChild(button);
    });

    function markActive() {
      var items = rList.querySelectorAll('.st');
      for (var i = 0; i < items.length; i += 1) {
        var active = i === curStation;
        items[i].classList.toggle('active', active);
        items[i].setAttribute('aria-selected', active ? 'true' : 'false');
      }
    }

    function setUnavailable(on) {
      wrap.classList.toggle('unavailable', on);
      rSub.textContent = on ? TRANSLATIONS[detectLang()].unavailable : TRANSLATIONS[detectLang()].live;
    }

    function persist(playingIntent) {
      saveState({ station: curStation, volume: rAudio.volume, playing: playingIntent });
    }

    function play(userInitiated) {
      setUnavailable(false);
      rAudio.src = STATIONS[curStation].url;
      var result = rAudio.play();
      if (result && typeof result.then === 'function') {
        result.then(function () {
          wrap.classList.add('playing');
          rIcon.innerHTML = PAUSE_ICON;
          rBtn.setAttribute('aria-label', TRANSLATIONS[detectLang()].pause);
          persist(true);
        }).catch(function (error) {
          // Never show "playing" when audio.play() failed. A rejection on an unattended
          // resume-on-load attempt is normal browser autoplay policy, not a stream failure —
          // only surface the non-blocking unavailable indicator for a failure that happened in
          // direct response to an explicit user action.
          wrap.classList.remove('playing');
          rIcon.innerHTML = PLAY_ICON;
          rBtn.setAttribute('aria-label', TRANSLATIONS[detectLang()].play);
          persist(false);
          if (userInitiated && error && error.name !== 'AbortError') {
            setUnavailable(true);
          }
        });
      } else {
        wrap.classList.add('playing');
        rIcon.innerHTML = PAUSE_ICON;
        rBtn.setAttribute('aria-label', TRANSLATIONS[detectLang()].pause);
        persist(true);
      }
    }

    function pause() {
      rAudio.pause();
      wrap.classList.remove('playing');
      rIcon.innerHTML = PLAY_ICON;
      rBtn.setAttribute('aria-label', TRANSLATIONS[detectLang()].play);
      persist(false);
    }

    function selectStation(index) {
      curStation = index;
      rName.textContent = STATIONS[index].name;
      markActive();
      if (wrap.classList.contains('playing')) {
        play(true);
      } else {
        persist(false);
      }
    }

    rAudio.addEventListener('error', function () {
      wrap.classList.remove('playing');
      rIcon.innerHTML = PLAY_ICON;
      rBtn.setAttribute('aria-label', TRANSLATIONS[detectLang()].play);
      setUnavailable(true);
    });

    rBtn.addEventListener('click', function () {
      if (wrap.classList.contains('playing')) pause(); else play(true);
    });
    rExp.addEventListener('click', function (event) {
      event.stopPropagation();
      var open = wrap.classList.toggle('open');
      rExp.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function (event) {
      if (!wrap.contains(event.target)) {
        wrap.classList.remove('open');
        rExp.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && wrap.classList.contains('open')) {
        wrap.classList.remove('open');
        rExp.setAttribute('aria-expanded', 'false');
        rExp.focus();
      }
    });
    rVol.addEventListener('input', function () {
      var value = parseFloat(rVol.value);
      if (isNaN(value)) return;
      rAudio.volume = value;
      persist(wrap.classList.contains('playing'));
    });

    rName.textContent = STATIONS[curStation].name;
    rVol.value = String(state.volume);
    rAudio.volume = state.volume;
    markActive();
    applyTranslations();

    // Host pages update document.documentElement.lang as part of their own (mutually
    // incompatible) language-switching code — observing it directly, rather than requiring any
    // page to call into this widget, is what lets the already-injected widget re-translate
    // immediately without a reload and without this file depending on any page-private state.
    new MutationObserver(applyTranslations).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

    // Resume playback across navigation only if it was actually playing before — never as an
    // unattended autoplay attempt on a page the user has not interacted with yet. play() itself
    // still governs whether "playing" is ever shown: a browser-blocked resume degrades silently
    // to the paused state above, exactly like any other play() rejection.
    if (state.playing) play(false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
