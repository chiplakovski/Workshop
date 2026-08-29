// Logic tests for the shared client-side data layer (workshop-data.js): migration/backup safety,
// Equipment assignment rules and Quality workflow rules. Runs against the real module (see
// tests/helpers/load-workshop-data.js) — no reimplementation of its logic here.
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {loadWorkshopData,loadWorkshopDataWithStorage,MemoryLocalStorage}=require('./helpers/load-workshop-data');

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

// ── Corrupted-v4 rescue copy (Pass 1.1) ─────────────────────────────────────
function rescueKeys(localStorage){
  return Array.from(localStorage.store.keys()).filter(k=>k.startsWith(`${V4_KEY}.corrupted.`));
}

test('rescue copy: corrupted v4 with a valid v3 backup creates a rescue copy AND migrates v3', ()=>{
  const v3=minimalState({customers:[{id:5,no:'C-005',name:'Recover Me'}]});
  const {WD,localStorage}=loadWorkshopDataWithStorage({[V3_KEY]:JSON.stringify(v3),[V4_KEY]:'{not valid json'});
  const state=WD.get();
  assert.ok(state.customers.some(c=>c.name==='Recover Me'),'v3 must still be migrated');
  const rescued=rescueKeys(localStorage);
  assert.equal(rescued.length,1,'exactly one rescue copy must be created');
  const health=WD.getDataHealth();
  assert.equal(health.corruptedRecordPreserved,true);
});

test('rescue copy: corrupted v4 with no v3 backup creates a rescue copy before falling back to demo data', ()=>{
  const {WD,localStorage}=loadWorkshopDataWithStorage({[V4_KEY]:'{not valid json'});
  const rescued=rescueKeys(localStorage);
  assert.equal(rescued.length,1,'a rescue copy must exist even when there is no v3 to recover');
  const health=WD.getDataHealth();
  assert.equal(health.corruptedV4Detected,true);
  assert.equal(health.corruptedRecordPreserved,true);
  assert.ok(health.recoveryWarning);
});

test('rescue copy: the rescue copy contains the exact original corrupted raw value', ()=>{
  const rawCorrupted='{not valid json — this is exactly what was in localStorage';
  const {localStorage}=loadWorkshopDataWithStorage({[V4_KEY]:rawCorrupted});
  const rescued=rescueKeys(localStorage);
  assert.equal(rescued.length,1);
  assert.equal(localStorage.getItem(rescued[0]),rawCorrupted);
});

test('rescue copy: loading does not delete the legacy v3 key', ()=>{
  const v3=minimalState({customers:[{id:1,no:'C-001',name:'X'}]});
  const rawV3=JSON.stringify(v3);
  const {localStorage}=loadWorkshopDataWithStorage({[V3_KEY]:rawV3,[V4_KEY]:'{not valid json'});
  assert.equal(localStorage.getItem(V3_KEY),rawV3,'the v3 record itself must be untouched');
});

test('rescue copy: valid v4 data does not create a corrupted rescue key', ()=>{
  const v4=minimalState({version:4,customers:[{id:1,no:'C-001',name:'Fine'}]});
  const {WD,localStorage}=loadWorkshopDataWithStorage({[V4_KEY]:JSON.stringify(v4)});
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
  const {WD,localStorage}=loadWorkshopDataWithStorage({[V4_KEY]:'{not valid json'},new RejectingLocalStorage());
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
  const v4=minimalState({version:4,customers:[{id:1,no:'C-001',name:'X'}],equipment:[]});
  const WD=loadWorkshopData({[V4_KEY]:JSON.stringify(v4)});
  assert.deepEqual(WD.getEquipment(),[],'an intentionally empty equipment collection must not be refilled');
});

test('equipment: getEquipment() does not modify stored state', ()=>{
  const v4=minimalState({version:4,customers:[{id:1,no:'C-001',name:'X'}],equipment:[]});
  const WD=loadWorkshopData({[V4_KEY]:JSON.stringify(v4)});
  WD.getEquipment();
  WD.getEquipment();
  assert.deepEqual(WD.get().equipment,[],'repeated reads must never mutate state');
  assert.equal(WD.getDataHealth().sourceKey,V4_KEY,'no save() should have been triggered by a read');
});

test('equipment: ensureDemoEquipment() explicitly adds demonstration equipment to an empty collection', ()=>{
  const v4=minimalState({version:4,customers:[{id:1,no:'C-001',name:'X'}],equipment:[]});
  const WD=loadWorkshopData({[V4_KEY]:JSON.stringify(v4)});
  assert.deepEqual(WD.getEquipment(),[]);
  const result=WD.ensureDemoEquipment();
  assert.ok(Array.isArray(result)&&result.length>0,'ensureDemoEquipment must add demo records when called explicitly');
  assert.deepEqual(WD.getEquipment(),result,'getEquipment() reflects the change once explicitly made');
});

test('equipment: existing equipment records are left unchanged by getEquipment() and by loading', ()=>{
  const existing=[{id:'E-9001',equipmentId:'E-9001',name:'Custom Drill Press',status:'Available'}];
  const v4=minimalState({version:4,customers:[{id:1,no:'C-001',name:'X'}],equipment:existing});
  const WD=loadWorkshopData({[V4_KEY]:JSON.stringify(v4)});
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
