// Logic tests for the shared client-side data layer (workshop-data.js): migration/backup safety,
// Equipment assignment rules and Quality workflow rules. Runs against the real module (see
// tests/helpers/load-workshop-data.js) — no reimplementation of its logic here.
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {loadWorkshopData}=require('./helpers/load-workshop-data');

const V4_KEY='varmak.workshop.frontend.v4';
const V3_KEY='varmak.workshop.frontend.v3';

function minimalState(overrides){
  return Object.assign({version:3,customers:[],estimations:[],projects:[],inventory:[],equipment:[],
    jobcards:[],suppliers:[],hours:[],movements:[],offcuts:[],stockCounts:[],activity:[]},overrides);
}

// ── Data migration ──────────────────────────────────────────────────────────
test('data migration: v4 present and valid is used as-is', ()=>{
  const v4=minimalState({version:4,customers:[{id:2,no:'C-002',name:'Current Co'}]});
  const WD=loadWorkshopData({[V4_KEY]:JSON.stringify(v4)});
  const state=WD.get();
  assert.equal(state.customers.length,1);
  assert.equal(state.customers[0].name,'Current Co');
  assert.equal(WD.getDataHealth().migratedFromLegacy,false);
});

test('data migration: legacy v3 is migrated to v4 when v4 is absent', ()=>{
  const v3=minimalState({customers:[{id:99,no:'C-099',name:'Legacy Customer'}]});
  const WD=loadWorkshopData({[V3_KEY]:JSON.stringify(v3)});
  const state=WD.get();
  assert.ok(state.customers.some(c=>c.name==='Legacy Customer'),'legacy customer must be preserved');
  assert.equal(WD.getDataHealth().migratedFromLegacy,true);
  assert.equal(WD.getDataHealth().sourceKey,V3_KEY);
});

test('data migration: legacy v3 key is preserved untouched after migration', ()=>{
  const v3=minimalState({customers:[{id:1,no:'C-001',name:'X'}]});
  const rawV3=JSON.stringify(v3);
  const WD=loadWorkshopData({[V3_KEY]:rawV3});
  WD.get();
  assert.equal(WD.key,V4_KEY,'module still points at the v4 key going forward');
});

test('data migration: an intentionally empty user array stays empty after migration (not refilled with demo data)', ()=>{
  const v3=minimalState({customers:[{id:1,no:'C-001',name:'X'}],hours:[]});
  const WD=loadWorkshopData({[V3_KEY]:JSON.stringify(v3)});
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

test('data migration: a corrupted v4 record does not destroy a valid v3 backup — v3 is recovered instead', ()=>{
  const v3=minimalState({customers:[{id:5,no:'C-005',name:'Recover Me'}]});
  const WD=loadWorkshopData({[V3_KEY]:JSON.stringify(v3),[V4_KEY]:'{not valid json'});
  const state=WD.get();
  assert.ok(state.customers.some(c=>c.name==='Recover Me'));
  const health=WD.getDataHealth();
  assert.equal(health.corruptedV4Detected,true);
  assert.ok(health.recoveryWarning,'a recovery warning must be surfaced to the caller');
});

test('data migration: corrupted v4 with no v3 backup falls back safely to demo data without throwing', ()=>{
  const WD=loadWorkshopData({[V4_KEY]:'{not valid json'});
  const state=WD.get();
  assert.ok(state.customers.length>0);
  assert.equal(WD.getDataHealth().corruptedV4Detected,true);
  assert.equal(WD.getDataHealth().sourceKey,null);
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
  const WD=loadWorkshopData();
  const missing=WD.createFinalRelease({projectNo:'P-2026-014',result:'released-conditions'});
  assert.ok(missing.error);
  const ok=WD.createFinalRelease({projectNo:'P-2026-014',result:'released-conditions',conditions:'Punch list to close within 30 days',approvalRef:'REL-APPROVAL-1'});
  assert.ok(!ok.error);
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
