// Pure-helper tests for estimation-rules.js — the exact module both estimations-desktop.html's
// pricing (computeTotals) and its customer-facing print sheet load, so a passing test here means
// the printed offer and the calculated totals can never structurally disagree.
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {money,lineTotal,baseAndIncludedLines}=require('../estimation-rules.js');

function sampleEstimation(){
  return {
    workItems:[
      {no:'1',desc:'Ventilation duct',lines:[
        {desc:'Steel Sheet 3mm (S235JR)',category:'material',qty:8,unit:'EA',sell:1200,disc:0,tax:25,cost:800,waste:5},
        {desc:'Square Tube 40x40x3mm (S235JR)',category:'material',qty:20,unit:'EA',sell:150,disc:0,tax:25,cost:100,waste:5},
        {desc:'Assembly labour',category:'labour',qty:16,unit:'H',sell:450,disc:0,tax:25,cost:300}
      ]}
    ],
    options:[
      {id:1,name:'Stainless upgrade',included:false,intoWorkItem:'1',
        replacesDesc:['Steel Sheet 3mm (S235JR)','Square Tube 40x40x3mm (S235JR)'],
        lines:[{desc:'Stainless Sheet 3mm (AISI 304)',category:'material',qty:8,unit:'EA',sell:1800,disc:0,tax:25,cost:1200,waste:5}]}
    ]
  };
}

test('replacement option excludes its replaced base line(s) once included', ()=>{
  const e=sampleEstimation();
  e.options[0].included=true;
  const lines=baseAndIncludedLines(e);
  assert.ok(!lines.some(l=>l.desc==='Steel Sheet 3mm (S235JR)'),'replaced base line must not appear');
  assert.ok(!lines.some(l=>l.desc==='Square Tube 40x40x3mm (S235JR)'),'replaced base line must not appear');
  assert.ok(lines.some(l=>l.desc==='Stainless Sheet 3mm (AISI 304)'),'the replacement option line must appear');
  assert.ok(lines.some(l=>l.desc==='Assembly labour'),'unrelated base lines must be unaffected');
});

test('a non-included replacement option leaves the base lines untouched', ()=>{
  const e=sampleEstimation(); // options[0].included is false by default
  const lines=baseAndIncludedLines(e);
  assert.ok(lines.some(l=>l.desc==='Steel Sheet 3mm (S235JR)'));
  assert.ok(lines.some(l=>l.desc==='Square Tube 40x40x3mm (S235JR)'));
  assert.ok(!lines.some(l=>l.desc==='Stainless Sheet 3mm (AISI 304)'),'a non-included option must not be priced in');
});

// Regression test for the print/calculation mismatch: renderPrintSheet() builds its base-section
// rows as baseAndIncludedLines(e).filter(l=>!l.fromOption), plus one section per included option's
// own o.lines. Reassembling those two pieces must reproduce exactly what computeTotals() prices.
test('printed effective lines (base section + included option sections) equal the calculated effective line set', ()=>{
  const e=sampleEstimation();
  e.options[0].included=true;
  const calculated=baseAndIncludedLines(e);
  const printedBase=baseAndIncludedLines(e).filter(l=>!l.fromOption);
  const printedOptionLines=e.options.filter(o=>o.included).flatMap(o=>o.lines);
  const printedTotal=money(printedBase.reduce((a,l)=>a+lineTotal(l),0)+printedOptionLines.reduce((a,l)=>a+lineTotal(l),0));
  const calculatedTotal=money(calculated.reduce((a,l)=>a+lineTotal(l),0));
  assert.equal(printedTotal,calculatedTotal);
  assert.equal(printedBase.length+printedOptionLines.length,calculated.length);
});

test('lineTotal applies the line discount and clamps a negative/absurd discount defensively', ()=>{
  assert.equal(lineTotal({qty:2,sell:100,disc:10}),180);
  assert.equal(lineTotal({qty:2,sell:100,disc:-50}),200,'a negative discount must not inflate the price');
  assert.equal(lineTotal({qty:2,sell:100,disc:500}),0,'discount is clamped at 100%');
});
