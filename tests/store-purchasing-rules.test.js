// Pure-helper tests for store-purchasing-rules.js — the exact module store-desktop.html loads, so
// these tests exercise the real logic the page runs, not a reimplementation of it. These functions
// never write to WorkshopData themselves — only WorkshopData.upsertPurchaseOrder() (called from
// store-desktop.html, not here) is the sole place a real Purchase Order is written.
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  buildReorderItemsText,extractMaterialCode,isOpenPurchaseOrderStatus,findOpenReorderPO,
  suggestedReorderQty,purchaseOrderValueFor,defaultExpectedDate,buildReorderPurchaseOrderPayload
}=require('../store-purchasing-rules.js');

function po(overrides){return Object.assign({id:1,no:'PO-2026-0001',supplier:'Acme',project:null,date:'2026-08-20',expected:'2026-09-03',value:1000,buyer:'Aleksandar C.',status:'Awaiting Approval',items:'Reorder: Grinding disc 4.5" (GRD-DISC-4.5)'},overrides);}

// ── buildReorderItemsText / extractMaterialCode ──
test('buildReorderItemsText/extractMaterialCode: round-trips the material code embedded at the end', ()=>{
  const text=buildReorderItemsText('Grinding disc 4.5"','GRD-DISC-4.5');
  assert.equal(text,'Reorder: Grinding disc 4.5" (GRD-DISC-4.5)');
  assert.equal(extractMaterialCode(text),'GRD-DISC-4.5');
});
test('extractMaterialCode: anchors on the TRAILING parenthesized group, even when the description has its own parentheses', ()=>{
  const text=buildReorderItemsText('Bracket (heavy duty)','BRK-200');
  assert.equal(extractMaterialCode(text),'BRK-200');
});
test('extractMaterialCode: no trailing parenthetical, or empty/missing text, returns null', ()=>{
  assert.equal(extractMaterialCode('Ventilation duct materials'),null);
  assert.equal(extractMaterialCode(''),null);
  assert.equal(extractMaterialCode(undefined),null);
  assert.equal(extractMaterialCode(null),null);
});

// ── isOpenPurchaseOrderStatus ──
test('isOpenPurchaseOrderStatus: Received and Cancelled are the only terminal (non-open) statuses', ()=>{
  assert.equal(isOpenPurchaseOrderStatus('Received'),false);
  assert.equal(isOpenPurchaseOrderStatus('Cancelled'),false);
  ['Draft','Awaiting Approval','Confirmed','Partially Received','Overdue'].forEach(s=>{
    assert.equal(isOpenPurchaseOrderStatus(s),true);
  });
});

// ── findOpenReorderPO ──
test('findOpenReorderPO: finds an open PO for the same code and same project (null project matches null)', ()=>{
  const list=[po({project:null})];
  const found=findOpenReorderPO(list,'GRD-DISC-4.5',null);
  assert.equal(found,list[0]);
});
test('findOpenReorderPO: the same material short on two DIFFERENT projects are each independently open', ()=>{
  const list=[po({project:'P-2026-014'})];
  assert.equal(findOpenReorderPO(list,'GRD-DISC-4.5','P-26-0001'),null);
  assert.equal(findOpenReorderPO(list,'GRD-DISC-4.5','P-2026-014'),list[0]);
});
test('findOpenReorderPO: a terminal-status PO (Received/Cancelled) never blocks a new one', ()=>{
  const list=[po({status:'Received'}),po({id:2,no:'PO-2',status:'Cancelled'})];
  assert.equal(findOpenReorderPO(list,'GRD-DISC-4.5',null),null);
});
test('findOpenReorderPO: no match on a different material code, or an empty/missing list', ()=>{
  const list=[po()];
  assert.equal(findOpenReorderPO(list,'OTHER-CODE',null),null);
  assert.equal(findOpenReorderPO([],'GRD-DISC-4.5',null),null);
  assert.equal(findOpenReorderPO(null,'GRD-DISC-4.5',null),null);
});

// ── suggestedReorderQty ──
test('suggestedReorderQty: uses the real preferred reorderQty when set', ()=>{
  assert.equal(suggestedReorderQty(100,60,54),100);
});
test('suggestedReorderQty: falls back to max(min*2-available, min) when no reorderQty is set', ()=>{
  assert.equal(suggestedReorderQty(0,60,54),66); // 60*2-54=66
  assert.equal(suggestedReorderQty(null,10,0),20); // 10*2-0=20
});
test('suggestedReorderQty: never suggests less than the minimum, even with negative available stock', ()=>{
  assert.equal(suggestedReorderQty(0,10,-50),70); // 10*2-(-50)=70, still >= min
  assert.equal(suggestedReorderQty(0,5,100),5); // 5*2-100 is negative, floored to min (5)
});

// ── purchaseOrderValueFor ──
test('purchaseOrderValueFor: qty times lastPrice, rounded', ()=>{
  assert.equal(purchaseOrderValueFor(100,12.5,999),1250);
});
test('purchaseOrderValueFor: falls back to avgCost when lastPrice is missing/zero', ()=>{
  assert.equal(purchaseOrderValueFor(10,0,20),200);
  assert.equal(purchaseOrderValueFor(10,null,20),200);
});
test('purchaseOrderValueFor: zero when both prices are missing — never NaN', ()=>{
  assert.equal(purchaseOrderValueFor(10,null,null),0);
  assert.equal(purchaseOrderValueFor(null,null,null),0);
});

// ── defaultExpectedDate ──
test('defaultExpectedDate: adds exactly the given lead days to the given date', ()=>{
  const from=new Date('2026-08-20T00:00:00.000Z');
  assert.equal(defaultExpectedDate(from,14),'2026-09-03');
  assert.equal(defaultExpectedDate(from,0),'2026-08-20');
});
test('defaultExpectedDate: falls back to the module default lead time and to "now" for invalid input', ()=>{
  const from=new Date('2026-08-20T00:00:00.000Z');
  assert.equal(defaultExpectedDate(from,undefined),'2026-09-03'); // DEFAULT_LEAD_DAYS=14
  const result=defaultExpectedDate(null,0);
  assert.match(result,/^\d{4}-\d{2}-\d{2}$/); // "now" — just assert it's a valid date string
});

// ── buildReorderPurchaseOrderPayload ──
test('buildReorderPurchaseOrderPayload: composes the full real PO shape, always Awaiting Approval', ()=>{
  const today=new Date('2026-08-20T00:00:00.000Z');
  const payload=buildReorderPurchaseOrderPayload({code:'GRD-DISC-4.5',description:'Grinding disc 4.5"',supplier:'Acme',qty:100,lastPrice:12.5,avgCost:10,projectNo:null,buyer:'Aleksandar C.',today});
  assert.deepEqual(payload,{
    supplier:'Acme',project:null,date:'2026-08-20',expected:'2026-09-03',
    value:1250,buyer:'Aleksandar C.',status:'Awaiting Approval',
    items:'Reorder: Grinding disc 4.5" (GRD-DISC-4.5)',itemCode:'GRD-DISC-4.5',
    orderedQty:100,receivedQty:0,receivedValue:0
  });
});
test('buildReorderPurchaseOrderPayload: sets project when given, defaults buyer when omitted', ()=>{
  const today=new Date('2026-08-20T00:00:00.000Z');
  const payload=buildReorderPurchaseOrderPayload({code:'ER70S-6-1.0',description:'Welding wire ER70S-6',supplier:'WeldSupply',qty:33,lastPrice:0,avgCost:45,projectNo:'P-2026-014',today});
  assert.equal(payload.project,'P-2026-014');
  assert.equal(payload.buyer,'Aleksandar C.');
  assert.equal(payload.value,1485); // 33*45
  assert.equal(payload.status,'Awaiting Approval');
  assert.equal(payload.orderedQty,33);
  assert.equal(payload.receivedQty,0);
});
