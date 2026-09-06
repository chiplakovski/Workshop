// Verifies: (1) every standalone JS module parses cleanly, (2) every inline <script> block in every
// HTML page parses cleanly, and (3) every literal internal ".html" link actually points at a file
// that exists in the repository. Run via `npm run test:syntax`. Exits non-zero on any failure.
'use strict';
const fs=require('fs');
const path=require('path');

const ROOT=path.join(__dirname,'..');
let failures=0;

function checkSyntax(label,source){
  try{
    new Function(source);
    console.log(`OK   ${label}`);
  }catch(e){
    failures++;
    console.log(`FAIL ${label}: ${e.message}`);
  }
}

const jsFiles=['workshop-data.js','workshop-forms.js','jobcard-rules.js','estimation-rules.js','project-rules.js','quality-gates.js','equipment-gates.js','jobcard-equipment-rules.js','store-purchasing-rules.js','workshop-radio.js'];
for(const file of jsFiles){
  const full=path.join(ROOT,file);
  if(!fs.existsSync(full)){failures++;console.log(`FAIL ${file}: file not found`);continue;}
  checkSyntax(file,fs.readFileSync(full,'utf8'));
}

const htmlFiles=fs.readdirSync(ROOT).filter(f=>f.endsWith('.html'));
const existingFiles=new Set(fs.readdirSync(ROOT));

for(const file of htmlFiles){
  const html=fs.readFileSync(path.join(ROOT,file),'utf8');
  const inlineScripts=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  inlineScripts.forEach((s,i)=>{
    if(!s.trim())return; // ignore empty inline <script> tags (e.g. JSON-LD placeholders)
    checkSyntax(`${file} (inline script ${i})`,s);
  });

  // Missing internal .html link check: only literal string links (no template interpolation),
  // relative (no scheme, not starting with '/'), matched from href=/src=/location.href= attributes.
  const linkPattern=/(?:href|src)\s*=\s*"([^"$]+\.html(?:#[^"]*)?)"|location\.href\s*=\s*'([^'$]+\.html)'/g;
  let m;
  while((m=linkPattern.exec(html))){
    const raw=(m[1]||m[2]);
    const target=raw.split('#')[0].split('?')[0];
    if(!target||/^https?:\/\//i.test(target)||target.startsWith('/')||target.startsWith('mailto:'))continue;
    if(!existingFiles.has(target)){
      failures++;
      console.log(`FAIL ${file}: links to missing file "${target}"`);
    }
  }
}

console.log(failures===0?'\nAll syntax and link checks passed.':`\n${failures} check(s) failed.`);
process.exit(failures===0?0:1);
