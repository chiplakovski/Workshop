// Reads each page's translation dictionaries by evaluating the inline script that builds them, rather
// than by regex. A regex over 2591 string literals in sixteen files is a regex that will be wrong about
// some of them, and being wrong here means writing Cyrillic into a product code.
const fs = require('fs'), path = require('path'), vm = require('vm');

function dictsIn(file) {
  const src = fs.readFileSync(file, 'utf8');
  const scripts = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  for (const code of scripts) {
    if (!/\bT\s*[=.]/.test(code)) continue;
    // Everything up to and including the last assignment into T — enough to build the dictionaries and
    // nothing that touches the DOM.
    const cut = (() => {
      const marks = [...code.matchAll(/\bT\.(?:en|sv|mk)\s*=|const\s+T\s*=|\bT\s*=\s*\{/g)];
      if (!marks.length) return null;
      // Take from the first mark to the end of the object literal that follows the last one.
      const start = marks[0].index;
      let i = code.indexOf('{', marks[marks.length - 1].index);
      if (i < 0) return null;
      let depth = 0;
      for (; i < code.length; i++) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}') { depth--; if (!depth) break; }
      }
      return code.slice(start, i + 1);
    })();
    if (!cut) continue;
    const sandbox = { T: {} };
    try {
      vm.runInNewContext(`${/^const\s+T/.test(cut.trim()) ? '' : 'var T = T || {};'}\n${cut};\nOUT = T;`,
        sandbox, { timeout: 4000 });
    } catch (e) { continue; }
    const T = sandbox.OUT || sandbox.T;
    if (T && T.mk && Object.keys(T.mk).length) return T;
  }
  return null;
}

module.exports = { dictsIn };

if (require.main === module) {
  for (const f of fs.readdirSync('.').filter((x) => x.endsWith('.html')).sort()) {
    const T = dictsIn(f);
    if (!T) { console.log(`${f.padEnd(34)} no dictionary read`); continue; }
    const langs = Object.keys(T).filter((k) => T[k] && typeof T[k] === 'object');
    console.log(`${f.padEnd(34)} ${langs.join(',')}  mk keys ${Object.keys(T.mk).length}`);
  }
}
