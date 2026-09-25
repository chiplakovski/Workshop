'use strict';

// Macedonian romanisation back to Cyrillic.
//
// The table is not guessed: every non-ASCII letter in the corpus was inventoried first, and every
// ambiguous digraph was listed with the words it appears in and judged one at a time. That mattered —
//
//   * `nj` is њ in all 47 words that carry it (planiranje → планирање, kampanja → кампања), and there is
//     no word where it is н+ј. `ñ` is a second spelling of the same letter, used 35 times (barañe →
//     барање), which a table built from one spelling would have left as a Latin letter.
//   * `dz` is д+з, NOT ѕ — `nadzornik` is надзорник. Mapping it to ѕ would have invented a letter.
//   * `dj` is д+ј (`Odjava` → Одјава). Only `gj` is ѓ (`lugje` → луѓе). These are one keystroke apart and
//     a table that treated them alike would be wrong in both directions.
//   * ќ has three spellings in this corpus: `kj`, `ḱ` and `ć`. ѓ has one.
const DIGRAPHS = [
  ['dž', 'џ'], ['Dž', 'Џ'], ['DŽ', 'Џ'],
  ['gj', 'ѓ'], ['Gj', 'Ѓ'], ['GJ', 'Ѓ'],
  ['kj', 'ќ'], ['Kj', 'Ќ'], ['KJ', 'Ќ'],
  ['lj', 'љ'], ['Lj', 'Љ'], ['LJ', 'Љ'],
  ['nj', 'њ'], ['Nj', 'Њ'], ['NJ', 'Њ']
];

const LETTERS = {
  a: 'а', b: 'б', v: 'в', g: 'г', d: 'д', e: 'е', z: 'з', i: 'и', j: 'ј', k: 'к', l: 'л',
  m: 'м', n: 'н', o: 'о', p: 'п', r: 'р', s: 'с', t: 'т', u: 'у', f: 'ф', h: 'х', c: 'ц',
  'č': 'ч', 'š': 'ш', 'ž': 'ж',
  // The second spellings, each verified against the word it appears in.
  'ñ': 'њ', 'ḱ': 'ќ', 'ć': 'ќ',
  // `è` is сѐ / ѝ — Macedonian marks those two vowels, in Cyrillic as well as in transliteration.
  'è': 'ѐ', 'í': 'и',
  A: 'А', B: 'Б', V: 'В', G: 'Г', D: 'Д', E: 'Е', Z: 'З', I: 'И', J: 'Ј', K: 'К', L: 'Л',
  M: 'М', N: 'Н', O: 'О', P: 'П', R: 'Р', S: 'С', T: 'Т', U: 'У', F: 'Ф', H: 'Х', C: 'Ц',
  'Č': 'Ч', 'Š': 'Ш', 'Ž': 'Ж', 'Ñ': 'Њ', 'Ḱ': 'Ќ', 'Ć': 'Ќ', 'È': 'Ѐ'
};

// Left in Latin, because they are not words. Each was found by listing every all-caps and code-shaped
// token in the corpus and asking whether it appears verbatim in the English for the same key: `NCR` does,
// `PRISTAP` does not — that one is a Macedonian word in capitals and transliterates like any other.
const KEEP = new Set([
  'SEK', 'PIN', 'PDF', 'CSV', 'JSON', 'XML', 'SpreadsheetML', 'Excel', 'KB', 'MB', 'QR', 'AB',
  'NCR', 'NDT', 'WPS', 'ITP', 'CAPA', 'RFQ', 'PO', 'JC', 'DN', 'EST', 'DOC', 'EXW', 'DAP', 'DDP',
  'ISO', 'EN', 'MIG', 'TIG', 'TOG', 'VAT', 'IBAN',
  'LinkedIn', 'Kanban', 'Varmak', 'allabolag', 'Blocket', 'Google', 'Supabase',
  'XXXX', 'XXXXXX', 'Rev', 'Incoterms', 'Hub',
  // Swedish proper nouns in the firm's own address, which do not transliterate — an address has to be
  // typeable into a delivery note by whoever reads it.
  'Lagmansgatan', 'Marieholm', 'Malmö', 'Helsingborg', 'Landskrona',
  // A technical term with no Macedonian form in use, left as the thing somebody would search for.
  'origin',
  // Units, which are written the same in every language on a shop floor.
  'kg', 'mm', 'cm', 'm', 'st', 'h', 'kr', 'ton', 'mm2', 'm2', 'm3'
]);

// Runs that are never transliterated wherever they appear: a placeholder, a format specifier, an email,
// a URL, a reference with digits in it, or anything inside angle brackets.
const PROTECT = [
  /\{[^}]*\}/g,
  /%[sdif]/g,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  /\bhttps?:\/\/\S+/g,
  // A file path, which in these strings always ends in a filename with an extension. Asking only for a
  // slash was the first version and it protected `Cena/lead` and `DDV/EMBS` — two real translations left in
  // Latin because a regex thought they were paths. The extension is what makes a path a path here.
  /\b[A-Za-z][\w-]*(?:\/[\w-]+)*\/[\w-]+\.[A-Za-z]{1,5}\b/g,
  /\b[\w-]+\.(?:sh|js|sql|json|html|css|md|csv|pdf|xlsx?|se|com|org|io|dev)\b/g,
  /\b[A-Za-z]{2,4}-\d[\dA-Za-z-]*/g,
  /<[^>]*>/g,
  // Text inside typographic quotes, which in these strings is always a label quoted from somewhere else —
  // “Save as PDF” is what the browser's own print dialog says, in English, whatever language the page is
  // in. Turning it into Cyrillic tells somebody to look for a button that does not exist.
  /\u201C[^\u201D]*\u201D/g,
  // `cross-origin` and the like: a hyphenated English technical term the translator kept.
  /\bcross-origin\b/g
];

// Hides every run that must survive untouched — a placeholder, a format specifier, an email, a URL, a
// path, an HTML tag, a reference with digits, and every keep-list word — behind a marker no pass will
// match. Returns the hidden text and the function that puts it back.
function protect(text) {
  const held = [];
  const stash = (s) => { held.push(s); return `\u0000${held.length - 1}\u0000`; };
  let out = text;
  for (const re of PROTECT) out = out.replace(re, (m) => stash(m));
  out = out.replace(/[A-Za-zÀ-ÿĀ-ɏḰḱ]+/g, (word) => (KEEP.has(word) ? stash(word) : word));
  return { out, restore: (s) => s.replace(/\u0000(\d+)\u0000/g, (_, i) => held[Number(i)]) };
}

// The letter table alone, on text whose protected runs are already hidden.
function letters(text) {
  let out = text;
  for (const [from, to] of DIGRAPHS) out = out.split(from).join(to);
  return out.replace(/[A-Za-zÀ-ÿĀ-ɏḰḱ]/g, (ch) => (LETTERS[ch] !== undefined ? LETTERS[ch] : ch));
}

function transliterate(text) {
  if (typeof text !== 'string' || !text) return text;
  const { out, restore } = protect(text);
  return restore(letters(out));
}

module.exports = { transliterate, KEEP, LETTERS, DIGRAPHS };

// ── The three things a letter table cannot do ─────────────────────────────────────────────────────
//
// 1. One page's Macedonian was typed WITHOUT diacritics. hub-desktop.html's "your data" panel writes
//    `sto` for што, `prelistuvac` for прелистувач, `nisto` for ништо, `ke` for ќе. A letter table turns
//    those into сто, прелистувац, нисто and ке — Cyrillic that is wrong rather than Latin that is
//    obviously untranslated, which is the worse failure of the two. Twenty-two strings across four pages,
//    found by looking for words that must carry a diacritic and do not.
const RESTORE_DIACRITICS = [
  // Longest first, so `prikazuvaat` is not half-matched by `prikazuva`.
  ['prikazuvaat', 'prikažuvaat'], ['Vrakanjeto', 'Vraḱanjeto'], ['vrakanjeto', 'vraḱanjeto'],
  ['Cistenjeto', 'Čistenjeto'], ['sodrzinata', 'sodržinata'], ['prelistuvacot', 'prelistuvačot'],
  ['prelistuvac', 'prelistuvač'], ['prikazuva', 'prikažuva'], ['zacuvana', 'začuvana'],
  ['Zacuvaj', 'Začuvaj'], ['zacuvaj', 'začuvaj'], ['zacuvana', 'začuvana'],
  ['mozese', 'možeše'], ['iscistat', 'isčistat'], ['procita', 'pročita'], ['veruvas', 'veruvaš'],
  ['Nisto', 'Ništo'], ['nisto', 'ništo'], ['smenis', 'smeniš'], ['casovi', 'časovi'],
  ['Cuvaj', 'Čuvaj'], ['cuvaj', 'čuvaj'], ['cuva', 'čuva'], ['brise', 'briše'],
  ['sodrzi', 'sodrži'], ['uste', 'ušte'], ['bese', 'beše'], ['sto', 'što'],
  // Two words where `è` stands in for `č` rather than for the accented vowel. Every other `è` in the
  // corpus — 32 of them — is the real thing, in `sè` / `Sè`, which is why the letter table maps it to ѐ;
  // these two had to be listed rather than the mapping changed, or `сѐ` would come out as `сча`.
  ['otkluèam', 'otklučam'], ['otkluèuvanjeto', 'otklučuvanjeto']
];

// `Se sto` is Сѐ што — everything — while a bare lowercase `se` is the reflexive се. One word, two
// letters apart, and only the first is accented. Done before the table so the accent is there to convert.
const PHRASES = [
  ['Se sto', 'Sè što'], ['Se uste', 'Sè ušte'], ['se sto', 'sè što'],
  // ќе, which the same panel writes bare. Only as a standalone word: `ke` inside another word is к+е.
  [/\bke\b/g, 'kje'], [/\bKe\b/g, 'Kje'],
  // A Serbianism rather than a missing diacritic: Macedonian for a device is `ured`, not `uredaj`.
  [/\buredaj\b/g, 'ured'], [/\bUredaj\b/g, 'Ured']
];

// 2. Words that are English, not Macedonian written in Latin. Transliterating `pipeline` gives пипелине,
//    which is not a word in any language. These are translated instead.
const TRANSLATE = [
  [/\bAktivna pipeline vrednost\b/g, 'Активна вредност на текот'],
  [/\bPonderirana pipeline\b/g, 'Пондериран тек'],
  [/\bPipeline vrednost\b/g, 'Вредност на текот'],
  [/\bpipeline izgleda zdravo\b/g, 'текот изгледа здраво'],
  [/\bPipeline\b/g, 'Тек'], [/\bpipeline\b/g, 'тек'],
  // A sales lead. The Macedonian marketing word is лид, not the letter-by-letter леад.
  [/\bLeads\b/g, 'Лидови'], [/\bleads\b/g, 'лидови'],
  [/\bLead\b/g, 'Лид'], [/\blead\b/g, 'лид'],
  // And the inflected forms the translator built on the English stem. `leadovi` came out as леадови on the
  // first run, which is the English word wearing a Macedonian ending in the wrong alphabet.
  [/\bleadov(\w*)/g, (m, tail) => 'лидов' + tail], [/\bLeadov(\w*)/g, (m, tail) => 'Лидов' + tail],
  // Loanwords with a settled Macedonian spelling that the letter table would get wrong.
  [/\bbackend\b/g, 'бекенд'], [/\bBackend\b/g, 'Бекенд'],
  [/\bpop-up\b/g, 'поп-ап'], [/\bPop-up\b/g, 'Поп-ап'],
  // An English marker word, not a loanword: there is no Macedonian noun `Плацехолдер`.
  [/\bPlaceholder\b/g, 'Место за текст'],
  // `vs` is versus, four times in two pages, and the letter table gives вс — two Cyrillic letters that
  // mean nothing. Macedonian abbreviates it `сп.` (спореди).
  [/\bvs\.?\s/g, 'сп. '], [/\bVs\.?\s/g, 'Сп. ']
];

function convert(text) {
  if (typeof text !== 'string' || !text) return text;
  // Protected FIRST, so the word-level passes below cannot reach inside a placeholder.
  const { out: hidden, restore } = protect(text);
  let out = hidden;
  for (const [from, to] of PHRASES) out = typeof from === 'string' ? out.split(from).join(to) : out.replace(from, to);
  for (const [from, to] of RESTORE_DIACRITICS) {
    out = out.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
  }
  for (const [from, to] of TRANSLATE) out = out.replace(from, to);
  return restore(letters(out));
}

// Values that are not prose and must never be converted, whatever they contain.
//
// `locale` is the one that would have done real damage: its value is `mk`, a BCP-47 tag handed to
// toLocaleDateString, and `мк` is not a language anybody's browser knows. Every date on every Macedonian
// screen would have fallen back or thrown, and the string is two letters long so nothing about it looks
// like a date format. Found by reading a spread of the output rather than by any check — which is the
// argument for reading the output.
// Only `locale` and its relatives, each checked against what the key actually holds on these screens.
// `currency` was in this list until it turned out to hold the word "Currency" — the label, not a code, with
// "Valuta" in Swedish — so protecting it left one Macedonian word untranslated on the customers screen.
const NOT_PROSE = new Set(['locale', 'lang', 'dir', 'tz', 'timezone']);

function convertValue(key, value) {
  if (typeof value !== 'string') return value;
  // The key, and only the key. A second test on the SHAPE of the value — anything looking like a BCP-47
  // tag — was written first and was already wrong twice over: `by_word` is `od`, Macedonian for "by", and
  // `da` is "yes". Both match a language tag and neither is one. A heuristic that has to be right about
  // every two-letter string in three languages is a heuristic that will be wrong about one of them.
  if (NOT_PROSE.has(key)) return value;
  return convert(value);
}

module.exports.convert = convert;
module.exports.convertValue = convertValue;
module.exports.NOT_PROSE = NOT_PROSE;
module.exports.RESTORE_DIACRITICS = RESTORE_DIACRITICS;
module.exports.TRANSLATE = TRANSLATE;
