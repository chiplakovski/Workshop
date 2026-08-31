// Pure helpers for turning a Store shortage (low-stock reorder or a project BOM gap) into a real
// Purchasing record, and for detecting one that's already open — so re-clicking never creates a
// duplicate. Never decides anything about Purchasing's own workflow; WorkshopData.upsertPurchaseOrder
// remains the only place a real PO is written.
(function(root){
  'use strict';
  const CODE_SUFFIX=/\(([^()]+)\)\s*$/;
  const TERMINAL_PO_STATUSES=['Received','Cancelled']; // same "no longer open" set purchasing-desktop.html's own "Open POs" KPI uses
  const DEFAULT_LEAD_DAYS=14; // same default lead time purchasing-desktop.html's own openPO() uses

  function buildReorderItemsText(description,code){return `Reorder: ${description} (${code})`;}
  function extractMaterialCode(itemsText){const m=CODE_SUFFIX.exec(String(itemsText||''));return m?m[1]:null;}
  function isOpenPurchaseOrderStatus(status){return !TERMINAL_PO_STATUSES.includes(status);}

  // "Already open" = a non-terminal PO whose embedded code matches AND whose project matches exactly
  // (both null = a general, non-project-specific reorder). The same material short on two DIFFERENT
  // projects gets two independent POs; the same material + same project (or no project) twice is
  // blocked. Only matches POs created through this module's own encoding — a manually-created PO in
  // purchasing-desktop.html for the same material won't be detected; accepted limitation.
  function findOpenReorderPO(purchaseOrders,code,projectNo){
    const wantProject=projectNo||null;
    return (purchaseOrders||[]).find(po=>po&&isOpenPurchaseOrderStatus(po.status)
      &&extractMaterialCode(po.items)===code&&(po.project||null)===wantProject)||null;
  }
  function suggestedReorderQty(reorderQty,minStock,available){
    return reorderQty||Math.max((minStock||0)*2-(available||0),minStock||0);
  }
  function purchaseOrderValueFor(qty,lastPrice,avgCost){
    return Math.round((Number(qty)||0)*(Number(lastPrice)||Number(avgCost)||0));
  }
  function defaultExpectedDate(fromDate,leadDays){
    const base=(fromDate instanceof Date&&!isNaN(fromDate))?fromDate:new Date();
    const days=Number.isFinite(leadDays)?leadDays:DEFAULT_LEAD_DAYS;
    return new Date(base.getTime()+days*86400000).toISOString().slice(0,10);
  }
  // Always 'Awaiting Approval' — a system-computed suggestion always needs buyer sign-off before it's
  // a committed order; this is the exact status purchasing-desktop.html's Approvals panel filters on.
  function buildReorderPurchaseOrderPayload({code,description,supplier,qty,lastPrice,avgCost,projectNo,buyer,today}){
    const orderDate=(today instanceof Date&&!isNaN(today))?today:new Date();
    return{supplier,project:projectNo||null,date:orderDate.toISOString().slice(0,10),
      expected:defaultExpectedDate(orderDate,DEFAULT_LEAD_DAYS),
      value:purchaseOrderValueFor(qty,lastPrice,avgCost),buyer:buyer||'Aleksandar C.',
      status:'Awaiting Approval',items:buildReorderItemsText(description,code)};
  }
  const StorePurchasingRules={buildReorderItemsText,extractMaterialCode,isOpenPurchaseOrderStatus,
    findOpenReorderPO,suggestedReorderQty,purchaseOrderValueFor,defaultExpectedDate,
    buildReorderPurchaseOrderPayload,TERMINAL_PO_STATUSES,DEFAULT_LEAD_DAYS};
  root.StorePurchasingRules=StorePurchasingRules;
  if(typeof module!=='undefined'&&module.exports)module.exports=StorePurchasingRules;
})(typeof window!=='undefined'?window:globalThis);
