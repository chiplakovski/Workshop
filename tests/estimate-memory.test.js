// Pure logic tests for estimate-memory.js — what the workshop can tell an estimator about its own
// past work. Two halves: synthetic records that pin each rule down, and the real seeded data,
// which is deliberately thin. The point of the module is that thin evidence is reported as thin
// rather than dressed up as a trend, so the seeded half checks exactly that.
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Memory=require('../estimate-memory.js');
const {loadWorkshopData}=require('./helpers/load-workshop-data');

const op=(o)=>Object.assign({desc:'Cutting',plannedHours:10,loggedHours:10,status:'completed'},o);
const jc=(no,ops,extra)=>Object.assign({no,projectNo:'P-1',operations:ops},extra);

// ── Matching words, not spellings ────────────────────────────────────────────────────────────
test('match: the same work described differently still matches', ()=>{
  assert.ok(Memory.similarity('Cutting','Cut frame profiles')>0,'cutting and cut are one word');
  assert.ok(Memory.similarity('Welding','Weld main frame')>0);
  assert.ok(Memory.similarity('Grinding','Grind welds')>0);
  assert.equal(Memory.similarity('Cutting','Cutting'),1);
});
test('match: unrelated work does not match', ()=>{
  assert.equal(Memory.similarity('Cutting','Painting the roof'),0);
  assert.equal(Memory.similarity('Installation','Cutting'),0);
  assert.equal(Memory.similarity('',''),0);
  assert.equal(Memory.similarity('Cutting',null),0);
});
test('match: filler words and bare numbers carry no meaning', ()=>{
  assert.deepEqual(Memory.tokens('Cutting of the 40 mm plate'),['cut','plate']);
  assert.deepEqual(Memory.tokens('och för med'),[],'Swedish filler counts as filler too');
  assert.deepEqual(Memory.tokens('123 456'),[]);
});

// ── Only finished work counts ────────────────────────────────────────────────────────────────
test('record: an operation counts only once it is finished', ()=>{
  const cards=[jc('JC-1',[
    op({desc:'Done work',status:'completed',plannedHours:10,loggedHours:12}),
    op({desc:'Half done',status:'in-progress',plannedHours:20,loggedHours:5}),
    op({desc:'Not started',status:'pending',plannedHours:8,loggedHours:0})
  ])];
  const got=Memory.operationEntries(cards);
  assert.deepEqual(got.map(e=>e.desc),['Done work'],
    'an operation part-way through has burned part of its hours — counting that as a ratio would be a lie');
  assert.equal(got[0].planned,10);
  assert.equal(got[0].actual,12);
  assert.equal(got[0].ref,'JC-1','the record has to say which job it came from');
});
test('record: an archived jobcard is not part of the record', ()=>{
  assert.deepEqual(Memory.operationEntries([jc('JC-1',[op({})],{archived:true})]),[]);
  assert.deepEqual(Memory.operationEntries(null),[]);
});
test('record: a project counts only once it is completed or closed', ()=>{
  const projects=[
    {no:'P-1',name:'Done',status:'completed',plannedHours:24,usedHours:23.5,types:['Fabrication']},
    {no:'P-2',name:'Closed',status:'closed',plannedHours:12,usedHours:12,types:['Service']},
    {no:'P-3',name:'Running',status:'active',plannedHours:80,usedHours:25,types:['Fabrication']},
    {no:'P-4',name:'On hold',status:'hold',plannedHours:16,usedHours:3,types:['Repair']},
    {no:'P-5',name:'No hours',status:'completed',plannedHours:0,usedHours:0,types:['Service']}
  ];
  assert.deepEqual(Memory.projectEntries(projects).map(p=>p.ref),['P-1','P-2']);
});

// ── Recall ───────────────────────────────────────────────────────────────────────────────────
test('recall: nothing like it returns nothing, never a neutral-looking figure', ()=>{
  const list=Memory.operationEntries([jc('JC-1',[op({desc:'Cutting'})])]);
  assert.equal(Memory.recall('Painting the roof',list),null,
    '"no answer" and "on target" are different answers and must not look the same');
  assert.equal(Memory.recall('Cutting',[]),null);
  assert.equal(Memory.recall('Cutting',null),null);
});
test('recall: what it returns is what happened, with the jobs it came from', ()=>{
  const list=Memory.operationEntries([
    jc('JC-1',[op({desc:'Cutting',plannedHours:16,loggedHours:18})]),
    jc('JC-2',[op({desc:'Cut the frame',plannedHours:8,loggedHours:10})])
  ]);
  const r=Memory.recall('Cutting',list);
  assert.equal(r.samples,2);
  assert.equal(r.planned,24);
  assert.equal(r.actual,28);
  assert.deepEqual(r.refs.sort(),['JC-1','JC-2'],'every figure has to be traceable to a job');
});
test('recall: the factor weighs the whole of the matched work, not each job equally', ()=>{
  const list=Memory.operationEntries([
    jc('JC-BIG',[op({desc:'Cutting',plannedHours:100,loggedHours:100})]),
    jc('JC-TINY',[op({desc:'Cutting',plannedHours:1,loggedHours:3})])
  ]);
  const r=Memory.recall('Cutting',list);
  assert.equal(r.factor,1.02,'101 h estimated against 103 h worked');
  const meanOfRatios=(1+3)/2;
  assert.ok(r.factor<meanOfRatios,'one tiny job that tripled must not outweigh a large one that did not');
});
test('recall: hours are also given as the days an estimate is typed in', ()=>{
  const list=Memory.operationEntries([jc('JC-1',[op({desc:'Welding',plannedHours:16,loggedHours:16})])]);
  const r=Memory.recall('Welding',list);
  assert.equal(r.hoursPerJob,16);
  assert.equal(r.personDays,2,'16 hours is two days for one person');
});
test('recall: one job says one job', ()=>{
  const list=Memory.operationEntries([jc('JC-1',[op({desc:'Welding',plannedHours:10,loggedHours:20})])]);
  assert.equal(Memory.recall('Welding',list).samples,1,
    'the caller has to be able to say how thin the evidence is');
});

// ── Bias by kind of work ─────────────────────────────────────────────────────────────────────
test('bias: each kind of work is measured on its own finished projects', ()=>{
  const projects=[
    {no:'P-1',status:'completed',plannedHours:100,usedHours:120,types:['Fabrication']},
    {no:'P-2',status:'closed',plannedHours:100,usedHours:100,types:['Fabrication','Service']},
    {no:'P-3',status:'active',plannedHours:100,usedHours:10,types:['Fabrication']}
  ];
  const bias=Memory.biasByType(projects);
  const fab=bias.find(b=>b.type==='Fabrication');
  assert.equal(fab.samples,2,'the unfinished project is not evidence');
  assert.equal(fab.factor,1.1);
  assert.deepEqual(fab.refs,['P-1','P-2']);
  assert.equal(bias.find(b=>b.type==='Service').factor,1);
});
test('bias: a project with no type stated is still counted, under no type', ()=>{
  const bias=Memory.biasByType([{no:'P-1',status:'completed',plannedHours:10,usedHours:12,types:[]}]);
  assert.equal(bias.length,1);
  assert.equal(bias[0].type,'—');
  assert.equal(bias[0].factor,1.2);
});

// ── Proposing dates ──────────────────────────────────────────────────────────────────────────
test('schedule: items run one after another at the stated hours a day', ()=>{
  const r=Memory.proposeSchedule([{no:'A',hours:16},{no:'B',hours:8}],{start:'2026-10-05',hoursPerDay:8});
  assert.equal(r.items[0].start,'2026-10-05');
  assert.equal(r.items[0].end,'2026-10-06','16 h at 8 h a day is two days');
  assert.equal(r.items[1].start,'2026-10-07','the next item starts when the one before it ends');
  assert.equal(r.items[1].end,'2026-10-07');
  assert.equal(r.start,'2026-10-05');
  assert.equal(r.end,'2026-10-07');
  assert.equal(r.hours,24);
});
test('schedule: weekends are not worked', ()=>{
  // Thursday start, 24 h at 8 h a day: Thu, Fri, then Monday.
  const r=Memory.proposeSchedule([{no:'A',hours:24}],{start:'2026-10-08',hoursPerDay:8});
  assert.equal(r.items[0].start,'2026-10-08');
  assert.equal(r.items[0].end,'2026-10-12','Saturday and Sunday are skipped');
  // A start that lands on a Saturday moves to the Monday rather than being worked.
  assert.equal(Memory.proposeSchedule([{no:'A',hours:8}],{start:'2026-10-10'}).items[0].start,'2026-10-12');
});
test('schedule: the day rate changes the span, and defaults to a working day', ()=>{
  assert.equal(Memory.proposeSchedule([{no:'A',hours:16}],{start:'2026-10-05',hoursPerDay:16}).items[0].days,1);
  assert.equal(Memory.proposeSchedule([{no:'A',hours:16}],{start:'2026-10-05',hoursPerDay:4}).items[0].days,4);
  assert.equal(Memory.proposeSchedule([{no:'A',hours:16}],{start:'2026-10-05'}).hoursPerDay,8);
  assert.equal(Memory.proposeSchedule([{no:'A',hours:16}],{start:'2026-10-05',hoursPerDay:0}).hoursPerDay,8);
});
test('schedule: an item nobody has put hours on is reported, not given a guessed span', ()=>{
  const r=Memory.proposeSchedule([{no:'A',hours:8},{no:'B',title:'Unknown',hours:0}],{start:'2026-10-05'});
  assert.deepEqual(r.items.map(i=>i.no),['A']);
  assert.deepEqual(r.unsized,[{no:'B',title:'Unknown'}]);
});
test('schedule: an hour of work is still a day of the calendar', ()=>{
  assert.equal(Memory.proposeSchedule([{no:'A',hours:1}],{start:'2026-10-05'}).items[0].days,1);
});
test('schedule: with no start there is nothing to lay out', ()=>{
  const r=Memory.proposeSchedule([{no:'A',hours:8}],{start:''});
  assert.equal(r.error,'no-start');
  assert.deepEqual(r.items,[]);
  assert.deepEqual(Memory.proposeSchedule(null,{start:'2026-10-05'}).items,[]);
});

// ── Against the real seeded data ─────────────────────────────────────────────────────────────
test('real data: only the work that is actually finished is answered from', ()=>{
  const WD=loadWorkshopData();
  const shared=WD.get();
  const list=Memory.entries({jobcards:WD.listJobcards(),projects:shared.projects});
  assert.ok(list.length>0,'the seed is expected to contain some finished work');
  list.forEach(e=>{
    assert.ok(e.planned>0&&e.actual>0,'every entry carries both an estimate and an actual');
    assert.ok(e.ref,'and the job it came from');
  });
  // Nothing mid-flight may have leaked in.
  const finishedOps=new Set(WD.listJobcards().flatMap(j=>(j.operations||[])
    .filter(o=>['completed','done','closed'].includes(String(o.status).toLowerCase()))
    .map(o=>o.desc)));
  list.filter(e=>e.kind==='operation').forEach(e=>{
    assert.ok(finishedOps.has(e.desc),`"${e.desc}" is not a finished operation and must not be evidence`);
  });
  const runningProjects=shared.projects.filter(p=>!['completed','closed'].includes(String(p.status).toLowerCase())).map(p=>p.no);
  list.filter(e=>e.kind==='project').forEach(e=>{
    assert.ok(!runningProjects.includes(e.ref),`${e.ref} is not finished and must not be evidence`);
  });
});
test('real data: the seed is thin, and the module says so rather than implying a trend', ()=>{
  const WD=loadWorkshopData();
  const list=Memory.entries({jobcards:WD.listJobcards(),projects:WD.get().projects});
  const r=Memory.recall('Cutting',list);
  assert.ok(r,'the workshop has cut something before');
  assert.equal(r.samples,1,'one job is one job');
  assert.deepEqual(r.refs,['JC-2026-0001']);
  assert.equal(r.planned,16);
  assert.equal(r.actual,18);
  assert.equal(r.factor,1.13);
  Memory.biasByType(WD.get().projects).forEach(b=>{
    assert.ok(b.samples>=1);
    assert.ok(b.refs.length===b.samples,'a factor must name every project behind it');
  });
});
test('real data: a project can be laid out from the hours its items carry', ()=>{
  const WD=loadWorkshopData();
  const Planning=require('../planning-rules.js');
  const project=WD.findProject('P-2026-014');
  const items=Planning.itemsOf(project,WD.listJobcards());
  const r=Memory.proposeSchedule(items,{start:'2026-10-05',hoursPerDay:8});
  assert.equal(r.items.length,items.filter(i=>i.hours>0).length);
  assert.equal(r.items[0].start,'2026-10-05');
  r.items.forEach((it,i)=>{
    assert.ok(it.end>=it.start);
    if(i)assert.ok(it.start>r.items[i-1].end,'items do not overlap');
  });
  assert.equal(r.hours,items.reduce((s,i)=>s+i.hours,0));
});
