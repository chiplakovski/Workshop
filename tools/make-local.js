// Builds the one-file copy of the workshop that runs on a single PC with no server: every page and
// script inlined into one HTML file that is opened by double-clicking it. Records are kept in that
// browser's storage on that PC, exactly as the pages do when no server answers.
//
//   node tools/make-local.js <site-directory> <output-file>
//
// Called by tools/make-local.sh, which hands it a clean export of the committed tree.
'use strict';
const fs = require('fs');
const path = require('path');

const [ROOT, OUT] = process.argv.slice(2);
if (!ROOT || !OUT) { console.error('usage: node tools/make-local.js <site-directory> <output-file>'); process.exit(2); }

// Every page at the top of the site, sign-in first. Taken from the directory rather than listed, so a
// page added later cannot be quietly missing from the local copy.
const PAGE_FILES = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();
if (!PAGE_FILES.includes('login.html')) throw new Error('no login.html in ' + ROOT);

const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

// The one navigation built by concatenation that the general rewrite below deliberately skips.
const LITERAL_REPLACEMENTS = [
  [
    "location.href='estimations-desktop.html?estimation='+encodeURIComponent(estimation.no);",
    "__nav('estimations-desktop.html?estimation='+encodeURIComponent(estimation.no));",
  ],
];

const SCRIPT_TAG_RE = /<script src="([a-zA-Z0-9_-]+\.js)"><\/script>/g;
const LINK_TAG_RE = /<link rel="stylesheet" href="([a-zA-Z0-9_-]+\.css)">/g;
const LOCATION_HREF_RE = /(window\.)?location\.href\s*=\s*(['"])([^'"]*)\2/g;

function transformPage(name, raw) {
  let html = raw;
  // Shared scripts and the shared stylesheet go inside the page: there are no other files.
  html = html.replace(SCRIPT_TAG_RE, (m, js) => `<script>\n/* ${js} */\n${read(js)}\n</script>`);
  html = html.replace(LINK_TAG_RE, (m, css) => `<style>\n/* ${css} */\n${read(css)}\n</style>`);
  // Each page runs in a frame and cannot read its own file name, so it is told it.
  html = html.replace(/<\/head>/i, `<script>window.__module=${JSON.stringify(name.replace('.html', ''))};</script></head>`);
  for (const [from, to] of LITERAL_REPLACEMENTS) html = html.split(from).join(to);
  // location.href = 'page.html' becomes a request to the outer file to show that page. A literal
  // followed by + is a concatenation (mailto: links) and is left as it is.
  html = html.replace(LOCATION_HREF_RE, (match, win, quote, val, offset, str) =>
    str[offset + match.length] === '+' ? match : `__nav(${quote}${val}${quote})`);
  html = html.split('href="hub-desktop.html"').join('href="#" onclick="__nav(\'hub-desktop.html\');return false;"');
  // A page shown from memory has no address bar query; it reads the one it was handed instead.
  if (name === 'estimations-desktop.html') html = html.split('location.search').join('(window.__query||"")');
  return html;
}

const pages = {};
const unhandled = [];
for (const name of PAGE_FILES) {
  pages[name] = transformPage(name, read(name));
  const re = /location\.href\s*=\s*(['"])([^'"]*)\1/g;
  let m;
  while ((m = re.exec(pages[name]))) if (!/^mailto:/i.test(m[2])) unhandled.push(`${name}: ${m[0]}`);
  const left = pages[name].match(/<script src="[^"]*"|<link rel="stylesheet" href="(?!https:)[^"]*"/g);
  if (left) unhandled.push(`${name}: still loads ${left.join(', ')}`);
}
// A navigation left as a real one would take the frame to a file that does not exist on the PC.
if (unhandled.length) { console.error('Refusing: these would break in the one-file copy:\n  ' + unhandled.join('\n  ')); process.exit(1); }

const json = JSON.stringify(pages).replace(/<\/script/gi, '<\\/script');
const shell = fs.readFileSync(path.join(__dirname, 'local-shell.html'), 'utf8');
if (!shell.includes('__PAGES_JSON__')) throw new Error('local-shell.html is missing the __PAGES_JSON__ placeholder');
const out = shell.replace('__PAGES_JSON__', () => json);
fs.writeFileSync(OUT, out);
console.log(`Wrote ${OUT}: ${PAGE_FILES.length} pages, ${(out.length / 1048576).toFixed(1)} MB`);
