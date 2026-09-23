'use strict';

// The browser's side of the backend.
//
// One file, and deliberately thin: it carries requests and holds the session token. It makes no
// decision about what anybody may see — that is the database's job, settled in auth.sql, and a
// client that filtered anything itself would be a second place for the rule to be wrong.
//
// The whole app can run without this. Every page still works against browser storage on its own,
// which is how the sixteen pages were built and how they are still tested. This is the path that
// exists once there is a server to talk to, and `available()` is how a page finds out which world it
// is in rather than assuming.
(function (root) {
  const BASE = (root.VARMAK_API_BASE || '/api').replace(/\/$/, '');
  // sessionStorage, not localStorage: the shop tablet is shared, and a token that outlives the tab
  // is the next person signed in as the last one. The server expires a tablet session at the end of
  // the shift anyway; this is the same rule at the other end.
  const TOKEN_KEY = 'varmak.session.token';

  function readToken() {
    try { return root.sessionStorage.getItem(TOKEN_KEY) || null; } catch (e) { return null; }
  }
  function writeToken(value) {
    try {
      if (value) root.sessionStorage.setItem(TOKEN_KEY, value);
      else root.sessionStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* a private window with storage blocked still signs in, just not across reloads */ }
  }

  async function request(method, path, body) {
    const token = readToken();
    const response = await fetch(BASE + path, {
      method,
      headers: Object.assign(
        { 'content-type': 'application/json' },
        token ? { authorization: 'Bearer ' + token } : {}
      ),
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let parsed = null;
    const text = await response.text();
    if (text) { try { parsed = JSON.parse(text); } catch (e) { parsed = { refused: text }; } }
    return { status: response.status, body: parsed || {} };
  }

  // Is there a server at all? Answered once and remembered, because every page asks on load and a
  // page that has already been told there is no backend should not ask again on every render.
  let known = null;
  async function available() {
    if (known !== null) return known;
    try {
      const response = await fetch(BASE + '/health', { method: 'GET' });
      known = response.ok;
    } catch (e) {
      known = false;
    }
    return known;
  }

  async function signIn(email, secret, door, device) {
    const result = await request('POST', '/auth/sign-in', { email: email, secret: secret, door: door, device: device });
    if (result.status === 200 && result.body.token) {
      writeToken(result.body.token);
      return { ok: true };
    }
    // The refusal is the database's wording, passed through. "that is not a login we recognise" is
    // deliberately the same answer for a wrong secret and an unknown address.
    return { ok: false, refused: result.body.refused || 'that is not a login we recognise' };
  }

  async function signOut() {
    if (readToken()) await request('POST', '/auth/sign-out');
    writeToken(null);
  }

  // The workshop as the pages read it. Two calls, because the money is granted separately: a welder
  // is refused the second one and their snapshot is complete without it. A 403 here is the system
  // working, not an error to report.
  async function snapshot() {
    const main = await request('GET', '/read/snapshot');
    if (main.status === 401) return { signedOut: true };
    if (main.status !== 200) return { failed: main.body.refused || 'could not read the workshop' };

    const data = main.body;
    const money = await request('GET', '/read/money');
    if (money.status === 200) {
      // Merged record by record, by the id the snapshot carries. The figures arrive as strings and
      // stay strings — they are exact decimals from a numeric column, and turning them into numbers
      // here is the floating-point mistake the schema and the wire both avoided.
      for (const collection of Object.keys(money.body)) {
        const byId = money.body[collection];
        (data[collection] || []).forEach(function (record) {
          Object.assign(record, byId[record.id] || {});
        });
      }
      data.seesMoney = true;
    } else {
      data.seesMoney = false;
    }
    return { data: data };
  }

  // One named list, rather than the whole workshop. snapshot() is what the sixteen pages use; this
  // is for a screen that wants a single thing — the people, say — and the name has to be one of the
  // few in the server's read list, because that list is the difference between an API and a remote
  // SQL console.
  async function read(name) {
    const result = await request('GET', '/read/' + name);
    if (result.status === 200) return { ok: true, data: result.body };
    if (result.status === 401) return { ok: false, signedOut: true, refused: 'sign in again' };
    return { ok: false, refused: result.body.refused || 'that is not yours to read' };
  }

  // A workflow. Returns what the database returned, or its refusal in its own words, because
  // "cannot issue 500 KG of S355-10: only 120 in stock" is what the person needs to read.
  async function call(name, args) {
    const result = await request('POST', '/rpc/' + name, args || {});
    if (result.status === 200) return { ok: true, result: result.body.result };
    if (result.status === 401) return { ok: false, signedOut: true, refused: 'sign in again' };
    return { ok: false, refused: result.body.refused || 'that did not go through' };
  }

  root.WorkshopApi = {
    available: available,
    signedIn: function () { return !!readToken(); },
    signIn: signIn,
    signOut: signOut,
    snapshot: snapshot,
    read: read,
    call: call,
    base: BASE
  };
})(typeof window !== 'undefined' ? window : globalThis);
