// Pure Projects-module adapters, loaded by projects-desktop.html and by the Node test suite
// (tests/project-rules.test.js) so both share exactly one implementation of these rules.
(function(root){
  'use strict';

  // ── Customer resolution ──
  // Resolves against whatever customers array is passed in. The page always passes its CUSTOMERS
  // variable, which (as of Stabilisation Pass 2.1) is loaded directly from
  // WorkshopData.getCustomers(), so an id here is always a real shared customer id — never a
  // page-local-only numbering that could collide with a different shared customer.
  function custName(customers,id){const c=(customers||[]).find(x=>x.id===id);return c?c.name:'—';}
  function custObj(customers,id){return (customers||[]).find(x=>x.id===id)||null;}

  // ── Project status adapter ──
  const STATUS_ORDER=['draft','quotation','approved','planned','active','hold','completed','closed','cancelled'];
  // Known synonyms for the SAME underlying operational state, used elsewhere in the app — a project
  // created via Estimation conversion (workshop-data.js createProjectFromEstimation) uses
  // 'production' for what this page's own vocabulary calls 'active'. This is the ONLY place such
  // synonyms are declared; nothing else may reinterpret a status string on its own. Any status not
  // listed here passes through unchanged, so it stays visible (never hidden by a filter) without
  // ever being treated as eligible for a workflow action meant for a known status.
  const STATUS_ALIASES={production:'active'};
  function uiStatus(rawStatus){return STATUS_ALIASES[rawStatus]||rawStatus;}
  function isKnownUiStatus(rawStatus){return STATUS_ORDER.includes(uiStatus(rawStatus));}
  // Every workflow-action check requires a RECOGNISED status (native or aliased) before it can be
  // true — an unknown status is never eligible for any transition, including Cancel (which used to
  // be an "allow unless terminal" check that incorrectly treated an unknown status as cancellable).
  function canHold(p){return isKnownUiStatus(p.status)&&['active','planned'].includes(uiStatus(p.status));}
  function canResume(p){return isKnownUiStatus(p.status)&&uiStatus(p.status)==='hold';}
  function canComplete(p){return isKnownUiStatus(p.status)&&uiStatus(p.status)==='active';}
  function canClose(p){return isKnownUiStatus(p.status)&&uiStatus(p.status)==='completed';}
  function canCancel(p){return isKnownUiStatus(p.status)&&!['closed','cancelled','completed'].includes(uiStatus(p.status));}
  function canReopen(p){return isKnownUiStatus(p.status)&&uiStatus(p.status)==='closed';}
  function isReadonlyStatus(p){return uiStatus(p.status)==='closed';}
  // The CSS class rendered for a status badge. A known status (native or aliased) uses its own
  // mapped class name; an unrecognised status ALWAYS uses the fixed 'unknown' class — raw status
  // text must never be interpolated directly into an HTML class attribute.
  function statusCssClass(rawStatus){return isKnownUiStatus(rawStatus)?uiStatus(rawStatus):'unknown';}

  // ── Project form state (New Customer mini-modal round trip) ──
  // Merges a captured Project form snapshot with the outcome of the New Customer mini-modal: if a
  // customer was created, its id wins; if the modal was cancelled (newCustomerId is null/undefined),
  // the previously selected customer id is kept. Every other captured field passes through
  // untouched, so no in-progress Project form value is ever lost when the modal replaces the DOM.
  function mergeProjectFormStateAfterCustomer(pending,newCustomerId){
    const state=Object.assign({},pending||{});
    if(newCustomerId!=null)state.customerId=newCustomerId;
    return state;
  }

  const ProjectRules={custName,custObj,STATUS_ORDER,STATUS_ALIASES,uiStatus,isKnownUiStatus,
    canHold,canResume,canComplete,canClose,canCancel,canReopen,isReadonlyStatus,statusCssClass,
    mergeProjectFormStateAfterCustomer};
  root.ProjectRules=ProjectRules;
  if(typeof module!=='undefined'&&module.exports)module.exports=ProjectRules;
})(typeof window!=='undefined'?window:globalThis);
