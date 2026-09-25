'use strict';

// A document, between the register on screen and the columns underneath.
//
// Five screens file documents — the register itself, and the document panels on Suppliers, Estimating,
// Customers and Store — and each of them held its own idea of what a document is. That is why this file
// exists rather than five copies of the same mapping: the last time the same shape was copied per page,
// three of the copies were still wrong after it had been fixed twice.
//
// Three things in here are not a rename:
//
// **The status.** The screen has four words and the column has four values, and they are not the same
// four. 'Review Soon' and 'Expired' are answers to "what is the date today", worked out from the expiry on
// every read; a column holding either would be a fact that was true the morning somebody chose it and then
// silently stopped being. 'Superseded' is the reverse — a state the database keeps and the form must never
// set, because choosing it from a dropdown would leave no record of what replaced it. So a record arriving
// from the server carries BOTH: `status`, the word to print, and `setStatus`, what somebody actually chose.
// A save sends the second.
//
// **The link.** One pair of columns, entity and entity_id, against the screen's two free-text fields
// called module and record. The database resolves the pair and refuses a reference nothing answers to, so
// this file's only job is knowing that 'Unlinked' and 'General' are the screen's words for nothing.
//
// **The file.** There is no object storage yet, so `fileData`, `fileName`, `mimeType` and `fileSize` are
// never sent. They are not dropped silently: the register holds the record, its expiry and its revision,
// and the screens say so at the point somebody attaches a file.
(function (root) {
  const trimmed = (v) => {
    const s = v === undefined || v === null ? '' : String(v).trim();
    return s === '' || s === '—' ? null : s;
  };

  // What the form may set. The two computed words are deliberately absent, and so is the state the
  // Supersede action owns — mapped here only so a record read back and saved again keeps it.
  const SETTABLE = {
    Draft: 'draft', Valid: 'valid', Approved: 'approved', Superseded: 'superseded',
    draft: 'draft', valid: 'valid', approved: 'approved', superseded: 'superseded'
  };
  const SHOWN = {
    draft: 'Draft', valid: 'Valid', approved: 'Approved', superseded: 'Superseded'
  };

  // 'Review Soon' and 'Expired' arrive as a status and must not go back as one. `held` is the record as
  // the server last sent it, which still carries what somebody chose.
  function statusToSend(payload, held) {
    const said = payload && payload.status;
    if (SETTABLE[said]) return SETTABLE[said];
    if (held && SETTABLE[held.setStatus]) return SETTABLE[held.setStatus];
    return 'draft';
  }

  // The screen's own two words for "not filed against anything". 'General' is what the folder form puts in
  // the record field when somebody leaves it blank, and it is not the name of a record.
  const NOTHING = new Set(['unlinked', 'general', '']);
  function linkOf(payload) {
    const record = trimmed(payload && payload.record);
    if (record === null || NOTHING.has(record.toLowerCase())) {
      return { module: null, record: null };
    }
    return { module: trimmed(payload && payload.module), record };
  }

  function toServer(payload, held) {
    const link = linkOf(payload);
    return {
      id: payload && payload.id != null ? Number(payload.id) : null,
      title: trimmed(payload && payload.name),
      kind: trimmed(payload && payload.type) || 'Document',
      module: link.module,
      record: link.record,
      category: trimmed(payload && payload.category),
      status: statusToSend(payload, held),
      expires_on: trimmed(payload && payload.expiry),
      revision: trimmed(payload && payload.revision),
      // Null leaves whoever filed it alone. No screen has an author field, and a save sending an empty one
      // would take the name off a drawing every time somebody corrected its category.
      author: trimmed(payload && payload.author),
      notes: trimmed(payload && payload.notes)
    };
  }

  // The screen's shape, from the snapshot's. `_server` is kept for the same reason every other record file
  // keeps it: a page that shows a subset of a record must not save a subset of it.
  function fromServer(given) {
    const shaped = Object.assign({}, given);
    shaped.name = given.name;
    shaped.status = given.status;
    shaped.setStatus = given.setStatus;
    shaped.record = given.record || 'Unlinked';
    shaped.module = given.module || null;
    shaped.updated = given.updated || given.uploaded || null;
    shaped.author = given.author || given.uploadedBy || null;
    shaped._server = Object.assign({}, given);
    return shaped;
  }

  // Whether a payload is carrying file bytes the server has nowhere to put. Asked by the screens so they
  // can say it once, at the point of attaching, rather than leaving somebody to find out from a download
  // button that does nothing.
  function carriesAFile(payload) {
    return !!(payload && (payload.fileData || payload.fileName || payload.fileSize));
  }

  const api = { toServer, fromServer, statusToSend, linkOf, carriesAFile, trimmed, SETTABLE, SHOWN };
  root.DocumentRecord = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
