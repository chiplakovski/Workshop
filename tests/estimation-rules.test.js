// Pure-helper tests for estimation-rules.js — the exact module both estimations-desktop.html's
// pricing (computeTotals) and its customer-facing print sheet load, so a passing test here means
// the printed offer and the calculated totals can never structurally disagree.
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {money,lineTotal,baseAndIncludedLines,reconcileWorkItems,averageManpower}=require('../estimation-rules.js');

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

// reconcileWorkItems keeps an Estimation's work items in step with its linked Project's live item
// list (Projects owns scope, Estimations only ever prices what Projects says exists) — see
// estimations-desktop.html's reconcileEstimationWithProject/pushEstimationToProject, which are the
// "pull" and "push" halves of the Project<->Estimation sync this rule makes possible.
test('reconcileWorkItems adds a new fromProjectItem work item for a project item not yet represented', ()=>{
  const result=reconcileWorkItems([],[{no:'JC-1',desc:'Cut frame'}]);
  assert.equal(result.length,1);
  assert.deepEqual(result[0],{no:'JC-1',desc:'Cut frame',lines:[],peopleRequired:0,locked:false,fromProjectItem:true});
});

test('reconcileWorkItems removes a fromProjectItem work item whose project item no longer exists', ()=>{
  const current=[{no:'JC-1',desc:'Cut frame',lines:[],peopleRequired:2,fromProjectItem:true}];
  const result=reconcileWorkItems(current,[]);
  assert.equal(result.length,0);
});

test('reconcileWorkItems updates the desc of a fromProjectItem work item whose project item was renamed, preserving its lines/peopleRequired', ()=>{
  const current=[{no:'JC-1',desc:'Cut frame',lines:[{desc:'Steel plate',category:'material',qty:1,unit:'EA',sell:100,cost:60}],peopleRequired:3,fromProjectItem:true}];
  const result=reconcileWorkItems(current,[{no:'JC-1',desc:'Cut frame — revised'}]);
  assert.equal(result.length,1);
  assert.equal(result[0].desc,'Cut frame — revised');
  assert.equal(result[0].peopleRequired,3);
  assert.equal(result[0].lines.length,1);
});

test('reconcileWorkItems never touches a manually-added work item without fromProjectItem, even if its no matches nothing live', ()=>{
  const current=[{no:'',desc:'Contingency',lines:[{desc:'Buffer',category:'other',qty:1,unit:'lot',sell:5000,cost:0}]}];
  const result=reconcileWorkItems(current,[]);
  assert.equal(result.length,1);
  assert.equal(result[0].desc,'Contingency');
});

test('averageManpower is the mean peopleRequired across fromProjectItem work items only, 0 when none', ()=>{
  assert.equal(averageManpower([]),0);
  assert.equal(averageManpower([{fromProjectItem:true,peopleRequired:2},{fromProjectItem:true,peopleRequired:4}]),3);
  assert.equal(averageManpower([{fromProjectItem:true,peopleRequired:2},{desc:'Contingency',peopleRequired:100}]),2,'a manually-added work item must not skew the average');
});
