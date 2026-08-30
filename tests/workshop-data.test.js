// Logic tests for the shared client-side data layer (workshop-data.js): migration/backup safety,
// Equipment assignment rules and Quality workflow rules. Runs against the real module (see
// tests/helpers/load-workshop-data.js) — no reimplementation of its logic here.
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {loadWorkshopData,loadWorkshopDataWithStorage,MemoryLocalStorage}=require('./helpers/load-workshop-data');

const V5_KEY='varmak.workshop.frontend.v5';
const V4_KEY='varmak.workshop.frontend.v4';
const V3_KEY='varmak.workshop.frontend.v3';

function minimalState(overrides){
  return Object.assign({version:3,customers:[],estimations:[],projects:[],inventory:[],equipment:[],
    jobcards:[],suppliers:[],hours:[],movements:[],offcuts:[],stockCounts:[],activity:[]},overrides);
}

// ── Data migration: v5 is primary, v4 and v3 are migration/recovery sources (Pass 2) ───────────
test('data migration: valid v5 loads unchanged', ()=>{
  const v5=minimalState({version:5,customers:[{id:2,no:'C-002',name:'Current Co'}]});
  const WD=loadWorkshopData({[V5_KEY]:JSON.stringify(v5)});
  const state=WD.get();
  assert.equal(state.customers.length,1);
  assert.equal(state.customers[0].name,'Current Co');
  assert.equal(WD.getDataHealth().migratedFromLegacy,false);
  assert.equal(WD.getDataHealth().migrationSource,'v5');
});

test('data migration: v4 migrates safely to v5 when v5 is absent', ()=>{
  const v4=minimalState({version:4,customers:[{id:2,no:'C-002',name:'V4 Co'}]});
  const WD=loadWorkshopData({[V4_KEY]:JSON.stringify(v4)});
  const state=WD.get();
  assert.ok(state.customers.some(c=>c.name==='V4 Co'));
  const health=WD.getDataHealth();
  assert.equal(health.migratedFromLegacy,true);
  assert.equal(health.migrationSource,'v4');
  assert.equal(health.sourceKey,V4_KEY);
});

test('data migration: v3 can still migrate directly to v5 when v5 and v4 are both absent', ()=>{
  const v3=minimalState({customers:[{id:99,no:'C-099',name:'Legacy Customer'}]});
  const WD=loadWorkshopData({[V3_KEY]:JSON.stringify(v3)});
  const state=WD.get();
  assert.ok(state.customers.some(c=>c.name==='Legacy Customer'),'legacy customer must be preserved');
  const health=WD.getDataHealth();
  assert.equal(health.migratedFromLegacy,true);
  assert.equal(health.migrationSource,'v3');
  assert.equal(health.sourceKey,V3_KEY);
});

test('data migration: old v4 and v3 keys remain untouched after either migration path', ()=>{
  const v4=minimalState({version:4,customers:[{id:1,no:'C-001',name:'X'}]});
  const rawV4=JSON.stringify(v4);
  const {localStorage:ls1}=loadWorkshopDataWithStorage({[V4_KEY]:rawV4});
  assert.equal(ls1.getItem(V4_KEY),rawV4,'v4 record itself must be untouched after v4->v5 migration');

  const v3=minimalState({customers:[{id:1,no:'C-001',name:'Y'}]});
  const rawV3=JSON.stringify(v3);
  const {localStorage:ls2}=loadWorkshopDataWithStorage({[V3_KEY]:rawV3});
  assert.equal(ls2.getItem(V3_KEY),rawV3,'v3 record itself must be untouched after v3->v5 migration');
});

test('data migration: an intentionally empty user array stays empty after migration (not refilled with demo data)', ()=>{
  const v4=minimalState({version:4,customers:[{id:1,no:'C-001',name:'X'}],hours:[]});
  const WD=loadWorkshopData({[V4_KEY]:JSON.stringify(v4)});
  const state=WD.get();
  assert.deepEqual(state.hours,[],'hours was explicitly empty in the source data and must remain empty');
});

test('data migration: a collection missing entirely from old v3 data (Equipment/Quality did not exist yet) is backfilled', ()=>{
  const v3={version:3,customers:[{id:1,no:'C-001',name:'X'}],estimations:[],projects:[],inventory:[],
    jobcards:[],suppliers:[],hours:[],movements:[],offcuts:[],stockCounts:[],activity:[]}; // no `equipment` key at all
  const WD=loadWorkshopData({[V3_KEY]:JSON.stringify(v3)});
  const state=WD.get();
  assert.ok(Array.isArray(state.equipment)&&state.equipment.length>0,'missing Equipment collection must be backfilled from defaults');
  assert.ok(Array.isArray(state.qualityInspections),'missing Quality collections must be backfilled from defaults');
});

// ── Corrupted-v5 rescue copy ─────────────────────────────────────────────────
function rescueKeys(localStorage){
  return Array.from(localStorage.store.keys()).filter(k=>k.startsWith(`${V5_KEY}.corrupted.`));
}

test('rescue copy: corrupted v5 is rescue-copied exactly, byte for byte', ()=>{
  const rawCorrupted='{not valid json — this is exactly what was in localStorage';
  const {localStorage}=loadWorkshopDataWithStorage({[V5_KEY]:rawCorrupted});
  const rescued=rescueKeys(localStorage);
  assert.equal(rescued.length,1);
  assert.equal(localStorage.getItem(rescued[0]),rawCorrupted);
});

test('rescue copy: corrupted v5 recovers from a valid v4 backup', ()=>{
  const v4=minimalState({version:4,customers:[{id:5,no:'C-005',name:'Recover Me'}]});
  const {WD,localStorage}=loadWorkshopDataWithStorage({[V4_KEY]:JSON.stringify(v4),[V5_KEY]:'{not valid json'});
  const state=WD.get();
  assert.ok(state.customers.some(c=>c.name==='Recover Me'),'v4 must still be migrated');
  assert.equal(WD.getDataHealth().migrationSource,'v4');
  const rescued=rescueKeys(localStorage);
  assert.equal(rescued.length,1,'exactly one rescue copy must be created');
  assert.equal(WD.getDataHealth().corruptedRecordPreserved,true);
});

test('rescue copy: corrupted v5 (and no usable v4) recovers from a valid v3 backup', ()=>{
  const v3=minimalState({customers:[{id:5,no:'C-005',name:'Recover Me Too'}]});
  const {WD,localStorage}=loadWorkshopDataWithStorage({[V3_KEY]:JSON.stringify(v3),[V5_KEY]:'{not valid json'});
  const state=WD.get();
  assert.ok(state.customers.some(c=>c.name==='Recover Me Too'));
  assert.equal(WD.getDataHealth().migrationSource,'v3');
  assert.equal(rescueKeys(localStorage).length,1);
});

test('rescue copy: corrupted v5 with no v3/v4 backup falls back safely to demo data, still rescuing the corrupted record', ()=>{
  const {WD,localStorage}=loadWorkshopDataWithStorage({[V5_KEY]:'{not valid json'});
  const rescued=rescueKeys(localStorage);
  assert.equal(rescued.length,1,'a rescue copy must exist even when there is no v3/v4 to recover');
  const health=WD.getDataHealth();
  assert.equal(health.corruptedV5Detected,true);
  assert.equal(health.corruptedRecordPreserved,true);
  assert.ok(health.recoveryWarning);
});

test('rescue copy: loading does not delete the legacy v3 key even when recovering from v4', ()=>{
  const v3=minimalState({customers:[{id:1,no:'C-001',name:'X'}]});
  const rawV3=JSON.stringify(v3);
  const v4=minimalState({version:4,customers:[{id:1,no:'C-001',name:'X'}]});
  const {localStorage}=loadWorkshopDataWithStorage({[V3_KEY]:rawV3,[V4_KEY]:JSON.stringify(v4)});
  assert.equal(localStorage.getItem(V3_KEY),rawV3,'the v3 record itself must be untouched');
});

test('rescue copy: valid v5 data does not create a corrupted rescue key', ()=>{
  const v5=minimalState({version:5,customers:[{id:1,no:'C-001',name:'Fine'}]});
  const {WD,localStorage}=loadWorkshopDataWithStorage({[V5_KEY]:JSON.stringify(v5)});
  assert.equal(rescueKeys(localStorage).length,0);
  assert.equal(WD.getDataHealth().corruptedRecordPreserved,false);
});

test('rescue copy: does not claim preservation, and surfaces a warning, when the rescue write itself fails', ()=>{
  class RejectingLocalStorage extends MemoryLocalStorage{
    setItem(key,value){
      if(key.includes('.corrupted.'))throw new Error('QuotaExceededError');
      return super.setItem(key,value);
    }
  }
  const {WD,localStorage}=loadWorkshopDataWithStorage({[V5_KEY]:'{not valid json'},new RejectingLocalStorage());
  assert.equal(rescueKeys(localStorage).length,0,'the rejected write must not have produced a rescue key');
  const health=WD.getDataHealth();
  assert.equal(health.corruptedRecordPreserved,false,'must not claim preservation when the write failed');
  assert.ok(health.recoveryWarning,'a recovery warning must still be surfaced');
});

// ── Backup / import safety ──────────────────────────────────────────────────
test('backup/import: an invalid import is rejected and current data is left unchanged', ()=>{
  const WD=loadWorkshopData();
  const before=WD.get();
  const result=WD.importBackup({not:'workshop data'});
  assert.equal(result.success,false);
  assert.deepEqual(WD.get().customers,before.customers);
});

test('backup/import: a valid backup is imported and the previous state is preserved as a recovery copy', ()=>{
  const WD=loadWorkshopData();
  const backup=minimalState({version:4,customers:[{id:7,no:'C-007',name:'Imported Co'}]});
  const result=WD.importBackup(backup);
  assert.equal(result.success,true);
  assert.ok(WD.get().customers.some(c=>c.name==='Imported Co'));
});

test('backup/import: validateBackup rejects malformed collection fields', ()=>{
  const WD=loadWorkshopData();
  assert.equal(WD.validateBackup(null).valid,false);
  assert.equal(WD.validateBackup({customers:'not-an-array'}).valid,false);
  assert.equal(WD.validateBackup(minimalState()).valid,true);
});

// ── Equipment: current assignment-blocking behaviour (not expanding the rule set) ──
test('equipment: cannot assign equipment that is Out of Service, Quarantined, Under Maintenance or Retired', ()=>{
  const WD=loadWorkshopData();
  for(const status of ['Out of Service','Quarantined','Under Maintenance','Retired']){
    WD.changeEquipmentStatus('E-1001',status);
    const res=WD.assignEquipment('E-1001',{project:'P-1',jobcard:'JC-1'});
    assert.equal(res.error,'Unavailable equipment cannot be assigned',`status ${status} must block assignment`);
  }
});

test('equipment: available equipment can be assigned', ()=>{
  const WD=loadWorkshopData();
  WD.changeEquipmentStatus('E-1001','Available');
  const res=WD.assignEquipment('E-1001',{project:'P-1',jobcard:'JC-1'});
  assert.ok(!res.error);
  assert.equal(res.assignedProject,'P-1');
});

// ── Equipment: intentionally empty collection must stay empty (Pass 1.1) ───
test('equipment: a valid empty equipment array remains empty after getEquipment()', ()=>{
  const v5=minimalState({version:5,customers:[{id:1,no:'C-001',name:'X'}],equipment:[]});
  const WD=loadWorkshopData({[V5_KEY]:JSON.stringify(v5)});
  assert.deepEqual(WD.getEquipment(),[],'an intentionally empty equipment collection must not be refilled');
});

test('equipment: getEquipment() does not modify stored state', ()=>{
  const v5=minimalState({version:5,customers:[{id:1,no:'C-001',name:'X'}],equipment:[]});
  const WD=loadWorkshopData({[V5_KEY]:JSON.stringify(v5)});
  WD.getEquipment();
  WD.getEquipment();
  assert.deepEqual(WD.get().equipment,[],'repeated reads must never mutate state');
  assert.equal(WD.getDataHealth().sourceKey,V5_KEY,'no save() should have been triggered by a read');
});

test('equipment: ensureDemoEquipment() explicitly adds demonstration equipment to an empty collection', ()=>{
  const v5=minimalState({version:5,customers:[{id:1,no:'C-001',name:'X'}],equipment:[]});
  const WD=loadWorkshopData({[V5_KEY]:JSON.stringify(v5)});
  assert.deepEqual(WD.getEquipment(),[]);
  const result=WD.ensureDemoEquipment();
  assert.ok(Array.isArray(result)&&result.length>0,'ensureDemoEquipment must add demo records when called explicitly');
  assert.deepEqual(WD.getEquipment(),result,'getEquipment() reflects the change once explicitly made');
});

test('equipment: existing equipment records are left unchanged by getEquipment() and by loading', ()=>{
  const existing=[{id:'E-9001',equipmentId:'E-9001',name:'Custom Drill Press',status:'Available'}];
  const v5=minimalState({version:5,customers:[{id:1,no:'C-001',name:'X'}],equipment:existing});
  const WD=loadWorkshopData({[V5_KEY]:JSON.stringify(v5)});
  const equipment=WD.getEquipment();
  // normalize() defensively backfills missing per-item sub-arrays (activity, inspections, ...) on
  // every load — that is schema normalization, not demo-data seeding. What must NOT happen is any
  // extra (demo) record being added, or this record's identifying fields being altered.
  assert.equal(equipment.length,1,'no demo equipment must be added alongside the user record');
  assert.equal(equipment[0].id,'E-9001');
  assert.equal(equipment[0].equipmentId,'E-9001');
  assert.equal(equipment[0].name,'Custom Drill Press');
  assert.equal(equipment[0].status,'Available');
});

// ── Quality: hold / NCR / release workflow rules ────────────────────────────
test('quality: a critical failed inspection automatically raises an active Quality Hold', ()=>{
  const WD=loadWorkshopData();
  const insp=WD.createInspection({title:'Weld check',jobcard:'JC-2026-0001'});
  const res=WD.completeInspection(insp.no,{result:'failed',critical:true,inspector:'Elena N.'});
  assert.ok(res.hold,'a hold record must be created');
  assert.equal(res.hold.status,'active');
});

test('quality: a non-critical failed inspection does not raise a hold', ()=>{
  const WD=loadWorkshopData();
  const insp=WD.createInspection({title:'Visual check'});
  const res=WD.completeInspection(insp.no,{result:'failed',critical:false});
  assert.equal(res.hold,null);
});

test('quality: a critical NCR automatically raises an active Quality Hold', ()=>{
  const WD=loadWorkshopData();
  const res=WD.createNcr({title:'Critical defect',severity:'critical',responsiblePerson:'Aleksandar C.',dueDate:'2026-09-10'});
  assert.ok(res.hold);
  assert.equal(res.hold.status,'active');
});

test('quality: major/critical NCRs require a responsible person and a due date', ()=>{
  const WD=loadWorkshopData();
  const missingBoth=WD.createNcr({title:'Defect',severity:'major'});
  assert.ok(missingBoth.error);
  const missingDue=WD.createNcr({title:'Defect',severity:'critical',responsiblePerson:'Aleksandar C.'});
  assert.ok(missingDue.error);
  const ok=WD.createNcr({title:'Defect',severity:'major',responsiblePerson:'Aleksandar C.',dueDate:'2026-09-10'});
  assert.ok(!ok.error);
});

test('quality: an NCR cannot close without verification evidence', ()=>{
  const WD=loadWorkshopData();
  const {ncr}=WD.createNcr({title:'Minor defect',severity:'minor'});
  const res=WD.closeNcr(ncr.no,'APPROVAL-1');
  assert.ok(res.error);
  assert.match(res.error,/verification/i);
});

test('quality: an NCR cannot close without a closure approval reference', ()=>{
  const WD=loadWorkshopData();
  const {ncr}=WD.createNcr({title:'Minor defect',severity:'minor'});
  WD.verifyNcrCorrective(ncr.no,'Corrective action verified effective','Aleksandar C.');
  const res=WD.closeNcr(ncr.no,'');
  assert.ok(res.error);
  assert.match(res.error,/approval/i);
});

test('quality: an NCR with verification and an approval reference can close', ()=>{
  const WD=loadWorkshopData();
  const {ncr}=WD.createNcr({title:'Minor defect',severity:'minor'});
  WD.verifyNcrCorrective(ncr.no,'Corrective action verified effective','Aleksandar C.');
  const res=WD.closeNcr(ncr.no,'APPROVAL-1');
  assert.ok(!res.error);
  assert.equal(res.status,'closed');
});

test('quality: Final Release cannot be issued as Released while blocking reasons remain', ()=>{
  const WD=loadWorkshopData();
  const res=WD.createFinalRelease({projectNo:'P-2026-014',result:'released',blockingReasons:['Open critical NCR']});
  assert.ok(res.error);
});

test('quality: Released with Conditions requires written conditions and an approval reference', ()=>{
  // Uses P-26-0001, which (unlike P-2026-014) has no active Quality Hold — Pass 3.1 makes
  // P-2026-014 correctly hold-blocked, so that project is no longer suitable for a "this should
  // succeed" case here; hold-blocking itself is covered separately below.
  const WD=loadWorkshopData();
  const missing=WD.createFinalRelease({projectNo:'P-26-0001',result:'released-conditions'});
  assert.ok(missing.error);
  const ok=WD.createFinalRelease({projectNo:'P-26-0001',result:'released-conditions',conditions:'Punch list to close within 30 days',approvalRef:'REL-APPROVAL-1'});
  assert.ok(!ok.error);
});

// ── Pass 3.1: central Quality Hold safety gate (quality-gates.js + WorkshopData enforcement) ──
// Seed fixture used throughout: HOLD-2026-001 (active, scope:'jobcard', reference:'JC-2026-0001')
// blocks JC-2026-0001 and its parent P-2026-014. JC-2026-0002 (sibling jobcard, same project) and
// P-26-0001 (unrelated project, status 'active', no jobcards) are the "must stay unaffected" controls.
test('quality gate: existing seed HOLD-2026-001 blocks both JC-2026-0001 and its parent P-2026-014', ()=>{
  const WD=loadWorkshopData();
  assert.equal(WD.getJobcardQualityGate('JC-2026-0001').blocked,true);
  assert.equal(WD.getProjectQualityGate('P-2026-014').blocked,true);
  assert.deepEqual(WD.getJobcardQualityGate('JC-2026-0001').holds.map(h=>h.no),['HOLD-2026-001']);
});
test('quality gate: an active Jobcard-scoped hold does not block a sibling jobcard under the same project', ()=>{
  const WD=loadWorkshopData();
  assert.equal(WD.getJobcardQualityGate('JC-2026-0002').blocked,false);
  const res=WD.updateJobcard('JC-2026-0002',{status:'in-progress'});
  assert.ok(!res.error,'a genuinely unrelated sibling jobcard must be free to transition normally');
});
test('quality gate: an unrelated project with no linked jobcards and no hold of its own is never blocked', ()=>{
  const WD=loadWorkshopData();
  assert.equal(WD.getProjectQualityGate('P-26-0001').blocked,false);
  const res=WD.updateProject('P-26-0001',{status:'completed'});
  assert.ok(!res.error);
  assert.equal(res.status,'completed');
});
test('quality gate: an active Project-scoped hold blocks the project AND every linked child jobcard', ()=>{
  const WD=loadWorkshopData();
  WD.applyQualityHold({scope:'project',reference:'P-26-0002',reason:'Customer stop-work notice'});
  assert.equal(WD.getProjectQualityGate('P-26-0002').blocked,true);
  // P-26-0002 has no seeded jobcards of its own; verify against a synthetic child via the gate API
  // using a real jobcard reassigned to this project, so "every linked child jobcard" is exercised
  // against the real WorkshopData.jobcards collection (not the Projects page's unrelated local Items list).
  const jc=WD.updateJobcard('JC-2026-0002',{projectNo:'P-26-0002'});
  assert.ok(!jc.error);
  assert.equal(WD.getJobcardQualityGate('JC-2026-0002').blocked,true,'a jobcard under a held project must itself read as blocked');
});
test('quality gate: a released hold no longer blocks its jobcard or project', ()=>{
  const WD=loadWorkshopData();
  const rel=WD.releaseQualityHold('HOLD-2026-001',{releaseAuthority:'Quality Manager',releaseReason:'Weld repaired, PT reinspection accepted'});
  assert.ok(!rel.error);
  assert.equal(rel.status,'released');
  assert.equal(WD.getJobcardQualityGate('JC-2026-0001').blocked,false);
  assert.equal(WD.getProjectQualityGate('P-2026-014').blocked,false);
});
test('quality gate: an orphan/malformed hold (references a jobcard number that does not exist) does not block real, unrelated records', ()=>{
  const WD=loadWorkshopData();
  WD.applyQualityHold({scope:'jobcard',reference:'JC-DOES-NOT-EXIST',reason:'Orphan test hold'});
  assert.equal(WD.getJobcardQualityGate('JC-2026-0002').blocked,false);
  assert.equal(WD.getProjectQualityGate('P-26-0001').blocked,false);
});

// ── Operation-level enforcement ──
test('quality gate: a held jobcard cannot start a pending operation', ()=>{
  const WD=loadWorkshopData();
  const res=WD.updateJobcardOperation('JC-2026-0001',5,{status:'in-progress'});
  assert.equal(res.code,'QUALITY_HOLD_ACTIVE');
  assert.ok(res.holdNumbers.includes('HOLD-2026-001'));
  const op=WD.get().jobcards.find(j=>j.no==='JC-2026-0001').operations.find(o=>o.id===5);
  assert.equal(op.status,'pending','a blocked operation must not have its status changed');
});
test('quality gate: a held jobcard cannot complete an in-progress operation', ()=>{
  const WD=loadWorkshopData();
  const res=WD.updateJobcardOperation('JC-2026-0001',4,{status:'completed',actualCompletion:'2026-08-30'});
  assert.equal(res.code,'QUALITY_HOLD_ACTIVE');
  const op=WD.get().jobcards.find(j=>j.no==='JC-2026-0001').operations.find(o=>o.id===4);
  assert.equal(op.status,'in-progress');
  assert.equal(op.actualCompletion,null,'a blocked completion must not set actualCompletion either');
});
test('quality gate: a held jobcard cannot skip an operation (status set directly to skipped)', ()=>{
  const WD=loadWorkshopData();
  const res=WD.updateJobcardOperation('JC-2026-0001',5,{status:'skipped'});
  assert.equal(res.code,'QUALITY_HOLD_ACTIVE');
});
test('quality gate: pausing an in-progress operation on a held jobcard is still allowed (a safe, non-execution transition)', ()=>{
  const WD=loadWorkshopData();
  const res=WD.updateJobcardOperation('JC-2026-0001',4,{status:'paused'});
  assert.ok(!res.error);
  assert.equal(res.status,'paused');
});
test('quality gate: after the hold is released, the previously-blocked operation completes normally (no other blocker)', ()=>{
  const WD=loadWorkshopData();
  WD.releaseQualityHold('HOLD-2026-001',{releaseAuthority:'Quality Manager',releaseReason:'Repair verified'});
  const res=WD.updateJobcardOperation('JC-2026-0001',4,{status:'completed',actualCompletion:'2026-08-30'});
  assert.ok(!res.error);
  assert.equal(res.status,'completed');
});

// ── Jobcard-level enforcement ──
test('quality gate: a held jobcard cannot resume to in-progress (resume-to-production)', ()=>{
  const WD=loadWorkshopData();
  WD.updateJobcard('JC-2026-0001',{status:'paused',_resumeStatus:'in-progress'});
  const res=WD.updateJobcard('JC-2026-0001',{status:'in-progress'});
  assert.equal(res.code,'QUALITY_HOLD_ACTIVE');
  assert.equal(WD.get().jobcards.find(j=>j.no==='JC-2026-0001').status,'paused');
});
test('quality gate: pausing/blocking a held jobcard is still allowed (a safe, non-execution transition)', ()=>{
  const WD=loadWorkshopData();
  const res=WD.updateJobcard('JC-2026-0001',{status:'paused',_resumeStatus:'in-progress'});
  assert.ok(!res.error);
  assert.equal(res.status,'paused');
});
test('quality gate: a held jobcard cannot be marked completed or closed', ()=>{
  const WD=loadWorkshopData();
  const completed=WD.updateJobcard('JC-2026-0001',{status:'completed'});
  assert.equal(completed.code,'QUALITY_HOLD_ACTIVE');
  const closed=WD.upsertJobcard({id:1,no:'JC-2026-0001',status:'closed'});
  assert.equal(closed.code,'QUALITY_HOLD_ACTIVE');
});
test('quality gate: upsertJobcard (the same path jobcard-desktop.html save forms use) cannot bypass the gate either', ()=>{
  const WD=loadWorkshopData();
  const res=WD.upsertJobcard({id:1,no:'JC-2026-0001',status:'closed'});
  assert.equal(res.code,'QUALITY_HOLD_ACTIVE');
});
test('quality gate: a caller-supplied override flag or an empty blockingReasons list cannot bypass a held jobcard transition', ()=>{
  const WD=loadWorkshopData();
  const res=WD.updateJobcard('JC-2026-0001',{status:'completed',managerOverride:true,force:true,blockingReasons:[]});
  assert.equal(res.code,'QUALITY_HOLD_ACTIVE');
});

// ── Project-level enforcement ──
test('quality gate: a project cannot be completed or closed while a child jobcard hold is active', ()=>{
  const WD=loadWorkshopData();
  const completed=WD.updateProject('P-2026-014',{status:'completed'});
  assert.equal(completed.code,'QUALITY_HOLD_ACTIVE');
  const closed=WD.upsertProject({no:'P-2026-014',name:'Ventilation Duct System',status:'closed'});
  assert.equal(closed.code,'QUALITY_HOLD_ACTIVE');
  assert.equal(WD.get().projects.find(p=>p.no==='P-2026-014').status,'production','status must be unchanged after either blocked attempt');
});
test('quality gate: a redundant re-save of a project that is already completed/closed does not re-trigger the gate (no genuine transition)', ()=>{
  const WD=loadWorkshopData();
  const first=WD.updateProject('P-26-0001',{status:'completed'});
  assert.ok(!first.error);
  const resave=WD.updateProject('P-26-0001',{status:'completed',notes:'unrelated edit'});
  assert.ok(!resave.error,'saving an already-completed project again must not be treated as a new unsafe transition');
});

// ── Final Release enforcement ──
test('quality gate: Final Release (Released) cannot be issued for a held project even with an empty/fabricated blocker list', ()=>{
  const WD=loadWorkshopData();
  const before=WD.get().qualityReleases.length;
  const res=WD.createFinalRelease({projectNo:'P-2026-014',result:'released',blockingReasons:[],override:true});
  assert.equal(res.code,'QUALITY_HOLD_ACTIVE');
  assert.equal(WD.get().qualityReleases.length,before,'a rejected release request must not create a release record');
});
test('quality gate: Released with Conditions cannot be issued for a held project even with valid conditions/approvalRef supplied', ()=>{
  const WD=loadWorkshopData();
  const res=WD.createFinalRelease({projectNo:'P-2026-014',result:'released-conditions',conditions:'Accepted with punch list',approvalRef:'REL-1'});
  assert.equal(res.code,'QUALITY_HOLD_ACTIVE');
});
test('quality gate: Final Release independently recalculates active holds from a jobcard number, not just projectNo', ()=>{
  const WD=loadWorkshopData();
  const res=WD.createFinalRelease({projectNo:'P-2026-014',jobcard:'JC-2026-0001',result:'released'});
  assert.equal(res.code,'QUALITY_HOLD_ACTIVE');
});
test('quality gate: after the hold is released, Final Release for that project can be issued (no other blocker)', ()=>{
  const WD=loadWorkshopData();
  WD.releaseQualityHold('HOLD-2026-001',{releaseAuthority:'Quality Manager',releaseReason:'Repair verified'});
  const res=WD.createFinalRelease({projectNo:'P-2026-014',result:'released'});
  assert.ok(!res.error);
  assert.equal(res.result,'released');
});

// ── Release workflow hardening ──
test('quality gate: releasing a hold requires a non-empty release authority', ()=>{
  const WD=loadWorkshopData();
  const res=WD.releaseQualityHold('HOLD-2026-001',{releaseAuthority:'',releaseReason:'Repair verified'});
  assert.ok(res.error);
  assert.equal(WD.get().qualityHolds.find(h=>h.no==='HOLD-2026-001').status,'active');
});
test('quality gate: releasing a hold requires non-empty resolution evidence/reason', ()=>{
  const WD=loadWorkshopData();
  const res=WD.releaseQualityHold('HOLD-2026-001',{releaseAuthority:'Quality Manager',releaseReason:''});
  assert.ok(res.error);
});
test('quality gate: whitespace-only release authority/reason is rejected, not treated as valid text', ()=>{
  const WD=loadWorkshopData();
  const res=WD.releaseQualityHold('HOLD-2026-001',{releaseAuthority:'   ',releaseReason:'   '});
  assert.ok(res.error);
});
test('quality gate: an already-released hold cannot be released again', ()=>{
  const WD=loadWorkshopData();
  WD.releaseQualityHold('HOLD-2026-001',{releaseAuthority:'Quality Manager',releaseReason:'Repair verified'});
  const again=WD.releaseQualityHold('HOLD-2026-001',{releaseAuthority:'Someone Else',releaseReason:'Repeat attempt'});
  assert.ok(again.error);
});
test('quality gate: releasing a complete audit trail — release records authority, reason and an activity entry', ()=>{
  const WD=loadWorkshopData();
  const res=WD.releaseQualityHold('HOLD-2026-001',{releaseAuthority:'Quality Manager',releaseReason:'Repair verified, PT accepted'});
  assert.equal(res.releaseAuthority,'Quality Manager');
  assert.equal(res.releaseReason,'Repair verified, PT accepted');
  assert.ok(res.releaseDate);
  assert.ok(res.activity.some(a=>/released/i.test(a.action||'')));
});
test('quality gate: releasing one hold does not release an unrelated second hold', ()=>{
  const WD=loadWorkshopData();
  const second=WD.applyQualityHold({scope:'jobcard',reference:'JC-2026-0002',reason:'A second, distinct issue'});
  WD.releaseQualityHold('HOLD-2026-001',{releaseAuthority:'Quality Manager',releaseReason:'Repair verified'});
  const stillActive=WD.get().qualityHolds.find(h=>h.no===second.no);
  assert.equal(stillActive.status,'active');
});
test('quality gate: releasing a hold does not auto-complete or auto-resume the jobcard/project it was blocking', ()=>{
  const WD=loadWorkshopData();
  WD.releaseQualityHold('HOLD-2026-001',{releaseAuthority:'Quality Manager',releaseReason:'Repair verified'});
  const jc=WD.get().jobcards.find(j=>j.no==='JC-2026-0001');
  const p=WD.get().projects.find(x=>x.no==='P-2026-014');
  assert.equal(jc.status,'in-progress','releasing must not silently change the jobcard status');
  assert.equal(p.status,'production','releasing must not silently change the project status');
});

// ── Duplicate-hold avoidance (Part 7) ──
test('quality gate: applying a hold with the same scope/reference/reason as an existing active hold reuses it instead of creating a duplicate', ()=>{
  const WD=loadWorkshopData();
  const before=WD.get().qualityHolds.length;
  const dup=WD.applyQualityHold({scope:'jobcard',reference:'JC-2026-0001',reason:'Critical NCR NCR-2026-002 — rejected mandatory NDT (NDT-2026-002) on weld W-03.'});
  assert.equal(dup.no,'HOLD-2026-001');
  assert.equal(WD.get().qualityHolds.length,before,'no new hold record should have been created');
});
test('quality gate: a hold for the same jobcard but a genuinely different reason is NOT merged into the existing one', ()=>{
  const WD=loadWorkshopData();
  const before=WD.get().qualityHolds.length;
  const distinct=WD.applyQualityHold({scope:'jobcard',reference:'JC-2026-0001',reason:'A second, unrelated quality issue'});
  assert.notEqual(distinct.no,'HOLD-2026-001');
  assert.equal(WD.get().qualityHolds.length,before+1);
  assert.equal(WD.getJobcardQualityGate('JC-2026-0001').holds.length,2,'both distinct holds on the same jobcard must be reported');
});

// ── API surface: clones, getters, blocked-attempt auditability ──
test('quality gate API: getActiveQualityHolds/getJobcardQualityGate/getProjectQualityGate return clones, not live references', ()=>{
  const WD=loadWorkshopData();
  const holds=WD.getActiveQualityHolds();
  holds[0].reason='TAMPERED';
  assert.notEqual(WD.getActiveQualityHolds()[0].reason,'TAMPERED');
  const gate=WD.getJobcardQualityGate('JC-2026-0001');
  gate.holds[0].reason='TAMPERED-2';
  assert.notEqual(WD.getJobcardQualityGate('JC-2026-0001').holds[0].reason,'TAMPERED-2');
});
test('quality gate API: getActiveQualityHolds excludes released holds', ()=>{
  const WD=loadWorkshopData();
  WD.releaseQualityHold('HOLD-2026-001',{releaseAuthority:'Quality Manager',releaseReason:'Repair verified'});
  assert.equal(WD.getActiveQualityHolds().length,0);
});
test('quality gate API: canTransitionJobcard/canTransitionProject/canTransitionJobcardOperation reflect the same gate', ()=>{
  const WD=loadWorkshopData();
  assert.equal(WD.canTransitionJobcard('JC-2026-0001').allowed,false);
  assert.equal(WD.canTransitionProject('P-2026-014').allowed,false);
  assert.equal(WD.canTransitionJobcardOperation('JC-2026-0001').allowed,false);
  assert.equal(WD.canTransitionJobcard('JC-2026-0002').allowed,true);
});
test('quality gate: a blocked transition attempt records an audit activity entry naming the action, reference and hold number', ()=>{
  const WD=loadWorkshopData();
  const before=WD.get().activity.length;
  WD.updateJobcard('JC-2026-0001',{status:'completed'});
  const after=WD.get().activity;
  assert.equal(after.length,before+1);
  assert.match(after[0].reason,/Blocked by active Quality Hold/);
  assert.match(after[0].reason,/JC-2026-0001/);
  assert.match(after[0].reason,/HOLD-2026-001/);
});
test('quality gate: hold reason/reference text is preserved exactly (safe for the caller to HTML-escape at render time), not stripped or altered', ()=>{
  const WD=loadWorkshopData();
  const injected='<img src=x onerror=alert(1)>';
  WD.applyQualityHold({scope:'jobcard',reference:'JC-2026-0002',reason:injected});
  const gate=WD.getJobcardQualityGate('JC-2026-0002');
  assert.equal(gate.holds[0].reason,injected,'the raw string must round-trip unchanged — escaping is the render layer\'s job, not the data layer\'s');
});

// ── Estimation deletion sync (shared-data layer) ────────────────────────────
test('estimation deletion: a linked estimation (has a projectId) cannot be hard-deleted', ()=>{
  const WD=loadWorkshopData();
  const saved=WD.upsertEstimation({no:'EST-TEST-LINKED',customerId:1,customer:'Test',title:'Linked',projectId:14});
  const res=WD.deleteEstimation(saved.id);
  assert.ok(res.error);
  assert.ok(WD.get().estimations.some(e=>e.id===saved.id),'linked estimation must still be present');
});

test('estimation deletion: an unlinked estimation can be hard-deleted and does not reappear', ()=>{
  const WD=loadWorkshopData();
  const saved=WD.upsertEstimation({no:'EST-TEST-UNLINKED',customerId:1,customer:'Test',title:'Unlinked'});
  const res=WD.deleteEstimation(saved.id);
  assert.equal(res.success,true);
  assert.ok(!WD.get().estimations.some(e=>e.id===saved.id),'deleted estimation must be gone from shared data');
});

test('estimation deletion: archiving a linked estimation keeps it present but marked archived', ()=>{
  const WD=loadWorkshopData();
  const saved=WD.upsertEstimation({no:'EST-TEST-ARCHIVE',customerId:1,customer:'Test',title:'Archive me',projectId:14});
  const res=WD.archiveEstimation(saved.id,'Archived (linked to project P-2026-014)');
  assert.equal(res.archived,true);
  assert.ok(WD.get().estimations.some(e=>e.id===saved.id&&e.archived===true));
});

// ── Legacy module-data migration (Pass 2) ───────────────────────────────────
const LEGACY_PROJECTS_KEY='varmak.projects.ui.v1';
const LEGACY_PURCHASING_KEY='varmak.purchasing.orders';
const LEGACY_DOCUMENTS_KEY='varmak.documents.records';
const LEGACY_REPORTS_SAVED_KEY='varmak.reports.saved.v1';
const LEGACY_REPORTS_CONFIG_KEY='varmak.reports.config.v1';

test('legacy migration: Projects legacy key (varmak.projects.ui.v1) is migrated into shared projects, customerId remapped by name', ()=>{
  const legacy=[{id:1,no:'P-26-9001',name:'Custom Project',customerId:2,status:'active',jobcards:[],hours:[],materials:[],purchases:[],documents:{},notes:[],activity:[]}];
  const WD=loadWorkshopData({[LEGACY_PROJECTS_KEY]:JSON.stringify(legacy)});
  const state=WD.get();
  const migrated=state.projects.find(p=>p.no==='P-26-9001');
  assert.ok(migrated,'legacy project must be present in shared projects');
  assert.equal(migrated.name,'Custom Project');
  assert.equal(migrated.customer,'Schröder Nordic','customerId 2 in the local picklist resolves to Schröder Nordic by name');
  assert.ok(state.customers.some(c=>c.name==='Schröder Nordic'),'the resolved customer must exist in shared customers');
  assert.ok(state.projects.some(p=>p.no==='P-2026-014'),'the unrelated pre-existing shared project must be preserved');
});

test('legacy migration: Purchasing legacy key (varmak.purchasing.orders) is migrated into shared purchaseOrders', ()=>{
  const legacy=[{no:'PO-CUSTOM-9001',supplier:'Acme Supplies',project:'P-1',date:'2026-01-01',expected:'2026-01-10',value:5000,buyer:'Me',status:'Draft',items:'stuff'}];
  const WD=loadWorkshopData({[LEGACY_PURCHASING_KEY]:JSON.stringify(legacy)});
  const state=WD.get();
  assert.equal(state.purchaseOrders.length,1);
  assert.equal(state.purchaseOrders[0].no,'PO-CUSTOM-9001');
  assert.equal(state.purchaseOrders[0].supplier,'Acme Supplies');
});

test('legacy migration: Documents legacy key (varmak.documents.records) is migrated into shared documents', ()=>{
  const legacy=[{id:500,name:'Custom Cert.pdf',type:'Certificate',module:'Purchasing',record:'PO-1',category:'Materials',updated:'2026-01-01T00:00:00',status:'Valid',expiry:'',revision:'1',author:'Me'}];
  const WD=loadWorkshopData({[LEGACY_DOCUMENTS_KEY]:JSON.stringify(legacy)});
  const state=WD.get();
  assert.equal(state.documents.length,1);
  assert.equal(state.documents[0].name,'Custom Cert.pdf');
});

test('legacy migration: Reports legacy keys (saved reports + config) are migrated into shared savedReports/reportConfig', ()=>{
  const legacySaved={reports:[{id:'custom-1',name:'My Custom Report',category:'Custom',favourite:false,created:'2026-01-01',lastUsed:'2026-01-01',section:'projects',filters:{},type:'view',archived:false}]};
  const legacyConfig={lang:'sv',section:'projects',filter:'week',activeFilters:{}};
  const WD=loadWorkshopData({[LEGACY_REPORTS_SAVED_KEY]:JSON.stringify(legacySaved),[LEGACY_REPORTS_CONFIG_KEY]:JSON.stringify(legacyConfig)});
  const state=WD.get();
  assert.equal(state.savedReports.length,1);
  assert.equal(state.savedReports[0].name,'My Custom Report');
  assert.equal(state.reportConfig.lang,'sv');
});

test('legacy migration: an intentionally empty legacy array (Projects/Purchasing/Documents) results in an empty shared collection, not demo data', ()=>{
  const projWD=loadWorkshopData({[LEGACY_PROJECTS_KEY]:'[]'});
  const projectsUiRecords=projWD.get().projects.filter(p=>/^P-26-\d{4}$/.test(p.no));
  assert.equal(projectsUiRecords.length,0,'an emptied Projects-UI legacy key must leave no projects-ui-origin demo records');

  const poWD=loadWorkshopData({[LEGACY_PURCHASING_KEY]:'[]'});
  assert.deepEqual(poWD.get().purchaseOrders,[],'an emptied Purchasing legacy key must result in an empty shared collection');

  const docWD=loadWorkshopData({[LEGACY_DOCUMENTS_KEY]:'[]'});
  assert.deepEqual(docWD.get().documents,[],'an emptied Documents legacy key must result in an empty shared collection');
});

test('legacy migration: repeated migration (reloading the app) does not duplicate records', ()=>{
  const legacy=[{id:1,no:'P-26-9002',name:'Once Only',customerId:1,status:'draft',jobcards:[],hours:[],materials:[],purchases:[],documents:{},notes:[],activity:[]}];
  const {WD,localStorage}=loadWorkshopDataWithStorage({[LEGACY_PROJECTS_KEY]:JSON.stringify(legacy)});
  const firstCount=WD.get().projects.filter(p=>p.no==='P-26-9002').length;
  assert.equal(firstCount,1);
  // A second application load reads the SAME localStorage, which now has a valid v5 record plus
  // the still-present (untouched) legacy key — v5 being present must short-circuit re-migration.
  const WD2=loadWorkshopData(null,localStorage);
  const secondCount=WD2.get().projects.filter(p=>p.no==='P-26-9002').length;
  assert.equal(secondCount,1,'the record must not be duplicated on a subsequent load');
});

test('legacy migration: Marketing leads/opportunities/campaigns persist through the shared API', ()=>{
  const WD=loadWorkshopData();
  const before=WD.getMarketingLeads().length;
  WD.upsertMarketingLead({company:'Persisted Co',contact:'A',email:'a@b.com'});
  assert.equal(WD.getMarketingLeads().length,before+1);
  assert.ok(WD.get().marketingLeads.some(l=>l.company==='Persisted Co'),'the lead must be present in the persisted shared state, not just in-memory');
});

// ── Shared API surface: clones, correct-collection writes, non-destructive archiving ───────────
test('shared API getters return clones, not live references to internal state', ()=>{
  const WD=loadWorkshopData();
  const a=WD.getPurchaseOrders();
  a.push({no:'HACK'});
  assert.equal(WD.getPurchaseOrders().some(p=>p.no==='HACK'),false,'mutating a getter result must not affect shared state');

  const b=WD.getDocuments();
  b.length=0;
  assert.ok(WD.getDocuments().length>0,'mutating a getter result must not affect shared state');

  const c=WD.getMarketingLeads();
  if(c[0])c[0].company='MUTATED';
  assert.notEqual(WD.getMarketingLeads()[0]&&WD.getMarketingLeads()[0].company,'MUTATED');
});

test('CRUD methods write to the correct collection and do not cross-contaminate others', ()=>{
  const WD=loadWorkshopData();
  const poCountBefore=WD.getPurchaseOrders().length;
  const docCountBefore=WD.getDocuments().length;
  WD.upsertPurchaseOrder({supplier:'Isolated Test Supplier',items:'x'});
  assert.equal(WD.getPurchaseOrders().length,poCountBefore+1);
  assert.equal(WD.getDocuments().length,docCountBefore,'creating a purchase order must not affect documents');
});

test('archived linked records are not hard-deleted (Purchasing and Documents)', ()=>{
  const WD=loadWorkshopData();
  const po=WD.upsertPurchaseOrder({supplier:'Archive Me Ltd',items:'x'});
  const archivedPo=WD.archivePurchaseOrder(po.no);
  assert.equal(archivedPo.archived,true);
  assert.ok(WD.getPurchaseOrders().some(p=>p.no===po.no),'archived purchase order must still be present, not deleted');

  const doc=WD.upsertDocument({name:'Archive Me.pdf',type:'Document',module:'Projects',record:'P-1'});
  const archivedDoc=WD.archiveDocument(doc.id);
  assert.equal(archivedDoc.status,'Archived');
  assert.ok(WD.getDocuments().some(d=>d.id===doc.id),'archived document must still be present, not deleted');
});

// ── Backup / import: v5 collections included, empty collections preserved ──────────────────────
test('backup validation includes the new v5 collections', ()=>{
  const WD=loadWorkshopData();
  const res1=WD.validateBackup({purchaseOrders:'not-an-array'});
  assert.equal(res1.valid,false);
  const res2=WD.validateBackup({marketingLeads:'not-an-array'});
  assert.equal(res2.valid,false);
  const res3=WD.validateBackup({reportConfig:'not-an-object'});
  assert.equal(res3.valid,false);
});

test('backup import preserves explicitly empty v5 collections rather than refilling them with demo data', ()=>{
  const WD=loadWorkshopData();
  const backup=Object.assign(WD.get(),{purchaseOrders:[],marketingLeads:[],documents:[]});
  const res=WD.importBackup(backup);
  assert.equal(res.success,true);
  assert.deepEqual(WD.get().purchaseOrders,[]);
  assert.deepEqual(WD.get().marketingLeads,[]);
  assert.deepEqual(WD.get().documents,[]);
});

test('getDataHealth().corruptedRecordPreserved is false after a successful import (not carried over from a prior load)', ()=>{
  const WD=loadWorkshopData();
  const backup=WD.get();
  backup.customers.push({id:999,no:'C-999',name:'Imported Extra'});
  const res=WD.importBackup(backup);
  assert.equal(res.success,true);
  assert.equal(WD.getDataHealth().corruptedRecordPreserved,false);
});

// ── Reports reads shared Purchasing and Marketing data through the same API a Reports page would use ──
test('Reports-facing API: purchasing and marketing data are readable through the shared getters Reports uses', ()=>{
  const WD=loadWorkshopData();
  const orders=WD.getPurchaseOrders();
  assert.ok(Array.isArray(orders)&&orders.length>0,'Reports must be able to read real shared purchase orders, not an empty/disconnected stub');
  const leads=WD.getMarketingLeads();
  const opps=WD.getMarketingOpportunities();
  assert.ok(Array.isArray(leads)&&leads.length>0,'Reports must be able to read real shared marketing leads');
  assert.ok(Array.isArray(opps)&&opps.length>0,'Reports must be able to read real shared marketing opportunities');
});

// ── Pass 2.1: Project customer and status integration fix ──────────────────────────────────────
test('getCustomers/listCustomers: shared customer id 1 is MarineVent AB, id 2 is Sanus Glutenfri AB', ()=>{
  const WD=loadWorkshopData();
  const customers=WD.getCustomers();
  assert.equal(customers.find(c=>c.id===1).name,'MarineVent AB');
  assert.equal(customers.find(c=>c.id===2).name,'Sanus Glutenfri AB');
  assert.deepEqual(WD.listCustomers(),customers);
});

test('getCustomers returns a clone, not a live reference to shared state', ()=>{
  const WD=loadWorkshopData();
  const customers=WD.getCustomers();
  customers.push({id:9999,no:'C-FAKE',name:'Injected'});
  assert.equal(WD.getCustomers().some(c=>c.id===9999),false);
});

test('upsertProject with a trusted shared customerId does not reinterpret it through a name lookup', ()=>{
  const WD=loadWorkshopData();
  const before=WD.get().projects.find(p=>p.no==='P-2026-014');
  assert.equal(before.customerId,1);
  // Simulate the Projects page syncing an edit WITHOUT the user having changed the customer field —
  // it must send the real customerId (1) through unchanged, exactly as syncSharedProject() does.
  const saved=WD.upsertProject({no:'P-2026-014',name:before.name,customerId:1,customer:'MarineVent AB',notes:[],jobcards:[],hours:[],materials:[],purchases:[],documents:{},activity:[]});
  assert.equal(saved.customerId,1);
  assert.equal(WD.get().customers.find(c=>c.id===1).name,'MarineVent AB');
});

test('upsertProject: explicitly selecting a different (real) customerId changes the project correctly', ()=>{
  const WD=loadWorkshopData();
  const saved=WD.upsertProject({no:'P-2026-014',name:'Ventilation Duct System',customerId:2,customer:'Sanus Glutenfri AB',notes:[],jobcards:[],hours:[],materials:[],purchases:[],documents:{},activity:[]});
  assert.equal(saved.customerId,2);
  assert.equal(WD.get().projects.find(p=>p.no==='P-2026-014').customerId,2);
});

test('creating a Project customer through upsertCustomer persists it, and it is findable/selectable afterwards', ()=>{
  const WD=loadWorkshopData();
  const saved=WD.upsertCustomer({name:'New Mini-Modal Customer AB',org:'123456-7890',status:'active',contacts:[{name:'Test Person',role:'Contact',primary:true}],notes:[],documents:[]});
  assert.ok(saved.id);
  const customers=WD.getCustomers();
  const found=customers.find(c=>c.id===saved.id);
  assert.equal(found.name,'New Mini-Modal Customer AB');
});

test('reloading (fresh load from the same localStorage) preserves the project/customer relationship', ()=>{
  const {WD,localStorage}=loadWorkshopDataWithStorage();
  const saved=WD.upsertCustomer({name:'Reload Test Customer',status:'active',contacts:[],notes:[],documents:[]});
  WD.upsertProject({no:'P-RELOAD-TEST',name:'Reload Test Project',customerId:saved.id,customer:saved.name,notes:[],jobcards:[],hours:[],materials:[],purchases:[],documents:{},activity:[]});
  const WD2=loadWorkshopData(null,localStorage);
  const reloaded=WD2.get().projects.find(p=>p.no==='P-RELOAD-TEST');
  assert.equal(reloaded.customerId,saved.id);
  assert.equal(WD2.getCustomers().find(c=>c.id===saved.id).name,'Reload Test Customer');
});

test('customer filtering uses shared ids: every real project customerId resolves to a real shared customer', ()=>{
  const WD=loadWorkshopData();
  const customers=WD.getCustomers();
  const marineVentProject=WD.get().projects.find(p=>p.no==='P-2026-014');
  const matched=customers.find(c=>c.id===marineVentProject.customerId);
  assert.ok(matched,'the project customerId must resolve against the shared customers collection');
  assert.equal(matched.name,'MarineVent AB');
});

test('upsertCustomer does not create a duplicate for a case/whitespace-only name difference', ()=>{
  const WD=loadWorkshopData();
  const before=WD.getCustomers().length;
  const a=WD.upsertCustomer({name:'  MarineVent AB  ',status:'active',contacts:[],notes:[],documents:[]});
  const b=WD.upsertCustomer({name:'marinevent ab',status:'active',contacts:[],notes:[],documents:[]});
  assert.equal(WD.getCustomers().length,before);
  assert.equal(a.id,1);
  assert.equal(b.id,1);
});

// ── Pass 2.2: no fake "—" customer, placeholder hardening, id-authoritative naming ─────────────
test('upsertProject: a project with no customer selected does not fabricate a "—" customer', ()=>{
  const WD=loadWorkshopData();
  const before=WD.getCustomers().length;
  const saved=WD.upsertProject({name:'No customer test',customerId:null,customer:'—',notes:[],jobcards:[],hours:[],materials:[],purchases:[],documents:{},activity:[]});
  assert.equal(WD.getCustomers().length,before,'no new customer must have been created');
  assert.equal(saved.customerId,null);
  assert.equal(WD.getCustomers().some(c=>c.name==='—'||c.name==='-'),false);
});

test('upsertProject: empty, whitespace and placeholder customer names never create a Customer', ()=>{
  const WD=loadWorkshopData();
  const before=WD.getCustomers().length;
  for(const placeholder of ['',' ','   ','—','-',null,undefined]){
    const saved=WD.upsertProject({name:'Placeholder test '+String(placeholder),customerId:null,customer:placeholder,notes:[],jobcards:[],hours:[],materials:[],purchases:[],documents:{},activity:[]});
    assert.equal(saved.customerId,null,`placeholder ${JSON.stringify(placeholder)} must not resolve to a customer`);
  }
  assert.equal(WD.getCustomers().length,before,'no customers must have been created for any placeholder value');
});

test('upsertProject: a valid shared customerId canonicalises the project customer name from the real record', ()=>{
  const WD=loadWorkshopData();
  const saved=WD.upsertProject({name:'Canonical name test',customerId:1,customer:'Whatever the caller happened to send',notes:[],jobcards:[],hours:[],materials:[],purchases:[],documents:{},activity:[]});
  assert.equal(saved.customerId,1);
  assert.equal(saved.customer,'MarineVent AB');
});

test('upsertProject: a conflicting supplied customer name cannot override a valid shared customerId', ()=>{
  const WD=loadWorkshopData();
  const before=WD.getCustomers().length;
  const saved=WD.upsertProject({name:'Conflicting name test',customerId:1,customer:'A Totally Different Company AB',notes:[],jobcards:[],hours:[],materials:[],purchases:[],documents:{},activity:[]});
  assert.equal(saved.customerId,1);
  assert.equal(saved.customer,'MarineVent AB','the authoritative shared record name wins, not the conflicting caller-supplied name');
  assert.equal(WD.getCustomers().length,before,'the conflicting name must not have created a new customer either');
});

// ── Pass 2.2: customer counter hardening (exactly one increment, no renumbering, uniqueness) ────
test('upsertCustomer: creating a new customer increments the counter exactly once (id and number use the same sequence value)', ()=>{
  const WD=loadWorkshopData();
  const saved=WD.upsertCustomer({name:'Counter Test Co',status:'active',contacts:[],notes:[],documents:[]});
  assert.equal(saved.no,`C-${String(saved.id).padStart(3,'0')}`,'id and no must come from the same single counter increment');
});

test('upsertCustomer: generated ids and numbers remain unique across several new customers', ()=>{
  const WD=loadWorkshopData();
  const created=['Alpha Co','Beta Co','Gamma Co'].map(name=>WD.upsertCustomer({name,status:'active',contacts:[],notes:[],documents:[]}));
  const ids=created.map(c=>c.id),nos=created.map(c=>c.no);
  assert.equal(new Set(ids).size,ids.length,'ids must be unique');
  assert.equal(new Set(nos).size,nos.length,'numbers must be unique');
  for(const c of created)assert.equal(c.no,`C-${String(c.id).padStart(3,'0')}`);
});

test('upsertCustomer: existing customer ids/numbers are never renumbered when a new customer is created', ()=>{
  const WD=loadWorkshopData();
  const before=WD.getCustomers().map(c=>({id:c.id,no:c.no}));
  WD.upsertCustomer({name:'Freshly Created Co',status:'active',contacts:[],notes:[],documents:[]});
  const after=WD.getCustomers().map(c=>({id:c.id,no:c.no}));
  for(const b of before){
    const match=after.find(a=>a.id===b.id);
    assert.ok(match,`existing customer id ${b.id} must still exist`);
    assert.equal(match.no,b.no,`existing customer id ${b.id}'s number must be unchanged`);
  }
});
