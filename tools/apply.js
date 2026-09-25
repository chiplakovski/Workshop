'use strict';
// Writes the converted Macedonian back into each page.
//
// Located by KEY rather than by matching the old text, because the same Latin string appears under several
// keys — `Status` is a value 13 times — and a replace-by-content pass would rewrite whichever came first
// and then fail to find the rest. Written back with the quote character the source used, and re-escaped,
// because a value carrying an apostrophe in a single-quoted literal is a syntax error if it is not.
const fs = require('fs');
const { dictsIn } = require('./dicts.js');
const { convertValue } = require('./translit.js');
const CYR = /[Ѐ-ӿ]/;

function mkBlock(src) {
  const m = /(?:\bmk\s*:\s*\{|T\.mk\s*=\s*\{)/.exec(src);
  if (!m) return null;
  let i = src.indexOf('{', m.index), depth = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) break; }
  }
  return { start: i, end: j + 1 };
}

// The literal that is the value for `key`, inside [from,to) of src.
function literalFor(src, from, to, key) {
  const re = new RegExp(`(^|[\\s{,])(?:${key}|'${key}'|"${key}")\\s*:\\s*`, 'g');
  re.lastIndex = from;
  let m;
  while ((m = re.exec(src)) && m.index < to) {
    const at = m.index + m[0].length;
    const quote = src[at];
    if (quote !== '"' && quote !== "'" && quote !== '`') continue;
    let k = at + 1;
    while (k < to) {
      if (src[k] === '\\') { k += 2; continue; }
      if (src[k] === quote) return { open: at, close: k, quote, raw: src.slice(at + 1, k) };
      k++;
    }
  }
  return null;
}

const encode = (value, quote) => value
  .replace(/\\/g, '\\\\')
  .replace(new RegExp(quote, 'g'), `\\${quote}`)
  .replace(/\n/g, '\\n')
  .replace(/\r/g, '\\r')
  .replace(/\t/g, '\\t');

let pages = 0, changed = 0, skipped = 0;
const problems = [];
for (const file of fs.readdirSync('.').filter((f) => f.endsWith('.html')).sort()) {
  const T = dictsIn(file);
  if (!T || !T.mk) continue;
  let src = fs.readFileSync(file, 'utf8');
  const block = mkBlock(src);
  if (!block) { problems.push(`${file}: mk block not found in source`); continue; }
  // Collected first, applied from the end backwards so earlier offsets stay valid.
  const edits = [];
  for (const [key, value] of Object.entries(T.mk)) {
    if (typeof value !== 'string' || !value.trim() || CYR.test(value)) { skipped++; continue; }
    const want = convertValue(key, value);
    if (want === value) { skipped++; continue; }
    const lit = literalFor(src, block.start, block.end, key);
    if (!lit) { problems.push(`${file} · ${key}: no literal found for this key`); continue; }
    edits.push({ ...lit, want });
  }
  if (!edits.length) continue;
  edits.sort((a, b) => b.open - a.open);
  for (const e of edits) {
    src = src.slice(0, e.open + 1) + encode(e.want, e.quote) + src.slice(e.close);
    changed++;
  }
  fs.writeFileSync(file, src);
  pages++;
  console.log(`${file.padEnd(34)} ${edits.length} values converted`);
}
console.log(`\n${changed} values across ${pages} pages; ${skipped} left alone`);
if (problems.length) {
  console.log('\nPROBLEMS:');
  problems.forEach((p) => console.log('  ' + p));
  process.exitCode = 1;
}
