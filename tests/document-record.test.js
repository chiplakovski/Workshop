'use strict';

// A document's two shapes, and the three places the translation can lose something.
//
// Most of this module is a rename. What is worth testing is the rest:
//
//   * The status. The screen has four words, the column has four values, and they are not the same four.
//     'Review Soon' and 'Expired' are answers to "what is the date today" and must never be sent back as a
//     status; 'Superseded' is a state the Supersede action owns and the form must never set. This is the
//     half that matters: a mapping that sent the computed word back would supersede a certificate because
//     somebody corrected its category.
//   * The link. Two free-text fields on screen against one pair of columns, where 'Unlinked' and 'General'
//     are the screen's words for nothing — and half a link is worse than none.
//   * The file, which has nowhere to be stored and so is never sent. Not dropped silently: the screens ask
//     `carriesAFile` so they can say it once, at the point somebody attaches one.
//   * The subset rule, fifth screen running. The register shows nine fields and saves through a form with
//     eight, so `_server` has to carry the whole row.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const MODULE = process.env.VARMAK_DOCUMENT_RECORD
  || path.join(__dirname, '..', 'document-record.js');
delete require.cache[require.resolve(MODULE)];
const DocumentRecord = require(MODULE);

// A document as the snapshot sends it: the computed word to print, and beside it what somebody chose.
const fromTheServer = () => ({
  id: '7', no: 'DOC-00007', name: 'Material Certificate MTC-240516', type: 'Certificate',
  category: 'Materials', revision: '1', status: 'Review Soon', setStatus: 'valid',
  expiry: '2026-10-05', module: 'Projects', record: 'P-2026-014',
  author: 'Anna Berg', notes: 'Heat H240516', uploadedBy: 'Anna Berg',
  uploaded: '2026-09-01T08:14:00Z', updated: '2026-09-20T11:02:00Z',
  fileName: null, fileSize: null, mimeType: null, activity: []
});

test('the word on screen and the word in the column are not the same word', () => {
  const held = fromTheServer();
  assert.equal(held.status, 'Review Soon', 'the register prints what the date makes of it');
  assert.equal(DocumentRecord.toServer(held, held).status, 'valid',
    'and sends back what somebody chose');
});

test('an expired certificate is not retired by correcting its category', () => {
  // The discriminating case, and the one a planted bug survived at first: 'Review Soon' happens to map to
  // the same stored value as what was chosen, so a mapping that sent the computed word back looked correct.
  // 'Expired' does not — the only nearby value the enum accepts is 'superseded', and sending that would
  // quietly retire a certificate because somebody fixed a typo in its category.
  const lapsed = Object.assign(fromTheServer(), { status: 'Expired', setStatus: 'valid' });
  const sent = DocumentRecord.toServer(Object.assign({}, lapsed, { category: 'Lifting' }), lapsed);
  assert.equal(sent.status, 'valid');
  assert.equal(sent.category, 'Lifting');
});

test('a form that does set a status has its answer sent', () => {
  const held = fromTheServer();
  for (const [chosen, stored] of Object.entries(
    { Draft: 'draft', Valid: 'valid', Approved: 'approved', Superseded: 'superseded' })) {
    assert.equal(DocumentRecord.toServer(Object.assign({}, held, { status: chosen }), held).status,
      stored, `${chosen} has to reach the column as ${stored}`);
  }
});

test('a record with no status anywhere is a draft, not an accident', () => {
  assert.equal(DocumentRecord.toServer({ name: 'Something' }).status, 'draft');
  assert.equal(DocumentRecord.toServer({ name: 'Something', status: 'Nonsense' }).status, 'draft');
});

test("'Unlinked' and 'General' are the screen's words for nothing", () => {
  for (const said of ['Unlinked', 'unlinked', 'General', '', '   ', '—', null, undefined]) {
    const sent = DocumentRecord.toServer({ name: 'x', module: 'Projects', record: said });
    assert.equal(sent.record, null, `${JSON.stringify(said)} is not the name of a record`);
    assert.equal(sent.module, null, 'and a module with nothing beside it is not half a link');
  }
});

test('a real reference keeps both halves', () => {
  const sent = DocumentRecord.toServer({ name: 'x', module: 'Purchasing', record: ' PO-2026-0145 ' });
  assert.equal(sent.module, 'Purchasing');
  assert.equal(sent.record, 'PO-2026-0145', 'trimmed, because a form field collects spaces');
});

test('the file is never sent, and the screens are told so rather than left to find out', () => {
  const sent = DocumentRecord.toServer({
    name: 'Scan.pdf', fileData: 'data:application/pdf;base64,AAAA', fileName: 'Scan.pdf',
    fileSize: 4096, mimeType: 'application/pdf'
  });
  for (const key of Object.keys(sent)) {
    assert.ok(!/^file|^mime|^size|storage/.test(key), `${key} has nowhere to be stored and must not be sent`);
  }
  assert.equal(DocumentRecord.carriesAFile({ fileName: 'Scan.pdf' }), true);
  assert.equal(DocumentRecord.carriesAFile({ fileData: 'data:...' }), true);
  assert.equal(DocumentRecord.carriesAFile({ fileSize: 12 }), true);
  assert.equal(DocumentRecord.carriesAFile({ name: 'Just a register entry' }), false);
});

test('an author nobody typed does not take the name off a drawing', () => {
  // No screen has an author field. A save sending an empty one would wipe the name every time somebody
  // corrected a category, so null means "leave whoever filed it alone" and the database keeps it.
  assert.equal(DocumentRecord.toServer({ name: 'x' }).author, null);
  assert.equal(DocumentRecord.toServer({ name: 'x', author: '   ' }).author, null);
  assert.equal(DocumentRecord.toServer({ name: 'x', author: 'Marcus Lind' }).author, 'Marcus Lind');
});

test('a document with no name is refused by the database, and the mapping does not invent one', () => {
  assert.equal(DocumentRecord.toServer({ name: '' }).title, null);
  assert.equal(DocumentRecord.toServer({}).title, null);
  assert.equal(DocumentRecord.toServer({ name: '  Duct drawing  ' }).title, 'Duct drawing');
});

test('a kind nobody chose is a Document, which is the one the form opens on', () => {
  assert.equal(DocumentRecord.toServer({ name: 'x' }).kind, 'Document');
  assert.equal(DocumentRecord.toServer({ name: 'x', type: 'Certificate' }).kind, 'Certificate');
});

test('the screen shows nine fields and the whole row survives the round trip', () => {
  const given = fromTheServer();
  const shaped = DocumentRecord.fromServer(given);
  assert.deepEqual(shaped._server, given, 'the whole row is kept, or a save writes back a subset of it');
  assert.equal(shaped.record, 'P-2026-014');
  assert.equal(shaped.setStatus, 'valid', 'what somebody chose comes through to be sent back');
});

test('a document the database says is filed against nothing reads as Unlinked on screen', () => {
  const loose = Object.assign(fromTheServer(), { module: null, record: null });
  const shaped = DocumentRecord.fromServer(loose);
  assert.equal(shaped.record, 'Unlinked', 'the screen has a word for it and this is that word');
  assert.equal(shaped.module, null);
  // And it round-trips back to nothing rather than to a record called Unlinked.
  assert.equal(DocumentRecord.toServer(shaped, loose).record, null);
});

test('an em dash is absence, in every field that can hold one', () => {
  const sent = DocumentRecord.toServer({
    name: 'x', category: '—', revision: '—', expiry: '—', notes: '—'
  });
  assert.equal(sent.category, null);
  assert.equal(sent.revision, null);
  assert.equal(sent.expires_on, null);
  assert.equal(sent.notes, null);
});

test('an id arrives as text and goes back as a number', () => {
  assert.equal(DocumentRecord.toServer({ id: '7', name: 'x' }).id, 7);
  assert.equal(DocumentRecord.toServer({ name: 'x' }).id, null, 'and a new document has no id at all');
});
