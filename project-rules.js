// Pure Projects-module adapters, loaded by estimations-desktop.html and by the Node test suite
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
  const STATUS_ORDER=['quotation','approved','planned','active','hold','completed','closed','cancelled'];
  // Known synonyms for the SAME underlying operational state, used elsewhere in the app — a project
  // created via Estimation conversion (workshop-data.js createProjectFromEstimation) uses
  // 'production' for what this page's own vocabulary calls 'active'. This is the ONLY place such
  // synonyms are declared; nothing else may reinterpret a status string on its own. Any status not
  // listed here passes through unchanged, so it stays visible (never hidden by a filter) without
  // ever being treated as eligible for a workflow action meant for a known status.
  // 'draft' is a retired status (Pass 3.69): a project used to be created as a draft and only then
  // sent out as a quotation, but the two steps recorded the same thing, so a project now starts at
  // 'quotation' with its price. Aliasing rather than deleting keeps every project already saved as
  // a draft — in a browser's stored state or written by another module — working and visible.
  const STATUS_ALIASES={production:'active',draft:'quotation'};
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
  // The quoting chain. Before Pass 3.68 'quotation', 'approved' and 'planned' existed as statuses
  // (and as board columns) with nothing in the app able to reach them, so the only projects ever in
  // those states were the seeded demo ones. Each step is single-source, so a status can only ever be
  // entered from the one that legitimately precedes it.
  function canApprove(p){return isKnownUiStatus(p.status)&&uiStatus(p.status)==='quotation';}
  function canPlan(p){return isKnownUiStatus(p.status)&&uiStatus(p.status)==='approved';}
  function canStart(p){return isKnownUiStatus(p.status)&&uiStatus(p.status)==='planned';}
  // The ordered pipeline a project walks before it is running work. Kept next to the checks above
  // because the UI renders it as a step strip and must not re-declare the order for itself.
  const PIPELINE=['quotation','approved','planned','active'];
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

  const ProjectRules={custName,custObj,STATUS_ORDER,STATUS_ALIASES,PIPELINE,uiStatus,isKnownUiStatus,
    canHold,canResume,canComplete,canClose,canCancel,canReopen,canApprove,canPlan,canStart,
    isReadonlyStatus,statusCssClass,mergeProjectFormStateAfterCustomer};
  root.ProjectRules=ProjectRules;
  if(typeof module!=='undefined'&&module.exports)module.exports=ProjectRules;
})(typeof window!=='undefined'?window:globalThis);
