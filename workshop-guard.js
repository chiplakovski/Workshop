'use strict';

// Two worlds in one session is the hazard this file exists to remove.
//
// Every page reads the workshop through workshop-data.js. One of them — the phone hours screen —
// has been wired to the server: it signs in, adopts a snapshot, and writes through the API. The rest
// still read this browser's own storage, which is how they were built and how they are still tested.
//
// Which means a person who signs in on the tablet and then opens the hub sees the workshop twice:
// the real records on one screen and whatever happens to be in that browser on another. Neither
// screen says which it is. Somebody would make a decision on the wrong one within a day.
//
// So: a page that has not been wired refuses to show anything at all to a signed-in session, and
// says why. Not a banner over the top of stale data — a page that shows stale data with a warning is
// a page somebody reads past.
//
// A wired page declares itself by setting window.WORKSHOP_SERVER_READY = true before this runs. The
// declaration is deliberate rather than detected, because "detected" would mean guessing, and a
// wrong guess here shows real figures on a screen that cannot write them back.
(function (root) {
  const document = root.document;
  if (!document) return;

  function notice(message, detail) {
    const wrap = document.createElement('div');
    wrap.setAttribute('role', 'alert');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;'
      + 'justify-content:center;padding:24px;background:#0b0e13;color:#e8eaee;'
      + 'font:15px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;';
    const box = document.createElement('div');
    box.style.cssText = 'max-width:520px;border:1px solid #2a3140;padding:28px;background:#111620;';
    const title = document.createElement('div');
    title.style.cssText = 'font-size:12px;letter-spacing:0.12em;text-transform:uppercase;'
      + 'color:#8b95a7;margin-bottom:14px;';
    title.textContent = 'Varmak Workshop';
    const body = document.createElement('p');
    body.style.cssText = 'margin:0 0 10px;';
    body.textContent = message;
    const small = document.createElement('p');
    small.style.cssText = 'margin:0 0 20px;color:#8b95a7;font-size:13.5px;';
    small.textContent = detail;
    const back = document.createElement('a');
    back.href = 'hours-mobile.html';
    back.textContent = 'Back to the hours screen';
    back.style.cssText = 'display:inline-block;padding:12px 20px;border:1px solid #3a4354;'
      + 'color:#e8eaee;text-decoration:none;';
    box.appendChild(title);
    box.appendChild(body);
    box.appendChild(small);
    box.appendChild(back);
    wrap.appendChild(box);
    document.documentElement.appendChild(wrap);
  }

  function check() {
    if (!root.WorkshopApi || !root.WorkshopApi.signedIn()) return;   // browser-storage mode, as before
    if (root.WORKSHOP_SERVER_READY) return;                          // this page is wired
    // Signed in, and this page is not connected. Everything it would render comes from this browser
    // rather than from the workshop's records, so it renders nothing.
    notice(
      'This screen is not connected to the server yet.',
      'You are signed in, so the workshop\'s real records live in the database — but this screen '
      + 'still reads only this browser. Rather than show you figures that are not the workshop\'s, '
      + 'it shows you nothing.'
    );
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check);
  else check();

  root.WorkshopGuard = { check: check };
})(typeof window !== 'undefined' ? window : globalThis);
