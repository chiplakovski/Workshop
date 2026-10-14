// Swedish organisation numbers: what can be known about one without asking anybody.
//
// Ten digits, the last a check digit by the Luhn rule — the same rule as a personnummer, which is
// what a sole trader's organisation number is. A number that fails it was typed wrong, and saying so
// at the counter is cheaper than finding out on a returned invoice. Written with a hyphen after the
// sixth digit; given with a century in front (16, 18, 19, 20) it is still the same ten digits.
//
// The VAT number of a Swedish firm is SE, the ten digits, and 01. That is a rule, not a guess — but
// only a firm registered for VAT has one, so it is offered to fill an empty field, never forced.
//
// Loaded by the customers and suppliers pages before their own script, and by the tests through
// require(): the same file both ways, so the rule cannot be one thing on screen and another in a test.
(function (root) {
  'use strict';

  function digitsOf(value) {
    const d = String(value == null ? '' : value).replace(/[^0-9]/g, '');
    // A century prefix in front of a personnummer-shaped number.
    if (d.length === 12 && /^(16|18|19|20)/.test(d)) return d.slice(2);
    return d;
  }

  function luhnOk(ten) {
    let sum = 0;
    for (let i = 0; i < 10; i += 1) {
      let n = Number(ten[i]);
      if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
    }
    return sum % 10 === 0;
  }

  // { ok, digits, formatted, vat, reason } — reason is 'empty', 'length' or 'checksum' when not ok.
  function check(value) {
    const digits = digitsOf(value);
    if (!digits) return { ok: false, reason: 'empty', digits: '' };
    if (digits.length !== 10) return { ok: false, reason: 'length', digits };
    if (!luhnOk(digits)) return { ok: false, reason: 'checksum', digits };
    return {
      ok: true,
      digits,
      formatted: `${digits.slice(0, 6)}-${digits.slice(6)}`,
      vat: `SE${digits}01`
    };
  }

  // Where a person can look the firm up for themselves.
  function lookupUrl(value) {
    const digits = digitsOf(value);
    return digits ? `https://www.allabolag.se/what/${encodeURIComponent(digits)}` : null;
  }

  // The pages' one use of all this: check what is in the org number field, write it back in its proper
  // form, offer the VAT number to an empty VAT field, and say what was found next to the button —
  // with a link to look the firm up, since a valid number is not the same thing as the right firm.
  // `words` carries the page's own language: need, length, checksum, ok, vat ({vat}), open.
  function checkInto(orgInput, vatInput, statusEl, words) {
    const r = check(orgInput && orgInput.value);
    if (!statusEl) return r;
    statusEl.textContent = '';
    statusEl.className = 'orglookup-status ' + (r.ok ? 'ok' : 'err');
    if (!r.ok) {
      statusEl.textContent = r.reason === 'empty' ? words.need : r.reason === 'length' ? words.length : words.checksum;
      if (orgInput && orgInput.focus) orgInput.focus();
      return r;
    }
    orgInput.value = r.formatted;
    const said = [words.ok];
    if (vatInput && !String(vatInput.value || '').trim().replace(/^—$/, '')) {
      vatInput.value = r.vat;
      said.push(String(words.vat || '').replace('{vat}', r.vat));
    }
    statusEl.append(said.join(' ') + ' ');
    const a = statusEl.ownerDocument.createElement('a');
    a.href = lookupUrl(r.digits); a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = words.open;
    statusEl.append(a);
    return r;
  }

  // And, when this page is signed in to a server that holds Bolagsverket credentials, the registered
  // name and address for a number that passed the check. `fill` decides which fields take them — the
  // pages only ever fill what is still empty, so nothing somebody typed is overwritten. A server
  // without credentials says nothing at all: the check above is still the whole answer there.
  // `words`: found ({name}, {form}), inactive, notFound, failed ({why}).
  async function lookupInto(result, statusEl, words, fill) {
    const server = root.WorkshopApi;
    if (!result || !result.ok || !server || !server.lookupCompany || !server.signedIn()) return null;
    const answer = await server.lookupCompany(result.digits);
    if (answer.notSetUp) return null;
    const line = statusEl.ownerDocument.createElement('span');
    line.className = 'orglookup-found';
    if (!answer.ok) {
      line.textContent = ' ' + (answer.notFound ? words.notFound : String(words.failed || '').replace('{why}', answer.refused || ''));
      statusEl.append(line);
      return null;
    }
    const d = answer.data;
    fill(d);
    line.textContent = ' ' + String(words.found || '').replace('{name}', d.name).replace('{form}', d.legalForm || '')
      + (d.registered === false ? ' ' + words.inactive : '');
    statusEl.append(line);
    return d;
  }

  const api = { check, digitsOf, lookupUrl, checkInto, lookupInto };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OrgNumber = api;
})(typeof window !== 'undefined' ? window : globalThis);
