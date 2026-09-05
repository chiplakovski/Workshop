'use strict';
// Varmak Workshop — shared static desktop application-shell modal initializer
// (Frontend UX Pass 1B-1 independent-review correction).
//
// Runs only for elements explicitly marked ".ws-modal-dyn" (opt-in) — never touches any other
// modal implementation on any page, and does nothing at all on a page that has no such element.
// Loaded only on the pages that currently need it: customers-desktop.html and
// estimations-desktop.html. Suppliers' modal is a static shape (its card markup never changes,
// only an inner field container's content does) that needs no JavaScript at all — see
// workshop-desktop-shell.css's ".ws-modal-card>form" rules.
//
// Each ".ws-modal-dyn" element already carries ".ws-modal-card" (workshop-desktop-shell.css) and
// has its ENTIRE innerHTML replaced by the host page's own existing render functions as
// "<h2>...optional .fsub...fields...<div class="fbtns">" (7 call sites on Customers, 11 on
// Estimations — none of them read, modified, or called by this file). This initializer only
// groups the field content between the leading h2/.fsub and the trailing .fbtns into one
// ".ws-modal-body" div, so CSS can keep the header and action row pinned while only that body
// scrolls. It never recreates the modal, never touches field values/ids/labels/handlers/order,
// and calculates no layout height — only DOM grouping. It is a no-op whenever a ".ws-modal-body"
// already wraps the current content, so a MutationObserver firing again on the same content
// (or this file being loaded more than once) is always safe.
(function () {
  function wireOne(el) {
    if (el.__wsModalWired) return;
    el.__wsModalWired = true;

    function regroup() {
      if (el.querySelector(':scope > .ws-modal-body')) return;
      var btns = el.querySelector(':scope > .fbtns');
      var body = document.createElement('div');
      body.className = 'ws-modal-body';
      Array.prototype.slice.call(el.children).forEach(function (child) {
        if (child === btns || child.tagName === 'H2' || child.classList.contains('fsub')) return;
        body.appendChild(child);
      });
      if (!body.childNodes.length) return; // nothing to wrap yet (e.g. the card is still empty)
      if (btns) el.insertBefore(body, btns); else el.appendChild(body);
    }

    // One long-lived observer per marked element (there are only ever 1-2 such elements per
    // page), not re-created per modal open/close, so there is no repeated observer setup cost.
    new MutationObserver(regroup).observe(el, { childList: true });
    regroup();
  }

  function init() {
    document.querySelectorAll('.ws-modal-dyn').forEach(wireOne);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
