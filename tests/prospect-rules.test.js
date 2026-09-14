// Pure logic tests for prospect-rules.js — the triage that stands between an outward sweep of
// public sources and the person who has to read the result.
//
// Three promises are what these tests are really for, because they are the ones that make the
// difference between a useful morning list and a machine that invents work:
//   1. A finding with nowhere to point is dropped, not shown.
//   2. What the shop can do comes from the equipment register, so a job needing a machine the
//      shop does not own is reported as missing rather than quietly accepted.
//   3. A finding reported once is never reported again, even re-worded.
// The last block runs the rules against the real seeded register, so a change to the shop's
// machines shows up here rather than in a wrong verdict on somebody's screen.
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Prospect=require('../prospect-rules.js');
const {loadWorkshopData}=require('./helpers/load-workshop-data');

const DAY=86400000;
const daysAgo=n=>new Date(Date.now()-n*DAY).toISOString().slice(0,10);
const eq=(id,category,status,extra)=>Object.assign({equipmentId:id,name:id+' machine',category,status},extra);
const find=o=>Object.assign({
  title:'Something needs doing',
  sourceUrl:'https://byggahus.se/forum/t/1',
  klass:'hot'
},o);

// A shop with one machine per process, all of them usable — the baseline the other fixtures bend.
const FULL=[
  eq('E-W','Welding Machine','Available'),
  eq('E-C','Cutting Equipment','Available'),
  eq('E-B','Forming Equipment','Available'),
  eq('E-G','Power Tool','Available'),
  eq('E-L','Lifting Equipment','Available')
];
const cap=(caps,id)=>caps.find(c=>c.id===id);

// ── What the shop can do is read, never assumed ──────────────────────────────────────────────
test('capabilities: a process is real only when the register carries a machine for it', ()=>{
  const caps=Prospect.capabilities([eq('E-1','Welding Machine','Available')]);
  assert.equal(cap(caps,'welding').owned,true);
  assert.equal(cap(caps,'welding').usable,true);
  assert.deepEqual(cap(caps,'welding').machines,[{id:'E-1',name:'E-1 machine',status:'Available'}]);
  // Nothing else was bought, so nothing else is claimed.
  ['cutting','bending','finishing','lifting'].forEach(id=>{
    assert.equal(cap(caps,id).owned,false,id+' has no machine and must not be claimed');
    assert.equal(cap(caps,id).usable,false);
    assert.deepEqual(cap(caps,id).machines,[]);
  });
});
test('capabilities: owning a machine and being able to use it today are two different answers', ()=>{
  Prospect.OUT_OF_ACTION.forEach(status=>{
    const caps=Prospect.capabilities([eq('E-1','Forming Equipment',status)]);
    assert.equal(cap(caps,'bending').owned,true,status+' still proves the shop owns the process');
    assert.equal(cap(caps,'bending').usable,false,status+' cannot be counted on today');
  });
});
test('capabilities: one working machine is enough, even beside a broken one', ()=>{
  const caps=Prospect.capabilities([
    eq('E-1','Welding Machine','Quarantined'),
    eq('E-2','Welding Machine','In Use')
  ]);
  assert.equal(cap(caps,'welding').usable,true,'"In Use" is a machine at work, not a machine down');
  assert.equal(cap(caps,'welding').machines.length,2,'both are reported, with their real statuses');
});
test('capabilities: a retired machine has left the shop', ()=>{
  const caps=Prospect.capabilities([eq('E-1','Welding Machine','Available',{isRetired:true})]);
  assert.equal(cap(caps,'welding').owned,false);
  assert.deepEqual(cap(caps,'welding').machines,[]);
});
test('capabilities: no register at all claims nothing', ()=>{
  [[],null,undefined,'not a fleet'].forEach(input=>{
    const caps=Prospect.capabilities(input);
    assert.equal(caps.length,Prospect.PROCESSES.length,'every process is still reported');
    assert.ok(caps.every(c=>!c.owned&&!c.usable),'and every one of them as absent');
  });
});

// ── What a finding needs ─────────────────────────────────────────────────────────────────────
test('needs: a finding that names its processes is taken at its word', ()=>{
  assert.deepEqual(Prospect.processesNeeded(find({needs:['welding','bending']})),['welding','bending']);
  assert.deepEqual(Prospect.processesNeeded(find({needs:['WELDING']})),['welding'],'case is not meaning');
});
test('needs: a process the shop does not sell is not invented from a stated need', ()=>{
  assert.deepEqual(Prospect.processesNeeded(find({needs:['galvanising','welding']})),['welding']);
  assert.deepEqual(Prospect.processesNeeded(find({needs:['galvanising']})),[]);
});
test('needs: work outside the trade is set aside, not swept under the rug', ()=>{
  // "They want 100-ton pressing" must never come out the other end as "they did not say what
  // they want" — that reads as a maybe when the honest answer is no.
  assert.deepEqual(Prospect.outsideTrade(find({needs:['pressing','welding']})),['pressing']);
  assert.deepEqual(Prospect.outsideTrade(find({needs:['welding']})),[]);
  assert.deepEqual(Prospect.outsideTrade(find({title:'weld it'})),[],
    'words read off a post are only ever read as work the shop does sell');
  assert.deepEqual(Prospect.outsideTrade(null),[]);
});
test('needs: with nothing stated, the words of the finding are read', ()=>{
  assert.deepEqual(Prospect.processesNeeded(find({title:'Trasig grävskopa, behöver svetsning'})),['welding']);
  assert.deepEqual(Prospect.processesNeeded(find({title:'Räcke',summary:'plasma cut and fold 4 mm plate'})),
    ['cutting','bending']);
  assert.deepEqual(Prospect.processesNeeded(find({title:'Bracket',need:'grind the welds flush'})),
    ['welding','finishing'],'the need field is read too');
});
test('needs: a finding naming no process comes back empty, not guessed at', ()=>{
  assert.deepEqual(Prospect.processesNeeded(find({title:'Looking for a supplier in Skåne'})),[]);
  assert.deepEqual(Prospect.processesNeeded(null),[]);
});

// ── Matching a finding against the register ──────────────────────────────────────────────────
test('match: covered, busy and missing are three different answers', ()=>{
  const fleet=[
    eq('E-W','Welding Machine','Available'),
    eq('E-B','Forming Equipment','Under Maintenance')
  ];
  const m=Prospect.matchCapabilities(find({needs:['welding','bending','cutting']}),fleet);
  assert.deepEqual(m.needed,['welding','cutting','bending'],
    'the processes come back in the shop\u2019s own order, so two findings read the same way');
  assert.deepEqual(m.covered,['welding']);
  assert.deepEqual(m.busy,['bending'],'owned but down today');
  assert.deepEqual(m.missing,['cutting'],'never owned — the shop cannot promise it');
  assert.equal(m.coverage,0.67,'two of three processes are in the shop at all');
});
test('match: the machines reported are the ones that would do the work', ()=>{
  const m=Prospect.matchCapabilities(find({needs:['welding','cutting']}),
    [eq('E-W','Welding Machine','Available')]);
  assert.deepEqual(m.machines.map(x=>x.id),['E-W'],'a missing process brings no machine with it');
});
test('match: a finding naming no process has no coverage to report', ()=>{
  const m=Prospect.matchCapabilities(find({title:'General enquiry'}),FULL);
  assert.deepEqual(m.needed,[]);
  assert.equal(m.coverage,null,'nothing needed is not "nothing covered" — it is no answer');
});

test('match: a trade the shop is not in is reported as such', ()=>{
  const m=Prospect.matchCapabilities(find({needs:['pressing','welding']}),FULL);
  assert.deepEqual(m.needed,['welding']);
  assert.deepEqual(m.outside,['pressing']);
  assert.deepEqual(m.covered,['welding']);
  assert.deepEqual(m.missing,[],'pressing is not a machine the shop is short of — it is not its trade');
  assert.equal(m.coverage,1,'coverage is of the work the shop sells, and says so alongside `outside`');
});

// ── A finding without a source is not a finding ──────────────────────────────────────────────
test('reportable: a finding has to point somewhere a person can go and look', ()=>{
  assert.equal(Prospect.isReportable(find({sourceUrl:'https://byggahus.se/forum/t/1'})),true);
  assert.equal(Prospect.isReportable(find({sourceUrl:'http://maskinisten.net/viewtopic.php?t=9'})),true);
  assert.equal(Prospect.isReportable(find({sourceUrl:'blocket.se/annons/1234'})),true,
    'a host and a path is a place, protocol or not');
});
test('reportable: everything that is not a place is dropped', ()=>{
  ['','   ','Byggahus','a forum somewhere','byggahus.se','tel:0700000000','https://'].forEach(src=>{
    assert.equal(Prospect.isReportable(find({sourceUrl:src})),false,
      JSON.stringify(src)+' is not somewhere anybody can check');
  });
  assert.equal(Prospect.isReportable(find({title:'',sourceUrl:'https://x.se/1'})),false,
    'an untitled finding says nothing either');
  assert.equal(Prospect.isReportable(null),false);
});

// ── Reported once, never reported again ──────────────────────────────────────────────────────
test('fingerprint: the same page under a different link is the same finding', ()=>{
  const base=Prospect.fingerprint(find({sourceUrl:'https://byggahus.se/forum/t/1'}));
  ['http://byggahus.se/forum/t/1','https://www.byggahus.se/forum/t/1',
   'https://byggahus.se/forum/t/1/','https://byggahus.se/forum/t/1?utm_source=newsletter',
   'https://byggahus.se/forum/t/1#reply-4','  https://BYGGAHUS.se/forum/t/1  '].forEach(src=>{
    assert.equal(Prospect.fingerprint(find({sourceUrl:src})),base,src+' is the same page');
  });
});
test('fingerprint: different pages stay different findings', ()=>{
  assert.notEqual(Prospect.fingerprint(find({sourceUrl:'https://byggahus.se/forum/t/1'})),
    Prospect.fingerprint(find({sourceUrl:'https://byggahus.se/forum/t/2'})));
});
test('fingerprint: with no link, a re-worded repost of the same job is still recognised', ()=>{
  const a=Prospect.fingerprint({title:'Gate hinges broken',place:'Lund',sourceUrl:''});
  const b=Prospect.fingerprint({title:'  gate   hinges   BROKEN ',place:'lund'});
  assert.equal(a,b,'spelling and spacing are not identity');
  assert.notEqual(a,Prospect.fingerprint({title:'Gate hinges broken',place:'Malmö'}),
    'the same words in another town is another job');
  assert.equal(Prospect.fingerprint(null),'');
});
test('seen: a fingerprint already on the list is not new, however it is handed over', ()=>{
  const f=find({sourceUrl:'https://byggahus.se/forum/t/1'});
  const mark=Prospect.fingerprint(f);
  assert.equal(Prospect.isNew(f,new Set([mark])),false);
  assert.equal(Prospect.isNew(f,[mark]),false,'an array of marks reads the same as a set');
  assert.equal(Prospect.isNew(f,[]),true);
  assert.equal(Prospect.isNew(f,null),true);
});

// ── What the rules would say, and why ────────────────────────────────────────────────────────
const reasonCodes=r=>r.reasons.map(x=>x.code);
test('verdict: work the shop can do, posted days ago, nearby, is worth the phone call', ()=>{
  const f=find({needs:['welding'],date:daysAgo(2),distanceKm:34});
  const got=Prospect.suggestVerdict(f,Prospect.matchCapabilities(f,FULL));
  assert.equal(got.verdict,'go');
  assert.deepEqual(reasonCodes(got),['covered','fresh','near']);
  assert.deepEqual(got.reasons[0],{code:'covered',detail:'welding'},'a reason names what it rests on');
});
test('verdict: a job half outside the shop is never a plain yes, however fresh and close', ()=>{
  const f=find({needs:['welding','bending'],date:daysAgo(1),distanceKm:10});
  const got=Prospect.suggestVerdict(f,Prospect.matchCapabilities(f,[eq('E-W','Welding Machine','Available')]));
  assert.equal(got.verdict,'maybe');
  assert.ok(reasonCodes(got).includes('missing-capability'));
  assert.equal(got.reasons.find(r=>r.code==='missing-capability').detail,'bending');
  assert.ok(reasonCodes(got).includes('held-back'),'and the page can say the verdict was held down');
});
test('verdict: a job the shop cannot touch at all is a skip, however fresh and close', ()=>{
  const f=find({needs:['bending'],date:daysAgo(1),distanceKm:10});
  const got=Prospect.suggestVerdict(f,Prospect.matchCapabilities(f,[eq('E-W','Welding Machine','Available')]));
  assert.equal(got.verdict,'skip');
});
test('verdict: nothing about a finding can lift it past what the shop can do', ()=>{
  // The arithmetic is a way of ranking the work the shop can take. It is not a way of talking
  // the shop into work it cannot. Whatever the day, the distance and the class, no finding with
  // a process the register does not carry comes out of here as a yes.
  const partly=[eq('E-W','Welding Machine','Available')];
  [0,1,3,10].forEach(age=>[0,5,20,39].forEach(km=>['hot','repair','prototype','subcontract'].forEach(klass=>{
    const some=find({needs:['welding','bending'],date:daysAgo(age),distanceKm:km,klass});
    assert.notEqual(Prospect.suggestVerdict(some,Prospect.matchCapabilities(some,partly)).verdict,'go',
      `${klass} ${age} d / ${km} km: half of it needs a machine the shop does not own`);
    const none=find({needs:['bending'],date:daysAgo(age),distanceKm:km,klass});
    assert.equal(Prospect.suggestVerdict(none,Prospect.matchCapabilities(none,partly)).verdict,'skip',
      `${klass} ${age} d / ${km} km: none of it can be done here`);
  })));
});
test('verdict: a job outside the trade is a skip, and says which trade', ()=>{
  const f=find({needs:['pressing'],date:daysAgo(1),distanceKm:5});
  const got=Prospect.suggestVerdict(f,Prospect.matchCapabilities(f,FULL));
  assert.equal(got.verdict,'skip');
  assert.equal(got.reasons.find(r=>r.code==='outside-trade').detail,'pressing');
  assert.ok(!reasonCodes(got).includes('no-process-named'),
    'the finding said exactly what it wanted — the shop simply does not sell it');
});
test('verdict: a job part of which is outside the trade is not a plain yes', ()=>{
  const f=find({needs:['welding','pressing'],date:daysAgo(1),distanceKm:5});
  const got=Prospect.suggestVerdict(f,Prospect.matchCapabilities(f,FULL));
  assert.equal(got.verdict,'maybe');
  assert.ok(reasonCodes(got).includes('covered')&&reasonCodes(got).includes('outside-trade'),
    'both halves of the answer are shown, so the user can judge splitting the job');
});
test('verdict: a watch is never somebody to ring today', ()=>{
  // The class is information the sweep paid for. A watch is a thing to keep an eye on; letting
  // freshness and distance turn it into a call is how a queue starts wasting mornings.
  ['watch','weak'].forEach(klass=>{
    const f=find({klass,needs:['welding'],date:daysAgo(0),distanceKm:5});
    const got=Prospect.suggestVerdict(f,Prospect.matchCapabilities(f,FULL));
    assert.notEqual(got.verdict,'go',klass+' is not a job, whatever the day and the distance');
  });
  const hot=find({klass:'hot',needs:['welding'],date:daysAgo(0),distanceKm:5});
  assert.equal(Prospect.suggestVerdict(hot,Prospect.matchCapabilities(hot,FULL)).verdict,'go',
    'the same finding as a hot lead is exactly the call to make');
});
test('verdict: a machine the shop owns but cannot run today is not a promise for today', ()=>{
  const f=find({needs:['bending'],date:daysAgo(1),distanceKm:10});
  const got=Prospect.suggestVerdict(f,Prospect.matchCapabilities(f,[eq('E-B','Forming Equipment','Under Maintenance')]));
  assert.equal(got.verdict,'maybe','the shop can do it — just not while the machine is down');
  assert.ok(reasonCodes(got).includes('machine-busy'));
});
test('verdict: a machine that is down is said out loud, not counted against the job', ()=>{
  const f=find({needs:['bending'],date:daysAgo(1),distanceKm:10});
  const busy=Prospect.suggestVerdict(f,Prospect.matchCapabilities(f,[eq('E-B','Forming Equipment','Quarantined')]));
  assert.ok(reasonCodes(busy).includes('machine-busy'));
  assert.ok(!reasonCodes(busy).includes('covered'),'a machine down today does not cover the work');
  assert.ok(!reasonCodes(busy).includes('missing-capability'),'nor is it missing — the shop owns it');
});
test('verdict: age and distance both count, and both are shown', ()=>{
  const old=find({needs:['welding'],date:daysAgo(40),distanceKm:200});
  const got=Prospect.suggestVerdict(old,Prospect.matchCapabilities(old,FULL));
  assert.equal(got.verdict,'maybe','the work fits, but it is stale and far');
  assert.deepEqual(reasonCodes(got),['covered','stale','far']);
  assert.equal(got.reasons.find(r=>r.code==='stale').detail,'40 d');
  assert.equal(got.reasons.find(r=>r.code==='far').detail,'200 km');
});
test('verdict: how stale and how far are the caller’s to set', ()=>{
  const f=find({needs:['welding'],date:daysAgo(20),distanceKm:100});
  const tight=Prospect.suggestVerdict(f,Prospect.matchCapabilities(f,FULL),{staleDays:14,farKm:80});
  const loose=Prospect.suggestVerdict(f,Prospect.matchCapabilities(f,FULL),{staleDays:30,farKm:150});
  assert.ok(reasonCodes(tight).includes('stale')&&reasonCodes(tight).includes('far'));
  assert.ok(!reasonCodes(loose).includes('stale')&&!reasonCodes(loose).includes('far'));
  assert.equal(loose.verdict,'go');
});
test('verdict: a finding with no date says so rather than passing for fresh', ()=>{
  const f=find({needs:['welding'],distanceKm:10});
  const got=Prospect.suggestVerdict(f,Prospect.matchCapabilities(f,FULL));
  assert.ok(reasonCodes(got).includes('no-date'));
  assert.ok(!reasonCodes(got).includes('fresh'));
  const bad=Prospect.suggestVerdict(find({needs:['welding'],date:'not a date'}),null);
  assert.ok(reasonCodes(bad).includes('no-date'));
});
test('verdict: a finding naming no process is a maybe with the reason said plainly', ()=>{
  const f=find({title:'Somebody in Lund is looking for a supplier',date:daysAgo(1),distanceKm:20});
  const got=Prospect.suggestVerdict(f,Prospect.matchCapabilities(f,FULL));
  assert.ok(reasonCodes(got).includes('no-process-named'));
  assert.equal(got.verdict,'maybe','a signal is not a job, but it is not nothing either');
  assert.ok(reasonCodes(got).includes('held-back'),'freshness alone does not make it one');
});
test('verdict: a weak signal is held to a higher bar than a job', ()=>{
  const base={needs:['welding'],date:daysAgo(2),distanceKm:20};
  const hot=find(Object.assign({klass:'hot'},base));
  const weak=find(Object.assign({klass:'weak'},base));
  assert.equal(Prospect.suggestVerdict(hot,Prospect.matchCapabilities(hot,FULL)).verdict,'go');
  assert.equal(Prospect.suggestVerdict(weak,Prospect.matchCapabilities(weak,FULL)).score,
    Prospect.suggestVerdict(hot,Prospect.matchCapabilities(hot,FULL)).score-1);
});
test('verdict: every verdict the rules give is one of the three', ()=>{
  [0,1,2,5,14,15,40].forEach(age=>[0,10,50,90,300].forEach(km=>{
    const f=find({needs:['welding','bending'],date:daysAgo(age),distanceKm:km});
    const got=Prospect.suggestVerdict(f,Prospect.matchCapabilities(f,FULL));
    assert.ok(Prospect.VERDICTS.includes(got.verdict),`${age} d / ${km} km gave ${got.verdict}`);
    assert.ok(got.reasons.length>0,'and never without saying why');
  }));
});

// ── Triaging a whole sweep ───────────────────────────────────────────────────────────────────
test('triage: three outcomes, each of them counted', ()=>{
  const got=Prospect.triage([
    find({title:'Weld a trailer frame',sourceUrl:'https://byggahus.se/forum/t/1',needs:['welding'],date:daysAgo(1),distanceKm:20}),
    find({title:'Seen this one before',sourceUrl:'https://byggahus.se/forum/t/2'}),
    find({title:'Nowhere to point',sourceUrl:'heard about it'})
  ],['u:byggahus.se/forum/t/2'],FULL);
  assert.equal(got.ready.length,1);
  assert.equal(got.known.length,1);
  assert.equal(got.dropped.length,1);
  assert.deepEqual(got.tally,{found:3,ready:1,known:1,dropped:1});
  assert.equal(got.ready[0].title,'Weld a trailer frame');
});
test('triage: a finding is carried through whole, with its match and its reasons attached', ()=>{
  const got=Prospect.triage([find({
    title:'Broken loader bucket',place:'Eslöv',needs:['welding'],date:daysAgo(2),distanceKm:15,
    contact:'thread reply',sourceUrl:'https://maskinisten.net/t/55'
  })],[],FULL);
  const r=got.ready[0];
  assert.equal(r.place,'Eslöv','nothing the sweep found is thrown away');
  assert.equal(r.contact,'thread reply');
  assert.equal(r.fingerprint,'u:maskinisten.net/t/55');
  assert.deepEqual(r.match.covered,['welding']);
  assert.deepEqual(r.match.machines.map(m=>m.id),['E-W']);
  assert.ok(r.reasons.length>0);
});
test('triage: a verdict the sweep already reached is left alone', ()=>{
  const f=find({needs:['bending'],sourceUrl:'https://x.se/1',date:daysAgo(1),verdict:'GO'});
  const got=Prospect.triage([f],[],[eq('E-W','Welding Machine','Available')]);
  assert.equal(got.ready[0].verdict,'go','whoever did the sweep saw more than the rules do');
  assert.equal(got.ready[0].verdictFrom,'sweep');
  assert.ok(got.ready[0].reasons.some(r=>r.code==='missing-capability'),
    'the rules still say what they saw, so the disagreement is visible');
});
test('triage: with no verdict from the sweep, the rules supply one and say so', ()=>{
  const got=Prospect.triage([find({needs:['welding'],sourceUrl:'https://x.se/2',date:daysAgo(1),distanceKm:20})],[],FULL);
  assert.equal(got.ready[0].verdict,'go');
  assert.equal(got.ready[0].verdictFrom,'rules');
});
test('triage: a verdict the sweep invented is not taken as a verdict', ()=>{
  const got=Prospect.triage([find({needs:['welding'],sourceUrl:'https://x.se/3',date:daysAgo(1),distanceKm:20,verdict:'definitely'})],[],FULL);
  assert.equal(got.ready[0].verdict,'go');
  assert.equal(got.ready[0].verdictFrom,'rules');
});
test('triage: the same job posted twice in one sweep is shown once', ()=>{
  const twice=[
    find({title:'Railing for a terrace',sourceUrl:'https://blocket.se/a/7'}),
    find({title:'Terrace railing wanted',sourceUrl:'https://www.blocket.se/a/7/?utm=mail'})
  ];
  const got=Prospect.triage(twice,[],FULL);
  assert.equal(got.ready.length,1,'the second is the same page dressed differently');
  assert.equal(got.known.length,1);
});
test('triage: the caller’s list of what it has seen is not quietly rewritten', ()=>{
  const seen=['u:byggahus.se/forum/t/2'];
  Prospect.triage([find({sourceUrl:'https://byggahus.se/forum/t/9'})],seen,FULL);
  assert.deepEqual(seen,['u:byggahus.se/forum/t/2'],
    'recording the sweep is the data layer’s job, not a side effect of reading it');
});
test('triage: an empty sweep is an empty answer, not an error', ()=>{
  [[],null,undefined].forEach(input=>{
    const got=Prospect.triage(input,[],FULL);
    assert.deepEqual(got.ready,[]);
    assert.deepEqual(got.tally,{found:0,ready:0,known:0,dropped:0});
  });
});

// ── Against the shop that actually exists ────────────────────────────────────────────────────
test('real register: every process the rules can match has a category the register uses', ()=>{
  const WD=loadWorkshopData();
  const known=new Set(WD.get().equipment.map(e=>e.category));
  Prospect.PROCESSES.forEach(p=>{
    assert.ok(p.categories.some(c=>known.has(c)),
      `"${p.name}" is matched on categories no machine in the register carries: ${p.categories.join(', ')}`);
  });
});
test('real register: what the shop is told it can do comes back with real machines behind it', ()=>{
  const WD=loadWorkshopData();
  const fleet=WD.get().equipment;
  const caps=Prospect.capabilities(fleet);
  const byId=new Map(fleet.map(e=>[e.equipmentId||e.id,e]));
  caps.filter(c=>c.owned).forEach(c=>{
    assert.ok(c.machines.length>0,c.name+' is owned, so it must name the machines');
    c.machines.forEach(m=>{
      assert.ok(byId.has(m.id),`"${m.name}" is offered as a capability but is not in the register`);
      assert.equal(m.status,byId.get(m.id).status,'a machine carries its real status, not a hopeful one');
    });
  });
  // The seeded shop welds, cuts and bends; those are the three the module exists to sell.
  ['welding','cutting','bending'].forEach(id=>assert.equal(cap(caps,id).owned,true,id+' is in the register'));
});
test('real register: a welding repair down the road is worth a call; a job needing a press we do not own is not', ()=>{
  const WD=loadWorkshopData();
  const fleet=WD.get().equipment;
  const repair=find({title:'Trasig skopa, behöver svetsning',place:'Eslöv',date:daysAgo(2),distanceKm:34,
    sourceUrl:'https://maskinisten.net/t/1',klass:'repair'});
  const got=Prospect.triage([repair],[],fleet);
  assert.equal(got.ready.length,1);
  assert.equal(got.ready[0].verdict,'go');
  assert.ok(got.ready[0].match.machines.length>0,'and it names the machine that would do it');

  // 100-ton pressing is the example the shop must never claim: no machine, no promise.
  const beyond=find({title:'Pressa 100 ton',needs:['pressing'],date:daysAgo(1),distanceKm:5,
    sourceUrl:'https://blocket.se/a/1'});
  const out=Prospect.triage([beyond],[],fleet).ready[0];
  assert.deepEqual(out.match.needed,[],'the shop has no process for it');
  assert.deepEqual(out.match.outside,['pressing'],'and the finding is held to what it actually asked for');
  assert.equal(out.verdict,'skip','a press the shop does not own is not a job it can take');
});
