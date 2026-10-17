// The workshop radio, on every page instead of only the hub.
//
// It lived in the hub's markup, so opening any other page stopped the music and the player was nowhere
// to be found. Now it is one module mounted in two places:
//
//   * In the copy on one PC (Varmak-Workshop.html) it sits in the shell's top bar, OUTSIDE the frame the
//     pages are swapped in, so it simply keeps playing from page to page. The pages there mount nothing.
//   * Opened as separate pages (online, or a page opened on its own), every desktop page mounts it in the
//     corner and remembers station, volume and whether it was playing, so the next page carries on. A
//     browser may refuse to start sound on a page nobody has clicked yet; then the player says so and
//     one press of ▶ continues.
//
// Each station has more than one address: broadcasters move their streams, and a station that has moved
// used to leave the player showing "playing" over silence. It tries the next address, and says plainly
// when none answers.
(function (root) {
  'use strict';

  const STATIONS = [
    { name: 'P4 Malmöhus', urls: ['https://sverigesradio.se/topsy/direkt/207-hi-mp3', 'https://http-live.sr.se/p4malmo-mp3-192'] },
    { name: 'Sveriges Radio P1', urls: ['https://sverigesradio.se/topsy/direkt/132-hi-mp3', 'https://http-live.sr.se/p1-mp3-192'] },
    { name: 'Sveriges Radio P2', urls: ['https://sverigesradio.se/topsy/direkt/163-hi-mp3', 'https://http-live.sr.se/p2-mp3-192'] },
    { name: 'Sveriges Radio P3', urls: ['https://sverigesradio.se/topsy/direkt/164-hi-mp3', 'https://http-live.sr.se/p3-mp3-192'] },
    { name: 'Mix Megapol', urls: ['https://live-bauerse-fm.sharp-stream.com/mixmegapol_instream_se_mp3', 'https://fm02-icecast.mediatop.se/mix_128'] }
  ];
  const W = {
    en: { stations: 'Stations', ready: 'DAB · Live', connecting: 'Connecting…', live: 'Live', failed: 'Unreachable',
      failedLong: 'The station could not be reached. Check the internet connection, or choose another station.',
      resume: 'Press ▶ to continue', play: 'Play', pause: 'Pause', choose: 'Stations', radio: 'Radio' },
    sv: { stations: 'Kanaler', ready: 'DAB · Live', connecting: 'Ansluter…', live: 'Live', failed: 'Nås inte',
      failedLong: 'Kanalen kunde inte nås. Kontrollera internetanslutningen eller välj en annan kanal.',
      resume: 'Tryck ▶ för att fortsätta', play: 'Spela', pause: 'Pausa', choose: 'Kanaler', radio: 'Radio' },
    mk: { stations: 'Станици', ready: 'ДАБ · Во живо', connecting: 'Се поврзува…', live: 'Во живо', failed: 'Недостапна',
      failedLong: 'Станицата не може да се достигне. Проверете ја интернет врската или изберете друга станица.',
      resume: 'Притиснете ▶ за да продолжи', play: 'Пушти', pause: 'Паузирај', choose: 'Станици', radio: 'Радио' }
  };
  const KEY = 'varmak.radio';
  const PLAY = '<path d="M8 5v14l11-7z"/>', PAUSE = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';
  // A page says its language on <html lang>; the PC copy's shell has no language of its own, so there the
  // radio follows the choice the pages remember (workshop-ui.js keeps it under varmak.lang).
  const lang = () => {
    let l = root.__radioInShell ? '' : (root.document.documentElement.lang || '').slice(0, 2);
    if (!W[l]) { try { l = root.localStorage.getItem('varmak.lang') || ''; } catch (e) { l = ''; } }
    return W[l] ? l : 'en';
  };
  const words = () => W[lang()];
  const read = () => { try { return JSON.parse(root.localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } };
  const keep = (patch) => { try { root.localStorage.setItem(KEY, JSON.stringify(Object.assign(read(), patch))); } catch (e) { /* nothing to remember with */ } };

  const CSS = `
.wsradio{font-family:var(--font-body,system-ui,sans-serif);z-index:35}
.wsradio.float{position:fixed;right:18px;bottom:16px}
.wsradio .radio-bar{display:flex;align-items:center;gap:10px;padding:8px 10px 8px 12px;background:rgba(7,26,51,.88);border:1px solid rgba(142,163,192,.2);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);color:#e8f0fb}
.wsradio.inbar .radio-bar{padding:0;background:transparent;border:0;gap:8px;backdrop-filter:none;-webkit-backdrop-filter:none}
.wsradio .rico{width:16px;height:16px;color:#4a90ff;flex:none}
.wsradio .rmeta{display:flex;flex-direction:column;gap:1px;min-width:0}
.wsradio .rstation{font-size:12px;font-weight:600;max-width:130px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wsradio .rsub{font-size:9.5px;opacity:.7;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
.wsradio .eq{display:flex;align-items:flex-end;gap:2px;height:16px;width:20px}
.wsradio .eq span{flex:1;background:#4a90ff;height:4px;opacity:.5}
.wsradio.playing .eq span{animation:wsradio-eq .9s ease-in-out infinite}
.wsradio .eq span:nth-child(2){animation-delay:.15s}.wsradio .eq span:nth-child(3){animation-delay:.3s}.wsradio .eq span:nth-child(4){animation-delay:.45s}
@keyframes wsradio-eq{0%,100%{height:4px;opacity:.45}50%{height:15px;opacity:1}}
@media (prefers-reduced-motion:reduce){.wsradio.playing .eq span{animation:none;height:9px}}
.wsradio .rbtn{width:32px;height:32px;flex:none;display:flex;align-items:center;justify-content:center;cursor:pointer;background:linear-gradient(180deg,#2c6bd6,#013179);border:none;color:#fff}
.wsradio.inbar .rbtn{width:26px;height:26px;border-radius:4px}
.wsradio .rexp{width:26px;height:30px;flex:none;display:flex;align-items:center;justify-content:center;cursor:pointer;background:transparent;border:none;color:inherit;opacity:.75}
.wsradio .rexp svg{transition:transform .18s}.wsradio.open .rexp svg{transform:rotate(180deg)}
.wsradio .radio-panel{position:absolute;right:0;bottom:calc(100% + 6px);width:230px;background:rgba(7,26,51,.97);border:1px solid rgba(142,163,192,.22);color:#e8f0fb;box-shadow:0 14px 34px rgba(0,0,0,.45);opacity:0;visibility:hidden;transition:.16s;z-index:2}
.wsradio.inbar{position:relative}.wsradio.inbar .radio-panel{bottom:auto;top:calc(100% + 8px)}
.wsradio.open .radio-panel{opacity:1;visibility:visible}
.wsradio .ph{font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;opacity:.7;padding:11px 14px 7px}
.wsradio .st{display:block;width:100%;text-align:left;background:transparent;border:none;color:inherit;font:inherit;font-size:13px;padding:9px 14px;cursor:pointer;opacity:.85}
.wsradio .st:hover{background:rgba(74,144,255,.14);opacity:1}
.wsradio .st.active{opacity:1;box-shadow:inset 2px 0 0 #4a90ff}
.wsradio .vol{display:flex;align-items:center;gap:9px;padding:12px 14px;border-top:1px solid rgba(142,163,192,.16)}
.wsradio .vol svg{width:15px;height:15px;opacity:.7;flex:none}.wsradio .vol input{flex:1;accent-color:#4a90ff}
@media print{.wsradio{display:none !important}}`;

  // host: an element to mount into (the shell's bar), or nothing for the floating corner player.
  function mount(host) {
    const doc = root.document;
    if (doc.getElementById('radio')) return null;
    if (!doc.getElementById('wsradio-style')) {
      const st = doc.createElement('style'); st.id = 'wsradio-style'; st.textContent = CSS; doc.head.appendChild(st);
    }
    const kept = read();
    const box = doc.createElement('div');
    box.className = 'wsradio radio ' + (host ? 'inbar' : 'float');
    box.id = 'radio';
    box.innerHTML = `<div class="radio-panel" id="radioPanel"><div class="ph" data-radio="stations"></div><div id="stationList"></div>
      <div class="vol"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14"/></svg>
      <input type="range" id="radioVol" min="0" max="1" step="0.05" aria-label="Volume"></div></div>
      <div class="radio-bar"><svg class="rico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 10h16v10H4z"/><circle cx="16" cy="15" r="2.5"/><path d="M8 14h2M8 17h2M4 10l13-5"/></svg>
      <div class="rmeta"><span class="rstation" id="radioName"></span><span class="rsub" id="radioState"></span></div>
      <div class="eq"><span></span><span></span><span></span><span></span></div>
      <button class="rbtn" id="radioBtn" type="button"><svg id="radioIcon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">${PLAY}</svg></button>
      <button class="rexp" id="radioExp" type="button"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></button></div>
      <audio id="radioAudio" preload="none"></audio>`;
    (host || doc.body).appendChild(box);
    const $ = (id) => box.querySelector('#' + id);
    const audio = $('radioAudio'), btn = $('radioBtn'), icon = $('radioIcon'), name = $('radioName'), state = $('radioState');
    const vol = $('radioVol'), list = $('stationList');
    let station = Number.isInteger(kept.station) && STATIONS[kept.station] ? kept.station : 0;
    let url = 0, status = 'ready', attempt = 0;
    vol.value = kept.volume != null ? kept.volume : 0.7;
    audio.volume = Number(vol.value);
    STATIONS.forEach((s, i) => {
      const b = doc.createElement('button'); b.type = 'button'; b.className = 'st'; b.textContent = s.name;
      b.onclick = () => { station = i; keep({ station: i }); paint(); play(); };
      list.appendChild(b);
    });
    function paint() {
      const t = words();
      name.textContent = STATIONS[station].name;
      box.querySelector('[data-radio="stations"]').textContent = t.stations;
      state.textContent = status === 'connecting' ? t.connecting : status === 'live' ? t.live : status === 'failed' ? t.failed
        : status === 'blocked' ? t.resume : t.ready;
      state.title = status === 'failed' ? t.failedLong : '';
      state.style.color = status === 'failed' ? '#ff7a7a' : '';
      const on = status === 'connecting' || status === 'live';
      box.classList.toggle('playing', status === 'live');
      icon.innerHTML = on ? PAUSE : PLAY;
      btn.setAttribute('aria-label', on ? t.pause : t.play);
      $('radioExp').setAttribute('aria-label', t.choose);
      list.querySelectorAll('.st').forEach((b, i) => b.classList.toggle('active', i === station));
    }
    function tryUrl() {
      const mine = ++attempt;
      const urls = STATIONS[station].urls;
      if (url >= urls.length) { status = 'failed'; keep({ playing: false }); audio.removeAttribute('src'); audio.load(); paint(); return; }
      audio.src = urls[url];
      const p = audio.play();
      // A browser that will not start sound until somebody clicks says NotAllowedError: that is not the
      // station's fault, so it does not move on to the next address — it waits for the click.
      if (p) p.catch((e) => {
        if (mine !== attempt || status !== 'connecting') return;
        if (e && e.name === 'NotAllowedError') { status = 'blocked'; paint(); return; }
        advance(mine);
      });
    }
    function advance(mine) { if (mine !== attempt || status !== 'connecting') return; url += 1; tryUrl(); }
    audio.addEventListener('playing', () => { if (status === 'connecting') { status = 'live'; paint(); } });
    audio.addEventListener('error', () => advance(attempt));
    function play() { status = 'connecting'; url = 0; keep({ playing: true }); paint(); tryUrl(); }
    function pause() { attempt += 1; status = 'ready'; keep({ playing: false }); audio.pause(); audio.removeAttribute('src'); audio.load(); paint(); }
    btn.addEventListener('click', () => { (status === 'connecting' || status === 'live') ? pause() : play(); });
    $('radioExp').addEventListener('click', (e) => { e.stopPropagation(); box.classList.toggle('open'); });
    doc.addEventListener('click', (e) => { if (!box.contains(e.target)) box.classList.remove('open'); });
    // A click into the page frame under the PC copy's bar never reaches this document; the window losing
    // focus is how that click shows up here.
    root.addEventListener('blur', () => box.classList.remove('open'));
    vol.addEventListener('input', () => { audio.volume = Number(vol.value); keep({ volume: Number(vol.value) }); });
    root.addEventListener('storage', (e) => { if (e.key === 'varmak.lang') paint(); });
    if (root.MutationObserver) new root.MutationObserver(paint).observe(doc.documentElement, { attributes: true, attributeFilter: ['lang'] });
    paint();
    // Carry on from the last page. Only the floating player needs this: the one in the shell's bar
    // never stopped.
    if (!host && kept.playing) play();
    const api = { paint, play, pause, get status() { return status; } };
    root.paintRadio = paint;
    return api;
  }

  root.WorkshopRadio = { mount, STATIONS, words };
})(window);
