// Pure-helper tests for estimation-rules.js — the exact module both estimations-desktop.html's
// pricing (computeTotals) and its customer-facing print sheet load, so a passing test here means
// the printed offer and the calculated totals can never structurally disagree.
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {money,lineTotal,lineVat,lineGross,baseAndIncludedLines,itemEstRef,reconcileWorkItems,
  isItemLocked,canEditItemLines,lockItem,unlockItem,itemLockHistory,
  itemDays,itemPeople,itemPersonDays,effortTotals}=require('../estimation-rules.js');

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

test('lineVat charges tax on the discounted sell total, and lineGross is what the customer pays', ()=>{
  assert.equal(lineVat({qty:100,sell:5,tax:25}),125);
  assert.equal(lineGross({qty:100,sell:5,tax:25}),625,'100 km at 5,00 with 25% VAT is 625,00');
  assert.equal(lineGross({qty:16,sell:440,tax:25}),8800);
  assert.equal(lineGross({qty:1,sell:12500,tax:25}),15625);
  assert.equal(money(625+8800+15625),25050,'the three lines together make the item subtotal');
});

test('lineGross taxes the discounted amount, never the list price', ()=>{
  assert.equal(lineTotal({qty:2,sell:100,disc:10}),180);
  assert.equal(lineGross({qty:2,sell:100,disc:10,tax:25}),225,'VAT is charged on 180, not on 200');
});

test('a line with no tax rate is gross-equal to its net total', ()=>{
  assert.equal(lineGross({qty:2,sell:100}),lineTotal({qty:2,sell:100}));
  assert.equal(lineVat({qty:2,sell:100}),0);
});

test('lineVat clamps an absurd or negative tax rate rather than inventing money', ()=>{
  assert.equal(lineVat({qty:1,sell:100,tax:-20}),0,'a negative rate must not discount the line');
  assert.equal(lineVat({qty:1,sell:100,tax:500}),100,'the rate is clamped at 100%');
});

test('the gross lines of an estimate reconcile with its net subtotal plus VAT', ()=>{
  const lines=[{qty:100,sell:5,tax:25},{qty:16,sell:440,tax:25},{qty:1,sell:12500,tax:25},{qty:3,sell:90,tax:0}];
  const net=money(lines.reduce((a,l)=>a+lineTotal(l),0));
  const vat=money(lines.reduce((a,l)=>a+lineVat(l),0));
  const gross=money(lines.reduce((a,l)=>a+lineGross(l),0));
  assert.equal(gross,money(net+vat),'what the table shows must equal subtotal + VAT');
});

test('lineTotal applies the line discount and clamps a negative/absurd discount defensively', ()=>{
  assert.equal(lineTotal({qty:2,sell:100,disc:10}),180);
  assert.equal(lineTotal({qty:2,sell:100,disc:-50}),200,'a negative discount must not inflate the price');
  assert.equal(lineTotal({qty:2,sell:100,disc:500}),0,'discount is clamped at 100%');
});

// ── The estimate's work items ARE the project's items (Pass 3.70) ──
// An estimate used to keep its own free-text work items, unconnected to the items the project
// actually contains, so the two lists could describe different work. The project now owns the list
// and the estimate owns only the pricing.

const ITEMS=[{no:'JC-2026-041',desc:'Cut and form panels'},
             {no:'JC-2026-042',desc:'Weld frame'},
             {no:'JC-2026-043',desc:'Surface finish'}];
const priced=(no,sell)=>({no,lines:[{desc:'work',category:'labour',qty:2,unit:'h',cost:sell/2,sell,disc:0,tax:25}]});

test('item reference: read off the project number and the item position, zero-padded', ()=>{
  assert.equal(itemEstRef('P-26-0008',1),'P-26-0008-01');
  assert.equal(itemEstRef('P-26-0008',9),'P-26-0008-09');
  assert.equal(itemEstRef('P-26-0008',10),'P-26-0008-10');
  assert.equal(itemEstRef('P-2026-014',3),'P-2026-014-03');
});

test('item reference: a missing or nonsense sequence still yields a usable first-item reference', ()=>{
  assert.equal(itemEstRef('P-26-0008'),'P-26-0008-01');
  assert.equal(itemEstRef('P-26-0008',0),'P-26-0008-01');
  assert.equal(itemEstRef('P-26-0008',-4),'P-26-0008-01');
  assert.equal(itemEstRef('P-26-0008','2'),'P-26-0008-02');
});

test('reconcile: the project decides which items exist, in which order, and what they are called', ()=>{
  const {workItems}=reconcileWorkItems(ITEMS,[{no:'JC-2026-042',desc:'STALE NAME',lines:[]}]);
  assert.deepEqual(workItems.map(w=>w.no),['JC-2026-041','JC-2026-042','JC-2026-043']);
  assert.deepEqual(workItems.map(w=>w.seq),[1,2,3]);
  assert.equal(workItems[1].desc,'Weld frame','the project name wins over whatever the estimate stored');
});

test('reconcile: saved pricing follows its item by number, not by position', ()=>{
  const stored=[priced('JC-2026-043',500)];
  const {workItems}=reconcileWorkItems(ITEMS,stored);
  assert.equal(workItems[0].lines.length,0);
  assert.equal(workItems[1].lines.length,0);
  assert.equal(workItems[2].lines.length,1,'the priced lines must land on JC-2026-043, whatever position it holds');
  assert.equal(workItems[2].lines[0].sell,500);
});

test('reconcile: reordering items on the project reorders the estimate and keeps each price attached', ()=>{
  const stored=[priced('JC-2026-041',100),priced('JC-2026-043',300)];
  const reordered=[ITEMS[2],ITEMS[0],ITEMS[1]];
  const {workItems}=reconcileWorkItems(reordered,stored);
  assert.deepEqual(workItems.map(w=>w.no),['JC-2026-043','JC-2026-041','JC-2026-042']);
  assert.equal(workItems[0].lines[0].sell,300);
  assert.equal(workItems[1].lines[0].sell,100);
  assert.equal(workItems[2].lines.length,0);
  assert.deepEqual(workItems.map(w=>w.seq),[1,2,3],'references renumber with the project order');
});

test('reconcile: an item added on the project appears here, unpriced rather than missing', ()=>{
  const {workItems}=reconcileWorkItems(ITEMS,[priced('JC-2026-041',100)]);
  const added=workItems.find(w=>w.no==='JC-2026-042');
  assert.ok(added,'a newly added project item must show up in the estimate');
  assert.deepEqual(added.lines,[],'and must start with no pricing rather than inheriting any');
});

test('reconcile: pricing for an item removed from the project is retired, never silently dropped', ()=>{
  const stored=[priced('JC-2026-041',100),priced('JC-GONE',900)];
  const {workItems,retired}=reconcileWorkItems(ITEMS,stored);
  assert.equal(workItems.some(w=>w.no==='JC-GONE'),false,'it must not be priced any more');
  assert.equal(retired.length,1);
  assert.equal(retired[0].no,'JC-GONE');
  assert.equal(retired[0].lines[0].sell,900,'the work that went into pricing it is still there to report');
});

test('reconcile: a retired item restored to the project comes back with its pricing intact', ()=>{
  const stored=[priced('JC-GONE',900)];
  const first=reconcileWorkItems(ITEMS,stored);
  assert.equal(first.retired.length,1);
  // Feeding the retired set back in is what makes the round trip lossless.
  const restored=reconcileWorkItems(ITEMS.concat({no:'JC-GONE',desc:'Back on the job'}),
                                    first.workItems.concat(first.retired));
  const back=restored.workItems.find(w=>w.no==='JC-GONE');
  assert.equal(back.lines[0].sell,900);
  assert.equal(restored.retired.length,0);
});

test('reconcile: an unpriced item that leaves the project is not reported as retired', ()=>{
  const {retired}=reconcileWorkItems(ITEMS,[{no:'JC-EMPTY',lines:[]}]);
  assert.deepEqual(retired,[],'there is nothing to warn about when no pricing would be lost');
});

test('reconcile: a project with no items yields an empty estimate, not a crash', ()=>{
  assert.deepEqual(reconcileWorkItems([],[]).workItems,[]);
  assert.deepEqual(reconcileWorkItems(null,null).workItems,[]);
  assert.deepEqual(reconcileWorkItems(undefined,undefined).retired,[]);
});

test('reconcile: the result feeds the pricing engine unchanged', ()=>{
  const {workItems}=reconcileWorkItems(ITEMS,[priced('JC-2026-041',100),priced('JC-2026-042',250)]);
  const lines=baseAndIncludedLines({workItems,options:[]});
  assert.equal(lines.length,2);
  assert.equal(money(lines.reduce((a,l)=>a+lineTotal(l),0)),money(2*100+2*250));
});

// ── Locking an item's calculation (Pass 3.78) ──
// An agreed price must not be able to change quietly: locking records who and when, unlocking
// demands a reason, and both are kept on the item so the trail cannot be separated from the figures.

test('item lock: an item starts editable and stays so until it is locked', ()=>{
  const wi={no:'JC-1',lines:[]};
  assert.equal(isItemLocked(wi),false);
  assert.equal(canEditItemLines(wi),true);
  assert.equal(isItemLocked({no:'JC-1',lines:[],lock:null}),false,'an explicit null lock is not locked');
  assert.equal(isItemLocked({no:'JC-1',lines:[],lock:{locked:false}}),false,'a released lock is not locked');
});

test('item lock: locking records who and when, and closes the lines to editing', ()=>{
  const lock=lockItem(null,'Aleksandar C.','2026-09-11 10:00');
  assert.equal(lock.locked,true);
  assert.equal(lock.by,'Aleksandar C.');
  assert.equal(lock.at,'2026-09-11 10:00');
  assert.equal(canEditItemLines({lock}),false,'a locked item must refuse line edits');
});

test('item lock: unlocking releases it, keeps the reason, and names who did it', ()=>{
  const locked=lockItem(null,'Aleksandar C.','2026-09-11 10:00');
  const released=unlockItem(locked,'Elena N.','2026-09-11 11:30','Customer changed the scope');
  assert.equal(released.locked,false);
  assert.equal(canEditItemLines({lock:released}),true);
  const last=released.trail[released.trail.length-1];
  assert.equal(last.action,'unlocked');
  assert.equal(last.by,'Elena N.');
  assert.equal(last.at,'2026-09-11 11:30');
  assert.equal(last.reason,'Customer changed the scope');
});

test('item lock: the trail accumulates every lock and unlock, in order', ()=>{
  let lock=lockItem(null,'A','2026-09-01 09:00');
  lock=unlockItem(lock,'B','2026-09-02 09:00','revise');
  lock=lockItem(lock,'C','2026-09-03 09:00');
  assert.deepEqual(lock.trail.map(x=>x.action),['locked','unlocked','locked']);
  assert.deepEqual(lock.trail.map(x=>x.by),['A','B','C']);
  assert.deepEqual(itemLockHistory({lock}).map(x=>x.by),['C','B','A'],'history reads newest first');
});

test('item lock: a re-lock after an unlock does not erase what came before', ()=>{
  let lock=lockItem(null,'A','2026-09-01 09:00');
  lock=unlockItem(lock,'B','2026-09-02 09:00','wrong material price');
  lock=lockItem(lock,'A','2026-09-03 09:00');
  const unlockEntry=lock.trail.find(x=>x.action==='unlocked');
  assert.equal(unlockEntry.reason,'wrong material price','the reason for a past unlock must survive re-locking');
  assert.equal(lock.trail.length,3);
});

test('item lock: an unlock with no reason given is recorded as empty, never as undefined', ()=>{
  const lock=unlockItem(lockItem(null,'A','t1'),'B','t2');
  assert.equal(lock.trail[1].reason,'');
});

test('item lock: the lock survives the project being re-read', ()=>{
  const locked={no:'JC-2026-041',lines:[{desc:'x',category:'labour',qty:1,unit:'h',cost:1,sell:2,disc:0,tax:25}],
    lock:lockItem(null,'Aleksandar C.','2026-09-11 10:00')};
  const {workItems}=reconcileWorkItems([{no:'JC-2026-041',desc:'Cut and form panels'}],[locked]);
  assert.equal(isItemLocked(workItems[0]),true,'re-reading the project must not release a lock');
  assert.equal(workItems[0].lock.by,'Aleksandar C.');
  assert.equal(workItems[0].lines.length,1);
});

test('item lock: an item that was never locked reconciles with no lock rather than a fabricated one', ()=>{
  const {workItems}=reconcileWorkItems([{no:'JC-1',desc:'a'}],[]);
  assert.equal(workItems[0].lock,null);
  assert.equal(canEditItemLines(workItems[0]),true);
});

test('item lock: locking one item leaves the others editable', ()=>{
  const stored=[{no:'JC-1',lines:[],lock:lockItem(null,'A','t')},{no:'JC-2',lines:[]}];
  const {workItems}=reconcileWorkItems([{no:'JC-1',desc:'a'},{no:'JC-2',desc:'b'}],stored);
  assert.equal(isItemLocked(workItems[0]),true);
  assert.equal(isItemLocked(workItems[1]),false);
});

// ── Duration and crew (Pass 3.84) ──
// Priced lines say what an item costs, not how long it takes or how many people it occupies. Those
// are estimated per item; the project's own figures are derived, never typed a second time.

test('effort: a missing, zero or nonsense figure reads as nothing rather than breaking the sum', ()=>{
  for(const bad of [undefined,null,'',{},[],NaN,-3,'abc']){
    assert.equal(itemDays({days:bad}),0);
    assert.equal(itemPeople({people:bad}),0);
  }
  assert.equal(itemDays(),0);
  assert.equal(itemPeople(null),0);
  assert.equal(itemPersonDays({days:4,people:2}),8);
});

test('effort: numbers arriving as text still count', ()=>{
  assert.equal(itemDays({days:'5'}),5);
  assert.equal(itemPeople({people:'3'}),3);
  assert.equal(itemPersonDays({days:'5',people:'3'}),15);
});

test('effort: start to finish is the sum of the items, because they run one after another', ()=>{
  const t=effortTotals([{days:4,people:2},{days:6,people:1},{days:2,people:3}]);
  assert.equal(t.totalDays,12);
});

test('effort: the average crew is weighted by duration, not a plain average of the items', ()=>{
  // Ten days with one person and one day with six is not three and a half people.
  const t=effortTotals([{days:10,people:1},{days:1,people:6}]);
  assert.equal(t.personDays,16);
  assert.equal(t.totalDays,11);
  assert.equal(t.avgPeople,money(16/11));
  assert.notEqual(t.avgPeople,3.5,'a plain average would misrepresent a long thin item');
});

test('effort: an item with no duration cannot weight the average, and is not counted as zero people', ()=>{
  const t=effortTotals([{days:4,people:2},{days:0,people:9}]);
  assert.equal(t.avgPeople,2,'the unestimated item must not drag the average');
  assert.equal(t.totalDays,4);
});

test('effort: the peak is the busiest single item, which is what the shop has to staff', ()=>{
  const t=effortTotals([{days:4,people:2},{days:1,people:6},{days:3,people:1}]);
  assert.equal(t.peakPeople,6);
  assert.ok(t.avgPeople<t.peakPeople,'the average must not hide the busiest moment');
});

test('effort: it reports how much of the project has actually been estimated', ()=>{
  const t=effortTotals([{days:4,people:2},{days:0,people:0},{days:3,people:1}]);
  assert.equal(t.estimated,2);
  assert.equal(t.items,3);
});

test('effort: an option being previewed never counts towards the project duration', ()=>{
  const t=effortTotals([{days:4,people:2},{days:99,people:9,isOption:true}]);
  assert.equal(t.totalDays,4);
  assert.equal(t.items,1);
});

test('effort: nothing estimated yet reports zeros rather than dividing by zero', ()=>{
  const t=effortTotals([{days:0,people:0}]);
  assert.equal(t.avgPeople,0);
  assert.equal(t.totalDays,0);
  assert.deepEqual(effortTotals([]),{totalDays:0,personDays:0,avgPeople:0,peakPeople:0,estimated:0,items:0});
  assert.deepEqual(effortTotals(null).totalDays,0);
});

test('effort: duration and crew survive the project being re-read', ()=>{
  const stored=[{no:'JC-1',lines:[],days:6,people:3}];
  const {workItems}=reconcileWorkItems([{no:'JC-1',desc:'Weld frame'}],stored);
  assert.equal(workItems[0].days,6);
  assert.equal(workItems[0].people,3);
  assert.equal(effortTotals(workItems).personDays,18);
});

test('effort: an item that never had an estimate reconciles to zero, not undefined', ()=>{
  const {workItems}=reconcileWorkItems([{no:'JC-9',desc:'New'}],[]);
  assert.equal(workItems[0].days,0);
  assert.equal(workItems[0].people,0);
});
