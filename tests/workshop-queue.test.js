'use strict';

// The offline queue, tested through the failure it exists for: the tablet being killed with work
// unsent, and the answer to the first attempt being lost on the way back.
//
// A fake localStorage stands in for the real one, and "the tablet restarted" is the module being
// required again against the same storage — which is exactly what a reload is.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// The module under test, which is normally the file next door. mutation-check.js hands a damaged copy
// in through VARMAK_QUEUE — the same way the SQL suites are handed a damaged schema — so that the
// promises below can themselves be checked for being checked.
const MODULE = process.env.VARMAK_QUEUE || path.join(__dirname, '..', 'workshop-queue.js');

function aTablet(existing) {
  const box = { data: existing === undefined ? {} : existing };
  const storage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(box.data, k) ? box.data[k] : null),
    setItem: (k, v) => { box.data[k] = String(v); },
    removeItem: (k) => { delete box.data[k]; }
  };
  // A fresh module against this storage, which is what a page load is.
  const host = { localStorage: storage, crypto: { randomUUID: () => 'id-' + (++box.n || (box.n = 1)) } };
  delete require.cache[require.resolve(MODULE)];
  const before = global.window;
  global.window = host;
  Object.assign(host, { window: host });
  const queue = require(MODULE);
  global.window = before;
  return { queue, box, storage };
}

// A `send` that answers however the test tells it to, and records what it was handed.
function aNetwork(answers) {
  const seen = [];
  const send = async (call, args) => {
    seen.push({ call, args });
    const answer = answers.length ? answers.shift() : { ok: true };
    return answer;
  };
  return { send, seen };
}

test('the id is written down before anything is sent, and survives a restart', () => {
  const first = aTablet();
  first.queue.claim('7');
  const entry = first.queue.add('7', 'book_hours', { jobcard_id: 3, hours: 6.5 }, '6.5 h');
  assert.match(entry.id, /^id-/);
  assert.equal(first.queue.count(), 1);

  // The tablet is locked, killed, reloaded. Same storage, new module.
  const after = aTablet(first.box.data);
  const kept = after.queue.waiting();
  assert.equal(kept.length, 1, 'the entry is still there, which is the whole point of writing it down');
  assert.equal(kept[0].id, entry.id, 'and it is the SAME id — a fresh one would be a second entry');
  assert.equal(kept[0].args.hours, 6.5);
});

test('the same id goes with every attempt, so a lost answer books once', async () => {
  const tablet = aTablet();
  tablet.queue.claim('7');
  const entry = tablet.queue.add('7', 'book_hours', { jobcard_id: 3, hours: 6.5 });

  // The first attempt reaches the database and the answer is lost on the way back: the tablet sees a
  // connection failure and the work is already booked.
  const lost = aNetwork([{ offline: true }]);
  let result = await tablet.queue.flush('7', lost.send);
  assert.equal(result.offline, true);
  assert.equal(tablet.queue.count(), 1, 'nothing comes off the queue on a connection failure');
  assert.equal(lost.seen[0].args.event_id, entry.id);

  // Later, with a signal. The server sees the id it has already recorded and hands back the first
  // answer, which arrives here as a plain success — and the entry comes off.
  const back = aNetwork([{ ok: true, result: 'already booked' }]);
  result = await tablet.queue.flush('7', back.send);
  assert.equal(result.sent, 1);
  assert.equal(tablet.queue.count(), 0);
  assert.equal(back.seen[0].args.event_id, entry.id,
    'the second attempt carries the same id, which is what makes it the same press');
});

test('entries go in the order they were made, one at a time', async () => {
  const tablet = aTablet();
  tablet.queue.claim('7');
  tablet.queue.add('7', 'record_operation', { operation_id: 5, status: 'in-progress' });
  tablet.queue.add('7', 'book_hours', { jobcard_id: 3, hours: 2 });
  tablet.queue.add('7', 'record_operation', { operation_id: 5, status: 'completed' });

  const net = aNetwork([]);
  const result = await tablet.queue.flush('7', net.send);
  assert.equal(result.sent, 3);
  assert.deepEqual(net.seen.map((s) => s.call),
    ['record_operation', 'book_hours', 'record_operation'],
    '"finished" arriving before "started" is a jobcard that reads wrongly for ever');
  assert.deepEqual(net.seen.map((s) => s.args.status), ['in-progress', undefined, 'completed']);
});

test('a connection failure stops the flush and keeps the rest in order', async () => {
  const tablet = aTablet();
  tablet.queue.claim('7');
  tablet.queue.add('7', 'book_hours', { jobcard_id: 3, hours: 1 });
  tablet.queue.add('7', 'book_hours', { jobcard_id: 3, hours: 2 });
  tablet.queue.add('7', 'book_hours', { jobcard_id: 3, hours: 3 });

  const net = aNetwork([{ ok: true }, { offline: true }]);
  const result = await tablet.queue.flush('7', net.send);
  assert.equal(result.sent, 1);
  assert.equal(result.offline, true);
  assert.equal(net.seen.length, 2, 'it stops at the first failure rather than pressing on');
  const left = tablet.queue.waiting();
  assert.deepEqual(left.map((e) => e.args.hours), [2, 3], 'and the rest keep their order');
  assert.equal(left[0].tries, 1, 'the one that failed remembers it tried');
});

test('a refusal is not a failure: it is shown, with the database\'s words', async () => {
  const tablet = aTablet();
  tablet.queue.claim('7');
  const entry = tablet.queue.add('7', 'record_operation', { operation_id: 5, status: 'in-progress' },
    'Start Weld out');
  const net = aNetwork([{ ok: false, refused: 'operation Weld out cannot start: MIG 400 is out-of-service' }]);
  const result = await tablet.queue.flush('7', net.send);

  assert.equal(result.refused, 1);
  assert.equal(result.left, 0);
  assert.equal(tablet.queue.count(), 0, 'retrying a refusal cannot help, so it does not stay in the queue');
  const shown = tablet.queue.refused();
  assert.equal(shown.length, 1);
  assert.match(shown[0].refusedWith, /MIG 400 is out-of-service/,
    'the person at the machine needs the reason, not a code');
  assert.equal(shown[0].label, 'Start Weld out');
  assert.equal(shown[0].id, entry.id, 'and it keeps its id');
});

test('a refused entry can be sent again unchanged once the reason is cleared', async () => {
  const tablet = aTablet();
  tablet.queue.claim('7');
  const entry = tablet.queue.add('7', 'record_operation', { operation_id: 5, status: 'in-progress' });
  await tablet.queue.flush('7', aNetwork([{ ok: false, refused: 'out-of-service' }]).send);
  assert.equal(tablet.queue.refused().length, 1);

  // The machine is back in service. The same entry goes back on the queue with the SAME id, because a
  // refusal rolls the claim back — the server has not recorded this press as done.
  const again = tablet.queue.retry(entry.id);
  assert.equal(again.id, entry.id);
  assert.ok(!('refusedWith' in again));
  assert.equal(tablet.queue.count(), 1);
  assert.equal(tablet.queue.refused().length, 0);

  const net = aNetwork([{ ok: true }]);
  await tablet.queue.flush('7', net.send);
  assert.equal(net.seen[0].args.event_id, entry.id);
});

test('one person\'s unsent work is never flushed under another person\'s session', async () => {
  const tablet = aTablet();
  tablet.queue.claim('7');
  tablet.queue.add('7', 'book_hours', { jobcard_id: 3, hours: 6.5 });

  // The next welder signs in on the same tablet. The server takes the name for a booking from the
  // session, so flushing this now would book the first welder's hours in the second welder's name.
  const state = tablet.queue.claim('9');
  assert.equal(state.blocked, true, 'the screen has to be able to say the tablet is holding work');
  assert.equal(state.owner, '7', 'and whose it is');

  const net = aNetwork([]);
  const result = await tablet.queue.flush('9', net.send);
  assert.equal(result.notYours, true);
  assert.equal(net.seen.length, 0, 'nothing was sent');
  assert.equal(tablet.queue.count(), 1, 'and nothing was lost either');

  // Their own session flushes it when they come back.
  const theirs = await tablet.queue.flush('7', aNetwork([{ ok: true }]).send);
  assert.equal(theirs.sent, 1);
});

test('an empty queue changes hands freely', () => {
  const tablet = aTablet();
  tablet.queue.claim('7');
  const state = tablet.queue.claim('9');
  assert.ok(!state.blocked, 'nothing to protect, so the next person just gets on with it');
  assert.equal(state.owner, '9');
});

test('storage being blocked does not stop the work, it only stops it surviving', async () => {
  // A private window, or a browser with site data blocked. Everything must still send; what is lost is
  // only the ability to come back to it after a reload, which is worth knowing and not worth crashing
  // over.
  delete require.cache[require.resolve('../workshop-queue.js')];
  const before = global.window;
  const host = {};
  Object.defineProperty(host, 'localStorage', { get() { throw new Error('blocked'); } });
  global.window = host;
  const queue = require('../workshop-queue.js');
  global.window = before;

  assert.doesNotThrow(() => queue.claim('7'));
  const entry = queue.add('7', 'book_hours', { jobcard_id: 3, hours: 1 });
  assert.match(entry.id, /^q-|^id-/);
  assert.equal(queue.count(), 0, 'nothing was kept, and nothing pretended otherwise');
  const net = aNetwork([]);
  const result = await queue.flush('7', net.send);
  assert.equal(result.sent, 0);
});
