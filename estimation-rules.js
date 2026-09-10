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
  // ── The estimate's work items ARE the project's items ──
  // An estimate prices work that a project already describes: the project owns which items exist,
  // what they are called and what order they come in, and the estimate owns only their pricing.
  // Reconciling on every read is what keeps that true - an item added, renamed or reordered on the
  // project shows up here without a second list that can drift away from it.

  // An item's reference is read off the project, not invented here: the project number plus the
  // item's position in it, so P-26-0008's second item is always P-26-0008-02.
  function itemEstRef(projectNo,seq){
    const n=Math.max(1,Math.floor(Number(seq)||1));
    return String(projectNo||'')+'-'+String(n).padStart(2,'0');
  }

  // Rebuilds the priced work items from the project's current items, carrying each item's saved
  // lines across by item number. Pricing for an item that has since left the project is NOT
  // discarded - it is returned separately as `retired`, so it can be reported rather than silently
  // dropped, and comes back intact if the item is restored. Pass previously retired items back in
  // as part of `stored` for that to work.
  function reconcileWorkItems(projectItems,stored){
    const byNo=new Map();
    (stored||[]).forEach(w=>{if(w&&w.no!=null&&!byNo.has(w.no))byNo.set(w.no,w);});
    const claimed=new Set();
    const workItems=(projectItems||[]).map((item,i)=>{
      const prev=byNo.get(item.no);
      if(prev)claimed.add(item.no);
      return{no:item.no,seq:i+1,desc:item.desc||String(item.no),
        lines:prev&&Array.isArray(prev.lines)?prev.lines:[]};
    });
    const retired=(stored||[]).filter(w=>w&&w.no!=null&&!claimed.has(w.no)&&Array.isArray(w.lines)&&w.lines.length);
    return{workItems,retired};
  }

  const EstimationRules={money,lineTotal,lineCostTotal,baseAndIncludedLines,itemEstRef,reconcileWorkItems};
  root.EstimationRules=EstimationRules;
  if(typeof module!=='undefined'&&module.exports)module.exports=EstimationRules;
})(typeof window!=='undefined'?window:globalThis);
