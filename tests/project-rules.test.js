// Pure-helper tests for project-rules.js — the exact module projects-desktop.html loads, so these
// tests exercise the real customer-resolution and status-adapter logic the page runs.
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const ProjectRules=require('../project-rules.js');
const {custName,custObj,uiStatus,isKnownUiStatus,canHold,canResume,canComplete,canClose,canCancel,canReopen,isReadonlyStatus,statusCssClass,mergeProjectFormStateAfterCustomer,STATUS_ORDER}=ProjectRules;

// A minimal shared-customers fixture matching real v5 ids (MarineVent AB = 1, Sanus Glutenfri AB = 2)
// — the exact mismatch that caused Pass 2's Projects page to show the wrong customer name.
const SHARED_CUSTOMERS=[
  {id:1,no:'C-001',name:'MarineVent AB'},
  {id:2,no:'C-002',name:'Sanus Glutenfri AB'},
  {id:3,no:'C-003',name:'Schröder Nordic'}
];

test('custName: shared customer id 1 resolves to MarineVent AB, not a page-local id 1', ()=>{
  assert.equal(custName(SHARED_CUSTOMERS,1),'MarineVent AB');
});

test('custName: shared customer id 2 (Sanus Glutenfri AB) resolves correctly and is distinct from id 1', ()=>{
  assert.equal(custName(SHARED_CUSTOMERS,2),'Sanus Glutenfri AB');
  assert.notEqual(custName(SHARED_CUSTOMERS,2),custName(SHARED_CUSTOMERS,1));
});

test('custName: an unknown id resolves to the em-dash placeholder, not a crash', ()=>{
  assert.equal(custName(SHARED_CUSTOMERS,9999),'—');
});

test('custObj: returns the full matching customer record or null', ()=>{
  assert.equal(custObj(SHARED_CUSTOMERS,1).name,'MarineVent AB');
  assert.equal(custObj(SHARED_CUSTOMERS,9999),null);
});

// ── Status adapter ──
test('uiStatus: shared "production" status maps to the Projects UI "active" status', ()=>{
  assert.equal(uiStatus('production'),'active');
});

test('uiStatus: a status already in the UI vocabulary passes through unchanged', ()=>{
  for(const s of STATUS_ORDER)assert.equal(uiStatus(s),s);
});

test('uiStatus: an unrelated/unknown status passes through unchanged rather than being invented', ()=>{
  assert.equal(uiStatus('some-other-status'),'some-other-status');
});

test('isKnownUiStatus: recognises aliased and native statuses, rejects unknown ones', ()=>{
  assert.equal(isKnownUiStatus('production'),true);
  assert.equal(isKnownUiStatus('active'),true);
  assert.equal(isKnownUiStatus('bogus'),false);
});

test('a "production" project receives the same safe actions as an "active" project', ()=>{
  const production={status:'production'},active={status:'active'};
  assert.equal(canHold(production),canHold(active));
  assert.equal(canHold(production),true);
  assert.equal(canComplete(production),canComplete(active));
  assert.equal(canComplete(production),true);
  assert.equal(canResume(production),canResume(active));
  assert.equal(canClose(production),canClose(active));
  assert.equal(canReopen(production),canReopen(active));
  assert.equal(isReadonlyStatus(production),isReadonlyStatus(active));
});

test('unknown statuses stay visible (isKnownUiStatus false) but receive no state-transition-dependent action, including Cancel', ()=>{
  const p={status:'totally-unknown-status'};
  assert.equal(isKnownUiStatus(p.status),false);
  assert.equal(canHold(p),false);
  assert.equal(canResume(p),false);
  assert.equal(canComplete(p),false);
  assert.equal(canClose(p),false);
  assert.equal(canCancel(p),false,'Pass 2.2: canCancel used to be an "allow unless terminal" check that wrongly returned true for an unknown status');
  assert.equal(canReopen(p),false);
  assert.equal(isReadonlyStatus(p),false);
});

test('normal Projects-created statuses (draft/active/hold/completed/closed/cancelled) keep working exactly as before', ()=>{
  assert.equal(canHold({status:'draft'}),false);
  assert.equal(canHold({status:'planned'}),true);
  assert.equal(canHold({status:'active'}),true);
  assert.equal(canResume({status:'hold'}),true);
  assert.equal(canComplete({status:'active'}),true);
  assert.equal(canClose({status:'completed'}),true);
  assert.equal(canReopen({status:'closed'}),true);
  assert.equal(canCancel({status:'closed'}),false);
  assert.equal(canCancel({status:'cancelled'}),false);
  assert.equal(canCancel({status:'completed'}),false);
  assert.equal(canCancel({status:'draft'}),true);
  assert.equal(isReadonlyStatus({status:'closed'}),true);
});

// ── Pass 2.2: safe CSS class for the status badge ───────────────────────────────────────────────
test('statusCssClass: a known status (native or aliased) uses its own mapped class name', ()=>{
  assert.equal(statusCssClass('active'),'active');
  assert.equal(statusCssClass('hold'),'hold');
  assert.equal(statusCssClass('production'),'active','production must still map safely to active');
});

test('statusCssClass: an unrecognised status always uses the fixed "unknown" class, never the raw text', ()=>{
  assert.equal(statusCssClass('totally-unknown-status'),'unknown');
  assert.equal(statusCssClass('"><img src=x onerror=alert(1)>'),'unknown','even a hostile-looking raw status must resolve to the fixed safe class, never be echoed into it');
});

// ── Pass 2.2: Project form state survives the New Customer mini-modal round trip ───────────────
const FULL_FORM_STATE={
  no:'P-26-0099',name:'Full Field Test Project',customerId:2,customerRef:'REF-999',poNumber:'PO-999',
  description:'A description that must survive.',internalNotes:'Internal notes that must survive.',
  types:['Welding'],pm:'Marko',workshop:'Elena',sales:'',plannedStart:'2026-09-01',deadline:'2026-10-01',
  plannedCompletion:'2026-09-25',quotedValue:55000
};

test('mergeProjectFormStateAfterCustomer: saving a new customer preserves every other captured field', ()=>{
  const merged=mergeProjectFormStateAfterCustomer(FULL_FORM_STATE,41);
  assert.equal(merged.customerId,41,'the newly created customer must be selected');
  for(const k of Object.keys(FULL_FORM_STATE)){
    if(k==='customerId')continue;
    assert.deepEqual(merged[k],FULL_FORM_STATE[k],`field "${k}" must be preserved unchanged`);
  }
});

test('mergeProjectFormStateAfterCustomer: cancelling (newCustomerId null) preserves every field, including the previous customer', ()=>{
  const merged=mergeProjectFormStateAfterCustomer(FULL_FORM_STATE,null);
  assert.deepEqual(merged,FULL_FORM_STATE,'nothing must change when the New Customer modal is cancelled');
});

test('mergeProjectFormStateAfterCustomer: works identically for a captured edit-in-progress state (not just a brand-new project)', ()=>{
  const editState=Object.assign({},FULL_FORM_STATE,{no:'P-2026-014',name:'Edited MarineVent Name (unsaved)',customerId:1});
  const savedNewCustomer=mergeProjectFormStateAfterCustomer(editState,50);
  assert.equal(savedNewCustomer.name,'Edited MarineVent Name (unsaved)');
  assert.equal(savedNewCustomer.customerId,50);
  const cancelled=mergeProjectFormStateAfterCustomer(editState,null);
  assert.equal(cancelled.name,'Edited MarineVent Name (unsaved)');
  assert.equal(cancelled.customerId,1,'cancelling must keep the customer the project already had, unchanged');
});
