// Swedish organisation numbers, checked the way the pages check them — the same file, by require().
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const OrgNumber=require('../org-number.js');

test('a valid number is formatted and given its VAT number', ()=>{
  // 556012-5790 is a published, real organisation number; 811218-9876 is the personnummer the Tax
  // Agency itself uses as its example, which is what a sole trader's organisation number looks like.
  for(const [given,formatted] of [['556012-5790','556012-5790'],['5560125790','556012-5790'],
    ['16556012-5790','556012-5790'],[' 556012 5790 ','556012-5790'],['8112189876','811218-9876'],['198112189876','811218-9876']]){
    const r=OrgNumber.check(given);
    assert.equal(r.ok,true,`${given} should be valid`);
    assert.equal(r.formatted,formatted);
    assert.equal(r.vat,'SE'+formatted.replace('-','')+'01');
  }
});

test('a mistyped number is caught, and says why', ()=>{
  assert.equal(OrgNumber.check('556012-5791').reason,'checksum','one digit wrong');
  assert.equal(OrgNumber.check('556012-5970').reason,'checksum','two neighbouring digits swapped');
  assert.equal(OrgNumber.check('556012-579').reason,'length');
  assert.equal(OrgNumber.check('').reason,'empty');
  assert.equal(OrgNumber.check(null).reason,'empty');
  assert.equal(OrgNumber.check('556012-5791').ok,false);
});

test('the look-up link carries only the digits', ()=>{
  assert.equal(OrgNumber.lookupUrl('556012-5790'),'https://www.allabolag.se/what/5560125790');
  assert.equal(OrgNumber.lookupUrl(''),null);
});
