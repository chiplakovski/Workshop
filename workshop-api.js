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
  // Who the token belongs to, kept beside it and for exactly as long. The offline queue is stored
  // under its owner's id and must never be flushed under somebody else's session, so a page that
  // comes back from a reload with no connection still has to be able to say whose work it is holding.
  // The same lifetime as the token is the whole point: when the token goes, so does this, and the
  // next person cannot inherit the answer to "who am I".
  const USER_KEY = 'varmak.session.user';

  function readToken() {
    try { return root.sessionStorage.getItem(TOKEN_KEY) || null; } catch (e) { return null; }
  }
  function rememberUser(id) {
    try {
      if (id) root.sessionStorage.setItem(USER_KEY, String(id));
      else root.sessionStorage.removeItem(USER_KEY);
    } catch (e) { /* as above: signing in still works, it just does not survive a reload */ }
  }
  function userId() {
    try { return root.sessionStorage.getItem(USER_KEY) || null; } catch (e) { return null; }
  }
  function writeToken(value) {
    try {
      if (value) root.sessionStorage.setItem(TOKEN_KEY, value);
      else { root.sessionStorage.removeItem(TOKEN_KEY); rememberUser(null); }
    } catch (e) { /* a private window with storage blocked still signs in, just not across reloads */ }
  }

  async function request(method, path, body) {
    const token = readToken();
    let response;
    try {
      response = await fetch(BASE + path, {
        method,
        headers: Object.assign(
          { 'content-type': 'application/json' },
          token ? { authorization: 'Bearer ' + token } : {}
        ),
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (e) {
      // No connection. An answer rather than an exception, because the shop tablet loses the signal
      // as a matter of routine and every caller here would otherwise have to wrap its own fetch —
      // and the one that did not would throw out of a click handler, leaving the person looking at a
      // button that did nothing and said nothing.
      return { status: 0, body: {}, unreachable: true };
    }
    let parsed = null;
    let text = '';
    try {
      text = await response.text();
    } catch (e) {
      // The headers arrived and the body did not. The request may well have been carried out, so
      // this is the unreachable case too: safe to send again, because every offline workflow takes
      // the id from the device and a replay of the same id is answered rather than repeated.
      return { status: 0, body: {}, unreachable: true };
    }
    if (text) { try { parsed = JSON.parse(text); } catch (e) { parsed = { refused: text }; } }
    return { status: response.status, body: parsed || {} };
  }

  // Not reachable, as opposed to refused.
  //
  // The difference decides what happens to a queued entry: unreachable is tried again, unchanged and
  // in order, while a refusal is shown to the person because trying again cannot help. So a 5xx
  // counts as unreachable — a dropped database connection, a restart mid-deploy, a proxy with
  // nothing behind it. None of those are the welder's to fix, all of them are safe to send again
  // (the id makes a replay harmless), and none of them have any wording worth showing.
  function unreachable(result) {
    return !!result.unreachable || result.status >= 500;
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
    // An unreachable server is not a wrong password, and saying so matters: a welder told "that is
    // not a login we recognise" will try their PIN again, then a different one, then stop trusting it.
    if (unreachable(result)) return { ok: false, offline: true, refused: 'no connection to the workshop' };
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
    // Offline is its own answer here too, so a page can tell "we cannot reach the server" from "the
    // server would not give it to you" — and, above all, so that losing the signal does not sign
    // anybody out or throw on load while there is unsent work in the queue.
    if (unreachable(main)) return { offline: true, failed: 'no connection to the workshop' };
    if (main.status === 401) return { signedOut: true };
    if (main.status !== 200) return { failed: main.body.refused || 'could not read the workshop' };

    const data = main.body;
    // The snapshot is where this page learns who it is signed in as, and the only place: the server
    // answers it from the session rather than being told, which is what makes it worth writing down.
    if (data.takenById) rememberUser(data.takenById);
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
    if (unreachable(result)) return { ok: false, offline: true, refused: 'no connection to the workshop' };
    if (result.status === 401) return { ok: false, signedOut: true, refused: 'sign in again' };
    return { ok: false, refused: result.body.refused || 'that is not yours to read' };
  }

  // A workflow. Returns what the database returned, or its refusal in its own words, because
  // "cannot issue 500 KG of S355-10: only 120 in stock" is what the person needs to read.
  async function call(name, args) {
    const result = await request('POST', '/rpc/' + name, args || {});
    if (result.status === 200) return { ok: true, result: result.body.result };
    if (unreachable(result)) return { ok: false, offline: true, refused: 'no connection to the workshop' };
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
    userId: userId,
    base: BASE
  };
})(typeof window !== 'undefined' ? window : globalThis);
