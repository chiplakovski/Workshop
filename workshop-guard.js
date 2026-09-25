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

  // The screens that read and write the database. A page not on this list shows the notice below to
  // a signed-in session, and the list is what the notice offers as somewhere to go instead.
  //
  // This list had two entries in it while twelve pages were wired, which is the shape of mistake this
  // project keeps finding: a list somebody has to remember to add to, next to a fact somebody else
  // declares. A signed-in administrator reading the notice was offered the welders' phone screen and
  // Access, and nothing else — so the check in tests/integrity.js now asserts this list against the
  // pages that actually declare themselves wired, and a page added to one and not the other fails.
  const WIRED = [
    ['hub-desktop.html', 'The workshop'],
    ['hub-mobile.html', 'The workshop, on a phone'],
    ['hours-mobile.html', 'The hours screen'],
    ['hours-desktop.html', 'Hours'],
    ['planning-desktop.html', 'Planning'],
    ['jobcard-desktop.html', 'Work'],
    ['customers-desktop.html', 'Customers'],
    ['estimations-desktop.html', 'Estimating'],
    ['store-desktop.html', 'Store'],
    ['equipment-machines-desktop.html', 'Machines'],
    ['quality-desktop.html', 'Quality'],
    ['suppliers-desktop.html', 'Suppliers'],
    ['marketing-desktop.html', 'Sales'],
    ['reports-desktop.html', 'Reports'],
    ['admin.html', 'Access']
  ];

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
    // Every wired screen, not one of them. The first version linked to the hours screen only, which
    // was the whole list at the time — and the moment a second page was wired, a signed-in
    // administrator reading this notice was sent to the welders' phone screen with no way to reach
    // the one page that would have helped them.
    const links = document.createElement('div');
    links.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;';
    for (const [href, label] of WIRED) {
      if (document.location.pathname.endsWith(href)) continue;
      const link = document.createElement('a');
      link.href = href;
      link.textContent = label;
      link.style.cssText = 'display:inline-block;padding:12px 20px;border:1px solid #3a4354;'
        + 'color:#e8eaee;text-decoration:none;';
      links.appendChild(link);
    }
    box.appendChild(title);
    box.appendChild(body);
    box.appendChild(small);
    box.appendChild(links);
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
