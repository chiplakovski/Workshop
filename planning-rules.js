// Planning logic, kept out of the page so the module and the tests agree on it.
//
// Everything here reads the shared project records the rest of the workshop
// writes. Nothing invents a project, an employee, a machine or a utilisation
// figure: where the data does not support an answer, these functions say so
// rather than filling the gap with a plausible number.
(function(global){
  'use strict';

  const DAY=86400000;

  // The shared store carries nine project statuses that grew up in different
  // modules - production and active mean the same thing on the floor, as do
  // completed and closed. Planning needs a handful of lanes, so the mapping is
  // written down once, here, instead of being guessed at each render.
  const LANES=[
    {id:'toschedule',name:'To schedule',statuses:['quotation','approved']},
    {id:'planned',name:'Planned',statuses:['planned']},
    {id:'progress',name:'In progress',statuses:['active','production']},
    {id:'hold',name:'On hold',statuses:['hold']},
    {id:'done',name:'Done',statuses:['completed','closed']}
  ];
  // Cancelled work is not a stage of the plan; it is kept out of the board
  // rather than given a lane that would never be dragged out of.
  const HIDDEN_STATUSES=['cancelled'];
  // Dropping a card on a lane has to write one definite status back.
  const LANE_STATUS={toschedule:'quotation',planned:'planned',progress:'production',hold:'hold',done:'completed'};

  const iso=d=>{
    const x=d instanceof Date?d:new Date(d);
    return Number.isNaN(x.getTime())?null:x.toISOString().slice(0,10);
  };
  const day=v=>{
    if(!v)return null;
    const d=new Date(v);
    return Number.isNaN(d.getTime())?null:new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));
  };
  const addDays=(d,n)=>new Date(d.getTime()+n*DAY);
  const round1=n=>Math.round((Number(n)||0)*10)/10;

  function laneOf(project){
    const status=String((project&&project.status)||'').toLowerCase();
    const lane=LANES.find(l=>l.statuses.includes(status));
    if(lane)return lane.id;
    if(HIDDEN_STATUSES.includes(status))return null;
    // An unrecognised status is surfaced as needing attention rather than
    // silently dropped off the board.
    return 'toschedule';
  }
  function statusForLane(laneId){return LANE_STATUS[laneId]||null;}

  // The schedule a project carries is spelled differently depending on which
  // module wrote it: the seeded records use start/deadline, while Estimating's
  // scheduling step writes plannedStart/plannedCompletion. Both are the same
  // fact, so they are read through one pair of accessors instead of each
  // function picking its own favourite field.
  function startOf(project){return project?day(project.start||project.plannedStart):null;}
  function endOf(project){return project?day(project.deadline||project.plannedCompletion||project.expectedCompletion):null;}
  function expectedOf(project){return project?day(project.expectedCompletion||project.plannedCompletion):null;}

  // A project with no dates cannot be drawn on a schedule. Rather than invent
  // a span, it is reported as unscheduled so the board can ask for the dates.
  function isScheduled(project){
    return Boolean(startOf(project)&&endOf(project));
  }

  function board(projects){
    const list=Array.isArray(projects)?projects:[];
    return LANES.map(lane=>({
      id:lane.id,name:lane.name,
      projects:list.filter(p=>laneOf(p)===lane.id)
    }));
  }

  // One bar per project, from its own dates - and only for projects the board
  // shows, so cancelled work does not sit on the schedule taking up a slot.
  // expectedCompletion is drawn
  // alongside the deadline when the two disagree, because that gap is the
  // thing a planner needs to see.
  function scheduleBar(project){
    if(!isScheduled(project))return null;
    const start=startOf(project);
    const end=endOf(project);
    if(end<start)return null;
    const expected=expectedOf(project);
    const days=Math.round((end-start)/DAY)+1;
    return {
      no:project.no,name:project.name,
      start:iso(start),end:iso(end),days,
      expected:expected?iso(expected):null,
      late:Boolean(expected&&expected>end),
      overrunDays:expected&&expected>end?Math.round((expected-end)/DAY):0,
      progress:Math.max(0,Math.min(100,Number(project.progress)||0)),
      plannedHours:Number(project.plannedHours)||0,
      usedHours:Number(project.usedHours)||0
    };
  }
  function schedule(projects){
    return (Array.isArray(projects)?projects:[])
      .filter(p=>laneOf(p)!==null)
      .map(scheduleBar).filter(Boolean)
      .sort((a,b)=>a.start.localeCompare(b.start)||a.no.localeCompare(b.no));
  }

  // The Monday of the week a date falls in, so weeks line up however the
  // browser's locale feels about the first day.
  function weekStart(value){
    const d=day(value);
    if(!d)return null;
    const dow=(d.getUTCDay()+6)%7;
    return addDays(d,-dow);
  }
  function weeks(from,count){
    const first=weekStart(from);
    if(!first)return [];
    const out=[];
    for(let i=0;i<count;i++){
      const s=addDays(first,i*7);
      out.push({start:iso(s),end:iso(addDays(s,6))});
    }
    return out;
  }

  // How many hours of work a project still owes, spread evenly over the days
  // it has left. Even is a simplification and an honest one: without a task
  // breakdown there is nothing to weight the spread by, and the seeded
  // projects carry no tasks.
  function remainingHours(project){
    const planned=Number(project.plannedHours)||0;
    const used=Number(project.usedHours)||0;
    return Math.max(0,planned-used);
  }

  // Weekly demand in hours, from the projects that overlap each week. Returns
  // demand only - supply is the caller's to state, because the workshop's own
  // hours per week is a fact about the business, not about the data.
  function demandByWeek(projects,from,count){
    const buckets=weeks(from,count).map(w=>({...w,hours:0,projects:[]}));
    if(!buckets.length)return buckets;
    (Array.isArray(projects)?projects:[]).forEach(p=>{
      if(!isScheduled(p))return;
      if(laneOf(p)==='done'||laneOf(p)===null)return;
      const start=startOf(p),end=endOf(p);
      const days=Math.round((end-start)/DAY)+1;
      const perDay=remainingHours(p)/days;
      if(!perDay)return;
      buckets.forEach(b=>{
        const bs=day(b.start),be=day(b.end);
        const from=start>bs?start:bs;
        const to=end<be?end:be;
        if(to<from)return;
        const overlap=Math.round((to-from)/DAY)+1;
        b.hours=round1(b.hours+perDay*overlap);
        if(b.projects.indexOf(p.no)<0)b.projects.push(p.no);
      });
    });
    return buckets;
  }

  // Demand against a stated supply. hoursPerWeek is what the workshop can
  // actually put in; with no figure given the load is left null rather than
  // reported as a percentage of nothing.
  function loadByWeek(projects,from,count,hoursPerWeek){
    const supply=Number(hoursPerWeek)>0?Number(hoursPerWeek):null;
    return demandByWeek(projects,from,count).map(b=>({
      ...b,
      capacity:supply,
      load:supply?Math.round(b.hours/supply*100):null,
      over:supply?b.hours>supply:false
    }));
  }

  // Who and what the plan actually names, taken from the projects themselves
  // rather than from a list of staff nobody maintains.
  function peopleOnPlan(projects){
    const seen=new Map();
    (Array.isArray(projects)?projects:[]).forEach(p=>{
      if(laneOf(p)==='done'||laneOf(p)===null)return;
      const names=[].concat(p.responsible?[p.responsible]:[],Array.isArray(p.workers)?p.workers:[]);
      names.filter(Boolean).forEach(n=>{
        const rec=seen.get(n)||{name:n,projects:[],hours:0};
        if(rec.projects.indexOf(p.no)<0){rec.projects.push(p.no);rec.hours=round1(rec.hours+remainingHours(p));}
        seen.set(n,rec);
      });
    });
    return [...seen.values()].sort((a,b)=>b.hours-a.hours||a.name.localeCompare(b.name));
  }
  function machinesOnPlan(projects,equipment){
    const fleet=Array.isArray(equipment)?equipment:[];
    const seen=new Map();
    (Array.isArray(projects)?projects:[]).forEach(p=>{
      if(laneOf(p)==='done'||laneOf(p)===null)return;
      (Array.isArray(p.machines)?p.machines:[]).forEach(m=>{
        const name=typeof m==='string'?m:(m&&(m.name||m.equipmentId));
        if(!name)return;
        const rec=seen.get(name)||{name,projects:[],equipment:null};
        if(rec.projects.indexOf(p.no)<0)rec.projects.push(p.no);
        // Tie the name back to a real machine where one matches, so the page
        // can show its status instead of just a label.
        if(!rec.equipment)rec.equipment=fleet.find(e=>e.name===name||e.equipmentId===name)||null;
        seen.set(name,rec);
      });
    });
    return [...seen.values()].sort((a,b)=>b.projects.length-a.projects.length||a.name.localeCompare(b.name));
  }

  // ── A project's items ────────────────────────────────────────────────────
  // A project's work is broken into items, and they are recorded in two places
  // depending on when the project was made: the ones Estimating creates become
  // real jobcards in the shared register, while the older records carry their
  // own list on the project itself. Both are the same thing to a planner, so
  // they are read as one list here - and each item remembers which list it came
  // from, because that decides where a date typed against it has to be written.
  function itemsOf(project,jobcards){
    if(!project)return [];
    const registered=(Array.isArray(jobcards)?jobcards:[])
      .filter(j=>j&&!j.archived&&String(j.projectNo||'')===String(project.no))
      .map(j=>({
        no:j.no,title:j.title||j.item||'',source:'jobcard',
        start:j.plannedStart?iso(day(j.plannedStart)):'',
        end:j.plannedCompletion?iso(day(j.plannedCompletion)):'',
        hours:Number(j.plannedHours)||0,
        progress:Math.max(0,Math.min(100,Number(j.progress)||0)),
        status:j.status||'',responsible:j.responsible||''
      }));
    const known=new Set(registered.map(x=>x.no));
    const own=(Array.isArray(project.jobcards)?project.jobcards:[])
      .filter(j=>j&&j.no&&!known.has(j.no))
      .map(j=>({
        no:j.no,title:j.desc||j.title||'',source:'project',
        start:j.plannedStart?iso(day(j.plannedStart)):'',
        end:j.plannedCompletion?iso(day(j.plannedCompletion)):'',
        hours:Number(j.est)||Number(j.plannedHours)||0,
        progress:Math.max(0,Math.min(100,Number(j.progress)||0)),
        status:j.status||'',responsible:j.assigned||''
      }));
    return registered.concat(own);
  }
  // The span the items themselves describe, for comparing against the span the
  // project claims. Null when no item carries both of its dates - there is
  // nothing to compare, and nothing worth guessing.
  function itemSpan(items){
    const dated=(Array.isArray(items)?items:[]).filter(i=>i.start&&i.end&&day(i.start)&&day(i.end));
    if(!dated.length)return null;
    const starts=dated.map(i=>day(i.start).getTime());
    const ends=dated.map(i=>day(i.end).getTime());
    return {start:iso(new Date(Math.min(...starts))),end:iso(new Date(Math.max(...ends))),counted:dated.length};
  }
  // An item outside the project's own span is worth saying out loud rather than
  // silently moving one end or the other.
  function itemFit(project,item){
    if(!project||!item||!item.start||!item.end)return {dated:false,before:false,after:false};
    const ps=startOf(project),pe=endOf(project);
    const is=day(item.start),ie=day(item.end);
    if(!is||!ie)return {dated:false,before:false,after:false};
    return {dated:true,reversed:ie<is,
      before:Boolean(ps&&is<ps),after:Boolean(pe&&ie>pe)};
  }

  // What is waiting to be scheduled: accepted quotes with no project yet, and
  // projects that exist but have no dates on them.
  function awaitingSchedule(projects,estimations){
    const list=Array.isArray(projects)?projects:[];
    const quotes=(Array.isArray(estimations)?estimations:[])
      .filter(e=>String(e.status||'').toLowerCase()==='accepted'&&!e.projectId)
      .map(e=>({kind:'estimation',id:e.id,no:e.no||e.ref||`EST-${e.id}`,name:e.title||e.name||'',customer:e.customer||''}));
    const undated=list
      .filter(p=>laneOf(p)&&laneOf(p)!=='done'&&!isScheduled(p))
      .map(p=>({kind:'project',no:p.no,name:p.name||'',customer:p.customer||'',
        missing:[startOf(p)?null:'start',endOf(p)?null:'deadline'].filter(Boolean)}));
    return quotes.concat(undated);
  }

  const PlanningRules={
    LANES,HIDDEN_STATUSES,
    laneOf,statusForLane,startOf,endOf,expectedOf,isScheduled,board,
    scheduleBar,schedule,
    weekStart,weeks,remainingHours,demandByWeek,loadByWeek,
    peopleOnPlan,machinesOnPlan,awaitingSchedule,
    itemsOf,itemSpan,itemFit
  };
  if(typeof module!=='undefined'&&module.exports)module.exports=PlanningRules;
  if(global)global.PlanningRules=PlanningRules;
})(typeof window!=='undefined'?window:(typeof globalThis!=='undefined'?globalThis:this));
