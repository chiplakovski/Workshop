'use strict';

// Work booked with no connection, kept until it arrives.
//
// BACKEND.md §3 scoped offline to three actions — booking hours, starting or finishing a step, and
// taking material off the shelf — because they happen at the machine and cannot wait for a signal.
// The database side has existed since step 4: each of those workflows takes an id the device
// generates, and a replay of the same id gets the first answer back instead of doing the work twice.
//
// This is the other end, and the whole of it is one sentence: **the id is generated once, written down
// before anything is sent, and never generated again.** Everything else here follows from that.
//
//   * A tablet cannot know whether its first attempt arrived before the connection died. So it flushes
//     blindly and the server makes asking twice harmless — but only if the id is the same id. An id
//     made fresh on each retry is a second entry, which is the failure this file exists to prevent.
//   * Written to localStorage rather than held in memory, because the failure that loses work is not a
//     slow network — it is the tablet being locked, the browser being killed, or the page being
//     reloaded while an entry is still unsent.
//
// Two decisions that are not obvious:
//
// **The queue belongs to a person, not to a device.** The server takes the name for a booking from the
// session, never from the request — so a queue left behind by one welder and flushed under the next
// one's session would book the first welder's work in the second welder's name. On a shared tablet
// that is a real Tuesday. So each queue is stored under its owner's id and only ever flushed by them.
//
// **A refusal is not a failure.** If the database says no — the machine is out of service, the job is
// on hold, there is not enough steel — retrying cannot help, and retrying forever would hide it. The
// entry moves to a list the person is shown, with the database's own words, and they decide. The server
// rolls a refusal back including the claim on the id, so the same entry can be sent again unchanged
// once the reason is cleared. A network failure is the opposite: the entry stays, in order, and the
// next flush tries again.
(function (root) {
  const KEY = 'varmak.queue';

  function store() {
    try {
      return root.localStorage || null;
    } catch (e) {
      // A private window with storage blocked. Everything still works; nothing survives a reload, and
      // that is worth knowing rather than crashing over.
      return null;
    }
  }

  function read() {
    const box = store();
    if (!box) return { owner: null, waiting: [], refused: [] };
    try {
      const raw = box.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== 'object') return { owner: null, waiting: [], refused: [] };
      return {
        owner: parsed.owner === undefined ? null : parsed.owner,
        waiting: Array.isArray(parsed.waiting) ? parsed.waiting : [],
        refused: Array.isArray(parsed.refused) ? parsed.refused : []
      };
    } catch (e) {
      return { owner: null, waiting: [], refused: [] };
    }
  }

  function write(state) {
    const box = store();
    if (!box) return state;
    try {
      box.setItem(KEY, JSON.stringify(state));
    } catch (e) { /* full or blocked; the entry is still in memory for this flush */ }
    return state;
  }

  // Unique, and only ever made here. crypto.randomUUID where there is one; otherwise time plus
  // randomness, which is enough for a queue that is flushed within minutes on one device.
  function newId() {
    try {
      if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    } catch (e) { /* fall through */ }
    return 'q-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // Whose queue this is. Set on sign-in; a queue with a different owner is left alone rather than sent.
  function claim(owner) {
    const state = read();
    if (String(state.owner || '') === String(owner || '')) return state;
    // A different person. Their predecessor's unsent work stays exactly where it is — under their id —
    // so it can be flushed when they come back, rather than being booked in this person's name or
    // thrown away. Which means one device holds one person's queue at a time, and switching users with
    // work unsent is something the screen has to say out loud.
    if (state.waiting.length || state.refused.length) {
      return { owner: state.owner, waiting: state.waiting, refused: state.refused, blocked: true };
    }
    return write({ owner: owner === undefined ? null : owner, waiting: [], refused: [] });
  }

  function owned(owner) {
    const state = read();
    return String(state.owner || '') === String(owner || '');
  }

  // Put something in the queue. Returns the entry, with the id it will keep for as long as it lives.
  function add(owner, call, args, label) {
    const state = read();
    const entry = {
      id: newId(),
      call: call,
      args: args,
      label: label || call,
      at: new Date().toISOString(),
      tries: 0
    };
    const next = {
      owner: String(owner || ''),
      waiting: state.waiting.concat([entry]),
      refused: state.refused
    };
    write(next);
    return entry;
  }

  function waiting() { return read().waiting; }
  function refused() { return read().refused; }
  function count() { const s = read(); return s.waiting.length; }

  // Send what is waiting, oldest first, one at a time.
  //
  // One at a time and in order on purpose: two entries against the same step, sent together, would
  // arrive in whichever order the network chose, and "started" landing after "finished" is a jobcard
  // that reads wrongly for ever. `send` is handed the call name and the arguments and answers
  // { ok } / { refused } / { offline } — which is WorkshopApi.call in the browser and a stub in a test.
  async function flush(owner, send) {
    const state = read();
    if (String(state.owner || '') !== String(owner || '')) {
      return { sent: 0, refused: 0, left: state.waiting.length, notYours: true };
    }
    let sent = 0;
    let turnedAway = 0;
    while (true) {
      const now = read();
      if (!now.waiting.length) break;
      const entry = now.waiting[0];
      const answer = await send(entry.call, Object.assign({}, entry.args, { event_id: entry.id }));
      if (answer && answer.ok) {
        // Off the queue only once the database has it. The id went with it, so if this answer is lost
        // on the way back the next flush sends the same id and gets the first answer returned.
        write({ owner: now.owner, waiting: now.waiting.slice(1), refused: now.refused });
        sent += 1;
        continue;
      }
      if (answer && answer.offline) {
        // The connection, not the content. Everything stays where it is, in order.
        const tried = Object.assign({}, entry, { tries: (entry.tries || 0) + 1 });
        write({ owner: now.owner, waiting: [tried].concat(now.waiting.slice(1)), refused: now.refused });
        return { sent: sent, refused: turnedAway, left: now.waiting.length, offline: true };
      }
      // The database said no. Retrying cannot help and retrying forever would hide it, so it moves to
      // the list the person is shown — with the refusal in the database's own words, and the same id,
      // because a refusal rolls back the claim and the entry can be sent again unchanged.
      write({
        owner: now.owner,
        waiting: now.waiting.slice(1),
        refused: now.refused.concat([Object.assign({}, entry, {
          refusedWith: (answer && answer.refused) || 'that did not go through',
          refusedAt: new Date().toISOString()
        })])
      });
      turnedAway += 1;
    }
    return { sent: sent, refused: turnedAway, left: 0 };
  }

  // Put a refused entry back, unchanged, once the reason is cleared — same id, so the database treats
  // it as the same press rather than a second one.
  function retry(id) {
    const state = read();
    const entry = state.refused.find((e) => e.id === id);
    if (!entry) return null;
    const clean = Object.assign({}, entry);
    delete clean.refusedWith;
    delete clean.refusedAt;
    write({
      owner: state.owner,
      waiting: state.waiting.concat([clean]),
      refused: state.refused.filter((e) => e.id !== id)
    });
    return clean;
  }

  function discard(id) {
    const state = read();
    write({
      owner: state.owner,
      waiting: state.waiting.filter((e) => e.id !== id),
      refused: state.refused.filter((e) => e.id !== id)
    });
  }

  function clear() { write({ owner: null, waiting: [], refused: [] }); }

  const api = { KEY, claim, owned, add, waiting, refused, count, flush, retry, discard, clear, newId };
  root.WorkshopQueue = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
