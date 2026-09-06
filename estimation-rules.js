// Pure Estimation pricing/effective-line helpers, loaded by estimations-desktop.html and by the
// Node test suite (tests/estimation-rules.test.js) so both share exactly one implementation —
// the printed offer and the on-screen calculation can never disagree.
(function(root){
  'use strict';
  function money(n){n=Number(n);if(!Number.isFinite(n))return 0;return Math.round(n*100)/100;}
  // A line's sell total is qty x unit sell price, reduced by the line discount (0-100%, clamped defensively).
  function lineTotal(it){
    const qty=Math.max(0,Number(it.qty)||0),sell=Math.max(0,Number(it.sell)||0),disc=Math.min(100,Math.max(0,Number(it.disc)||0));
    return money(qty*sell*(1-disc/100));
  }
  // Internal cost: for MATERIAL lines, waste% inflates the quantity actually consumed (offcuts, kerf, spoilage).
  function lineCostTotal(it){
    const qty=Math.max(0,Number(it.qty)||0),cost=Math.max(0,Number(it.cost)||0);
    const waste=it.category==='material'?Math.max(0,Number(it.waste)||0):0;
    return money(qty*cost*(1+waste/100));
  }
  // The effective line set: every work-item line, MINUS any base line a currently-included
  // replacement option displaces, PLUS the lines of every currently-included option. This is the
  // single source of truth for both computeTotals() (pricing) and renderPrintSheet() (the printed
  // offer) — nothing may recompute this independently.
  function baseAndIncludedLines(e){
    const replaced=new Set();
    (e.options||[]).filter(o=>o.included&&Array.isArray(o.replacesDesc)).forEach(o=>o.replacesDesc.forEach(d=>replaced.add(o.intoWorkItem+'|'+d)));
    const base=(e.workItems||[]).flatMap(wi=>wi.lines.filter(l=>!replaced.has(wi.no+'|'+l.desc)));
    const includedOptLines=(e.options||[]).filter(o=>o.included).flatMap(o=>o.lines.map(l=>Object.assign({},l,{fromOption:o.name,optionId:o.id})));
    return base.concat(includedOptLines);
  }
  // Keeps an Estimation's work-item list in step with its linked Project's live item list (Projects
  // owns scope/description; Estimations only ever prices what Projects says exists). A work item
  // gets fromProjectItem:true when it mirrors a project item this way — those are added/renamed/
  // removed automatically here and must never be hand-edited in Estimations (no/desc changes would
  // just be overwritten on the next reconcile). Every other (manually-added, e.g. contingency/
  // delivery) work item is left completely untouched, so nothing here ever discards a line of
  // pricing the user typed in.
  function reconcileWorkItems(currentWorkItems,liveProjectItems){
    const current=currentWorkItems||[];
    const live=liveProjectItems||[];
    const liveByNo=new Map(live.map(li=>[li.no,li]));
    const keep=current.filter(wi=>!wi.fromProjectItem||liveByNo.has(wi.no)).map(wi=>{
      if(!wi.fromProjectItem)return wi;
      const li=liveByNo.get(wi.no);
      return li.desc===wi.desc?wi:Object.assign({},wi,{desc:li.desc});
    });
    const knownNos=new Set(keep.map(wi=>wi.no));
    const added=live.filter(li=>!knownNos.has(li.no)).map(li=>({no:li.no,desc:li.desc,lines:[],peopleRequired:0,locked:false,fromProjectItem:true}));
    return keep.concat(added);
  }
  // Mean "people required" across a project's own work items (fromProjectItem ones) — manually
  // added extra work items (contingency, delivery, ...) don't represent a crewed project item and
  // are excluded so they can't skew the figure. 0 when there's nothing to average.
  function averageManpower(workItems){
    const items=(workItems||[]).filter(wi=>wi.fromProjectItem);
    if(!items.length)return 0;
    return money(items.reduce((a,wi)=>a+(Number(wi.peopleRequired)||0),0)/items.length);
  }
  const EstimationRules={money,lineTotal,lineCostTotal,baseAndIncludedLines,reconcileWorkItems,averageManpower};
  root.EstimationRules=EstimationRules;
  if(typeof module!=='undefined'&&module.exports)module.exports=EstimationRules;
})(typeof window!=='undefined'?window:globalThis);
