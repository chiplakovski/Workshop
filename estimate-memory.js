// What the workshop already knows about its own estimates, read out of the records it keeps.
//
// Nothing here predicts. Every figure it returns is a recollection of work that was actually
// finished, carried with the number of jobs it rests on and the references to open them. An
// estimate is only counted once the work it describes is done: a job half-way through has burned
// half its hours, and calling that "0.5x the estimate" would be a lie the rest of the module
// spends its time avoiding.
(function(global){
  'use strict';

  const DAY_HOURS=8;
  // Statuses that mean the work is finished and its hours are final.
  const DONE_OPERATION=['completed','done','closed'];
  const DONE_PROJECT=['completed','closed'];
  // Words that say nothing about what the work is.
  const STOP=new Set(['and','or','the','of','for','to','a','an','on','in','with','per',
    'och','av','till','för','med','på','i','den','det',
    'i','na','za','od','so','vo']);

  const round1=n=>Math.round((Number(n)||0)*10)/10;
  const round2=n=>Math.round((Number(n)||0)*100)/100;

  // Matching is on words, not on spelling: "Laser cutting" and "Cut frame profiles" share
  // nothing, while "Cutting" and "Cut frame profiles" share the stem that matters.
  function tokens(text){
    return String(text||'').toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu,' ')
      .split(/\s+/)
      .filter(w=>w.length>2&&!STOP.has(w)&&!/^\d+$/.test(w))
      // cutting/cut/cuts are one word here. Stripping the ending can leave the doubled
      // consonant English adds before it (cutting -> cutt), so that is collapsed too.
      .map(w=>w.replace(/(ing|ed|s)$/,'').replace(/([bdfglmnprt])\1$/,'$1'))
      .filter(w=>w.length>2);
  }
  // Dice's coefficient over the two word sets: 1 when they say the same thing, 0 when they
  // share nothing. Chosen over a substring test because word order is not meaningful here.
  function similarity(a,b){
    const A=new Set(tokens(a)),B=new Set(tokens(b));
    if(!A.size||!B.size)return 0;
    let shared=0;
    A.forEach(w=>{if(B.has(w))shared++;});
    return round2(2*shared/(A.size+B.size));
  }

  // ── The record: one entry per piece of work that was estimated and then finished ──────────
  function operationEntries(jobcards){
    const out=[];
    (Array.isArray(jobcards)?jobcards:[]).forEach(j=>{
      if(!j||j.archived)return;
      (Array.isArray(j.operations)?j.operations:[]).forEach(op=>{
        const planned=Number(op.plannedHours)||0,actual=Number(op.loggedHours)||0;
        if(!planned||!actual)return;
        if(!DONE_OPERATION.includes(String(op.status||'').toLowerCase()))return;
        out.push({kind:'operation',desc:op.desc||'',planned:round1(planned),actual:round1(actual),
          ref:j.no,project:j.projectNo||'',machine:op.machine||'',worker:op.worker||'',
          date:op.actualCompletion||op.actualStart||''});
      });
    });
    return out;
  }
  function projectEntries(projects){
    return (Array.isArray(projects)?projects:[])
      .filter(p=>p&&DONE_PROJECT.includes(String(p.status||'').toLowerCase()))
      .filter(p=>(Number(p.plannedHours)||0)>0&&(Number(p.usedHours)||0)>0)
      .map(p=>({kind:'project',desc:p.name||'',planned:round1(p.plannedHours),actual:round1(p.usedHours),
        ref:p.no,project:p.no,types:Array.isArray(p.types)?p.types.slice():[],date:p.actualCompletion||p.closedDate||''}));
  }
  function entries(shared){
    const s=shared||{};
    return operationEntries(s.jobcards).concat(projectEntries(s.projects));
  }

  // ── Recall ───────────────────────────────────────────────────────────────────────────────
  // What the workshop did last time it took on work described like this. Returns null - not a
  // neutral-looking 1.0 - when nothing matches, because "no answer" and "on target" are
  // different answers.
  function recall(text,list,options){
    const opts=options||{};
    const threshold=typeof opts.threshold==='number'?opts.threshold:0.34;
    const matches=(Array.isArray(list)?list:[])
      .map(e=>Object.assign({score:similarity(text,e.desc)},e))
      .filter(e=>e.score>=threshold)
      .sort((a,b)=>b.score-a.score||b.actual-a.actual);
    if(!matches.length)return null;
    const planned=round1(matches.reduce((s,e)=>s+e.planned,0));
    const actual=round1(matches.reduce((s,e)=>s+e.actual,0));
    return {
      samples:matches.length,
      planned,actual,
      // How the estimate turned out, over the matched work as a whole rather than as an average
      // of ratios - one tiny job that ran double should not outweigh a large one that did not.
      factor:planned?round2(actual/planned):null,
      hoursPerJob:round1(actual/matches.length),
      // What a planner types into an estimate: days for one person.
      personDays:round1(actual/matches.length/DAY_HOURS),
      refs:[...new Set(matches.map(e=>e.ref))],
      matches
    };
  }

  // ── How the workshop's estimates run, by the kind of work ────────────────────────────────
  // Only finished projects, because only they have a final number of hours against them.
  function biasByType(projects){
    const seen=new Map();
    projectEntries(projects).forEach(p=>{
      const types=p.types.length?p.types:['—'];
      types.forEach(type=>{
        const rec=seen.get(type)||{type,samples:0,planned:0,actual:0,refs:[]};
        rec.samples++;rec.planned=round1(rec.planned+p.planned);rec.actual=round1(rec.actual+p.actual);
        rec.refs.push(p.ref);
        seen.set(type,rec);
      });
    });
    return [...seen.values()]
      .map(r=>Object.assign(r,{factor:r.planned?round2(r.actual/r.planned):null}))
      .sort((a,b)=>b.samples-a.samples||a.type.localeCompare(b.type));
  }

  // ── Proposing dates for a project's items ────────────────────────────────────────────────
  // One item after another at a stated number of hours a day, skipping weekends. Sequential is
  // the honest shape for a workshop this size: the same people move from one item to the next.
  // An item with no hours on it cannot be sized, so it is left undated and reported instead.
  function addDays(d,n){return new Date(d.getTime()+n*86400000);}
  function iso(d){return d.toISOString().slice(0,10);}
  function day(v){
    if(!v)return null;
    const d=new Date(v);
    return Number.isNaN(d.getTime())?null:new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));
  }
  const isWeekend=d=>d.getUTCDay()===0||d.getUTCDay()===6;
  function nextWorkday(d){let x=d;while(isWeekend(x))x=addDays(x,1);return x;}
  function workdaysFrom(start,count){
    let d=nextWorkday(start);
    for(let i=1;i<count;i++){d=nextWorkday(addDays(d,1));}
    return d;
  }
  function proposeSchedule(items,options){
    const opts=options||{};
    const hoursPerDay=Number(opts.hoursPerDay)>0?Number(opts.hoursPerDay):DAY_HOURS;
    let cursor=day(opts.start);
    if(!cursor)return {items:[],unsized:[],start:null,end:null,error:'no-start'};
    cursor=nextWorkday(cursor);
    const out=[],unsized=[];
    (Array.isArray(items)?items:[]).forEach(it=>{
      const hours=Number(it.hours)||0;
      if(hours<=0){unsized.push({no:it.no,title:it.title||''});return;}
      const days=Math.max(1,Math.ceil(hours/hoursPerDay));
      const start=nextWorkday(cursor);
      const end=workdaysFrom(start,days);
      out.push({no:it.no,title:it.title||'',hours:round1(hours),days,start:iso(start),end:iso(end)});
      cursor=addDays(end,1);
    });
    return {
      items:out,unsized,
      hoursPerDay,
      start:out.length?out[0].start:null,
      end:out.length?out[out.length-1].end:null,
      hours:round1(out.reduce((s,x)=>s+x.hours,0))
    };
  }

  const EstimateMemory={
    DAY_HOURS,
    tokens,similarity,
    operationEntries,projectEntries,entries,
    recall,biasByType,proposeSchedule
  };
  if(typeof module!=='undefined'&&module.exports)module.exports=EstimateMemory;
  if(global)global.EstimateMemory=EstimateMemory;
})(typeof window!=='undefined'?window:(typeof globalThis!=='undefined'?globalThis:this));
