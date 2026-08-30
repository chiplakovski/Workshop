// Pure logic tests for the central Equipment safety gate (equipment-gates.js). These exercise the
// module directly with synthetic equipment records — no WorkshopData/localStorage involved — so
// status/date/inspection/breakdown/pre-use-check matching is verified in isolation from the shared
// data plumbing (covered separately, against the real API and seed data, in tests/workshop-data.test.js).
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const EquipmentGates=require('../equipment-gates.js');

const ASOF='2026-08-30';
function eq(overrides){
  return Object.assign({equipmentId:'E-TEST',status:'Available',inspections:[],downtimeRecords:[],preUseChecks:[]},overrides);
}

// ── normalizeStatus / status classification ──
test('gate: normalizeStatus is case/whitespace-insensitive', ()=>{
  assert.equal(EquipmentGates.normalizeStatus('Available'),'available');
  assert.equal(EquipmentGates.normalizeStatus('  OUT OF SERVICE  '),'out of service');
  assert.equal(EquipmentGates.normalizeStatus(null),'');
});
test('gate: every hard-block status is recognised and blocks', ()=>{
  for(const s of ['Out of Service','Quarantined','Under Maintenance','Maintenance Due','Inspection Required','Retired']){
    assert.equal(EquipmentGates.isHardBlockStatus(s),true,s);
    assert.equal(EquipmentGates.isOperationalStatus(s),false,s);
    assert.equal(EquipmentGates.statusBlocksOperation(s),true,s);
  }
});
test('gate: every operational status is recognised and does not block on its own', ()=>{
  for(const s of ['Available','Reserved','In Use']){
    assert.equal(EquipmentGates.isOperationalStatus(s),true,s);
    assert.equal(EquipmentGates.statusBlocksOperation(s),false,s);
  }
});
test('gate: status matching is case/whitespace-insensitive for both hard-block and operational sets', ()=>{
  assert.equal(EquipmentGates.isHardBlockStatus(' quarantined '),true);
  assert.equal(EquipmentGates.isHardBlockStatus('QUARANTINED'),true);
  assert.equal(EquipmentGates.isOperationalStatus(' in use '),true);
  assert.equal(EquipmentGates.isOperationalStatus('IN USE'),true);
});
test('gate: an unknown/malformed status is never guessed as safe — it fails closed (blocked)', ()=>{
  assert.equal(EquipmentGates.isKnownStatus('Bananas'),false);
  assert.equal(EquipmentGates.statusBlocksOperation('Bananas'),true);
  assert.equal(EquipmentGates.statusBlocksOperation(''),true);
  assert.equal(EquipmentGates.statusBlocksOperation(null),true);
  assert.equal(EquipmentGates.statusBlocksOperation(undefined),true);
});
test('gate: Retired is recognised distinctly and is permanent (isRetiredStatus)', ()=>{
  assert.equal(EquipmentGates.isRetiredStatus('Retired'),true);
  assert.equal(EquipmentGates.isRetiredStatus(' RETIRED '),true);
  assert.equal(EquipmentGates.isRetiredStatus('Quarantined'),false);
});

// ── getEquipmentSafetyGate: status ──
test('gate: available equipment with no other issues is not blocked', ()=>{
  const g=EquipmentGates.getEquipmentSafetyGate(eq({status:'Available'}),{asOf:ASOF});
  assert.equal(g.blocked,false);
  assert.equal(g.code,null);
  assert.deepEqual(g.reasons,[]);
});
test('gate: every hard-block status produces a blocked result with code EQUIPMENT_SAFETY_BLOCKED', ()=>{
  for(const s of ['Out of Service','Quarantined','Under Maintenance','Maintenance Due','Inspection Required','Retired']){
    const g=EquipmentGates.getEquipmentSafetyGate(eq({status:s}),{asOf:ASOF});
    assert.equal(g.blocked,true,s);
    assert.equal(g.code,'EQUIPMENT_SAFETY_BLOCKED',s);
  }
});
test('gate: an unknown status blocks with a distinct STATUS_UNKNOWN blocker code', ()=>{
  const g=EquipmentGates.getEquipmentSafetyGate(eq({status:'Bananas'}),{asOf:ASOF});
  assert.equal(g.blocked,true);
  assert.ok(g.blockers.some(b=>b.code==='STATUS_UNKNOWN'));
});
test('gate: a missing equipment record blocks with EQUIPMENT_NOT_FOUND', ()=>{
  const g=EquipmentGates.getEquipmentSafetyGate(null,{asOf:ASOF});
  assert.equal(g.blocked,true);
  assert.ok(g.blockers.some(b=>b.code==='EQUIPMENT_NOT_FOUND'));
});

// ── Date-based blockers ──
test('gate: an overdue mandatory date blocks; the same overdue date is non-blocking (only a soft blocker detail) when not mandatory', ()=>{
  const overdue=eq({status:'Available',maintenanceDate:'2026-01-01'});
  const soft=EquipmentGates.getEquipmentSafetyGate(overdue,{asOf:ASOF});
  assert.equal(soft.blocked,false,'not mandatory -> must not hard-block (Pass 3.2A backwards compatibility)');
  assert.ok(soft.blockers.some(b=>b.code==='MAINTENANCE_OVERDUE'&&b.hard===false));
  const mandatory=eq({status:'Available',maintenanceDate:'2026-01-01',requirements:{maintenanceRequired:true}});
  const hard=EquipmentGates.getEquipmentSafetyGate(mandatory,{asOf:ASOF});
  assert.equal(hard.blocked,true);
  assert.ok(hard.blockers.some(b=>b.code==='MAINTENANCE_OVERDUE'&&b.hard===true));
});
test('gate: overdue inspection blocks only when inspectionRequired is mandatory', ()=>{
  const notMandatory=EquipmentGates.getEquipmentSafetyGate(eq({inspectionDate:'2026-01-01'}),{asOf:ASOF});
  assert.equal(notMandatory.blocked,false);
  const mandatory=EquipmentGates.getEquipmentSafetyGate(eq({inspectionDate:'2026-01-01',requirements:{inspectionRequired:true}}),{asOf:ASOF});
  assert.equal(mandatory.blocked,true);
});
test('gate: expired certification blocks only when certificationRequired is mandatory', ()=>{
  const notMandatory=EquipmentGates.getEquipmentSafetyGate(eq({certificationExpiry:'2026-01-01'}),{asOf:ASOF});
  assert.equal(notMandatory.blocked,false);
  const mandatory=EquipmentGates.getEquipmentSafetyGate(eq({certificationExpiry:'2026-01-01',requirements:{certificationRequired:true}}),{asOf:ASOF});
  assert.equal(mandatory.blocked,true);
});
test('gate: overdue calibration blocks only when calibrationRequired is mandatory', ()=>{
  const notMandatory=EquipmentGates.getEquipmentSafetyGate(eq({calibrationDate:'2026-01-01'}),{asOf:ASOF});
  assert.equal(notMandatory.blocked,false);
  const mandatory=EquipmentGates.getEquipmentSafetyGate(eq({calibrationDate:'2026-01-01',requirements:{calibrationRequired:true}}),{asOf:ASOF});
  assert.equal(mandatory.blocked,true);
});
test('gate: options.asOf makes date evaluation deterministic — the same record blocks or not purely depending on asOf', ()=>{
  const item=eq({maintenanceDate:'2026-06-15',requirements:{maintenanceRequired:true}});
  assert.equal(EquipmentGates.getEquipmentSafetyGate(item,{asOf:'2026-06-01'}).blocked,false,'asOf before the due date -> not yet overdue');
  assert.equal(EquipmentGates.getEquipmentSafetyGate(item,{asOf:'2026-07-01'}).blocked,true,'asOf after the due date -> overdue');
});
test('gate: a date exactly equal to asOf is NOT overdue (calendar-day comparison, not exact time-of-day)', ()=>{
  const item=eq({maintenanceDate:'2026-08-30',requirements:{maintenanceRequired:true}});
  assert.equal(EquipmentGates.getEquipmentSafetyGate(item,{asOf:'2026-08-30'}).blocked,false);
});
test('gate: a missing mandatory date blocks with a *_MISSING code, distinct from *_OVERDUE', ()=>{
  const g=EquipmentGates.getEquipmentSafetyGate(eq({maintenanceDate:null,requirements:{maintenanceRequired:true}}),{asOf:ASOF});
  assert.equal(g.blocked,true);
  assert.ok(g.blockers.some(b=>b.code==='MAINTENANCE_MISSING'&&b.hard===true));
});

// ── Inspections ──
test('gate: the latest inspection failing blocks, regardless of critical flag', ()=>{
  const g=EquipmentGates.getEquipmentSafetyGate(eq({inspections:[{id:'INS-1',result:'failed',critical:false}]}),{asOf:ASOF});
  assert.equal(g.blocked,true);
  assert.ok(g.blockers.some(b=>b.code==='INSPECTION_FAILED'));
});
test('gate: a critical inspection that has not yet passed blocks even if its result is merely pending, not failed', ()=>{
  const g=EquipmentGates.getEquipmentSafetyGate(eq({inspections:[{id:'INS-1',result:'pending',critical:true}]}),{asOf:ASOF});
  assert.equal(g.blocked,true);
  assert.ok(g.blockers.some(b=>b.code==='CRITICAL_INSPECTION_UNRESOLVED'));
});
test('gate: a later UNRELATED passed inspection does NOT clear an earlier unresolved failure (no more "latest wins")', ()=>{
  const g=EquipmentGates.getEquipmentSafetyGate(eq({inspections:[
    {id:'INS-2',result:'passed',critical:true},
    {id:'INS-1',result:'failed',critical:true}
  ]}),{asOf:ASOF});
  assert.equal(g.blocked,true,'the old failure must still block even though a newer unrelated inspection passed');
  assert.ok(g.blockers.some(b=>b.code==='CRITICAL_INSPECTION_UNRESOLVED'));
});
test('gate: a failed inspection explicitly marked resolved (resolved:true) no longer blocks', ()=>{
  const g=EquipmentGates.getEquipmentSafetyGate(eq({inspections:[
    {id:'INS-2',result:'passed',critical:true},
    {id:'INS-1',result:'failed',critical:true,resolved:true,resolvedBy:'Aleksandar C.'}
  ]}),{asOf:ASOF});
  assert.equal(g.blocked,false);
});
test('gate: multiple independent unresolved failures each produce their own blocker', ()=>{
  const g=EquipmentGates.getEquipmentSafetyGate(eq({inspections:[
    {id:'INS-2',result:'failed',critical:false},
    {id:'INS-1',result:'failed',critical:true}
  ]}),{asOf:ASOF});
  assert.equal(g.blockers.filter(b=>b.hard).length,2);
});

// ── Breakdowns ──
test('gate: an open (unresolved) breakdown blocks', ()=>{
  const g=EquipmentGates.getEquipmentSafetyGate(eq({downtimeRecords:[{id:'BR-1',status:'Reported'}]}),{asOf:ASOF});
  assert.equal(g.blocked,true);
  assert.ok(g.blockers.some(b=>b.code==='BREAKDOWN_OPEN'));
});
test('gate: a resolved breakdown does not block', ()=>{
  const g=EquipmentGates.getEquipmentSafetyGate(eq({downtimeRecords:[{id:'BR-1',status:'resolved',resolved:true}]}),{asOf:ASOF});
  assert.equal(g.blocked,false);
});

// ── Pre-use checks ──
test('gate: a failed latest pre-use check blocks immediately', ()=>{
  const g=EquipmentGates.getEquipmentSafetyGate(eq({preUseChecks:[{id:'PUC-1',result:'failed'}]}),{asOf:ASOF});
  assert.equal(g.blocked,true);
  assert.ok(g.blockers.some(b=>b.code==='PREUSE_CHECK_FAILED'));
});
test('gate: a later UNRELATED passed pre-use check does NOT clear an older unresolved failed one', ()=>{
  const g=EquipmentGates.getEquipmentSafetyGate(eq({preUseChecks:[{id:'PUC-2',result:'passed'},{id:'PUC-1',result:'failed'}]}),{asOf:ASOF});
  assert.equal(g.blocked,true);
  assert.ok(g.blockers.some(b=>b.code==='PREUSE_CHECK_FAILED'));
});
test('gate: a failed pre-use check explicitly marked resolved no longer blocks', ()=>{
  const g=EquipmentGates.getEquipmentSafetyGate(eq({preUseChecks:[{id:'PUC-2',result:'passed'},{id:'PUC-1',result:'failed',resolved:true}]}),{asOf:ASOF});
  assert.equal(g.blocked,false);
});
test('gate: a mandatory pre-use check only applies when requirePreUseCheck is requested (use context), not on a bare status query', ()=>{
  const item=eq({requirements:{preUseCheckRequired:true}});
  const bare=EquipmentGates.getEquipmentSafetyGate(item,{asOf:ASOF});
  assert.equal(bare.blocked,false,'without requirePreUseCheck, the missing-check rule must not fire');
  const forUse=EquipmentGates.getEquipmentSafetyGate(item,{asOf:ASOF,requirePreUseCheck:true});
  assert.equal(forUse.blocked,true);
  assert.ok(forUse.blockers.some(b=>b.code==='PREUSE_CHECK_REQUIRED_MISSING'));
});
test('gate: a matching passed pre-use check for the same calendar date satisfies the mandatory requirement', ()=>{
  const item=eq({requirements:{preUseCheckRequired:true},preUseChecks:[{id:'PUC-1',result:'passed',date:ASOF}]});
  const g=EquipmentGates.getEquipmentSafetyGate(item,{asOf:ASOF,requirePreUseCheck:true,date:ASOF});
  assert.equal(g.blocked,false);
});
test('gate: a passed pre-use check for a DIFFERENT date does not satisfy the mandatory requirement for today', ()=>{
  const item=eq({requirements:{preUseCheckRequired:true},preUseChecks:[{id:'PUC-1',result:'passed',date:'2026-08-29'}]});
  const g=EquipmentGates.getEquipmentSafetyGate(item,{asOf:ASOF,requirePreUseCheck:true,date:ASOF});
  assert.equal(g.blocked,true);
});
test('gate: when a jobcardNo is supplied, a matching passed check must reference that same jobcard', ()=>{
  const item=eq({requirements:{preUseCheckRequired:true},preUseChecks:[{id:'PUC-1',result:'passed',date:ASOF,jobcardNo:'JC-OTHER'}]});
  const wrongJob=EquipmentGates.getEquipmentSafetyGate(item,{asOf:ASOF,requirePreUseCheck:true,date:ASOF,jobcardNo:'JC-1'});
  assert.equal(wrongJob.blocked,true);
  const rightJob=EquipmentGates.getEquipmentSafetyGate(item,{asOf:ASOF,requirePreUseCheck:true,date:ASOF,jobcardNo:'JC-OTHER'});
  assert.equal(rightJob.blocked,false);
});

// ── skipStatusCheck (used by returnEquipmentToService) ──
test('gate: skipStatusCheck ignores the current non-operational status but still evaluates every other blocker', ()=>{
  const clean=EquipmentGates.getEquipmentSafetyGate(eq({status:'Quarantined'}),{asOf:ASOF,skipStatusCheck:true});
  assert.equal(clean.blocked,false,'with no other blocker, only the status itself was in the way');
  const stillBroken=EquipmentGates.getEquipmentSafetyGate(eq({status:'Quarantined',downtimeRecords:[{id:'BR-1',status:'Reported'}]}),{asOf:ASOF,skipStatusCheck:true});
  assert.equal(stillBroken.blocked,true,'an open breakdown still blocks even with the status check skipped');
});

// ── Result shape / immutability ──
test('gate: result shape matches {blocked,code,reasons,equipmentId,status,blockers}', ()=>{
  const g=EquipmentGates.getEquipmentSafetyGate(eq({equipmentId:'E-77',status:'Out of Service'}),{asOf:ASOF});
  assert.deepEqual(Object.keys(g).sort(),['blocked','blockers','code','equipmentId','reasons','status'].sort());
  assert.equal(g.equipmentId,'E-77');
  assert.equal(g.status,'Out of Service');
});
test('gate: the pure function never mutates the equipment record it is given', ()=>{
  const item=eq({status:'Out of Service',inspections:[{id:'INS-1',result:'failed'}]});
  const before=JSON.parse(JSON.stringify(item));
  EquipmentGates.getEquipmentSafetyGate(item,{asOf:ASOF});
  assert.deepEqual(item,before);
});
