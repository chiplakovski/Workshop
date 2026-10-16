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

  // ── The crew plan: who works on what, day by day ───────────────────────────────────────────
  // The week a crew view shows, Monday first, with or without the weekend.
  function crewDays(from,withWeekend){
    const first=weekStart(from);
    if(!first)return [];
    const out=[];
    for(let i=0;i<(withWeekend?7:5);i++)out.push(iso(addDays(first,i)));
    return out;
  }
  const CLOSED_JOB=['completed','closed','cancelled'];
  const nameOf=v=>String(v||'').trim();
  // Everything the crew view draws for one week, worked out from the records rather than kept anywhere:
  // a row per person, a cell per day, what is planned there, what was booked, and what is wrong with it.
  //   entries  — the crew plan (worker, day, jobcard, absence, hours)
  //   roster   — the names to list even with nothing planned
  //   jobcards — to name each job, check its dates and say how much work it still owes
  //   hours    — what was booked, so a day that has gone can be held against what was planned
  //   today    — ISO day; booked hours are only compared on days that have started
  //   dayLength— the ordinary day; more planned than this is overtime and is marked
  function crewWeek(input){
    const o=Object.assign({entries:[],roster:[],jobcards:[],hours:[],today:null,dayLength:8},input||{});
    const days=o.days&&o.days.length?o.days:crewDays(o.today,false);
    const inWeek=new Set(days);
    const jobs=new Map((o.jobcards||[]).map(j=>[j.no,j]));
    const week=(o.entries||[]).filter(e=>inWeek.has(e.day));
    const names=new Set((o.roster||[]).map(nameOf).filter(Boolean));
    week.forEach(e=>names.add(nameOf(e.worker)));
    const booked=(who,d)=>(o.hours||[]).filter(h=>nameOf(h.worker||h.user)===who&&String(h.date||'').slice(0,10)===d)
      .reduce((t,h)=>t+(Number(h.hours)||0),0);
    const rows=[...names].sort((a,b)=>a.localeCompare(b,'sv')).map(worker=>{
      const cells=days.map(d=>{
        const here=week.filter(e=>nameOf(e.worker)===worker&&e.day===d)
          .sort((a,b)=>(a.absence?1:0)-(b.absence?1:0)||String(a.jobcard||'').localeCompare(String(b.jobcard||'')));
        const planned=round1(here.filter(e=>!e.absence).reduce((t,e)=>t+(Number(e.hours)||0),0));
        const away=here.find(e=>e.absence)||null;
        const started=o.today&&d<=o.today;
        const logged=started?round1(booked(worker,d)):null;
        const warnings=[];
        if(planned>o.dayLength)warnings.push({code:'overtime',hours:round1(planned-o.dayLength)});
        if(away&&planned>0)warnings.push({code:'awayAndWork',absence:away.absence});
        here.filter(e=>e.jobcard).forEach(e=>{
          const j=jobs.get(e.jobcard);
          if(!j){warnings.push({code:'jobGone',job:e.jobcard});return;}
          if(CLOSED_JOB.indexOf(String(j.status))>=0||j.archived)warnings.push({code:'jobClosed',job:j.no,status:j.archived?'archived':j.status});
          const s=day(j.plannedStart),f=day(j.plannedCompletion||j.deliveryTarget),here_=day(d);
          if(s&&here_<s)warnings.push({code:'beforeJob',job:j.no,start:iso(s)});
          else if(f&&here_>f)warnings.push({code:'afterJob',job:j.no,end:iso(f)});
        });
        return {day:d,entries:here,planned,away,logged,warnings};
      });
      const planned=round1(cells.reduce((t,c)=>t+c.planned,0));
      const loggedDays=cells.filter(c=>c.logged!==null);
      return {worker,cells,planned,logged:loggedDays.length?round1(loggedDays.reduce((t,c)=>t+c.logged,0)):null,
        away:cells.filter(c=>c.away).length};
    });
    const dayTotals=days.map((d,i)=>({day:d,
      working:rows.filter(r=>r.cells[i].planned>0).length,
      away:rows.filter(r=>r.cells[i].away).length,
      hours:round1(rows.reduce((t,r)=>t+r.cells[i].planned,0))}));
    // The open jobs, and how many of their hours this week covers. A job somebody should be on — it is
    // running, or its dates fall in this week — with nobody planned on it is the thing worth seeing first.
    const from=days[0],to=days[days.length-1];
    const openJobs=(o.jobcards||[]).filter(j=>j&&j.no&&!j.archived&&CLOSED_JOB.indexOf(String(j.status))<0&&String(j.status)!=='draft');
    const jobRows=openJobs.map(j=>{
      const thisWeek=round1(week.filter(e=>e.jobcard===j.no).reduce((t,e)=>t+(Number(e.hours)||0),0));
      const bookedAll=(o.hours||[]).filter(h=>h.jobcard===j.no).reduce((t,h)=>t+(Number(h.hours)||0),0);
      const plannedHours=Number(j.plannedHours)||0;
      const remaining=plannedHours>0?round1(Math.max(0,plannedHours-bookedAll)):null;
      const s=iso(day(j.plannedStart)),f=iso(day(j.plannedCompletion||j.deliveryTarget));
      const due=String(j.status)==='in-progress'||String(j.status)==='ready'||(s&&f&&s<=to&&f>=from)||(s&&!f&&s<=to)||(!s&&f&&f>=from&&f<=to);
      const people=[...new Set(week.filter(e=>e.jobcard===j.no).map(e=>nameOf(e.worker)))];
      return {no:j.no,title:j.title||'',status:j.status,customer:j.customer||'',start:s,end:f,thisWeek,remaining,people,
        due:!!due,unplanned:!!due&&thisWeek===0,overplanned:remaining!==null&&thisWeek>remaining};
    }).filter(r=>r.due||r.thisWeek>0)
      .sort((a,b)=>(b.unplanned-a.unplanned)||String(a.end||'9999').localeCompare(String(b.end||'9999'))||a.no.localeCompare(b.no));
    return {days,rows,dayTotals,jobs:jobRows,
      planned:round1(rows.reduce((t,r)=>t+r.planned,0)),
      warnings:rows.reduce((t,r)=>t+r.cells.reduce((u,c)=>u+c.warnings.length,0),0)};
  }

  const PlanningRules={
    LANES,HIDDEN_STATUSES,
    laneOf,statusForLane,startOf,endOf,expectedOf,isScheduled,board,
    scheduleBar,schedule,
    weekStart,weeks,remainingHours,demandByWeek,loadByWeek,
    peopleOnPlan,machinesOnPlan,awaitingSchedule,
    itemsOf,itemSpan,itemFit,
    crewDays,crewWeek
  };
  if(typeof module!=='undefined'&&module.exports)module.exports=PlanningRules;
  if(global)global.PlanningRules=PlanningRules;
})(typeof window!=='undefined'?window:(typeof globalThis!=='undefined'?globalThis:this));
