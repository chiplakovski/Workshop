// Pure logic tests for the Planning module's rules (planning-rules.js). Two halves:
//
//  1. synthetic projects, to pin down each rule on its own — lane mapping, schedule bars, weekly
//     demand, what counts as unscheduled;
//  2. the real seeded projects loaded through workshop-data.js (see tests/helpers), because the
//     point of this module is that Planning stops inventing figures: if the shared data says a
//     project has no dates, or nobody has stated an hours-per-week supply, these functions must
//     say so rather than produce a plausible number.
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Planning=require('../planning-rules.js');
const {loadWorkshopData}=require('./helpers/load-workshop-data');

function proj(overrides){
  return Object.assign({no:'P-TEST-1',name:'Test project',status:'planned',
    start:'2026-09-07',deadline:'2026-09-18',expectedCompletion:'2026-09-18',
    progress:0,plannedHours:40,usedHours:0,responsible:'',workers:[],machines:[]},overrides);
}

// ── laneOf: the nine statuses the shared store actually carries ───────────────────────────────
test('lane: the statuses that mean the same thing on the floor share a lane', ()=>{
  assert.equal(Planning.laneOf(proj({status:'quotation'})),'toschedule');
  assert.equal(Planning.laneOf(proj({status:'approved'})),'toschedule');
  assert.equal(Planning.laneOf(proj({status:'planned'})),'planned');
  assert.equal(Planning.laneOf(proj({status:'active'})),'progress');
  assert.equal(Planning.laneOf(proj({status:'production'})),'progress','production and active are one lane');
  assert.equal(Planning.laneOf(proj({status:'hold'})),'hold');
  assert.equal(Planning.laneOf(proj({status:'completed'})),'done');
  assert.equal(Planning.laneOf(proj({status:'closed'})),'done','closed and completed are one lane');
});
test('lane: status matching ignores case, as the store is not consistent about it', ()=>{
  assert.equal(Planning.laneOf(proj({status:'Production'})),'progress');
  assert.equal(Planning.laneOf(proj({status:'HOLD'})),'hold');
});
test('lane: cancelled work is kept off the board rather than given a lane', ()=>{
  assert.equal(Planning.laneOf(proj({status:'cancelled'})),null);
  assert.equal(Planning.laneOf(proj({status:'Cancelled'})),null);
});
test('lane: an unrecognised status surfaces as needing attention, never silently dropped', ()=>{
  assert.equal(Planning.laneOf(proj({status:'awaiting-parts'})),'toschedule');
  assert.equal(Planning.laneOf(proj({status:''})),'toschedule');
  assert.equal(Planning.laneOf({}),'toschedule');
  assert.equal(Planning.laneOf(null),'toschedule');
});
test('lane: every lane can be dropped on, and maps back to one definite status', ()=>{
  Planning.LANES.forEach(lane=>{
    const status=Planning.statusForLane(lane.id);
    assert.ok(status,`lane ${lane.id} must write a status back`);
    assert.equal(Planning.laneOf({status}),lane.id,`${status} must land back in ${lane.id}`);
  });
  assert.equal(Planning.statusForLane('nonsense'),null);
});

// ── board ────────────────────────────────────────────────────────────────────────────────────
test('board: returns every lane, in order, even the empty ones', ()=>{
  const b=Planning.board([proj({no:'A',status:'planned'})]);
  assert.deepEqual(b.map(l=>l.id),Planning.LANES.map(l=>l.id));
  assert.deepEqual(b.find(l=>l.id==='planned').projects.map(p=>p.no),['A']);
  assert.deepEqual(b.find(l=>l.id==='done').projects,[],'an empty lane is still a lane');
});
test('board: a project appears in exactly one lane, and cancelled in none', ()=>{
  const list=[proj({no:'A',status:'production'}),proj({no:'B',status:'cancelled'}),proj({no:'C',status:'closed'})];
  const placed=Planning.board(list).flatMap(l=>l.projects.map(p=>p.no));
  assert.deepEqual(placed.sort(),['A','C']);
});
test('board: no projects gives empty lanes, not an error', ()=>{
  assert.deepEqual(Planning.board(null).map(l=>l.projects.length),[0,0,0,0,0]);
});

// ── isScheduled / scheduleBar ────────────────────────────────────────────────────────────────
test('schedule: a project needs both ends of its own span before it can be drawn', ()=>{
  assert.equal(Planning.isScheduled(proj({})),true);
  assert.equal(Planning.isScheduled(proj({start:''})),false,'no start');
  assert.equal(Planning.isScheduled(proj({deadline:'',expectedCompletion:''})),false,'no end');
  assert.equal(Planning.isScheduled(proj({deadline:'',expectedCompletion:'2026-09-20'})),true,
    'expectedCompletion stands in when no deadline is set');
  assert.equal(Planning.isScheduled(proj({start:'not a date'})),false);
  assert.equal(Planning.isScheduled(null),false);
});
test('schedule: the two spellings of a schedule are read as the same fact', ()=>{
  // Estimating's scheduling step writes plannedStart/plannedCompletion; the seeded records use
  // start/deadline. A project scheduled through Estimating must appear on the plan, not be
  // reported as missing its dates.
  const viaEstimating={no:'P-EST-1',status:'planned',start:'',deadline:'',
    plannedStart:'2026-10-01',plannedCompletion:'2026-11-08',plannedHours:40,usedHours:0};
  assert.equal(Planning.isScheduled(viaEstimating),true);
  const bar=Planning.scheduleBar(viaEstimating);
  assert.equal(bar.start,'2026-10-01');
  assert.equal(bar.end,'2026-11-08');
  assert.deepEqual(Planning.awaitingSchedule([viaEstimating],[]),[],'a scheduled project is not waiting');
  // deadline still wins where both are present, because that is the date given to the customer.
  const both=Object.assign({},viaEstimating,{deadline:'2026-11-02'});
  assert.equal(Planning.scheduleBar(both).end,'2026-11-02');
  assert.equal(Planning.scheduleBar(both).late,true,'a later planned completion than the deadline is an overrun');
  assert.equal(Planning.scheduleBar(both).overrunDays,6);
});
test('schedule: a bar spans its own dates inclusively', ()=>{
  const bar=Planning.scheduleBar(proj({start:'2026-09-07',deadline:'2026-09-07'}));
  assert.equal(bar.days,1,'a one-day job is one day long, not zero');
  assert.equal(Planning.scheduleBar(proj({start:'2026-09-07',deadline:'2026-09-18'})).days,12);
});
test('schedule: an unscheduled project produces no bar instead of an invented span', ()=>{
  assert.equal(Planning.scheduleBar(proj({start:'',deadline:''})),null);
  assert.equal(Planning.scheduleBar(proj({start:'2026-09-18',deadline:'2026-09-07'})),null,'end before start is not a span');
});
test('schedule: the gap between deadline and expected completion is reported, not hidden', ()=>{
  const late=Planning.scheduleBar(proj({deadline:'2026-09-18',expectedCompletion:'2026-09-25'}));
  assert.equal(late.late,true);
  assert.equal(late.overrunDays,7);
  const ontime=Planning.scheduleBar(proj({deadline:'2026-09-18',expectedCompletion:'2026-09-18'}));
  assert.equal(ontime.late,false);
  assert.equal(ontime.overrunDays,0);
  const early=Planning.scheduleBar(proj({deadline:'2026-09-18',expectedCompletion:'2026-09-15'}));
  assert.equal(early.late,false,'finishing before the deadline is not an overrun');
});
test('schedule: progress is carried through, clamped to a percentage', ()=>{
  assert.equal(Planning.scheduleBar(proj({progress:62})).progress,62);
  assert.equal(Planning.scheduleBar(proj({progress:140})).progress,100);
  assert.equal(Planning.scheduleBar(proj({progress:-5})).progress,0);
  assert.equal(Planning.scheduleBar(proj({progress:null})).progress,0);
});
test('schedule: bars come back in date order, and cancelled work is not among them', ()=>{
  const bars=Planning.schedule([
    proj({no:'C',start:'2026-09-14'}),
    proj({no:'A',start:'2026-09-01'}),
    proj({no:'X',status:'cancelled',start:'2026-09-02'}),
    proj({no:'B',start:'2026-09-07'}),
    proj({no:'D',start:'',deadline:''})
  ]);
  assert.deepEqual(bars.map(b=>b.no),['A','B','C'],'undated and cancelled projects are left out');
});

// ── weeks ────────────────────────────────────────────────────────────────────────────────────
test('weeks: a week starts on Monday whatever day is asked for', ()=>{
  assert.equal(Planning.weekStart('2026-09-13').toISOString().slice(0,10),'2026-09-07','Sunday belongs to the week before');
  assert.equal(Planning.weekStart('2026-09-07').toISOString().slice(0,10),'2026-09-07','Monday is its own start');
  assert.equal(Planning.weekStart('2026-09-08').toISOString().slice(0,10),'2026-09-07');
  assert.equal(Planning.weekStart('nonsense'),null);
});
test('weeks: consecutive Monday-to-Sunday spans, no gaps', ()=>{
  const w=Planning.weeks('2026-09-09',3);
  assert.deepEqual(w,[
    {start:'2026-09-07',end:'2026-09-13'},
    {start:'2026-09-14',end:'2026-09-20'},
    {start:'2026-09-21',end:'2026-09-27'}
  ]);
  assert.deepEqual(Planning.weeks('bad',4),[]);
});

// ── remainingHours / demandByWeek ────────────────────────────────────────────────────────────
test('demand: only the hours still owed are spread, never the hours already worked', ()=>{
  assert.equal(Planning.remainingHours(proj({plannedHours:80,usedHours:25})),55);
  assert.equal(Planning.remainingHours(proj({plannedHours:24,usedHours:30})),0,'an overrun owes nothing more, it does not owe less than nothing');
});
test('demand: a project spread over its own span lands in the weeks it overlaps', ()=>{
  // 14 days, 70 hours left -> 5 h/day; the first week takes 7 days of it.
  const weeks=Planning.demandByWeek([proj({no:'A',start:'2026-09-07',deadline:'2026-09-20',plannedHours:70,usedHours:0})],'2026-09-07',3);
  assert.equal(weeks[0].hours,35);
  assert.equal(weeks[1].hours,35);
  assert.equal(weeks[2].hours,0,'a week the project does not touch gets nothing');
  assert.deepEqual(weeks[0].projects,['A']);
  assert.deepEqual(weeks[2].projects,[]);
});
test('demand: a week is only charged for the days the project actually overlaps it', ()=>{
  // starts Thursday: 4 of the first week's days (Thu-Sun) out of an 11-day span
  const weeks=Planning.demandByWeek([proj({start:'2026-09-10',deadline:'2026-09-20',plannedHours:110,usedHours:0})],'2026-09-07',2);
  assert.equal(weeks[0].hours,40);
  assert.equal(weeks[1].hours,70);
});
test('demand: finished, cancelled and undated work adds nothing', ()=>{
  const weeks=Planning.demandByWeek([
    proj({no:'DONE',status:'completed',plannedHours:100,usedHours:0,start:'2026-09-07',deadline:'2026-09-13'}),
    proj({no:'GONE',status:'cancelled',plannedHours:100,usedHours:0,start:'2026-09-07',deadline:'2026-09-13'}),
    proj({no:'NODATES',plannedHours:100,usedHours:0,start:'',deadline:'',expectedCompletion:''})
  ],'2026-09-07',2);
  assert.equal(weeks[0].hours,0);
  assert.deepEqual(weeks[0].projects,[],'a project contributing no hours is not listed as loading the week');
});
test('demand: a project with nothing left to do does not pad the week it sits in', ()=>{
  const weeks=Planning.demandByWeek([proj({plannedHours:40,usedHours:40,start:'2026-09-07',deadline:'2026-09-13'})],'2026-09-07',1);
  assert.equal(weeks[0].hours,0);
});

// ── loadByWeek: the honesty rule ─────────────────────────────────────────────────────────────
test('load: with no stated hours per week, load is null - not a percentage of nothing', ()=>{
  const weeks=Planning.loadByWeek([proj({plannedHours:70,usedHours:0,start:'2026-09-07',deadline:'2026-09-13'})],'2026-09-07',1);
  assert.equal(weeks[0].hours,70,'the demand is still known');
  assert.equal(weeks[0].capacity,null);
  assert.equal(weeks[0].load,null);
  assert.equal(weeks[0].over,false);
  [0,-40,null,undefined,'','abc'].forEach(v=>{
    assert.equal(Planning.loadByWeek([],'2026-09-07',1,v)[0].load,null,`supply ${JSON.stringify(v)} states nothing`);
  });
});
test('load: against a stated supply, load is that percentage and overload is flagged', ()=>{
  const weeks=Planning.loadByWeek([proj({plannedHours:70,usedHours:0,start:'2026-09-07',deadline:'2026-09-13'})],'2026-09-07',2,140);
  assert.equal(weeks[0].capacity,140);
  assert.equal(weeks[0].load,50);
  assert.equal(weeks[0].over,false);
  const tight=Planning.loadByWeek([proj({plannedHours:210,usedHours:0,start:'2026-09-07',deadline:'2026-09-13'})],'2026-09-07',1,140);
  assert.equal(tight[0].load,150);
  assert.equal(tight[0].over,true);
});

// ── peopleOnPlan / machinesOnPlan ────────────────────────────────────────────────────────────
test('people: the plan names its own people, counted once each, hours not double-counted', ()=>{
  const people=Planning.peopleOnPlan([
    proj({no:'A',responsible:'Aleksandar C.',workers:['Marko K.'],plannedHours:40,usedHours:0}),
    proj({no:'B',responsible:'Aleksandar C.',workers:['Marko K.','Elena N.'],plannedHours:10,usedHours:0})
  ]);
  assert.deepEqual(people.map(p=>p.name),['Aleksandar C.','Marko K.','Elena N.']);
  assert.equal(people[0].hours,50);
  assert.deepEqual(people[0].projects,['A','B']);
  assert.equal(people.find(p=>p.name==='Elena N.').hours,10);
});
test('people: finished and cancelled work does not keep someone busy', ()=>{
  assert.deepEqual(Planning.peopleOnPlan([
    proj({no:'A',status:'completed',responsible:'X'}),
    proj({no:'B',status:'cancelled',responsible:'Y'})
  ]),[]);
});
test('machines: a label is tied back to a register record where one matches, and honestly not where none does', ()=>{
  const fleet=[{equipmentId:'E-1',name:'Press Brake',status:'Available'}];
  const list=Planning.machinesOnPlan([proj({no:'A',machines:['Press Brake','Bandsaw']})],fleet);
  assert.equal(list.find(m=>m.name==='Press Brake').equipment.equipmentId,'E-1');
  assert.equal(list.find(m=>m.name==='Bandsaw').equipment,null,'an unregistered machine is reported as unmatched, not invented');
});
test('machines: the busiest machine comes first, and each is listed once', ()=>{
  const list=Planning.machinesOnPlan([
    proj({no:'A',machines:['Press Brake','Laser Cutting Machine']}),
    proj({no:'B',machines:['Press Brake']})
  ],[]);
  assert.deepEqual(list.map(m=>m.name),['Press Brake','Laser Cutting Machine']);
  assert.deepEqual(list[0].projects,['A','B']);
});

// ── awaitingSchedule ─────────────────────────────────────────────────────────────────────────
test('awaiting: an accepted quote with no project yet is waiting to be scheduled', ()=>{
  const out=Planning.awaitingSchedule([],[
    {id:1,no:'EST-1',status:'accepted',projectId:null,title:'Platform',customer:'ACME'},
    {id:2,no:'EST-2',status:'accepted',projectId:14},
    {id:3,no:'EST-3',status:'draft',projectId:null}
  ]);
  assert.deepEqual(out.map(x=>x.no),['EST-1']);
  assert.equal(out[0].kind,'estimation');
});
test('awaiting: a project with no dates says which date it is missing', ()=>{
  const out=Planning.awaitingSchedule([
    proj({no:'A'}),
    proj({no:'B',deadline:'',expectedCompletion:''}),
    proj({no:'C',start:'',deadline:'',expectedCompletion:''}),
    proj({no:'D',status:'completed',start:'',deadline:'',expectedCompletion:''})
  ],[]);
  assert.deepEqual(out.map(x=>x.no),['B','C'],'scheduled and finished projects are not waiting');
  assert.deepEqual(out.find(x=>x.no==='B').missing,['deadline']);
  assert.deepEqual(out.find(x=>x.no==='C').missing,['start','deadline']);
});

// ── a project's items ────────────────────────────────────────────────────────────────────────
test('items: the two places a project keeps its work are read as one list', ()=>{
  const project=proj({no:'P-1',jobcards:[{no:'JC-OLD',desc:'Cut frame',assigned:'Marko K.',est:8,progress:50,status:'active'}]});
  const items=Planning.itemsOf(project,[{no:'JC-NEW',projectNo:'P-1',title:'Weld frame',plannedHours:12,plannedStart:'2026-09-07',plannedCompletion:'2026-09-11',progress:0,status:'ready',responsible:'Elena N.'}]);
  assert.deepEqual(items.map(i=>i.no),['JC-NEW','JC-OLD'],'registered jobcards first, then the ones only the project knows about');
  assert.equal(items[0].source,'jobcard');
  assert.equal(items[0].title,'Weld frame');
  assert.equal(items[0].start,'2026-09-07');
  assert.equal(items[0].hours,12);
  assert.equal(items[1].source,'project','an item only the project carries must say so, because that is where a date goes back');
  assert.equal(items[1].title,'Cut frame','the older records call it desc');
  assert.equal(items[1].hours,8,'and call its hours est');
  assert.equal(items[1].responsible,'Marko K.');
  assert.equal(items[1].start,'','an item with no dates reports none rather than today');
});
test('items: a jobcard registered for the project wins over the project\'s own copy of it', ()=>{
  const project=proj({no:'P-1',jobcards:[{no:'JC-1',desc:'Stale copy',est:4}]});
  const items=Planning.itemsOf(project,[{no:'JC-1',projectNo:'P-1',title:'The real one',plannedHours:9}]);
  assert.equal(items.length,1,'the same item must not appear twice');
  assert.equal(items[0].title,'The real one');
  assert.equal(items[0].source,'jobcard');
});
test('items: only this project, and nothing archived', ()=>{
  const cards=[{no:'A',projectNo:'P-1',title:'Mine'},{no:'B',projectNo:'P-2',title:'Someone else'},
    {no:'C',projectNo:'P-1',title:'Archived',archived:true}];
  assert.deepEqual(Planning.itemsOf(proj({no:'P-1'}),cards).map(i=>i.no),['A']);
  assert.deepEqual(Planning.itemsOf(null,cards),[]);
  assert.deepEqual(Planning.itemsOf(proj({no:'P-9'}),cards),[]);
});
test('items: the span the items describe, or nothing when they do not describe one', ()=>{
  const items=[{no:'A',start:'2026-09-07',end:'2026-09-18'},{no:'B',start:'2026-09-14',end:'2026-10-02'},{no:'C',start:'',end:''}];
  assert.deepEqual(Planning.itemSpan(items),{start:'2026-09-07',end:'2026-10-02',counted:2},'half-dated items are left out of the span, not guessed at');
  assert.equal(Planning.itemSpan([{no:'A',start:'2026-09-07',end:''}]),null);
  assert.equal(Planning.itemSpan([]),null);
  assert.equal(Planning.itemSpan(null),null);
});
test('items: an item that falls outside its project is reported, not quietly moved', ()=>{
  const project=proj({start:'2026-09-07',deadline:'2026-09-30'});
  assert.deepEqual(Planning.itemFit(project,{start:'2026-09-10',end:'2026-09-20'}),{dated:true,reversed:false,before:false,after:false});
  assert.equal(Planning.itemFit(project,{start:'2026-09-01',end:'2026-09-20'}).before,true);
  assert.equal(Planning.itemFit(project,{start:'2026-09-10',end:'2026-10-08'}).after,true);
  assert.equal(Planning.itemFit(project,{start:'2026-09-20',end:'2026-09-10'}).reversed,true);
  assert.equal(Planning.itemFit(project,{start:'',end:''}).dated,false,'an undated item cannot be out of range');
});

// ── against the real seeded data ──────────────────────────────────────────────────────────────
test('real data: every seeded project is either on the board or deliberately hidden', ()=>{
  const WD=loadWorkshopData();
  const projects=WD.get().projects;
  assert.ok(projects.length>0);
  const onBoard=Planning.board(projects).flatMap(l=>l.projects.map(p=>p.no));
  const hidden=projects.filter(p=>Planning.laneOf(p)===null).map(p=>p.no);
  assert.equal(onBoard.length+hidden.length,projects.length,'no project may fall through the mapping');
  assert.equal(new Set(onBoard).size,onBoard.length,'no project may appear in two lanes');
  projects.filter(p=>String(p.status).toLowerCase()==='cancelled').forEach(p=>{
    assert.ok(hidden.includes(p.no),`${p.no} is cancelled and must not be on the board`);
  });
});
test('real data: the schedule is drawn only from projects that carry their own dates', ()=>{
  const WD=loadWorkshopData();
  const projects=WD.get().projects;
  const bars=Planning.schedule(projects);
  const expected=projects.filter(p=>Planning.laneOf(p)!==null&&Planning.isScheduled(p)).length;
  assert.equal(bars.length,expected);
  bars.forEach(b=>{
    const p=projects.find(x=>x.no===b.no);
    assert.equal(b.start,p.start,'a bar starts where the project says it starts');
    assert.ok(b.days>0);
  });
  const dated=[...bars].sort((a,b)=>a.start.localeCompare(b.start)).map(b=>b.no);
  assert.deepEqual(bars.map(b=>b.no),dated,'bars must come back in date order');
});
test('real data: the undated seeded project is reported as awaiting a date, not given one', ()=>{
  const WD=loadWorkshopData();
  const waiting=Planning.awaitingSchedule(WD.get().projects,WD.get().estimations);
  const undated=WD.get().projects.filter(p=>Planning.laneOf(p)&&Planning.laneOf(p)!=='done'&&!Planning.isScheduled(p));
  assert.ok(undated.length>0,'the seed is expected to contain a project with a missing date');
  undated.forEach(p=>{
    const row=waiting.find(w=>w.kind==='project'&&w.no===p.no);
    assert.ok(row,`${p.no} has no full span and must be listed as awaiting scheduling`);
    assert.ok(row.missing.length>0,'the row must say which date is missing');
  });
  const quotes=waiting.filter(w=>w.kind==='estimation');
  quotes.forEach(q=>{
    const e=WD.get().estimations.find(x=>(x.no||'')===q.no||x.id===q.id);
    assert.equal(String(e.status).toLowerCase(),'accepted');
    assert.ok(!e.projectId,'a quote that already became a project is not waiting');
  });
});
test('real data: weekly demand never exceeds the hours the projects actually owe', ()=>{
  const WD=loadWorkshopData();
  const projects=WD.get().projects;
  // A window wide enough to contain every seeded span, so nothing falls outside it.
  const weeks=Planning.demandByWeek(projects,'2026-01-05',104);
  const spread=weeks.reduce((s,w)=>s+w.hours,0);
  const owed=projects.filter(p=>Planning.laneOf(p)&&Planning.laneOf(p)!=='done'&&Planning.isScheduled(p))
    .reduce((s,p)=>s+Planning.remainingHours(p),0);
  assert.ok(Math.abs(spread-owed)<1,`spread ${spread} h must match the ${owed} h the projects owe`);
});
test('real data: each person on the plan appears once, under one name', ()=>{
  const WD=loadWorkshopData();
  const people=Planning.peopleOnPlan(WD.get().projects);
  assert.ok(people.length>0);
  const names=people.map(p=>p.name);
  assert.equal(new Set(names).size,names.length);
  // The same person under two spellings would read as two people with two workloads, which is
  // exactly the kind of invented figure this module exists to avoid.
  names.forEach(a=>names.forEach(b=>{
    if(a===b)return;
    assert.ok(!a.startsWith(b.replace(/\.$/,''))&&!b.startsWith(a.replace(/\.$/,'')),
      `"${a}" and "${b}" look like the same person under two names`);
  }));
});
test('real data: every machine the plan names exists in the equipment register', ()=>{
  const WD=loadWorkshopData();
  const machines=Planning.machinesOnPlan(WD.get().projects,WD.get().equipment);
  assert.ok(machines.length>0,'the seed is expected to book work on machines');
  machines.forEach(m=>{
    assert.ok(m.equipment,`"${m.name}" is booked on a project but is not in the equipment register`);
    assert.ok(m.equipment.status,'a matched machine must bring its real status with it');
  });
});
