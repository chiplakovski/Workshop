'use strict';

// A Swedish firm's registered name and address, asked of Bolagsverket by organisation number.
//
// Bolagsverket's "värdefulla datamängder" API is free and needs no agreement, but it is not open: a
// firm registers (kundanmälan) and is sent a client id and a client secret, and every request carries
// a token bought with those. That secret is why this lives on the server — a page holding it would
// hand it to anybody who opened the page — and why nothing here works until both are set:
//
//   BOLAGSVERKET_CLIENT_ID, BOLAGSVERKET_CLIENT_SECRET   — from Bolagsverket, never in git
//   BOLAGSVERKET_TOKEN_URL, BOLAGSVERKET_API_URL         — only if the addresses Bolagsverket gives
//                                                           differ from the defaults below
//
// Written against Bolagsverket's published description and checked against a stand-in that answers
// in that shape, not against the live service, which this code could not reach while it was being
// written. So the reading of the answer is deliberately forgiving: it looks for the fields by their
// Swedish names wherever they sit, rather than at one exact path that a small difference in the real
// response would break. What it cannot find it leaves empty; it never fills a field with a guess.

const DEFAULTS = {
  tokenUrl: 'https://portal.api.bolagsverket.se/oauth2/token',
  apiUrl: 'https://gw.api.bolagsverket.se/vardefulla-datamangder/v1',
  scope: 'vardefulla-datamangder:read'
};

function settings() {
  return {
    clientId: process.env.BOLAGSVERKET_CLIENT_ID || '',
    clientSecret: process.env.BOLAGSVERKET_CLIENT_SECRET || '',
    tokenUrl: process.env.BOLAGSVERKET_TOKEN_URL || DEFAULTS.tokenUrl,
    apiUrl: (process.env.BOLAGSVERKET_API_URL || DEFAULTS.apiUrl).replace(/\/+$/, ''),
    scope: process.env.BOLAGSVERKET_SCOPE || DEFAULTS.scope
  };
}

function configured() {
  const s = settings();
  return !!(s.clientId && s.clientSecret);
}

// One token at a time, kept until a minute before it runs out. Keyed by the client id so that changing
// the credentials (or a test switching stand-ins) never reuses a token bought with the old ones.
let cached = { key: null, token: null, until: 0 };

async function token(s, fresh) {
  const key = `${s.tokenUrl}|${s.clientId}`;
  if (!fresh && cached.key === key && cached.token && Date.now() < cached.until) return cached.token;
  const response = await fetch(s.tokenUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: 'Basic ' + Buffer.from(`${s.clientId}:${s.clientSecret}`).toString('base64')
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: s.scope }).toString(),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) {
    const error = new Error(`Bolagsverket did not accept this server's credentials (${response.status})`);
    error.lookup = 'credentials';
    throw error;
  }
  const body = await response.json();
  if (!body.access_token) {
    const error = new Error('Bolagsverket answered the token request without a token');
    error.lookup = 'credentials';
    throw error;
  }
  const seconds = Number(body.expires_in) || 300;
  cached = { key, token: body.access_token, until: Date.now() + Math.max(0, seconds - 60) * 1000 };
  return cached.token;
}

// The first value anywhere in `value` whose key matches `pattern`, searched breadth-first so the
// shallowest match wins — the organisation's own name before a name buried in a history list.
function find(value, pattern) {
  const queue = [value];
  while (queue.length) {
    const here = queue.shift();
    if (!here || typeof here !== 'object') continue;
    for (const [key, inner] of Object.entries(here)) {
      if (pattern.test(key) && inner !== null && inner !== undefined && inner !== '') return inner;
    }
    for (const inner of Object.values(here)) if (inner && typeof inner === 'object') queue.push(inner);
  }
  return undefined;
}

function text(value, inner) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) return value.length ? text(value[0], inner) : '';
  if (inner) {
    const found = find(value, inner);
    if (found !== undefined) return text(found);
  }
  return '';
}

// From Bolagsverket's answer to the four things a supplier or customer card needs, and whether the
// firm is still registered. Exported so the reading can be tested on its own.
function read(answer, digits) {
  const list = find(answer, /^organisationer$/i);
  const org = Array.isArray(list) ? list[0] : (list || answer);
  if (!org || typeof org !== 'object') return null;
  const name = text(find(org, /^organisationsnamn$/i), /^namn$/i) || text(find(org, /namn$/i), /^namn$/i);
  const post = find(org, /^postadress(organisation)?$/i) || {};
  const street = text(find(post, /^(utdelningsadress|adress|gatuadress)$/i));
  const coAddress = text(find(post, /^c(o|\/o)adress$/i));
  const postcode = text(find(post, /^postnummer$/i));
  const city = text(find(post, /^(postort|ort)$/i));
  const form = find(org, /^organisationsform$/i);
  const legalForm = text(form, /^(klartext|beskrivning|text)$/i) || text(form, /^kod$/i);
  const active = find(org, /^verksamorganisation$/i);
  const deregistered = find(org, /^avregistrer(ad|ing)(sdatum|organisation)?$/i);
  let registered = null;
  if (active !== undefined) registered = /^(ja|true)$/i.test(text(active, /^kod$/i) || String(active));
  if (deregistered !== undefined && deregistered !== false) registered = false;
  if (!name) return null;
  return {
    orgNo: `${digits.slice(0, 6)}-${digits.slice(6)}`,
    name,
    address: [coAddress, street].filter(Boolean).join(', '),
    postcode,
    city,
    legalForm,
    registered,
    source: 'Bolagsverket'
  };
}

// The question itself. `digits` is ten digits that have already passed the check-digit test.
async function lookup(digits) {
  const s = settings();
  const ask = async (fresh) => fetch(`${s.apiUrl}/organisationer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json',
      authorization: `Bearer ${await token(s, fresh)}` },
    body: JSON.stringify({ identitetsbeteckning: digits }),
    signal: AbortSignal.timeout(8000)
  });
  let response = await ask(false);
  // A token the register has stopped honouring is bought again, once.
  if (response.status === 401) response = await ask(true);
  if (response.status === 404) return null;
  if (!response.ok) {
    const error = new Error(`Bolagsverket could not answer just now (${response.status})`);
    error.lookup = 'unavailable';
    throw error;
  }
  return read(await response.json(), digits);
}

function forgetToken() { cached = { key: null, token: null, until: 0 }; }

module.exports = { configured, lookup, read, forgetToken, DEFAULTS };
