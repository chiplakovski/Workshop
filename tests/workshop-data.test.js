// Logic tests for the shared client-side data layer (workshop-data.js): migration/backup safety,
// Equipment assignment rules and Quality workflow rules. Runs against the real module (see
// tests/helpers/load-workshop-data.js) — no reimplementation of its logic here.
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const {loadWorkshopData,loadWorkshopDataWithStorage,loadWorkshopDataWithEnv,MemoryLocalStorage}=require('./helpers/load-workshop-data');

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

// ── Equipment: assignment-blocking behaviour — Pass 3.2A routes this through the central
// Equipment safety gate (equipment-gates.js) instead of a hardcoded, previously-incomplete list. ──
test('equipment: cannot assign equipment that is Out of Service, Quarantined, Under Maintenance, Maintenance Due, Inspection Required or Retired', ()=>{
  const WD=loadWorkshopData();
  for(const status of ['Out of Service','Quarantined','Under Maintenance','Maintenance Due','Inspection Required','Retired']){
    WD.changeEquipmentStatus('E-1001',status);
    const res=WD.assignEquipment('E-1001',{project:'P-1',jobcard:'JC-1'});
    assert.equal(res.code,'EQUIPMENT_SAFETY_BLOCKED',`status ${status} must block assignment`);
    assert.ok(res.error,`status ${status} must return a structured error`);
  }
});

test('equipment: available equipment can be assigned', ()=>{
  const WD=loadWorkshopData();
  WD.changeEquipmentStatus('E-1001','Available');
  // Seed E-1001 already carries an assignedJobcard (JC-2026-0001) — return it first so this test
  // exercises a genuinely fresh assignment, not an (also-valid) same-jobcard idempotent re-assign.
  WD.returnEquipment('E-1001',{});
  const res=WD.assignEquipment('E-1001',{project:'P-2026-014',jobcard:'JC-2026-0001',worker:'Marko K.',assignedBy:'Aleksandar C.'});
  assert.ok(!res.error);
  assert.equal(res.assignedProject,'P-2026-014');
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

// ── Pass 3.2A: central Equipment safety gate (equipment-gates.js + WorkshopData enforcement) ──
// Seed fixture used throughout: E-1001 (Available, Welding Machine, no `requirements` object, all
// history arrays empty) is the healthy control; other seed statuses (E-1002 In Use, E-1003
// Maintenance Due, E-1004 Under Maintenance, E-1006 Out of Service, E-1008 Inspection Required,
// E-1010 Quarantined) already exercise the full hard-block status set without extra setup.
// Computed as the real current date (not a hardcoded string) — several tests compare this against
// timestamps produced by now() inside workshop-data.js (e.g. reportBreakdown), so a fixed past date
// here would drift stale and start failing those date-ordering checks the moment the real date moves
// past it, exactly as happened once this suite was still using a hardcoded '2026-08-30'.
const EQ_ASOF=new Date().toISOString().slice(0,10);

test('equipment gate: available equipment with no blocker can be reserved and then assigned', ()=>{
  const WD=loadWorkshopData();
  // Seed E-1001 already carries an assignedJobcard (JC-2026-0001) — return it first so this test
  // exercises a genuinely fresh reservation, not a (also-valid) different-jobcard conflict.
  WD.returnEquipment('E-1001',{});
  const reserved=WD.reserveEquipment('E-1001',{project:'P-2026-014',jobcard:'JC-2026-0001',reservedBy:'Marko K.'});
  assert.ok(!reserved.error);
  assert.equal(reserved.status,'Reserved');
  const assigned=WD.assignEquipment('E-1001',{project:'P-2026-014',jobcard:'JC-2026-0001',worker:'Marko K.',assignedBy:'Aleksandar C.'});
  assert.ok(!assigned.error);
  assert.equal(assigned.assignedProject,'P-2026-014');
});
test('equipment gate: status blocking is case/whitespace-insensitive through the real WorkshopData API', ()=>{
  const WD=loadWorkshopData();
  WD.changeEquipmentStatus('E-1001','  quarantined  ');
  const res=WD.assignEquipment('E-1001',{project:'P-1'});
  assert.equal(res.code,'EQUIPMENT_SAFETY_BLOCKED');
});
test('equipment gate: an unrecognised/malformed status through the real API fails safe (blocks), never guessed as safe', ()=>{
  const WD=loadWorkshopData();
  WD.changeEquipmentStatus('E-1001','Something Weird');
  const res=WD.assignEquipment('E-1001',{project:'P-1'});
  assert.equal(res.code,'EQUIPMENT_SAFETY_BLOCKED');
});
// Requirements can now ONLY be changed through updateEquipmentRequirements (never updateEquipment)
// — used throughout this test block wherever a mandatory flag needs setting up.
function setEqRequirements(WD,equipmentId,flags){
  return WD.updateEquipmentRequirements(equipmentId,flags,{updatedBy:'Aleksandar C.',reason:'Test setup',approvalReference:'APPR-TEST-1'});
}
test('equipment gate: overdue maintenance/inspection/certification/calibration each block through WorkshopData exactly when mandatory (set up via their dedicated methods, never updateEquipment)', ()=>{
  const WD1=loadWorkshopData();
  setEqRequirements(WD1,'E-1001',{maintenanceRequired:true});
  WD1.addMaintenanceRecord('E-1001',{completedBy:'Marko K.',date:'2019-01-01',result:'completed',evidence:'Service report on file',nextDueDate:'2020-01-01'});
  assert.equal(WD1.getEquipmentSafetyGate('E-1001',{asOf:EQ_ASOF}).blocked,true,'maintenanceDate');

  const WD2=loadWorkshopData();
  setEqRequirements(WD2,'E-1001',{inspectionRequired:true});
  WD2.addInspection('E-1001',{inspector:'Aleksandar C.',result:'passed',date:'2019-01-01',evidence:'Visual check OK',nextDueDate:'2020-01-01'});
  assert.equal(WD2.getEquipmentSafetyGate('E-1001',{asOf:EQ_ASOF}).blocked,true,'inspectionDate');

  const WD3=loadWorkshopData();
  setEqRequirements(WD3,'E-1001',{certificationRequired:true});
  WD3.addCertification('E-1001',{issuedBy:'Aleksandar C.',date:'2019-01-01',expiryDate:'2020-01-01',certificateNumber:'CERT-TEST-1'});
  assert.equal(WD3.getEquipmentSafetyGate('E-1001',{asOf:EQ_ASOF}).blocked,true,'certificationExpiry');

  const WD4=loadWorkshopData();
  setEqRequirements(WD4,'E-1001',{calibrationRequired:true});
  WD4.addCalibration('E-1001',{calibratedBy:'Aleksandar C.',date:'2019-01-01',result:'passed',evidence:'Calibration certificate on file',nextDueDate:'2020-01-01'});
  assert.equal(WD4.getEquipmentSafetyGate('E-1001',{asOf:EQ_ASOF}).blocked,true,'calibrationDate');

  const WD5=loadWorkshopData();
  WD5.addMaintenanceRecord('E-1001',{completedBy:'Marko K.',date:'2019-01-01',result:'completed',evidence:'Service report on file',nextDueDate:'2020-01-01'});
  assert.equal(WD5.getEquipmentSafetyGate('E-1001',{asOf:EQ_ASOF}).blocked,false,'not mandatory must stay backwards-compatible');
});
test('equipment gate: canAssignEquipment/canUseEquipment accept options.asOf for deterministic date-based checks', ()=>{
  const WD=loadWorkshopData();
  setEqRequirements(WD,'E-1001',{maintenanceRequired:true});
  WD.addMaintenanceRecord('E-1001',{completedBy:'Marko K.',date:'2026-01-01',result:'completed',evidence:'Service report on file',nextDueDate:'2026-06-15'});
  assert.equal(WD.canAssignEquipment('E-1001',{asOf:'2026-06-01'}).allowed,true);
  assert.equal(WD.canAssignEquipment('E-1001',{asOf:'2026-07-01'}).allowed,false);
});
test('equipment gate: logEquipmentUsage requires a positive, finite number of hours and leaves the meter unchanged when rejected', ()=>{
  const WD=loadWorkshopData();
  const before=WD.get().equipment.find(e=>e.equipmentId==='E-1001').operatingHourMeter;
  for(const hours of [0,-1,NaN,Infinity,undefined,null,'abc']){
    const res=WD.logEquipmentUsage('E-1001',{hours,worker:'Marko K.'});
    assert.ok(res.error,`hours=${hours} must be rejected`);
  }
  assert.equal(WD.get().equipment.find(e=>e.equipmentId==='E-1001').operatingHourMeter,before);
});
test('equipment gate: canUseEquipment requires a mandatory pre-use check, but canAssignEquipment does not', ()=>{
  const WD=loadWorkshopData();
  setEqRequirements(WD,'E-1001',{preUseCheckRequired:true});
  assert.equal(WD.canAssignEquipment('E-1001',{}).allowed,true,'assignment is never gated by the pre-use-check requirement');
  assert.equal(WD.canUseEquipment('E-1001',{asOf:EQ_ASOF,date:EQ_ASOF}).allowed,false);
});
test('equipment gate: usage is blocked without a matching passed pre-use check when mandatory, and succeeds once one is recorded', ()=>{
  const WD=loadWorkshopData();
  setEqRequirements(WD,'E-1001',{preUseCheckRequired:true});
  const blocked=WD.logEquipmentUsage('E-1001',{hours:2,worker:'Marko K.',date:EQ_ASOF});
  assert.equal(blocked.code,'EQUIPMENT_SAFETY_BLOCKED');
  const passed=WD.recordEquipmentPreUseCheck('E-1001',{result:'passed',checkedBy:'Marko K.',date:EQ_ASOF,checklist:'Guards in place, oil level OK'});
  assert.ok(!passed.error);
  const ok=WD.logEquipmentUsage('E-1001',{hours:2,worker:'Marko K.',date:EQ_ASOF});
  assert.ok(!ok.error);
});
test('equipment gate: a failed pre-use check immediately blocks usage and is recorded as audit history (never a single toggle)', ()=>{
  const WD=loadWorkshopData();
  const res=WD.recordEquipmentPreUseCheck('E-1001',{result:'failed',checkedBy:'Marko K.',date:EQ_ASOF,notes:'Guard missing'});
  assert.ok(!res.error);
  const item=WD.get().equipment.find(e=>e.equipmentId==='E-1001');
  assert.equal(item.preUseChecks.length,1);
  assert.equal(item.status,'Inspection Required');
  assert.ok(item.activity.some(a=>/Pre-use check failed/.test(a.action)));
  const usage=WD.logEquipmentUsage('E-1001',{hours:1,worker:'Marko K.'});
  assert.equal(usage.code,'EQUIPMENT_SAFETY_BLOCKED');
});
test('equipment gate: recordEquipmentPreUseCheck validates required fields and requires evidence for a passed result', ()=>{
  const WD=loadWorkshopData();
  assert.ok(WD.recordEquipmentPreUseCheck('E-1001',{result:'passed',date:EQ_ASOF}).error,'missing checkedBy');
  assert.ok(WD.recordEquipmentPreUseCheck('E-1001',{checkedBy:'Marko K.',result:'passed'}).error,'missing date');
  assert.ok(WD.recordEquipmentPreUseCheck('E-1001',{checkedBy:'Marko K.',date:EQ_ASOF}).error,'missing result');
  assert.ok(WD.recordEquipmentPreUseCheck('E-1001',{checkedBy:'Marko K.',date:EQ_ASOF,result:'passed'}).error,'passed with no evidence/checklist');
  const ok=WD.recordEquipmentPreUseCheck('E-1001',{checkedBy:'Marko K.',date:EQ_ASOF,result:'passed',checklist:'Guards in place, oil level OK'});
  assert.ok(!ok.error);
});
test('equipment gate: pre-use checks accumulate as history, never overwriting a single toggle', ()=>{
  const WD=loadWorkshopData();
  WD.recordEquipmentPreUseCheck('E-1001',{checkedBy:'Marko K.',date:'2026-08-29',result:'passed',checklist:'OK'});
  WD.recordEquipmentPreUseCheck('E-1001',{checkedBy:'Marko K.',date:EQ_ASOF,result:'passed',checklist:'OK'});
  assert.equal(WD.get().equipment.find(e=>e.equipmentId==='E-1001').preUseChecks.length,2);
});
test('equipment gate: a failed critical inspection quarantines the equipment and blocks assignment/usage', ()=>{
  const WD=loadWorkshopData();
  const res=WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'failed',critical:true,findings:'Cracked frame',date:EQ_ASOF});
  assert.ok(!res.error);
  assert.equal(WD.get().equipment.find(e=>e.equipmentId==='E-1001').status,'Quarantined');
  const assign=WD.assignEquipment('E-1001',{project:'P-1'});
  assert.equal(assign.code,'EQUIPMENT_SAFETY_BLOCKED');
});
test('equipment gate: an open breakdown blocks assignment and usage', ()=>{
  const WD=loadWorkshopData();
  WD.reportBreakdown('E-1001',{reason:'Motor failure',responsiblePerson:'Marko K.'});
  const res=WD.assignEquipment('E-1001',{project:'P-1'});
  assert.equal(res.code,'EQUIPMENT_SAFETY_BLOCKED');
});
test('equipment gate: reportBreakdown places the equipment Out of Service and preserves the project/jobcard reference for traceability', ()=>{
  const WD=loadWorkshopData();
  WD.assignEquipment('E-1001',{project:'P-2026-014',jobcard:'JC-2026-0001'});
  const rec=WD.reportBreakdown('E-1001',{reason:'Overheating',responsiblePerson:'Marko K.'});
  assert.equal(rec.projectNo,'P-2026-014');
  assert.equal(rec.jobcardNo,'JC-2026-0001');
  assert.equal(WD.get().equipment.find(e=>e.equipmentId==='E-1001').status,'Out of Service');
});
test('equipment gate: resolveBreakdown requires resolvedBy and resolutionEvidence, clears the open-breakdown blocker, and never deletes the record', ()=>{
  const WD=loadWorkshopData();
  const br=WD.reportBreakdown('E-1001',{reason:'Motor failure',responsiblePerson:'Marko K.'});
  assert.ok(WD.resolveBreakdown('E-1001',br.id,{}).error);
  const resolved=WD.resolveBreakdown('E-1001',br.id,{resolvedBy:'Marko K.',resolutionEvidence:'Motor replaced and tested'});
  assert.ok(!resolved.error);
  const item=WD.get().equipment.find(e=>e.equipmentId==='E-1001');
  assert.equal(item.downtimeRecords.length,1,'the original breakdown record must not be deleted');
  assert.equal(item.downtimeRecords[0].status,'resolved');
  assert.ok(!WD.getEquipmentSafetyGate('E-1001',{skipStatusCheck:true}).blockers.some(b=>b.code==='BREAKDOWN_OPEN'));
});
test('equipment gate: returnEquipment clears the assignment but preserves a blocking status', ()=>{
  const WD=loadWorkshopData();
  WD.changeEquipmentStatus('E-1001','Quarantined');
  const res=WD.returnEquipment('E-1001',{user:'Marko K.'});
  assert.equal(res.status,'Quarantined');
  assert.equal(res.assignedProject,null);
});
test('equipment gate: returnEquipment sets status to Available for genuinely safe equipment', ()=>{
  const WD=loadWorkshopData();
  WD.assignEquipment('E-1001',{project:'P-1'});
  const res=WD.returnEquipment('E-1001',{user:'Marko K.'});
  assert.equal(res.status,'Available');
});
test('equipment gate: updateEquipment cannot move blocked equipment directly into Available, Reserved or In Use', ()=>{
  const WD=loadWorkshopData();
  WD.changeEquipmentStatus('E-1001','Out of Service');
  for(const target of ['Available','Reserved','In Use']){
    const res=WD.updateEquipment('E-1001',{status:target});
    assert.equal(res.code,'EQUIPMENT_SAFETY_BLOCKED',target);
  }
  assert.equal(WD.get().equipment.find(e=>e.equipmentId==='E-1001').status,'Out of Service');
});
test('equipment gate: changeEquipmentStatus cannot move blocked equipment directly into an operational status', ()=>{
  const WD=loadWorkshopData();
  WD.changeEquipmentStatus('E-1001','Quarantined');
  const res=WD.changeEquipmentStatus('E-1001','In Use');
  assert.equal(res.code,'EQUIPMENT_SAFETY_BLOCKED');
});
test('equipment gate: caller override/force/managerOverride/safetyApproved flags and a fabricated blockers/reasons list never bypass the gate', ()=>{
  const WD=loadWorkshopData();
  WD.changeEquipmentStatus('E-1001','Out of Service');
  const res=WD.updateEquipment('E-1001',{status:'Available',override:true,force:true,managerOverride:true,safetyApproved:true,blockers:[],reasons:[]});
  assert.equal(res.code,'EQUIPMENT_SAFETY_BLOCKED');
});
test('equipment gate: assignEquipment never trusts a caller-supplied assignment.status', ()=>{
  const WD=loadWorkshopData();
  // Seed E-1001 is already assigned to JC-2026-0001 — assign it to that SAME jobcard (idempotent,
  // always allowed) so this test isolates the status-trust behaviour, not the conflict check.
  const res=WD.assignEquipment('E-1001',{project:'P-2026-014',jobcard:'JC-2026-0001',worker:'Marko K.',assignedBy:'Aleksandar C.',status:'Available'});
  assert.ok(!res.error);
  assert.equal(res.status,'Reserved','assignment.status must be ignored — assigning always reserves, never trusts a caller-chosen status');
});
test('equipment gate: reserveEquipment rejects blocked equipment — it is not an unrestricted status change', ()=>{
  const WD=loadWorkshopData();
  WD.changeEquipmentStatus('E-1001','Under Maintenance');
  const res=WD.reserveEquipment('E-1001',{project:'P-1'});
  assert.equal(res.code,'EQUIPMENT_SAFETY_BLOCKED');
});

// ── Pass 3.2A fix: close equipment safety evidence bypasses (adversarial review) ──────────────
// (A) updateEquipment cannot disable mandatory requirements.
test('bypass fix A: updateEquipment cannot disable a mandatory requirement flag', ()=>{
  const WD=loadWorkshopData();
  setEqRequirements(WD,'E-1001',{certificationRequired:true});
  WD.addCertification('E-1001',{issuedBy:'Aleksandar C.',date:'2019-01-01',expiryDate:'2020-01-01',certificateNumber:'CERT-TEST-1'});
  assert.equal(WD.getEquipmentSafetyGate('E-1001',{asOf:EQ_ASOF}).blocked,true);
  const res=WD.updateEquipment('E-1001',{requirements:{certificationRequired:false}});
  assert.equal(res.code,'EQUIPMENT_SAFETY_FIELDS_PROTECTED');
  assert.equal(WD.getEquipmentSafetyGate('E-1001',{asOf:EQ_ASOF}).blocked,true,'still blocked — requirements untouched');
});
// (B) updateEquipment cannot move safety dates into the future.
test('bypass fix B: updateEquipment cannot move a gate-controlling date (e.g. certificationExpiry) into the future', ()=>{
  const WD=loadWorkshopData();
  setEqRequirements(WD,'E-1001',{certificationRequired:true});
  WD.addCertification('E-1001',{issuedBy:'Aleksandar C.',date:'2019-01-01',expiryDate:'2020-01-01',certificateNumber:'CERT-TEST-1'});
  const res=WD.updateEquipment('E-1001',{certificationExpiry:'2030-01-01'});
  assert.equal(res.code,'EQUIPMENT_SAFETY_FIELDS_PROTECTED');
  const item=WD.get().equipment.find(e=>e.equipmentId==='E-1001');
  assert.equal(item.certificationExpiry,'2020-01-01','the original expiry must be unchanged');
});
test('bypass fix: the full documented exploit (disable requirement + move date + assign) is rejected at every step', ()=>{
  const WD=loadWorkshopData();
  setEqRequirements(WD,'E-1001',{certificationRequired:true});
  WD.addCertification('E-1001',{issuedBy:'Aleksandar C.',date:'2019-01-01',expiryDate:'2020-01-01',certificateNumber:'CERT-TEST-1'});
  assert.equal(WD.canAssignEquipment('E-1001',{asOf:EQ_ASOF}).allowed,false,'step 2: correctly blocked');
  const tampered=WD.updateEquipment('E-1001',{requirements:{certificationRequired:false},certificationExpiry:'2030-01-01'});
  assert.equal(tampered.code,'EQUIPMENT_SAFETY_FIELDS_PROTECTED','step 3: the tamper attempt itself is rejected');
  assert.equal(WD.canAssignEquipment('E-1001',{asOf:EQ_ASOF}).allowed,false,'still blocked, nothing changed');
  const assign=WD.assignEquipment('E-1001',{project:'P-1'});
  assert.equal(assign.code,'EQUIPMENT_SAFETY_BLOCKED','step 4: assignment still rejected — no bypass');
});
// (C) a rejected mixed patch does not apply unrelated bundled fields.
test('bypass fix C: a rejected mixed patch (protected + ordinary fields together) applies NONE of it', ()=>{
  const WD=loadWorkshopData();
  const before=WD.get().equipment.find(e=>e.equipmentId==='E-1001');
  const res=WD.updateEquipment('E-1001',{name:'Renamed Machine',responsiblePerson:'Someone Else',certificationExpiry:'2030-01-01'});
  assert.equal(res.code,'EQUIPMENT_SAFETY_FIELDS_PROTECTED');
  const after=WD.get().equipment.find(e=>e.equipmentId==='E-1001');
  assert.deepEqual(after,before,'not even the unrelated name/responsiblePerson edits may apply');
});
test('bypass fix: ordinary descriptive fields (name, description, manufacturer, location, responsiblePerson) remain freely editable', ()=>{
  const WD=loadWorkshopData();
  const res=WD.updateEquipment('E-1001',{name:'Renamed Machine',description:'Updated desc',manufacturer:'NewCo',currentLocation:'Bay 9',responsiblePerson:'Someone Else'});
  assert.ok(!res.error);
  assert.equal(res.name,'Renamed Machine');
  assert.equal(res.currentLocation,'Bay 9');
});
// (D) createEquipment preserves normalized requirements.
test('bypass fix D: createEquipment preserves and normalizes a supplied requirements object', ()=>{
  const WD=loadWorkshopData();
  const created=WD.createEquipment({equipmentId:'E-NEW-1',name:'New Drill',category:'Power Tool',
    requirements:{certificationRequired:true,maintenanceRequired:'yes',bogusFlag:true}});
  assert.ok(!created.error);
  assert.deepEqual(created.requirements,{certificationRequired:true,maintenanceRequired:true});
  assert.equal(created.requirements.bogusFlag,undefined,'unknown keys are dropped, not stored verbatim');
});
// (E) empty/arbitrary passed inspection is rejected.
test('bypass fix E: an empty or minimal {result:"passed"} inspection is rejected outright', ()=>{
  const WD=loadWorkshopData();
  assert.ok(WD.addInspection('E-1001',{result:'passed'}).error,'nothing but a result must be rejected');
  assert.ok(WD.addInspection('E-1001',{result:'passed',inspector:'Aleksandar C.'}).error,'missing date');
  assert.ok(WD.addInspection('E-1001',{result:'passed',inspector:'Aleksandar C.',date:EQ_ASOF}).error,'missing evidence/reference');
  const ok=WD.addInspection('E-1001',{result:'passed',inspector:'Aleksandar C.',date:EQ_ASOF,evidence:'Visual check performed, no defects'});
  assert.ok(!ok.error);
});
// (F) unrelated passed inspection does not clear a critical failure.
test('bypass fix F: an unrelated later passed inspection does NOT clear an earlier critical failure', ()=>{
  const WD=loadWorkshopData();
  WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'failed',critical:true,findings:'Cracked frame',date:'2026-08-20'});
  WD.addInspection('E-1001',{inspector:'Marko K.',result:'passed',date:'2026-08-25',evidence:'Unrelated routine check, different item'});
  assert.equal(WD.getEquipmentSafetyGate('E-1001',{skipStatusCheck:true}).blocked,true,'the critical failure must still block');
  const assign=WD.assignEquipment('E-1001',{project:'P-1'});
  assert.equal(assign.code,'EQUIPMENT_SAFETY_BLOCKED');
});
// (G) old passed inspection cannot authorize post-failure return to service.
test('bypass fix G: an OLD passed inspection (predating a later failure) cannot authorize return to service', ()=>{
  const WD=loadWorkshopData();
  const oldPass=WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'passed',date:'2026-01-01',evidence:'Routine annual check'});
  WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'failed',critical:true,findings:'Cracked frame',date:'2026-08-20'});
  const res=WD.returnEquipmentToService('E-1001',{authorisedBy:'A',approvalReference:'R',resolutionEvidence:'E',passedInspectionReference:oldPass.id,returnDate:EQ_ASOF});
  assert.ok(res.error,'an inspection dated before the failure cannot serve as proof of a fix that came after it');
});
// (H) explicit linked reinspection can resolve the correct failed inspection.
test('bypass fix H: resolveEquipmentInspection with a genuinely newer, evidenced passed reinspection resolves the correct failure', ()=>{
  const WD=loadWorkshopData();
  const failed=WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'failed',critical:true,findings:'Cracked frame',date:'2026-08-20'});
  const missing=WD.resolveEquipmentInspection('E-1001',failed.id,{});
  assert.ok(missing.error,'missing authority/evidence fields must be rejected');
  const reinspection=WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'passed',date:'2026-08-25',evidence:'Frame repaired and re-welded, PT accepted'});
  const resolved=WD.resolveEquipmentInspection('E-1001',failed.id,{resolvedBy:'Aleksandar C.',resolutionEvidence:'Frame repaired, re-inspected and accepted',passedInspectionReference:reinspection.id,resolutionDate:'2026-08-25'});
  assert.ok(!resolved.error);
  assert.equal(WD.getEquipmentSafetyGate('E-1001',{skipStatusCheck:true}).blocked,false);
  const item=WD.get().equipment.find(e=>e.equipmentId==='E-1001');
  assert.equal(item.inspections.length,2,'both original records remain — nothing deleted');
  assert.equal(item.inspections.find(i=>i.id===failed.id).result,'failed','the failed record itself is never overwritten, only marked resolved');
});
// (I) resolving one failure does not resolve another failure.
test('bypass fix I: resolving one failed inspection does not resolve a second, independent failure', ()=>{
  const WD=loadWorkshopData();
  const failed1=WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'failed',critical:true,findings:'Cracked frame',date:'2026-08-18'});
  const failed2=WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'failed',critical:false,findings:'Loose guard',date:'2026-08-19'});
  const reinspection=WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'passed',date:'2026-08-25',evidence:'Frame repaired and re-welded'});
  WD.resolveEquipmentInspection('E-1001',failed1.id,{resolvedBy:'Aleksandar C.',resolutionEvidence:'Frame repaired',passedInspectionReference:reinspection.id,resolutionDate:'2026-08-25'});
  assert.equal(WD.getEquipmentSafetyGate('E-1001',{skipStatusCheck:true}).blocked,true,'the second, unresolved failure must still block');
  const item=WD.get().equipment.find(e=>e.equipmentId==='E-1001');
  assert.equal(item.inspections.find(i=>i.id===failed2.id).resolved,undefined);
});
// (J) failed pre-use check remains blocking until explicitly resolved.
test('bypass fix J: an unrelated later passed pre-use check does not clear an earlier failed one; explicit resolvesCheckId does', ()=>{
  const WD=loadWorkshopData();
  const failedCheck=WD.recordEquipmentPreUseCheck('E-1001',{checkedBy:'Marko K.',date:'2026-08-25',result:'failed',notes:'Guard missing'});
  WD.recordEquipmentPreUseCheck('E-1001',{checkedBy:'Marko K.',date:'2026-08-26',result:'passed',checklist:'Different, unrelated check'});
  assert.equal(WD.getEquipmentSafetyGate('E-1001',{skipStatusCheck:true}).blockers.some(b=>b.code==='PREUSE_CHECK_FAILED'),true,'unrelated pass must not clear the earlier failure');
  const linked=WD.recordEquipmentPreUseCheck('E-1001',{checkedBy:'Marko K.',date:'2026-08-27',result:'passed',checklist:'Guard reattached and verified',resolvesCheckId:failedCheck.id});
  assert.ok(!linked.error);
  assert.equal(WD.getEquipmentSafetyGate('E-1001',{skipStatusCheck:true}).blockers.some(b=>b.code==='PREUSE_CHECK_FAILED'),false,'the explicitly linked re-check must resolve it');
  const item=WD.get().equipment.find(e=>e.equipmentId==='E-1001');
  assert.equal(item.preUseChecks.length,3,'all three records remain — history preserved');
});
// (K) currentAssignment survives save and reload.
test('bypass fix K: currentAssignment (and assignment fields) survive a save + reload round-trip', ()=>{
  const {WD,localStorage}=loadWorkshopDataWithStorage();
  WD.assignEquipment('E-1001',{project:'P-2026-014',jobcard:'JC-2026-0001',worker:'Marko K.',assignedBy:'Aleksandar C.'});
  const reloaded=loadWorkshopData(undefined,localStorage);
  const item=reloaded.get().equipment.find(e=>e.equipmentId==='E-1001');
  assert.ok(item.currentAssignment&&typeof item.currentAssignment==='object'&&!Array.isArray(item.currentAssignment),'currentAssignment must remain a real object after reload');
  assert.equal(item.currentAssignment.project,'P-2026-014');
  assert.equal(item.currentAssignment.jobcard,'JC-2026-0001');
  assert.equal(item.assignedProject,'P-2026-014');
  assert.equal(item.assignedJobcard,'JC-2026-0001');
});
// (L) malformed currentAssignment becomes null.
test('bypass fix L: a malformed currentAssignment (array or primitive) normalizes to null; a valid object is preserved; real null stays null', ()=>{
  const v5=minimalState({version:5,customers:[{id:1,no:'C-001',name:'X'}],equipment:[
    {id:'E-A',equipmentId:'E-A',name:'A',status:'Available',currentAssignment:['bad','array']},
    {id:'E-B',equipmentId:'E-B',name:'B',status:'Available',currentAssignment:'a string'},
    {id:'E-C',equipmentId:'E-C',name:'C',status:'Available',currentAssignment:{project:'P-1',jobcard:'JC-1'}},
    {id:'E-D',equipmentId:'E-D',name:'D',status:'Available',currentAssignment:null}
  ]});
  const WD=loadWorkshopData({[V5_KEY]:JSON.stringify(v5)});
  const eqRec=id=>WD.get().equipment.find(e=>e.equipmentId===id);
  assert.equal(eqRec('E-A').currentAssignment,null);
  assert.equal(eqRec('E-B').currentAssignment,null);
  assert.deepEqual(eqRec('E-C').currentAssignment,{project:'P-1',jobcard:'JC-1'});
  assert.equal(eqRec('E-D').currentAssignment,null);
});
// (M) resolveBreakdown synchronizes both stored breakdown collections after reload.
test('bypass fix M: resolveBreakdown synchronizes equipment.downtimeRecords AND state.breakdowns after a reload (independent object copies)', ()=>{
  const {WD,localStorage}=loadWorkshopDataWithStorage();
  const br=WD.reportBreakdown('E-1001',{reason:'Motor failure',responsiblePerson:'Marko K.'});
  const reloaded=loadWorkshopData(undefined,localStorage);
  const res=reloaded.resolveBreakdown('E-1001',br.id,{resolvedBy:'Marko K.',resolutionEvidence:'Motor replaced'});
  assert.ok(!res.error);
  const st=reloaded.get();
  const inEquipment=st.equipment.find(e=>e.equipmentId==='E-1001').downtimeRecords.find(d=>d.id===br.id);
  const inShared=st.breakdowns.find(d=>d.id===br.id);
  assert.equal(inEquipment.status,'resolved');
  assert.equal(inShared.status,'resolved','the shared state.breakdowns copy — a separate object after reload — must also be updated');
});
// (N) protected history and usage fields cannot be replaced through updateEquipment.
test('bypass fix N: updateEquipment cannot replace ANY protected field (history arrays, usage/meter, assignment fields, requirements)', ()=>{
  const WD=loadWorkshopData();
  WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'failed',critical:true,findings:'Cracked frame',date:EQ_ASOF});
  const before=WD.get().equipment.find(e=>e.equipmentId==='E-1001');
  const attempts=[
    {inspections:[]},{maintenance:[]},{certifications:[]},{calibrations:[]},{preUseChecks:[]},
    {downtimeRecords:[]},{safetyWarnings:[]},{activity:[]},{returnToService:[]},{usageHistory:[]},
    {usageSessions:[]},{operatingHourMeter:99999},{currentAssignment:{fake:true}},
    {assignedProject:'FAKE'},{assignedJobcard:'FAKE'},{operator:'FAKE'},{requirements:{maintenanceRequired:true}}
  ];
  attempts.forEach(patch=>{
    const res=WD.updateEquipment('E-1001',patch);
    assert.equal(res.code,'EQUIPMENT_SAFETY_FIELDS_PROTECTED',JSON.stringify(patch));
  });
  const after=WD.get().equipment.find(e=>e.equipmentId==='E-1001');
  assert.deepEqual(after,before,'none of the attempts may have changed anything');
});
// (O) blocked mutations leave the complete record unchanged.
test('bypass fix O: a blocked returnEquipmentToService attempt leaves the equipment record completely unchanged', ()=>{
  const WD=loadWorkshopData();
  WD.reportBreakdown('E-1001',{reason:'Motor failure',responsiblePerson:'Marko K.'});
  const insp=WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'passed',date:EQ_ASOF,evidence:'Visual check OK'});
  const before=WD.get().equipment.find(e=>e.equipmentId==='E-1001');
  const res=WD.returnEquipmentToService('E-1001',{authorisedBy:'A',approvalReference:'R',resolutionEvidence:'E',passedInspectionReference:insp.id,returnDate:EQ_ASOF});
  assert.equal(res.code,'EQUIPMENT_SAFETY_BLOCKED');
  const after=WD.get().equipment.find(e=>e.equipmentId==='E-1001');
  assert.deepEqual(after,before);
});

test('equipment gate: returnEquipmentToService requires authorisedBy, approvalReference, resolutionEvidence, passedInspectionReference and returnDate', ()=>{
  const WD=loadWorkshopData();
  WD.changeEquipmentStatus('E-1001','Quarantined');
  const insp=WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'passed',date:EQ_ASOF,evidence:'Visual check OK'});
  const full={authorisedBy:'Aleksandar C.',approvalReference:'RTS-1',resolutionEvidence:'Repaired and verified',passedInspectionReference:insp.id,returnDate:EQ_ASOF};
  Object.keys(full).forEach(field=>{
    const partial=Object.assign({},full);delete partial[field];
    const res=WD.returnEquipmentToService('E-1001',partial);
    assert.ok(res.error,`missing ${field} must be rejected`);
  });
});
test('equipment gate: Retired equipment can never be returned to service', ()=>{
  const WD=loadWorkshopData();
  WD.retireEquipment('E-1001','End of life');
  const insp=WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'passed',date:EQ_ASOF,evidence:'Visual check OK'});
  const res=WD.returnEquipmentToService('E-1001',{authorisedBy:'A',approvalReference:'R',resolutionEvidence:'E',passedInspectionReference:insp.id,returnDate:EQ_ASOF});
  assert.ok(res.error);
});
test('equipment gate: returnEquipmentToService is rejected while an open breakdown remains unresolved', ()=>{
  const WD=loadWorkshopData();
  WD.reportBreakdown('E-1001',{reason:'Motor failure',responsiblePerson:'Marko K.'});
  const insp=WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'passed',date:EQ_ASOF,evidence:'Visual check OK'});
  const res=WD.returnEquipmentToService('E-1001',{authorisedBy:'A',approvalReference:'R',resolutionEvidence:'E',passedInspectionReference:insp.id,returnDate:EQ_ASOF});
  assert.equal(res.code,'EQUIPMENT_SAFETY_BLOCKED');
});
test('equipment gate: returnEquipmentToService is rejected when passedInspectionReference does not match a real, passed inspection record', ()=>{
  const WD=loadWorkshopData();
  WD.changeEquipmentStatus('E-1001','Quarantined');
  const res=WD.returnEquipmentToService('E-1001',{authorisedBy:'A',approvalReference:'R',resolutionEvidence:'E',passedInspectionReference:'DOES-NOT-EXIST',returnDate:EQ_ASOF});
  assert.ok(res.error);
});
test('equipment gate: a successful formal return to service preserves history, does not auto-assign, and adds an audit entry', ()=>{
  const WD=loadWorkshopData();
  WD.changeEquipmentStatus('E-1001','Quarantined');
  WD.addNote('E-1001',{author:'Marko K.',text:'Under review'});
  const insp=WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'passed',date:EQ_ASOF,evidence:'Visual check OK'});
  const before=WD.get().equipment.find(e=>e.equipmentId==='E-1001');
  const res=WD.returnEquipmentToService('E-1001',{authorisedBy:'Aleksandar C.',approvalReference:'RTS-1',resolutionEvidence:'Repaired and reinspected',passedInspectionReference:insp.id,returnDate:EQ_ASOF});
  assert.ok(!res.error);
  assert.equal(res.status,'Available');
  assert.equal(res.assignedProject,null);
  assert.equal(res.assignedJobcard,null);
  assert.equal(res.notesLog.length,before.notesLog.length);
  assert.equal(res.inspections.length,before.inspections.length);
  assert.ok(res.returnToService.length>=1);
  assert.ok(res.activity.some(a=>/Returned to service/.test(a.action)));
});
test('equipment gate: a blocked usage attempt leaves the equipment, hour meter and usage history completely unchanged', ()=>{
  const WD=loadWorkshopData();
  WD.changeEquipmentStatus('E-1001','Out of Service');
  const before=WD.get().equipment.find(e=>e.equipmentId==='E-1001');
  const res=WD.logEquipmentUsage('E-1001',{hours:5,worker:'Marko K.'});
  assert.equal(res.code,'EQUIPMENT_SAFETY_BLOCKED');
  assert.deepEqual(WD.get().equipment.find(e=>e.equipmentId==='E-1001'),before);
});
test('equipment gate: a blocked assignment attempt leaves the equipment assignment fields completely unchanged', ()=>{
  const WD=loadWorkshopData();
  WD.changeEquipmentStatus('E-1001','Out of Service');
  const before=WD.get().equipment.find(e=>e.equipmentId==='E-1001');
  const res=WD.assignEquipment('E-1001',{project:'P-9',jobcard:'JC-9',worker:'Someone'});
  assert.equal(res.code,'EQUIPMENT_SAFETY_BLOCKED');
  assert.deepEqual(WD.get().equipment.find(e=>e.equipmentId==='E-1001'),before);
});
test('equipment gate API: getEquipmentSafetyGate returns clones, not live references', ()=>{
  const WD=loadWorkshopData();
  WD.changeEquipmentStatus('E-1001','Quarantined');
  const gate=WD.getEquipmentSafetyGate('E-1001');
  gate.blockers[0].message='TAMPERED';
  const gate2=WD.getEquipmentSafetyGate('E-1001');
  assert.notEqual(gate2.blockers[0].message,'TAMPERED');
});
test('equipment gate: an intentionally empty equipment collection remains empty after normalize() (Pass 3.2A additions do not refill it)', ()=>{
  const v5=minimalState({version:5,customers:[{id:1,no:'C-001',name:'X'}],equipment:[]});
  const WD=loadWorkshopData({[V5_KEY]:JSON.stringify(v5)});
  assert.deepEqual(WD.getEquipment(),[]);
});

// ── Pass 3.2A fix round 2: close evidence-injection bypasses (adversarial review) ──────────────
// (1) Caller-supplied resolved:true cannot resolve a breakdown.
test('bypass fix 2.1: caller-supplied resolved:true/status cannot make reportBreakdown create an already-resolved breakdown', ()=>{
  const WD=loadWorkshopData();
  const br=WD.reportBreakdown('E-1001',{reason:'Motor failure',responsiblePerson:'Marko K.',resolved:true,status:'resolved'});
  assert.ok(!br.error);
  assert.ok(!br.resolved,'resolved must never be born true from caller input');
  assert.equal(br.status,'Reported','status is workflow-owned and always starts as Reported');
  assert.equal(WD.getEquipmentSafetyGate('E-1001',{skipStatusCheck:true}).blockers.some(b=>b.code==='BREAKDOWN_OPEN'),true);
});
// (2) Caller-supplied resolved:true cannot resolve a failed inspection.
test('bypass fix 2.2: caller-supplied resolved:true cannot make addInspection create an already-resolved failed inspection', ()=>{
  const WD=loadWorkshopData();
  const insp=WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'failed',critical:true,findings:'Cracked frame',date:EQ_ASOF,resolved:true,resolvedBy:'Nobody',resolutionEvidence:'Fake'});
  assert.ok(!insp.error);
  assert.ok(!insp.resolved,'resolved must never be born true from caller input');
  assert.equal(WD.getEquipmentSafetyGate('E-1001',{skipStatusCheck:true}).blocked,true);
});
// (3) Caller-supplied closed/repaired status cannot resolve a failed inspection.
test('bypass fix 2.3: a caller-supplied status string like "closed"/"repaired" cannot substitute for formal inspection resolution', ()=>{
  const WD=loadWorkshopData();
  const insp=WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'failed',critical:true,findings:'Cracked frame',date:EQ_ASOF,status:'closed'});
  assert.ok(!insp.error);
  const stored=WD.get().equipment.find(e=>e.equipmentId==='E-1001').inspections.find(i=>i.id===insp.id);
  assert.notEqual(stored.status,'closed','status is a stripped, workflow-owned field on inspection records too');
  assert.equal(WD.getEquipmentSafetyGate('E-1001',{skipStatusCheck:true}).blocked,true,'the failure must still block despite the caller-supplied status string');
});
// (4) Pending inspection cannot advance inspectionDate.
test('bypass fix 2.4: a pending inspection cannot advance inspectionDate', ()=>{
  const WD=loadWorkshopData();
  const before=WD.get().equipment.find(e=>e.equipmentId==='E-1001').inspectionDate;
  const res=WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'pending',date:EQ_ASOF,nextDueDate:'2099-01-01'});
  assert.ok(res.error,'nextDueDate is only accepted on a passed inspection');
  assert.equal(WD.get().equipment.find(e=>e.equipmentId==='E-1001').inspectionDate,before);
});
// (5) Failed inspection cannot advance inspectionDate.
test('bypass fix 2.5: a failed inspection cannot advance inspectionDate', ()=>{
  const WD=loadWorkshopData();
  const before=WD.get().equipment.find(e=>e.equipmentId==='E-1001').inspectionDate;
  const res=WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'failed',findings:'Cracked',date:EQ_ASOF,nextDueDate:'2099-01-01'});
  assert.ok(res.error);
  assert.equal(WD.get().equipment.find(e=>e.equipmentId==='E-1001').inspectionDate,before);
});
// (6) Only evidenced passed inspection can advance inspectionDate.
test('bypass fix 2.6: only an evidenced passed inspection can advance inspectionDate', ()=>{
  const WD=loadWorkshopData();
  const res=WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'passed',date:EQ_ASOF,evidence:'Visual check OK',nextDueDate:'2027-01-01'});
  assert.ok(!res.error);
  assert.equal(WD.get().equipment.find(e=>e.equipmentId==='E-1001').inspectionDate,'2027-01-01');
});
// The full FIX-1 exploit narrative, end to end.
test('bypass fix: the full documented FIX-1 exploit (breakdown/inspection born pre-resolved) is rejected end-to-end', ()=>{
  const WD=loadWorkshopData();
  const br=WD.reportBreakdown('E-1001',{reason:'failure',responsiblePerson:'Someone',resolved:true});
  assert.ok(!br.error&&!br.resolved);
  const failedInsp=WD.addInspection('E-1001',{result:'failed',critical:true,inspector:'A',date:'2026-08-29',findings:'fault',resolved:true});
  assert.ok(!failedInsp.error&&!failedInsp.resolved);
  const passedInsp=WD.addInspection('E-1001',{result:'passed',inspector:'A',date:EQ_ASOF,evidence:'Unrelated routine check'});
  const res=WD.returnEquipmentToService('E-1001',{authorisedBy:'A',approvalReference:'R',resolutionEvidence:'E',passedInspectionReference:passedInsp.id,returnDate:EQ_ASOF});
  assert.equal(res.code,'EQUIPMENT_SAFETY_BLOCKED','still blocked by the unresolved breakdown and the unresolved critical failure');
});
// (7) Invalid inspection dates are rejected.
test('bypass fix 3.1: invalid inspection dates are rejected (empty, malformed, non-existent calendar day, wrong shape)', ()=>{
  const WD=loadWorkshopData();
  for(const bad of ['','banana','2026-02-30','2026-13-01','30-08-2026']){
    const res=WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'pending',date:bad});
    assert.ok(res.error,`date=${bad} must be rejected`);
  }
});
// (8) Invalid resolutionDate is rejected.
test('bypass fix 3.2: resolveEquipmentInspection rejects an invalid resolutionDate', ()=>{
  const WD=loadWorkshopData();
  const failed=WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'failed',critical:true,findings:'Cracked frame',date:'2026-08-20'});
  const reinspection=WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'passed',date:'2026-08-25',evidence:'Repaired and re-welded'});
  const res=WD.resolveEquipmentInspection('E-1001',failed.id,{resolvedBy:'Aleksandar C.',resolutionEvidence:'Fixed',passedInspectionReference:reinspection.id,resolutionDate:'2026-02-30'});
  assert.ok(res.error);
});
// (9) Backdated reinspection cannot resolve a newer failure.
test('bypass fix 3.3: resolveEquipmentInspection rejects a backdated "passed" reference (older than the failure it claims to resolve)', ()=>{
  const WD=loadWorkshopData();
  const oldPass=WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'passed',date:'2026-01-01',evidence:'Routine annual check'});
  const failed=WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'failed',critical:true,findings:'Cracked frame',date:'2026-08-20'});
  const res=WD.resolveEquipmentInspection('E-1001',failed.id,{resolvedBy:'Aleksandar C.',resolutionEvidence:'Fixed',passedInspectionReference:oldPass.id,resolutionDate:'2026-08-25'});
  assert.ok(res.error,'a passed inspection dated before the failure cannot resolve it');
});
// (10) Backdated pre-use check cannot resolve a newer failed check.
test('bypass fix 3.4: a backdated pre-use check cannot resolve a newer failed check', ()=>{
  const WD=loadWorkshopData();
  const failed=WD.recordEquipmentPreUseCheck('E-1001',{checkedBy:'Marko K.',date:'2026-08-25',result:'failed',notes:'Guard missing'});
  const res=WD.recordEquipmentPreUseCheck('E-1001',{checkedBy:'Marko K.',date:'2026-08-22',result:'passed',checklist:'Backdated fix claim',resolvesCheckId:failed.id});
  assert.ok(res.error,'the resolving check must be dated after the failed check, not before');
});
// (11) Resolving pre-use check must match project/jobcard context.
test('bypass fix 3.5: resolving a pre-use check tied to a project/jobcard must match that same context', ()=>{
  const WD=loadWorkshopData();
  const failed=WD.recordEquipmentPreUseCheck('E-1001',{checkedBy:'Marko K.',date:'2026-08-25',result:'failed',notes:'Guard missing',projectNo:'P-2026-014',jobcardNo:'JC-2026-0001'});
  const wrongContext=WD.recordEquipmentPreUseCheck('E-1001',{checkedBy:'Marko K.',date:'2026-08-27',result:'passed',checklist:'Fixed',resolvesCheckId:failed.id,projectNo:'P-OTHER',jobcardNo:'JC-OTHER'});
  assert.ok(wrongContext.error,"resolving check must match the failed check's project/jobcard");
  const rightContext=WD.recordEquipmentPreUseCheck('E-1001',{checkedBy:'Marko K.',date:'2026-08-27',result:'passed',checklist:'Fixed',resolvesCheckId:failed.id,projectNo:'P-2026-014',jobcardNo:'JC-2026-0001'});
  assert.ok(!rightContext.error);
});
// (12) Invalid resolvesCheckId causes no mutation.
test('bypass fix 3.6: an invalid resolvesCheckId rejects the whole new pre-use check — no partial mutation', ()=>{
  const WD=loadWorkshopData();
  const before=WD.get().equipment.find(e=>e.equipmentId==='E-1001').preUseChecks;
  const res=WD.recordEquipmentPreUseCheck('E-1001',{checkedBy:'Marko K.',date:EQ_ASOF,result:'passed',checklist:'OK',resolvesCheckId:'DOES-NOT-EXIST'});
  assert.ok(res.error);
  const after=WD.get().equipment.find(e=>e.equipmentId==='E-1001').preUseChecks;
  assert.deepEqual(after,before,'no new check may have been recorded when the linkage itself is invalid');
});
// (13) Invalid returnDate is rejected.
test('bypass fix 3.7: returnEquipmentToService rejects an invalid returnDate', ()=>{
  const WD=loadWorkshopData();
  WD.changeEquipmentStatus('E-1001','Quarantined');
  const insp=WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'passed',date:EQ_ASOF,evidence:'Visual check OK'});
  const res=WD.returnEquipmentToService('E-1001',{authorisedBy:'A',approvalReference:'R',resolutionEvidence:'E',passedInspectionReference:insp.id,returnDate:'2026-02-30'});
  assert.ok(res.error);
});
// (14) Return date before passed inspection is rejected.
test('bypass fix 3.8: returnEquipmentToService rejects a returnDate earlier than the passed inspection it relies on', ()=>{
  const WD=loadWorkshopData();
  WD.changeEquipmentStatus('E-1001','Quarantined');
  const insp=WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'passed',date:'2026-08-25',evidence:'Visual check OK'});
  const res=WD.returnEquipmentToService('E-1001',{authorisedBy:'A',approvalReference:'R',resolutionEvidence:'E',passedInspectionReference:insp.id,returnDate:'2026-08-20'});
  assert.ok(res.error);
});
// (15) Unknown status cannot use formal return-to-service as a shortcut; already-operational equipment cannot use it either.
test('bypass fix 3.9: equipment with an unknown/malformed status cannot use returnEquipmentToService as a shortcut back to Available', ()=>{
  const WD=loadWorkshopData();
  WD.updateEquipment('E-1001',{status:'Sitting In The Yard'});
  const insp=WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'passed',date:EQ_ASOF,evidence:'Visual check OK'});
  const res=WD.returnEquipmentToService('E-1001',{authorisedBy:'A',approvalReference:'R',resolutionEvidence:'E',passedInspectionReference:insp.id,returnDate:EQ_ASOF});
  assert.ok(res.error,'an unrecognised status must fail safe, not be treated as an easy path back to Available');
});
test('bypass fix: already-operational equipment cannot use returnEquipmentToService', ()=>{
  const WD=loadWorkshopData();
  const insp=WD.addInspection('E-1001',{inspector:'Aleksandar C.',result:'passed',date:EQ_ASOF,evidence:'Visual check OK'});
  const res=WD.returnEquipmentToService('E-1001',{authorisedBy:'A',approvalReference:'R',resolutionEvidence:'E',passedInspectionReference:insp.id,returnDate:EQ_ASOF});
  assert.ok(res.error,'E-1001 is already Available — this method is not for already-operational equipment');
});
// (16) Maintenance without passed/completed result and evidence cannot advance its date.
test('bypass fix 4.1: addMaintenanceRecord without a completed/passed result and evidence cannot advance maintenanceDate', ()=>{
  const WD=loadWorkshopData();
  const before=WD.get().equipment.find(e=>e.equipmentId==='E-1001').maintenanceDate;
  assert.ok(WD.addMaintenanceRecord('E-1001',{completedBy:'Marko K.',date:EQ_ASOF,result:'in-progress',evidence:'x',nextDueDate:'2099-01-01'}).error,'result must be completed/passed');
  assert.ok(WD.addMaintenanceRecord('E-1001',{completedBy:'Marko K.',date:EQ_ASOF,result:'completed',nextDueDate:'2099-01-01'}).error,'evidence is required');
  assert.equal(WD.get().equipment.find(e=>e.equipmentId==='E-1001').maintenanceDate,before);
});
// (17) Certification without certificate/reference/evidence cannot advance expiry.
test('bypass fix 4.2: addCertification without certificateNumber/approvalReference cannot advance certificationExpiry', ()=>{
  const WD=loadWorkshopData();
  const before=WD.get().equipment.find(e=>e.equipmentId==='E-1001').certificationExpiry;
  assert.ok(WD.addCertification('E-1001',{issuedBy:'Aleksandar C.',date:EQ_ASOF,expiryDate:'2099-01-01'}).error,'certificateNumber/approvalReference is required');
  assert.equal(WD.get().equipment.find(e=>e.equipmentId==='E-1001').certificationExpiry,before);
});
// (18) Calibration without passed result and evidence cannot advance its date.
test('bypass fix 4.3: addCalibration without a passed result and evidence cannot advance calibrationDate', ()=>{
  const WD=loadWorkshopData();
  const before=WD.get().equipment.find(e=>e.equipmentId==='E-1001').calibrationDate;
  assert.ok(WD.addCalibration('E-1001',{calibratedBy:'Aleksandar C.',date:EQ_ASOF,result:'failed',evidence:'x',nextDueDate:'2099-01-01'}).error,'result must be passed');
  assert.ok(WD.addCalibration('E-1001',{calibratedBy:'Aleksandar C.',date:EQ_ASOF,result:'passed',nextDueDate:'2099-01-01'}).error,'evidence is required');
  assert.equal(WD.get().equipment.find(e=>e.equipmentId==='E-1001').calibrationDate,before);
});
// (19) updateEquipmentRequirements rejects non-boolean values.
test('bypass fix 4.4: updateEquipmentRequirements rejects non-boolean values (e.g. the string "false") rather than coercing them', ()=>{
  const WD=loadWorkshopData();
  const res=WD.updateEquipmentRequirements('E-1001',{certificationRequired:'false'},{updatedBy:'Aleksandar C.',reason:'test',approvalReference:'APPR-1'});
  assert.ok(res.error);
  const item=WD.get().equipment.find(e=>e.equipmentId==='E-1001');
  assert.notEqual(item.requirements&&item.requirements.certificationRequired,'false');
});
// (20) updateEquipmentRequirements requires approvalReference.
test('bypass fix 4.5: updateEquipmentRequirements requires an approvalReference (not just updatedBy/reason)', ()=>{
  const WD=loadWorkshopData();
  const res=WD.updateEquipmentRequirements('E-1001',{certificationRequired:true},{updatedBy:'Aleksandar C.',reason:'test'});
  assert.ok(res.error);
});
// (21) isRetired/retirementReason cannot be changed through updateEquipment.
test('bypass fix 5.1: isRetired/retirementReason cannot be changed through updateEquipment — only retireEquipment can, and it requires a reason', ()=>{
  const WD=loadWorkshopData();
  const res1=WD.updateEquipment('E-1001',{isRetired:true});
  assert.equal(res1.code,'EQUIPMENT_SAFETY_FIELDS_PROTECTED');
  const res2=WD.updateEquipment('E-1001',{retirementReason:'Sneaky'});
  assert.equal(res2.code,'EQUIPMENT_SAFETY_FIELDS_PROTECTED');
  assert.equal(WD.get().equipment.find(e=>e.equipmentId==='E-1001').isRetired,false);
  const missingReason=WD.retireEquipment('E-1001','   ');
  assert.ok(missingReason.error,'retireEquipment requires a non-whitespace reason');
  const ok=WD.retireEquipment('E-1001','End of service life');
  assert.ok(!ok.error);
  assert.equal(ok.status,'Retired');
  assert.equal(ok.isRetired,true);
});
// (22) Rejected mutations across every new validated method leave the complete record unchanged.
test('bypass fix 22: rejected mutations across every newly-validated method leave the complete equipment record unchanged', ()=>{
  const WD=loadWorkshopData();
  const before=WD.get().equipment.find(e=>e.equipmentId==='E-1001');
  WD.reportBreakdown('E-1001',{reason:''});
  WD.addInspection('E-1001',{result:'passed'});
  WD.addMaintenanceRecord('E-1001',{completedBy:'X'});
  WD.addCertification('E-1001',{issuedBy:'X'});
  WD.addCalibration('E-1001',{calibratedBy:'X'});
  WD.recordEquipmentPreUseCheck('E-1001',{checkedBy:'X'});
  WD.updateEquipmentRequirements('E-1001',{certificationRequired:true},{});
  const after=WD.get().equipment.find(e=>e.equipmentId==='E-1001');
  assert.deepEqual(after,before,'not one of these rejected attempts may have changed anything');
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
// Review fix (Pass 3.2B review, finding 1): updateJobcardOperation() no longer owns starting an
// operation at all — it unconditionally refuses ANY transition into 'in-progress', hold or no hold.
// startJobcardOperation() is the one route in, and IT is the method the Quality Hold gate applies to.
test('quality gate: updateJobcardOperation() unconditionally refuses to start a pending operation — startJobcardOperation() is the only route, and a held jobcard blocks it there', ()=>{
  const WD=loadWorkshopData();
  const res=WD.updateJobcardOperation('JC-2026-0001',5,{status:'in-progress'});
  assert.equal(res.code,'OPERATION_START_DEDICATED_METHOD_REQUIRED');
  const op1=WD.get().jobcards.find(j=>j.no==='JC-2026-0001').operations.find(o=>o.id===5);
  assert.equal(op1.status,'pending','a blocked operation must not have its status changed');
  const startRes=WD.startJobcardOperation('JC-2026-0001',5,{});
  assert.equal(startRes.code,'QUALITY_HOLD_ACTIVE');
  assert.ok(startRes.holdNumbers.includes('HOLD-2026-001'));
  const op2=WD.get().jobcards.find(j=>j.no==='JC-2026-0001').operations.find(o=>o.id===5);
  assert.equal(op2.status,'pending','a blocked start must not have its status changed either');
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

// ── Pass 3.1 fix: close generic jobcard/operation safety bypasses ──────────
// Independent review found two central-gate gaps: (1) upsertJobcard() only gated the
// existing-jobcard branch, so a brand-new Jobcard could be created directly with an unsafe status
// or with pre-populated unsafe-status operations under a held Project; (2) updateJobcard()/
// upsertJobcard() could receive a whole `operations` array (as the reorder/duplicate/delete flows
// already do) and smuggle an unsafe operation-status transition past updateJobcardOperation()'s
// dedicated gate. Both are now closed centrally via unsafeOperationTransitions()/
// hasUnsafeSeedOperations() in workshop-data.js.

// (A) + (B): new Jobcard creation cannot bypass a held PROJECT via a direct unsafe status.
test('bypass fix A: a new Jobcard cannot be created directly with status in-progress under a held project', ()=>{
  const WD=loadWorkshopData();
  WD.applyQualityHold({scope:'project',reference:'P-26-0002',reason:'Customer stop-work notice'});
  const before=WD.get().jobcards.length;
  const res=WD.upsertJobcard({no:'JC-TEST-A',projectNo:'P-26-0002',title:'Bypass attempt',status:'in-progress'});
  assert.equal(res.code,'QUALITY_HOLD_ACTIVE');
  assert.equal(WD.get().jobcards.length,before,'no jobcard record should have been created');
});
test('bypass fix B: a new Jobcard cannot be created directly with status completed or closed under a held project', ()=>{
  const WD=loadWorkshopData();
  WD.applyQualityHold({scope:'project',reference:'P-26-0002',reason:'Customer stop-work notice'});
  const before=WD.get().jobcards.length;
  const completed=WD.upsertJobcard({no:'JC-TEST-B1',projectNo:'P-26-0002',title:'Bypass attempt',status:'completed'});
  assert.equal(completed.code,'QUALITY_HOLD_ACTIVE');
  const closed=WD.upsertJobcard({no:'JC-TEST-B2',projectNo:'P-26-0002',title:'Bypass attempt',status:'closed'});
  assert.equal(closed.code,'QUALITY_HOLD_ACTIVE');
  assert.equal(WD.get().jobcards.length,before,'neither rejected attempt should have created a jobcard record');
});

// (C): new Jobcard creation cannot bypass a held project via pre-populated unsafe operations.
test('bypass fix C: a new Jobcard cannot be created with a pre-populated operation already set to in-progress, completed or skipped under a held project', ()=>{
  const WD=loadWorkshopData();
  WD.applyQualityHold({scope:'project',reference:'P-26-0002',reason:'Customer stop-work notice'});
  const before=WD.get().jobcards.length;
  // Review fix: a seed operation already 'in-progress' is refused unconditionally (never created
  // running at all, hold or no hold) — completed/skipped seed operations remain hold-gated as before.
  const expectedCode={'in-progress':'OPERATION_START_DEDICATED_METHOD_REQUIRED',completed:'QUALITY_HOLD_ACTIVE',skipped:'QUALITY_HOLD_ACTIVE'};
  ['in-progress','completed','skipped'].forEach((status,idx)=>{
    const res=WD.upsertJobcard({no:`JC-TEST-C${idx}`,projectNo:'P-26-0002',title:'Bypass attempt',status:'draft',
      operations:[{id:1,desc:'Pre-seeded op',status}]});
    assert.equal(res.code,expectedCode[status],`a pre-populated operation status of "${status}" must be blocked`);
  });
  assert.equal(WD.get().jobcards.length,before,'no jobcard record should have been created by any attempt');
});
test('bypass fix: a new Jobcard with only safe pre-populated operations (pending/paused) is unaffected and still creates normally under a held project', ()=>{
  const WD=loadWorkshopData();
  WD.applyQualityHold({scope:'project',reference:'P-26-0002',reason:'Customer stop-work notice'});
  const res=WD.upsertJobcard({no:'JC-TEST-C-SAFE',projectNo:'P-26-0002',title:'Planned only',status:'draft',
    operations:[{id:1,desc:'Prep',status:'pending'}]});
  assert.ok(!res.error,'draft status + only pending/paused operations must never be blocked, held project or not');
});

// (D) + (E): updateJobcard()/upsertJobcard() cannot bypass updateJobcardOperation()'s gate via a
// whole operations array, using the seeded HOLD-2026-001 (active, scope:jobcard, reference:JC-2026-0001).
// Review fix: a bulk operations-array update can never start an operation either way (hold or not)
// — see the equivalent single-patch case above for the same rule via startJobcardOperation().
test('bypass fix D: updateJobcard({operations}) cannot change an operation from pending to in-progress — the dedicated start method is the only route, held or not', ()=>{
  const WD=loadWorkshopData();
  const j=WD.findJobcard('JC-2026-0001');
  const ops=j.operations.map(o=>o.id===5?Object.assign({},o,{status:'in-progress'}):o);
  const res=WD.updateJobcard('JC-2026-0001',{operations:ops});
  assert.equal(res.code,'OPERATION_START_DEDICATED_METHOD_REQUIRED');
  const op=WD.get().jobcards.find(jj=>jj.no==='JC-2026-0001').operations.find(o=>o.id===5);
  assert.equal(op.status,'pending','a blocked bulk-array start must not have its status changed');
});
test('bypass fix D: updateJobcard({operations}) cannot change an in-progress operation to completed or skipped while held', ()=>{
  const WD=loadWorkshopData();
  const j=WD.findJobcard('JC-2026-0001');
  const toCompleted=j.operations.map(o=>o.id===4?Object.assign({},o,{status:'completed',actualCompletion:'2026-08-30'}):o);
  const completed=WD.updateJobcard('JC-2026-0001',{operations:toCompleted});
  assert.equal(completed.code,'QUALITY_HOLD_ACTIVE');
  const toSkipped=j.operations.map(o=>o.id===5?Object.assign({},o,{status:'skipped'}):o);
  const skipped=WD.updateJobcard('JC-2026-0001',{operations:toSkipped});
  assert.equal(skipped.code,'QUALITY_HOLD_ACTIVE');
});
test('bypass fix E: upsertJobcard({operations}) cannot perform the same bypass on an existing held jobcard', ()=>{
  const WD=loadWorkshopData();
  const j=WD.findJobcard('JC-2026-0001');
  const ops=j.operations.map(o=>o.id===4?Object.assign({},o,{status:'completed',actualCompletion:'2026-08-30'}):o);
  const res=WD.upsertJobcard({id:1,no:'JC-2026-0001',operations:ops});
  assert.equal(res.code,'QUALITY_HOLD_ACTIVE');
});

// (F): a rejected mutation must leave the Jobcard AND every operation completely unchanged — even
// unrelated fields bundled into the same patch must not be applied, since the whole mutation (not
// just the operations array) is rejected atomically.
test('bypass fix F: a rejected operations-array bypass leaves the jobcard and every operation completely unchanged', ()=>{
  const WD=loadWorkshopData();
  const before=WD.findJobcard('JC-2026-0001');
  const ops=before.operations.map(o=>o.id===5?Object.assign({},o,{status:'skipped'}):o);
  const res=WD.updateJobcard('JC-2026-0001',{operations:ops,responsible:'Someone Else',priority:'low'});
  assert.equal(res.code,'QUALITY_HOLD_ACTIVE');
  const after=WD.findJobcard('JC-2026-0001');
  assert.deepEqual(after,before,'nothing on the jobcard record may change when the mutation is rejected, not even unrelated bundled fields');
});

// (G): redundant re-save of an operation already in the same unsafe status must remain allowed.
test('bypass fix G: re-saving an operation already in the same unsafe status via the array patch is allowed even while held', ()=>{
  const WD=loadWorkshopData();
  const j=WD.findJobcard('JC-2026-0001');
  const ops=j.operations.map(o=>o.id===4?Object.assign({},o,{status:'in-progress',notes:'unchanged status, just a note edit'}):o);
  const res=WD.updateJobcard('JC-2026-0001',{operations:ops});
  assert.ok(!res.error);
  assert.equal(res.operations.find(o=>o.id===4).notes,'unchanged status, just a note edit');
});

// (H): ordinary (non-status) operation edits remain allowed while held.
test('bypass fix H: editing ordinary operation fields (no unsafe status transition) remains allowed while held', ()=>{
  const WD=loadWorkshopData();
  const j=WD.findJobcard('JC-2026-0001');
  const ops=j.operations.map(o=>o.id===6?Object.assign({},o,{worker:'Marko K.',plannedHours:20,notes:'Reassigned'}):o);
  const res=WD.updateJobcard('JC-2026-0001',{operations:ops});
  assert.ok(!res.error);
  const op6=res.operations.find(o=>o.id===6);
  assert.equal(op6.worker,'Marko K.');
  assert.equal(op6.plannedHours,20);
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

// ── Pass 3.2B independent review fixes ──────────────────────────────────────────────────────────
// startJobcardOperation() is the ONE authoritative route into 'in-progress'; equipment assignment
// and usage can never be attributed to a Jobcard other than the equipment's real, current holder.
// Every test below builds its own isolated fixtures (fresh equipment via createEquipment, a fresh
// non-held Jobcard) instead of relying on demo seed data, so they are unaffected by seed changes.
function mkJobcard(WD,no){return WD.upsertJobcard({no,projectNo:'P-2026-014',title:'Review fixture',status:'draft',machines:[],operations:[]});}
function mkOp(WD,jcId,patch){return WD.addJobcardOperation(jcId,Object.assign({desc:'Test operation',worker:'Marko K.',machine:'',equipmentId:null,plannedHours:1,loggedHours:0,status:'pending',dependency:null,inspectionCheckpoint:false,notes:'',actualStart:null,actualCompletion:null},patch||{}));}

// (1) Blocked equipment cannot transition to in-progress through updateJobcardOperation().
test('review fix 1: updateJobcardOperation() unconditionally refuses "in-progress", even with no equipment requirement and no active hold', ()=>{
  const WD=loadWorkshopData();
  const jc=mkJobcard(WD,'JC-REVIEW-01');
  const op=mkOp(WD,jc.id,{});
  const res=WD.updateJobcardOperation(jc.id,op.id,{status:'in-progress'});
  assert.equal(res.code,'OPERATION_START_DEDICATED_METHOD_REQUIRED');
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'pending');
});
// (2) Edit-form-equivalent status mutation cannot bypass the gate — and the WHOLE mutation is
// rejected atomically, not just the status field.
test('review fix 2: an Edit-Operation-form-style full payload (desc/worker/hours/... plus status:"in-progress") cannot start an operation, and no field from it is applied', ()=>{
  const WD=loadWorkshopData();
  const jc=mkJobcard(WD,'JC-REVIEW-02');
  const op=mkOp(WD,jc.id,{});
  const res=WD.updateJobcardOperation(jc.id,op.id,{desc:'Edited desc',worker:'Elena N.',machine:'',equipmentId:null,status:'in-progress',plannedHours:5,loggedHours:0,plannedStart:null,dependency:null,inspectionCheckpoint:false,notes:'edited'});
  assert.equal(res.code,'OPERATION_START_DEDICATED_METHOD_REQUIRED');
  const stored=WD.findJobcard(jc.id).operations.find(o=>o.id===op.id);
  assert.equal(stored.status,'pending');
  assert.notEqual(stored.desc,'Edited desc','the whole mutation must be rejected, not just the status field');
});
// (3) A new operation cannot be created already in-progress to bypass the gate.
test('review fix 3: a new operation cannot be created already in-progress via addJobcardOperation()', ()=>{
  const WD=loadWorkshopData();
  const jc=mkJobcard(WD,'JC-REVIEW-03');
  const res=WD.addJobcardOperation(jc.id,{desc:'Sneaky op',status:'in-progress',worker:'Marko K.'});
  assert.equal(res.code,'OPERATION_START_DEDICATED_METHOD_REQUIRED');
  assert.equal(WD.findJobcard(jc.id).operations.length,0,'no operation may have been added');
});
// (4) A whole operations-array update cannot bypass the dedicated start method — true even with NO
// active hold at all (the old Quality-Hold-only gate would have allowed this).
test('review fix 4: updateJobcard({operations}) cannot start an operation even with no active hold at all', ()=>{
  const WD=loadWorkshopData();
  const jc=mkJobcard(WD,'JC-REVIEW-04');
  const op=mkOp(WD,jc.id,{});
  const ops=WD.findJobcard(jc.id).operations.map(o=>o.id===op.id?Object.assign({},o,{status:'in-progress'}):o);
  const res=WD.updateJobcard(jc.id,{operations:ops});
  assert.equal(res.code,'OPERATION_START_DEDICATED_METHOD_REQUIRED');
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'pending');
});
test('review fix 4b: upsertJobcard({operations}) on an existing jobcard cannot start an operation either, hold or no hold', ()=>{
  const WD=loadWorkshopData();
  const jc=mkJobcard(WD,'JC-REVIEW-04B');
  const op=mkOp(WD,jc.id,{});
  const ops=WD.findJobcard(jc.id).operations.map(o=>o.id===op.id?Object.assign({},o,{status:'in-progress'}):o);
  const res=WD.upsertJobcard({id:jc.id,no:jc.no,operations:ops});
  assert.equal(res.code,'OPERATION_START_DEDICATED_METHOD_REQUIRED');
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'pending');
});
// (5) Dedicated start rejects Out of Service equipment.
test('review fix 5: startJobcardOperation() rejects equipment that is Out of Service', ()=>{
  const WD=loadWorkshopData();
  const jc=mkJobcard(WD,'JC-REVIEW-05');
  WD.createEquipment({equipmentId:'E-REVIEW-05',name:'Test Drill',category:'Power Tool'});
  WD.assignEquipment('E-REVIEW-05',{project:'P-2026-014',jobcard:jc.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  WD.updateJobcard(jc.id,{machines:[{equipmentId:'E-REVIEW-05',name:'Test Drill',plannedUsage:1}]});
  const op=mkOp(WD,jc.id,{equipmentId:'E-REVIEW-05',machine:'Test Drill'});
  WD.changeEquipmentStatus('E-REVIEW-05','Out of Service');
  const res=WD.startJobcardOperation(jc.id,op.id,{});
  assert.equal(res.code,'EQUIPMENT_SAFETY_BLOCKED');
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'pending');
});
// (6) Dedicated start rejects an open breakdown.
test('review fix 6: startJobcardOperation() rejects equipment with an open (unresolved) breakdown', ()=>{
  const WD=loadWorkshopData();
  const jc=mkJobcard(WD,'JC-REVIEW-06');
  WD.createEquipment({equipmentId:'E-REVIEW-06',name:'Test Drill',category:'Power Tool'});
  WD.assignEquipment('E-REVIEW-06',{project:'P-2026-014',jobcard:jc.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  WD.updateJobcard(jc.id,{machines:[{equipmentId:'E-REVIEW-06',name:'Test Drill',plannedUsage:1}]});
  const op=mkOp(WD,jc.id,{equipmentId:'E-REVIEW-06',machine:'Test Drill'});
  WD.reportBreakdown('E-REVIEW-06',{reason:'Motor failure',responsiblePerson:'Marko K.'});
  const res=WD.startJobcardOperation(jc.id,op.id,{});
  assert.equal(res.code,'EQUIPMENT_SAFETY_BLOCKED');
});
// (7) Dedicated start rejects missing/unlinked equipment (op.equipmentId not present in this
// Jobcard's own machines list, even though the equipment record itself really exists).
test('review fix 7: startJobcardOperation() rejects an op.equipmentId that is not linked to THIS Jobcard\'s own machines', ()=>{
  const WD=loadWorkshopData();
  const jc=mkJobcard(WD,'JC-REVIEW-07');
  WD.createEquipment({equipmentId:'E-REVIEW-07',name:'Test Drill',category:'Power Tool'});
  WD.assignEquipment('E-REVIEW-07',{project:'P-2026-014',jobcard:jc.no,worker:'Marko K.'});
  // Deliberately never added to jc.machines.
  const op=mkOp(WD,jc.id,{equipmentId:'E-REVIEW-07',machine:'Test Drill'});
  const res=WD.startJobcardOperation(jc.id,op.id,{});
  assert.equal(res.code,'EQUIPMENT_NOT_LINKED');
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'pending');
});
// (8) Dedicated start rejects legacy name-only equipment until explicitly linked — a resolvable
// op.machine name is never sufficient authorization, even if the Jobcard has that exact machine name
// linked (with equipmentId) elsewhere in its own machines array.
test('review fix 8: startJobcardOperation() rejects a legacy op.machine NAME (no op.equipmentId) even when it matches a real, linked, correctly-assigned machine by name', ()=>{
  const WD=loadWorkshopData();
  const jc=mkJobcard(WD,'JC-REVIEW-08');
  WD.createEquipment({equipmentId:'E-REVIEW-08',name:'Test Drill',category:'Power Tool'});
  WD.assignEquipment('E-REVIEW-08',{project:'P-2026-014',jobcard:jc.no,worker:'Marko K.'});
  WD.updateJobcard(jc.id,{machines:[{equipmentId:'E-REVIEW-08',name:'Test Drill',plannedUsage:1}]});
  const op=mkOp(WD,jc.id,{equipmentId:null,machine:'Test Drill'});
  const res=WD.startJobcardOperation(jc.id,op.id,{});
  assert.equal(res.code,'EQUIPMENT_NOT_LINKED');
});
// (9) Dedicated start rejects equipment assigned to another Jobcard (the stale-link bypass).
test('review fix 9: startJobcardOperation() rejects equipment that is linked here but currently assigned to a DIFFERENT Jobcard', ()=>{
  const WD=loadWorkshopData();
  const jcA=mkJobcard(WD,'JC-REVIEW-09A');
  const jcB=mkJobcard(WD,'JC-REVIEW-09B');
  WD.createEquipment({equipmentId:'E-REVIEW-09',name:'Test Drill',category:'Power Tool'});
  // Equipment is really held by jcB...
  WD.assignEquipment('E-REVIEW-09',{project:'P-2026-014',jobcard:jcB.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  // ...but jcA retains a stale local link to it (e.g. left over from before it was returned/reassigned).
  WD.updateJobcard(jcA.id,{machines:[{equipmentId:'E-REVIEW-09',name:'Test Drill',plannedUsage:1}]});
  const op=mkOp(WD,jcA.id,{equipmentId:'E-REVIEW-09',machine:'Test Drill'});
  const res=WD.startJobcardOperation(jcA.id,op.id,{});
  assert.equal(res.code,'EQUIPMENT_ASSIGNED_ELSEWHERE');
  assert.equal(res.assignedJobcard,jcB.no);
  assert.equal(WD.findJobcard(jcA.id).operations.find(o=>o.id===op.id).status,'pending');
});
// (10) Dedicated start rejects unassigned equipment (linked here, real record, but not currently
// assigned to ANY Jobcard at all).
test('review fix 10: startJobcardOperation() rejects equipment that is linked here but not currently assigned to any Jobcard', ()=>{
  const WD=loadWorkshopData();
  const jc=mkJobcard(WD,'JC-REVIEW-10');
  WD.createEquipment({equipmentId:'E-REVIEW-10',name:'Test Drill',category:'Power Tool'});
  // Never assigned at all — assignedJobcard stays null.
  WD.updateJobcard(jc.id,{machines:[{equipmentId:'E-REVIEW-10',name:'Test Drill',plannedUsage:1}]});
  const op=mkOp(WD,jc.id,{equipmentId:'E-REVIEW-10',machine:'Test Drill'});
  const res=WD.startJobcardOperation(jc.id,op.id,{});
  assert.equal(res.code,'EQUIPMENT_UNASSIGNED');
});
// (11) + (12) Dedicated start succeeds for safe equipment properly assigned to the exact Jobcard —
// and the mandatory matching pre-use-check rule (from canUseEquipment) still applies: it fails
// without one, and succeeds once a valid passed check is recorded.
test('review fix 11+12: startJobcardOperation() requires a mandatory pre-use check, then succeeds for safe, correctly-assigned equipment', ()=>{
  const WD=loadWorkshopData();
  const jc=mkJobcard(WD,'JC-REVIEW-11');
  WD.createEquipment({equipmentId:'E-REVIEW-11',name:'Test Drill',category:'Power Tool'});
  setEqRequirements(WD,'E-REVIEW-11',{preUseCheckRequired:true});
  WD.assignEquipment('E-REVIEW-11',{project:'P-2026-014',jobcard:jc.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  WD.updateJobcard(jc.id,{machines:[{equipmentId:'E-REVIEW-11',name:'Test Drill',plannedUsage:1}]});
  const op=mkOp(WD,jc.id,{equipmentId:'E-REVIEW-11',machine:'Test Drill'});
  const blocked=WD.startJobcardOperation(jc.id,op.id,{date:EQ_ASOF});
  assert.equal(blocked.code,'EQUIPMENT_SAFETY_BLOCKED','no pre-use check recorded yet — must still be blocked');
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'pending');
  WD.recordEquipmentPreUseCheck('E-REVIEW-11',{checkedBy:'Marko K.',date:EQ_ASOF,result:'passed',checklist:'Guards in place, cable checked',projectNo:'P-2026-014',jobcardNo:jc.no});
  const started=WD.startJobcardOperation(jc.id,op.id,{date:EQ_ASOF});
  assert.ok(!started.error);
  assert.equal(started.status,'in-progress');
  assert.ok(started.actualStart);
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'in-progress');
});
// (13) + (14) assignEquipment cannot overwrite another Jobcard's assignment, and the rejected
// attempt leaves the ENTIRE equipment record unchanged.
test('review fix 13+14: assignEquipment cannot reassign equipment already held by a different Jobcard, and leaves the record completely unchanged', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-REVIEW-13',name:'Test Drill',category:'Power Tool'});
  const jcA=mkJobcard(WD,'JC-REVIEW-13A');
  const jcB=mkJobcard(WD,'JC-REVIEW-13B');
  WD.assignEquipment('E-REVIEW-13',{project:'P-2026-014',jobcard:jcA.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  const before=WD.get().equipment.find(e=>e.equipmentId==='E-REVIEW-13');
  const res=WD.assignEquipment('E-REVIEW-13',{project:'P-2026-014',jobcard:jcB.no,worker:'Elena N.',assignedBy:'Aleksandar C.'});
  assert.equal(res.code,'EQUIPMENT_ASSIGNMENT_CONFLICT');
  assert.equal(res.assignedJobcard,jcA.no);
  const after=WD.get().equipment.find(e=>e.equipmentId==='E-REVIEW-13');
  assert.deepEqual(after,before,'not even worker/project may have changed on a rejected reassignment');
});
test('review fix: assignEquipment stays idempotent when re-assigning to the SAME Jobcard it already holds', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-REVIEW-13C',name:'Test Drill',category:'Power Tool'});
  const jc=mkJobcard(WD,'JC-REVIEW-13C');
  WD.assignEquipment('E-REVIEW-13C',{project:'P-2026-014',jobcard:jc.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  const res=WD.assignEquipment('E-REVIEW-13C',{project:'P-2026-014',jobcard:jc.no,worker:'Elena N.',assignedBy:'Aleksandar C.'});
  assert.ok(!res.error,'re-assigning to the same Jobcard must remain allowed');
  assert.equal(res.operator,'Elena N.');
});
// (15) + (16) logEquipmentUsage rejects a different assignedJobcard, and the rejection leaves the
// meter and usage history completely unchanged.
test('review fix 15+16: logEquipmentUsage rejects usage.jobcard that does not match the equipment\'s real assignedJobcard, leaving meter and history unchanged', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-REVIEW-15',name:'Test Drill',category:'Power Tool'});
  const jcA=mkJobcard(WD,'JC-REVIEW-15A');
  const jcB=mkJobcard(WD,'JC-REVIEW-15B');
  WD.assignEquipment('E-REVIEW-15',{project:'P-2026-014',jobcard:jcA.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  WD.recordEquipmentPreUseCheck('E-REVIEW-15',{checkedBy:'Marko K.',date:EQ_ASOF,result:'passed',checklist:'OK'});
  const before=WD.get().equipment.find(e=>e.equipmentId==='E-REVIEW-15');
  const res=WD.logEquipmentUsage('E-REVIEW-15',{hours:2,date:EQ_ASOF,worker:'Elena N.',project:'P-2026-014',jobcard:jcB.no});
  assert.equal(res.code,'EQUIPMENT_ASSIGNMENT_CONFLICT');
  assert.equal(res.assignedJobcard,jcA.no);
  const after=WD.get().equipment.find(e=>e.equipmentId==='E-REVIEW-15');
  assert.deepEqual(after,before,'meter, usageHistory and every other field must be completely unchanged');
});
// (18) Valid same-Jobcard usage still updates both the equipment record and (via the normal
// logHours() call the UI makes alongside it) labour hours — the corrected assignedJobcard check
// never interferes with the legitimate, matching-Jobcard workflow.
test('review fix 18: valid same-Jobcard usage still updates the equipment record normally', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-REVIEW-18',name:'Test Drill',category:'Power Tool'});
  const jc=mkJobcard(WD,'JC-REVIEW-18');
  WD.assignEquipment('E-REVIEW-18',{project:'P-2026-014',jobcard:jc.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  WD.recordEquipmentPreUseCheck('E-REVIEW-18',{checkedBy:'Marko K.',date:EQ_ASOF,result:'passed',checklist:'OK'});
  const before=WD.get().equipment.find(e=>e.equipmentId==='E-REVIEW-18').operatingHourMeter;
  const res=WD.logEquipmentUsage('E-REVIEW-18',{hours:3,date:EQ_ASOF,worker:'Marko K.',project:'P-2026-014',jobcard:jc.no});
  assert.ok(!res.error);
  assert.equal(res.operatingHourMeter,before+3);
  assert.ok(res.usageHistory.some(u=>u.jobcard===jc.no));
});
// logEquipmentUsage with NO jobcard supplied at all is unaffected by the new check (matches existing
// behaviour/tests that never pass a jobcard field).
test('review fix: logEquipmentUsage with no usage.jobcard at all is unaffected by the assignment check', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-REVIEW-15C',name:'Test Drill',category:'Power Tool'});
  WD.assignEquipment('E-REVIEW-15C',{project:'P-2026-014',jobcard:'JC-REVIEW-15C',worker:'Marko K.'});
  WD.recordEquipmentPreUseCheck('E-REVIEW-15C',{checkedBy:'Marko K.',date:EQ_ASOF,result:'passed',checklist:'OK'});
  const res=WD.logEquipmentUsage('E-REVIEW-15C',{hours:1,date:EQ_ASOF,worker:'Marko K.'});
  assert.ok(!res.error);
});

// ── Pass 3.2B SECOND independent review fixes ──────────────────────────────────────────────────
// Finding 1: reserveEquipment() was a second, unguarded route into assignedJobcard — it now enforces
// exactly the same conflict rule as assignEquipment()/logEquipmentUsage(). recordEquipmentPreUseCheck()
// is now hardened the same way whenever Jobcard context is supplied.
// (1)+(2) reserveEquipment cannot move equipment from JC-A to JC-B, and the rejected record is
// completely unchanged.
test('2nd review fix 1+2: reserveEquipment cannot reassign equipment already held by a different Jobcard, and leaves the record completely unchanged', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-REVIEW2-01',name:'Test Drill',category:'Power Tool'});
  const jcA=mkJobcard(WD,'JC-REVIEW2-01A');
  const jcB=mkJobcard(WD,'JC-REVIEW2-01B');
  WD.assignEquipment('E-REVIEW2-01',{project:'P-2026-014',jobcard:jcA.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  const before=WD.get().equipment.find(e=>e.equipmentId==='E-REVIEW2-01');
  const res=WD.reserveEquipment('E-REVIEW2-01',{project:'P-2026-014',jobcard:jcB.no,reservedBy:'Elena N.'});
  assert.equal(res.code,'EQUIPMENT_ASSIGNMENT_CONFLICT');
  assert.equal(res.assignedJobcard,jcA.no);
  const after=WD.get().equipment.find(e=>e.equipmentId==='E-REVIEW2-01');
  assert.deepEqual(after,before,'not even status/project may have changed on a rejected reservation');
});
// (3) reserveEquipment remains idempotent for the same Jobcard.
test('2nd review fix 3: reserveEquipment stays idempotent when reserving for the SAME Jobcard it already holds', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-REVIEW2-03',name:'Test Drill',category:'Power Tool'});
  const jc=mkJobcard(WD,'JC-REVIEW2-03');
  WD.assignEquipment('E-REVIEW2-03',{project:'P-2026-014',jobcard:jc.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  const res=WD.reserveEquipment('E-REVIEW2-03',{project:'P-2026-014',jobcard:jc.no,reservedBy:'Elena N.'});
  assert.ok(!res.error,'reserving for the same Jobcard must remain allowed');
  assert.equal(res.status,'Reserved');
});
// (4) reserveEquipment with an omitted jobcard cannot alter equipment already held by a Jobcard.
test('2nd review fix 4: reserveEquipment with NO jobcard supplied cannot silently touch equipment already held by a Jobcard', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-REVIEW2-04',name:'Test Drill',category:'Power Tool'});
  const jc=mkJobcard(WD,'JC-REVIEW2-04');
  WD.assignEquipment('E-REVIEW2-04',{project:'P-2026-014',jobcard:jc.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  const before=WD.get().equipment.find(e=>e.equipmentId==='E-REVIEW2-04');
  const res=WD.reserveEquipment('E-REVIEW2-04',{project:'P-2026-014',reservedBy:'Elena N.'});
  assert.equal(res.code,'EQUIPMENT_ASSIGNMENT_CONFLICT');
  const after=WD.get().equipment.find(e=>e.equipmentId==='E-REVIEW2-04');
  assert.deepEqual(after,before);
});
// reserveEquipment on genuinely unassigned equipment (nobody holds it) still works normally.
test('2nd review fix: reserveEquipment still works normally on equipment nobody currently holds', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-REVIEW2-04B',name:'Test Drill',category:'Power Tool'});
  const jc=mkJobcard(WD,'JC-REVIEW2-04B');
  const res=WD.reserveEquipment('E-REVIEW2-04B',{project:'P-2026-014',jobcard:jc.no,reservedBy:'Elena N.'});
  assert.ok(!res.error);
  assert.equal(res.assignedJobcard,jc.no);
});
// (5)+(6) recordEquipmentPreUseCheck rejects a mismatched jobcardNo, creating no history/status/
// activity changes at all.
test('2nd review fix 5+6: recordEquipmentPreUseCheck rejects a jobcardNo that does not match the equipment\'s real holder, with no history/status/activity change', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-REVIEW2-05',name:'Test Drill',category:'Power Tool'});
  const jc=mkJobcard(WD,'JC-REVIEW2-05A');
  WD.assignEquipment('E-REVIEW2-05',{project:'P-2026-014',jobcard:jc.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  const before=WD.get().equipment.find(e=>e.equipmentId==='E-REVIEW2-05');
  const res=WD.recordEquipmentPreUseCheck('E-REVIEW2-05',{checkedBy:'Elena N.',date:EQ_ASOF,result:'passed',checklist:'Looks fine',projectNo:'P-2026-014',jobcardNo:'JC-REVIEW2-05B'});
  assert.equal(res.code,'EQUIPMENT_ASSIGNMENT_CONFLICT');
  assert.equal(res.assignedJobcard,jc.no);
  const after=WD.get().equipment.find(e=>e.equipmentId==='E-REVIEW2-05');
  assert.deepEqual(after,before,'no preUseChecks/status/activity entry may have been created');
});
// (7) Correctly assigned same-Jobcard pre-use check still succeeds.
test('2nd review fix 7: recordEquipmentPreUseCheck with a jobcardNo matching the real holder still succeeds', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-REVIEW2-07',name:'Test Drill',category:'Power Tool'});
  const jc=mkJobcard(WD,'JC-REVIEW2-07');
  WD.assignEquipment('E-REVIEW2-07',{project:'P-2026-014',jobcard:jc.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  const res=WD.recordEquipmentPreUseCheck('E-REVIEW2-07',{checkedBy:'Marko K.',date:EQ_ASOF,result:'passed',checklist:'Looks fine',projectNo:'P-2026-014',jobcardNo:jc.no});
  assert.ok(!res.error);
  assert.equal(res.jobcardNo,jc.no);
  assert.equal(res.result,'passed');
});
// A pre-use check submitted with NO Jobcard context at all is unaffected (plain Equipment-module
// workflow, matches existing behaviour/tests that never pass jobcardNo).
test('2nd review fix: recordEquipmentPreUseCheck with no jobcardNo at all is unaffected by the assignment check', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-REVIEW2-07B',name:'Test Drill',category:'Power Tool'});
  WD.assignEquipment('E-REVIEW2-07B',{project:'P-2026-014',jobcard:'JC-REVIEW2-07B-OTHER',worker:'Marko K.'});
  const res=WD.recordEquipmentPreUseCheck('E-REVIEW2-07B',{checkedBy:'Marko K.',date:EQ_ASOF,result:'passed',checklist:'Looks fine'});
  assert.ok(!res.error);
});
// reportBreakdown remains available as a safe-direction action even when a DIFFERENT Jobcard holds
// the equipment — it must NOT be subject to the new assignment-conflict check.
test('2nd review fix: reportBreakdown remains a safe-direction action regardless of which Jobcard currently holds the equipment', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-REVIEW2-BD',name:'Test Drill',category:'Power Tool'});
  WD.assignEquipment('E-REVIEW2-BD',{project:'P-2026-014',jobcard:'JC-REVIEW2-BD-A',worker:'Marko K.'});
  const res=WD.reportBreakdown('E-REVIEW2-BD',{reason:'Smoking motor',responsiblePerson:'Elena N.',projectNo:'P-2026-014',jobcardNo:'JC-REVIEW2-BD-B'});
  assert.ok(!res.error,'reporting a breakdown must never be blocked by the assignment-conflict check');
  assert.equal(res.jobcardNo,'JC-REVIEW2-BD-B');
  const item=WD.get().equipment.find(e=>e.equipmentId==='E-REVIEW2-BD');
  assert.equal(item.status,'Out of Service');
});

// Finding 2: equipmentId/machine are safety-controlled on an in-progress operation — a same-status
// re-save (previously "allowed" for ordinary field edits) must never be usable to swap equipment
// out from under a running operation.
function mkStartedOpFixture(WD,jcNo,eqId){
  const jc=mkJobcard(WD,jcNo);
  WD.createEquipment({equipmentId:eqId,name:'Test Drill',category:'Power Tool'});
  const assigned=WD.assignEquipment(eqId,{project:'P-2026-014',jobcard:jc.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  assert.ok(!assigned.error,`fixture setup: assignEquipment must succeed — ${assigned.error}`);
  WD.updateJobcard(jc.id,{machines:[{equipmentId:eqId,name:'Test Drill',plannedUsage:1}]});
  const op=mkOp(WD,jc.id,{equipmentId:eqId,machine:'Test Drill'});
  WD.recordEquipmentPreUseCheck(eqId,{checkedBy:'Marko K.',date:EQ_ASOF,result:'passed',checklist:'OK',projectNo:'P-2026-014',jobcardNo:jc.no});
  const started=WD.startJobcardOperation(jc.id,op.id,{date:EQ_ASOF});
  assert.equal(started.status,'in-progress','fixture setup must succeed');
  return {jc:WD.findJobcard(jc.id),op:started};
}
// (8) In-progress operation cannot change equipmentId through updateJobcardOperation().
test('2nd review fix 8: an in-progress operation cannot have its equipmentId changed through updateJobcardOperation()', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW2-08','E-REVIEW2-08-SAFE');
  WD.createEquipment({equipmentId:'E-REVIEW2-08-OTHER',name:'Other Drill',category:'Power Tool'});
  const res=WD.updateJobcardOperation(jc.id,op.id,{status:'in-progress',equipmentId:'E-REVIEW2-08-OTHER',machine:'Other Drill'});
  assert.equal(res.code,'OPERATION_EQUIPMENT_CHANGE_REQUIRES_PAUSE');
  const stored=WD.findJobcard(jc.id).operations.find(o=>o.id===op.id);
  assert.equal(stored.equipmentId,'E-REVIEW2-08-SAFE','equipment reference must be unchanged');
  assert.equal(stored.status,'in-progress');
});
// (9) In-progress operation cannot remove equipmentId.
test('2nd review fix 9: an in-progress operation cannot have its equipmentId removed (set to null) through updateJobcardOperation()', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW2-09','E-REVIEW2-09');
  const res=WD.updateJobcardOperation(jc.id,op.id,{status:'in-progress',equipmentId:null,machine:''});
  assert.equal(res.code,'OPERATION_EQUIPMENT_CHANGE_REQUIRES_PAUSE');
  const stored=WD.findJobcard(jc.id).operations.find(o=>o.id===op.id);
  assert.equal(stored.equipmentId,'E-REVIEW2-09');
});
// (10) In-progress operation cannot ADD equipment when it started without equipment at all.
test('2nd review fix 10: an in-progress operation that started with NO equipment cannot have equipment added through updateJobcardOperation()', ()=>{
  const WD=loadWorkshopData();
  const jc=mkJobcard(WD,'JC-REVIEW2-10');
  const op=mkOp(WD,jc.id,{equipmentId:null,machine:''});
  const started=WD.startJobcardOperation(jc.id,op.id,{date:EQ_ASOF});
  assert.equal(started.status,'in-progress');
  WD.createEquipment({equipmentId:'E-REVIEW2-10',name:'Test Drill',category:'Power Tool'});
  const res=WD.updateJobcardOperation(jc.id,op.id,{status:'in-progress',equipmentId:'E-REVIEW2-10',machine:'Test Drill'});
  assert.equal(res.code,'OPERATION_EQUIPMENT_CHANGE_REQUIRES_PAUSE');
  const stored=WD.findJobcard(jc.id).operations.find(o=>o.id===op.id);
  assert.equal(stored.equipmentId,null);
});
// (11) A rejected mixed edit (equipment change bundled with ordinary field edits) applies NONE of it
// — the whole mutation is rejected atomically.
test('2nd review fix 11: a rejected equipment-change patch applies none of its bundled ordinary field edits either', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW2-11','E-REVIEW2-11-SAFE');
  WD.createEquipment({equipmentId:'E-REVIEW2-11-OTHER',name:'Other Drill',category:'Power Tool'});
  const res=WD.updateJobcardOperation(jc.id,op.id,{desc:'Sneaky edit',worker:'Someone Else',equipmentId:'E-REVIEW2-11-OTHER'});
  assert.equal(res.code,'OPERATION_EQUIPMENT_CHANGE_REQUIRES_PAUSE');
  const stored=WD.findJobcard(jc.id).operations.find(o=>o.id===op.id);
  assert.notEqual(stored.desc,'Sneaky edit','no unrelated field may have been applied either');
  assert.notEqual(stored.worker,'Someone Else');
});
// (12) updateJobcard({operations}) cannot swap equipment on an in-progress operation.
test('2nd review fix 12: updateJobcard({operations}) cannot swap equipment on an in-progress operation', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW2-12','E-REVIEW2-12-SAFE');
  WD.createEquipment({equipmentId:'E-REVIEW2-12-OTHER',name:'Other Drill',category:'Power Tool'});
  const ops=WD.findJobcard(jc.id).operations.map(o=>o.id===op.id?Object.assign({},o,{equipmentId:'E-REVIEW2-12-OTHER',machine:'Other Drill'}):o);
  const res=WD.updateJobcard(jc.id,{operations:ops});
  assert.equal(res.code,'OPERATION_EQUIPMENT_CHANGE_REQUIRES_PAUSE');
  const stored=WD.findJobcard(jc.id).operations.find(o=>o.id===op.id);
  assert.equal(stored.equipmentId,'E-REVIEW2-12-SAFE');
});
// (13) upsertJobcard({operations}) cannot perform the same swap.
test('2nd review fix 13: upsertJobcard({operations}) cannot swap equipment on an in-progress operation either', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW2-13','E-REVIEW2-13-SAFE');
  WD.createEquipment({equipmentId:'E-REVIEW2-13-OTHER',name:'Other Drill',category:'Power Tool'});
  const ops=WD.findJobcard(jc.id).operations.map(o=>o.id===op.id?Object.assign({},o,{equipmentId:'E-REVIEW2-13-OTHER',machine:'Other Drill'}):o);
  const res=WD.upsertJobcard({id:jc.id,no:jc.no,operations:ops});
  assert.equal(res.code,'OPERATION_EQUIPMENT_CHANGE_REQUIRES_PAUSE');
  const stored=WD.findJobcard(jc.id).operations.find(o=>o.id===op.id);
  assert.equal(stored.equipmentId,'E-REVIEW2-13-SAFE');
});
// (14)+(15) A paused operation MAY change equipment, and resuming afterwards re-checks assignment
// and the Equipment Safety Gate — unsafe or assigned-elsewhere equipment linked while paused still
// blocks the resume.
test('2nd review fix 14+15: a paused operation may change equipment, and resuming re-checks assignment/safety against the NEW equipment', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW2-14','E-REVIEW2-14-SAFE');
  const paused=WD.updateJobcardOperation(jc.id,op.id,{status:'paused'});
  assert.ok(!paused.error);
  // While paused, link it to equipment that is NOT actually assigned to this Jobcard (unsafe swap).
  // Linking it into jc.machines (Machines & Equipment tab) is a normal, always-allowed edit — the
  // stale/wrong assignment is only caught at resume time by startJobcardOperation().
  WD.createEquipment({equipmentId:'E-REVIEW2-14-OTHER',name:'Other Drill',category:'Power Tool'});
  const jcElsewhere=mkJobcard(WD,'JC-REVIEW2-14-ELSEWHERE');
  WD.assignEquipment('E-REVIEW2-14-OTHER',{project:'P-2026-014',jobcard:jcElsewhere.no,worker:'Someone',assignedBy:'Aleksandar C.'});
  WD.updateJobcard(jc.id,{machines:(WD.findJobcard(jc.id).machines||[]).concat([{equipmentId:'E-REVIEW2-14-OTHER',name:'Other Drill',plannedUsage:1}])});
  const swapped=WD.updateJobcardOperation(jc.id,op.id,{equipmentId:'E-REVIEW2-14-OTHER',machine:'Other Drill'});
  assert.ok(!swapped.error,'changing equipment while paused must be allowed');
  assert.equal(swapped.equipmentId,'E-REVIEW2-14-OTHER');
  const resumeBlocked=WD.startJobcardOperation(jc.id,op.id,{date:EQ_ASOF});
  assert.equal(resumeBlocked.code,'EQUIPMENT_ASSIGNED_ELSEWHERE','resume must re-check the NEW equipment is actually assigned to this Jobcard');
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'paused','a blocked resume must not change status');
  // Now properly return+re-assign the new equipment to THIS Jobcard (it's already linked in
  // jc.machines) and give it a matching pre-use check — resume must then succeed against it.
  WD.returnEquipment('E-REVIEW2-14-OTHER',{});
  WD.assignEquipment('E-REVIEW2-14-OTHER',{project:'P-2026-014',jobcard:jc.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  WD.recordEquipmentPreUseCheck('E-REVIEW2-14-OTHER',{checkedBy:'Marko K.',date:EQ_ASOF,result:'passed',checklist:'OK',projectNo:'P-2026-014',jobcardNo:jc.no});
  const resumed=WD.startJobcardOperation(jc.id,op.id,{date:EQ_ASOF});
  assert.ok(!resumed.error);
  assert.equal(resumed.status,'in-progress');
});
// (16) Ordinary non-equipment edits to an in-progress operation still work (the pre-existing "allowed"
// same-status re-save path — must not be broken by the new equipment-field guard).
test('2nd review fix 16: ordinary non-equipment field edits to an in-progress operation still work normally', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW2-16','E-REVIEW2-16');
  const res=WD.updateJobcardOperation(jc.id,op.id,{status:'in-progress',desc:'Updated description',notes:'Progress note',loggedHours:2});
  assert.ok(!res.error);
  assert.equal(res.desc,'Updated description');
  assert.equal(res.equipmentId,'E-REVIEW2-16','equipment reference must be untouched by an ordinary edit');
});

// ── Pass 3.2B THIRD independent review fixes ───────────────────────────────────────────────────
// Finding A: an in-progress operation cannot be silently deleted by omitting it from a whole
// operations-array replace. Finding B: equipment an in-progress operation depends on cannot be
// silently unlinked by omitting it from a whole machines-array replace. Central reconciliation:
// any equipment mutation that leaves it unassigned/hard-blocked/gate-blocked automatically pauses
// every in-progress operation using it (never resumes/starts anything).

// (1) updateJobcard({operations}) cannot delete an in-progress operation.
test('3rd review fix 1: updateJobcard({operations}) cannot delete an in-progress operation by omitting it', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW3-01','E-REVIEW3-01');
  const filtered=WD.findJobcard(jc.id).operations.filter(o=>o.id!==op.id);
  const res=WD.updateJobcard(jc.id,{operations:filtered});
  assert.equal(res.code,'OPERATION_ACTIVE_DELETE_REQUIRES_PAUSE');
  const stored=WD.findJobcard(jc.id);
  assert.equal(stored.operations.length,1,'the in-progress operation must still be present');
  assert.equal(stored.operations[0].id,op.id);
});
// (2) upsertJobcard({operations}) cannot delete an in-progress operation.
test('3rd review fix 2: upsertJobcard({operations}) cannot delete an in-progress operation by omitting it', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW3-02','E-REVIEW3-02');
  const filtered=WD.findJobcard(jc.id).operations.filter(o=>o.id!==op.id);
  const res=WD.upsertJobcard({id:jc.id,no:jc.no,operations:filtered});
  assert.equal(res.code,'OPERATION_ACTIVE_DELETE_REQUIRES_PAUSE');
  assert.equal(WD.findJobcard(jc.id).operations.length,1);
});
// (3) A rejected deletion leaves the complete Jobcard and operation unchanged.
test('3rd review fix 3: a rejected active-operation deletion leaves the complete Jobcard record unchanged, including unrelated bundled fields', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW3-03','E-REVIEW3-03');
  const before=WD.findJobcard(jc.id);
  const filtered=before.operations.filter(o=>o.id!==op.id);
  const res=WD.updateJobcard(jc.id,{operations:filtered,title:'Sneaky title change'});
  assert.equal(res.code,'OPERATION_ACTIVE_DELETE_REQUIRES_PAUSE');
  const after=WD.findJobcard(jc.id);
  assert.deepEqual(after,before,'nothing may have changed, including the unrelated title field bundled into the same patch');
});
// (4) A paused operation can still be deleted.
test('3rd review fix 4: a PAUSED operation can still be deleted through a whole operations-array replace', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW3-04','E-REVIEW3-04');
  WD.updateJobcardOperation(jc.id,op.id,{status:'paused'});
  const filtered=WD.findJobcard(jc.id).operations.filter(o=>o.id!==op.id);
  const res=WD.updateJobcard(jc.id,{operations:filtered});
  assert.ok(!res.error);
  assert.equal(WD.findJobcard(jc.id).operations.length,0);
});
// (5) updateJobcard({machines}) cannot remove equipment used by an in-progress operation.
test('3rd review fix 5: updateJobcard({machines}) cannot unlink equipment used by an in-progress operation', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW3-05','E-REVIEW3-05');
  const res=WD.updateJobcard(jc.id,{machines:[]});
  assert.equal(res.code,'ACTIVE_OPERATION_EQUIPMENT_UNLINK_REQUIRES_PAUSE');
  const stored=WD.findJobcard(jc.id);
  assert.equal(stored.machines.length,1,'the machine link must still be present');
  assert.equal(stored.operations.find(o=>o.id===op.id).equipmentId,'E-REVIEW3-05');
});
// (6) upsertJobcard({machines}) cannot perform the same unlink.
test('3rd review fix 6: upsertJobcard({machines}) cannot unlink equipment used by an in-progress operation either', ()=>{
  const WD=loadWorkshopData();
  const {jc}=mkStartedOpFixture(WD,'JC-REVIEW3-06','E-REVIEW3-06');
  const res=WD.upsertJobcard({id:jc.id,no:jc.no,machines:[]});
  assert.equal(res.code,'ACTIVE_OPERATION_EQUIPMENT_UNLINK_REQUIRES_PAUSE');
  assert.equal(WD.findJobcard(jc.id).machines.length,1);
});
// (7) A rejected unlink leaves the complete Jobcard unchanged.
test('3rd review fix 7: a rejected equipment unlink leaves the complete Jobcard record unchanged, including unrelated bundled fields', ()=>{
  const WD=loadWorkshopData();
  const {jc}=mkStartedOpFixture(WD,'JC-REVIEW3-07','E-REVIEW3-07');
  const before=WD.findJobcard(jc.id);
  const res=WD.updateJobcard(jc.id,{machines:[],title:'Sneaky title change'});
  assert.equal(res.code,'ACTIVE_OPERATION_EQUIPMENT_UNLINK_REQUIRES_PAUSE');
  const after=WD.findJobcard(jc.id);
  assert.deepEqual(after,before);
});
// (8) Removing equipment unused by an active operation still works.
test('3rd review fix 8: removing equipment NOT used by any in-progress operation still works normally', ()=>{
  const WD=loadWorkshopData();
  const {jc}=mkStartedOpFixture(WD,'JC-REVIEW3-08','E-REVIEW3-08-USED');
  WD.createEquipment({equipmentId:'E-REVIEW3-08-UNUSED',name:'Spare Drill',category:'Power Tool'});
  WD.updateJobcard(jc.id,{machines:WD.findJobcard(jc.id).machines.concat([{equipmentId:'E-REVIEW3-08-UNUSED',name:'Spare Drill',plannedUsage:0}])});
  const res=WD.updateJobcard(jc.id,{machines:WD.findJobcard(jc.id).machines.filter(m=>m.equipmentId!=='E-REVIEW3-08-UNUSED')});
  assert.ok(!res.error);
  assert.equal(res.machines.length,1);
  assert.equal(res.machines[0].equipmentId,'E-REVIEW3-08-USED');
});
// (9) Reordering machines or changing only planned usage still works.
test('3rd review fix 9: reordering the machines array or editing only plannedUsage still works while an operation is in-progress', ()=>{
  const WD=loadWorkshopData();
  const {jc}=mkStartedOpFixture(WD,'JC-REVIEW3-09','E-REVIEW3-09');
  WD.createEquipment({equipmentId:'E-REVIEW3-09-B',name:'Second Drill',category:'Power Tool'});
  const withSecond=WD.findJobcard(jc.id).machines.concat([{equipmentId:'E-REVIEW3-09-B',name:'Second Drill',plannedUsage:2}]);
  WD.updateJobcard(jc.id,{machines:withSecond});
  const reordered=WD.findJobcard(jc.id).machines.slice().reverse();
  const res=WD.updateJobcard(jc.id,{machines:reordered});
  assert.ok(!res.error,'reordering must not be treated as an unlink');
  const editedUsage=WD.findJobcard(jc.id).machines.map(m=>m.equipmentId==='E-REVIEW3-09'?Object.assign({},m,{plannedUsage:99}):m);
  const res2=WD.updateJobcard(jc.id,{machines:editedUsage});
  assert.ok(!res2.error,'editing plannedUsage on the SAME equipmentId must not be treated as an unlink');
  assert.equal(res2.machines.find(m=>m.equipmentId==='E-REVIEW3-09').plannedUsage,99);
});
// (10)+(11) returnEquipment() automatically pauses an active operation, and returning SAFE equipment
// still clears assignment and becomes Available.
test('3rd review fix 10+11: returnEquipment() automatically pauses the active operation, and safe equipment still becomes Available', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW3-10','E-REVIEW3-10');
  const res=WD.returnEquipment('E-REVIEW3-10',{user:'Marko K.'});
  assert.ok(!res.error);
  assert.equal(res.status,'Available');
  assert.equal(res.assignedJobcard,null);
  assert.ok(Array.isArray(res.pausedOperations)&&res.pausedOperations.length===1);
  assert.equal(res.pausedOperations[0].operationId,op.id);
  assert.equal(res.pausedOperations[0].jobcardNo,jc.no);
  const stored=WD.findJobcard(jc.id).operations.find(o=>o.id===op.id);
  assert.equal(stored.status,'paused');
});
// (12) Returning BLOCKED equipment still clears assignment but preserves its blocking status, and
// still auto-pauses the active operation.
test('3rd review fix 12: returning BLOCKED equipment clears assignment but preserves the blocking status — the operation, already auto-paused the moment it became blocked, stays paused', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW3-12','E-REVIEW3-12');
  // Quarantining already auto-pauses the running operation immediately (see fix 17) — by the time
  // returnEquipment() is called, there is nothing left in-progress on this equipment to newly pause;
  // that is itself the correct, intended behaviour (an operation can never remain in-progress on
  // blocked equipment for even one intervening mutation).
  const blockRes=WD.changeEquipmentStatus('E-REVIEW3-12','Quarantined');
  assert.equal(blockRes.pausedOperations.length,1,'quarantining itself must already auto-pause the running operation');
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'paused');
  const res=WD.returnEquipment('E-REVIEW3-12',{user:'Marko K.'});
  assert.equal(res.status,'Quarantined','a blocked status must never be silently cleared by returnEquipment');
  assert.equal(res.assignedJobcard,null);
  assert.equal(res.pausedOperations.length,0,'nothing new to pause — it was already paused when it became blocked');
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'paused','still paused, never reset');
});
// (13) reportBreakdown() automatically pauses the active operation and preserves project/Jobcard
// references on the breakdown record.
test('3rd review fix 13: reportBreakdown() automatically pauses the active operation and preserves project/Jobcard references', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW3-13','E-REVIEW3-13');
  const res=WD.reportBreakdown('E-REVIEW3-13',{reason:'Motor smoking',responsiblePerson:'Elena N.'});
  assert.equal(res.projectNo,'P-2026-014');
  assert.equal(res.jobcardNo,jc.no);
  assert.equal(res.pausedOperations.length,1);
  assert.equal(res.pausedOperations[0].operationId,op.id);
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'paused');
  const item=WD.get().equipment.find(e=>e.equipmentId==='E-REVIEW3-13');
  assert.equal(item.status,'Out of Service');
});
// (14) A failed pre-use check automatically pauses an active operation.
test('3rd review fix 14: a failed recordEquipmentPreUseCheck automatically pauses the active operation', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW3-14','E-REVIEW3-14');
  const res=WD.recordEquipmentPreUseCheck('E-REVIEW3-14',{checkedBy:'Marko K.',date:EQ_ASOF,result:'failed',notes:'Guard cracked',projectNo:'P-2026-014',jobcardNo:jc.no});
  assert.ok(!res.error);
  assert.equal(res.pausedOperations.length,1);
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'paused');
});
// (15) A failed equipment inspection automatically pauses an active operation.
test('3rd review fix 15: a failed addInspection automatically pauses the active operation', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW3-15','E-REVIEW3-15');
  const res=WD.addInspection('E-REVIEW3-15',{inspector:'Aleksandar C.',result:'failed',critical:true,findings:'Cracked frame',date:EQ_ASOF});
  assert.ok(!res.error);
  assert.equal(res.pausedOperations.length,1);
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'paused');
  const item=WD.get().equipment.find(e=>e.equipmentId==='E-REVIEW3-15');
  assert.equal(item.status,'Quarantined');
});
// (16) Retiring equipment automatically pauses an active operation.
test('3rd review fix 16: retireEquipment automatically pauses the active operation', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW3-16','E-REVIEW3-16');
  const res=WD.retireEquipment('E-REVIEW3-16','End of service life');
  assert.ok(!res.error);
  assert.equal(res.pausedOperations.length,1);
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'paused');
});
// (17) Changing equipment to Quarantined/Out of Service automatically pauses an active operation.
test('3rd review fix 17: changeEquipmentStatus to a hard-block status automatically pauses the active operation', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW3-17','E-REVIEW3-17');
  const res=WD.changeEquipmentStatus('E-REVIEW3-17','Quarantined');
  assert.equal(res.pausedOperations.length,1);
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'paused');
});
// updateEquipment moving to a non-operational status also reconciles.
test('3rd review fix: updateEquipment moving to a non-operational status also auto-pauses the active operation', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW3-17B','E-REVIEW3-17B');
  const res=WD.updateEquipment('E-REVIEW3-17B',{status:'Under Maintenance'});
  assert.ok(!res.error);
  assert.equal(res.pausedOperations.length,1);
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'paused');
});
// updateEquipmentRequirements that newly blocks the gate (via a stale existing date, no status
// change at all) also reconciles.
test('3rd review fix: updateEquipmentRequirements that newly blocks the live gate also auto-pauses the active operation', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW3-17C','E-REVIEW3-17C');
  const statusBefore=WD.get().equipment.find(e=>e.equipmentId==='E-REVIEW3-17C').status;
  const res=WD.updateEquipmentRequirements('E-REVIEW3-17C',{maintenanceRequired:true},{updatedBy:'Aleksandar C.',reason:'Policy change',approvalReference:'APPR-3-17C'});
  assert.ok(!res.error);
  // No maintenance record exists at all, so a mandatory requirement with no maintenanceDate on file
  // blocks the gate immediately (see equipment-gates.js) — purely from the requirement flip.
  assert.equal(res.status,statusBefore,'sanity: this scenario blocks purely via the requirement flip, with no status field change at all');
  assert.equal(res.pausedOperations.length,1);
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'paused');
});
// (18) Ordinary descriptive equipment edits do not pause operations.
test('3rd review fix 18: ordinary descriptive equipment edits (name/location/description) do not pause the active operation', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW3-18','E-REVIEW3-18');
  const res=WD.updateEquipment('E-REVIEW3-18',{name:'Renamed Drill',currentLocation:'Bay 9',description:'Updated desc'});
  assert.ok(!res.error);
  assert.equal(res.pausedOperations.length,0);
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'in-progress','an ordinary descriptive edit must never pause a running operation');
});
// (19) An invalid/rejected equipment mutation does not pause operations.
test('3rd review fix 19: a REJECTED equipment mutation (invalid pre-use check) does not pause the active operation or change any record', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW3-19','E-REVIEW3-19');
  const before=WD.findJobcard(jc.id);
  const beforeEq=WD.get().equipment.find(e=>e.equipmentId==='E-REVIEW3-19');
  const res=WD.recordEquipmentPreUseCheck('E-REVIEW3-19',{checkedBy:'',date:EQ_ASOF,result:'failed',notes:'Missing checkedBy'});
  assert.ok(res.error,'missing checkedBy must be rejected');
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'in-progress','a rejected mutation must never pause anything');
  assert.deepEqual(WD.findJobcard(jc.id),before);
  assert.deepEqual(WD.get().equipment.find(e=>e.equipmentId==='E-REVIEW3-19'),beforeEq);
});
// (20) Multiple active operations referencing the affected equipment are ALL paused.
test('3rd review fix 20: multiple in-progress operations referencing the SAME equipment are all paused together', ()=>{
  const WD=loadWorkshopData();
  const {jc,op:op1}=mkStartedOpFixture(WD,'JC-REVIEW3-20','E-REVIEW3-20');
  const op2seed=mkOp(WD,jc.id,{equipmentId:'E-REVIEW3-20',machine:'Test Drill'});
  const op2=WD.startJobcardOperation(jc.id,op2seed.id,{date:EQ_ASOF});
  assert.equal(op2.status,'in-progress','fixture: second operation must also have started');
  const res=WD.reportBreakdown('E-REVIEW3-20',{reason:'Overheating',responsiblePerson:'Marko K.'});
  assert.equal(res.pausedOperations.length,2);
  const pausedIds=res.pausedOperations.map(p=>p.operationId).sort();
  assert.deepEqual(pausedIds,[op1.id,op2.id].sort());
  const stored=WD.findJobcard(jc.id).operations;
  assert.equal(stored.find(o=>o.id===op1.id).status,'paused');
  assert.equal(stored.find(o=>o.id===op2.id).status,'paused');
});
// (21) Operations using OTHER equipment remain completely unchanged.
test('3rd review fix 21: operations using a DIFFERENT, unaffected piece of equipment remain completely unchanged', ()=>{
  const WD=loadWorkshopData();
  const {jc:jcAffected,op:opAffected}=mkStartedOpFixture(WD,'JC-REVIEW3-21A','E-REVIEW3-21A');
  const {jc:jcOther,op:opOther}=mkStartedOpFixture(WD,'JC-REVIEW3-21B','E-REVIEW3-21B');
  const beforeOther=WD.findJobcard(jcOther.id);
  WD.reportBreakdown('E-REVIEW3-21A',{reason:'Overheating',responsiblePerson:'Marko K.'});
  assert.equal(WD.findJobcard(jcAffected.id).operations.find(o=>o.id===opAffected.id).status,'paused');
  const afterOther=WD.findJobcard(jcOther.id);
  assert.deepEqual(afterOther,beforeOther,'a completely unrelated Jobcard/operation/equipment must be untouched');
  assert.equal(afterOther.operations.find(o=>o.id===opOther.id).status,'in-progress');
});
// (22) Repeated reconciliation is idempotent.
test('3rd review fix 22: repeated reconciliation is idempotent — no duplicate pause activity or state changes on a second trigger', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW3-22','E-REVIEW3-22');
  const first=WD.changeEquipmentStatus('E-REVIEW3-22','Quarantined');
  assert.equal(first.pausedOperations.length,1);
  const activityCountAfterFirst=WD.findJobcard(jc.id).activity.length;
  const second=WD.changeEquipmentStatus('E-REVIEW3-22','Quarantined');
  assert.equal(second.pausedOperations.length,0,'the operation is already paused — a second trigger must not re-pause or re-report it');
  const activityCountAfterSecond=WD.findJobcard(jc.id).activity.length;
  assert.equal(activityCountAfterSecond,activityCountAfterFirst,'no duplicate automatic-pause activity entry may be added');
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'paused');
});
// (23) The operation retains equipmentId, machine, actualStart and logged hours after automatic pause.
test('3rd review fix 23: an automatically-paused operation retains equipmentId, machine, actualStart and loggedHours', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW3-23','E-REVIEW3-23');
  WD.updateJobcardOperation(jc.id,op.id,{loggedHours:4.5});
  const beforePause=WD.findJobcard(jc.id).operations.find(o=>o.id===op.id);
  WD.reportBreakdown('E-REVIEW3-23',{reason:'Overheating',responsiblePerson:'Marko K.'});
  const afterPause=WD.findJobcard(jc.id).operations.find(o=>o.id===op.id);
  assert.equal(afterPause.status,'paused');
  assert.equal(afterPause.equipmentId,beforePause.equipmentId);
  assert.equal(afterPause.machine,beforePause.machine);
  assert.equal(afterPause.actualStart,beforePause.actualStart);
  assert.ok(afterPause.actualStart,'actualStart must be a real recorded value, not cleared');
  assert.equal(afterPause.loggedHours,4.5);
});
// (24) After return/unlink, Resume fails closed until equipment is correctly linked, assigned and
// checked again — the full UI requirement #8 scenario end to end.
test('3rd review fix 24: after an automatic pause + equipment return + unlink, Resume fails closed at every step until the equipment is correctly re-linked, re-assigned and re-checked', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW3-24','E-REVIEW3-24');
  WD.returnEquipment('E-REVIEW3-24',{user:'Marko K.'});
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'paused');
  // Step 1: still linked in j.machines, but no longer assigned to this Jobcard — resume fails closed.
  const blocked1=WD.startJobcardOperation(jc.id,op.id,{date:EQ_ASOF});
  assert.equal(blocked1.code,'EQUIPMENT_UNASSIGNED');
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'paused');
  // Step 2: now unlink it from the Jobcard (allowed — the operation is paused, not active) — resume
  // still fails closed, now because it isn't linked at all.
  const unlinkRes=WD.updateJobcard(jc.id,{machines:[]});
  assert.ok(!unlinkRes.error,'unlinking is allowed once the operation is paused');
  const blocked2=WD.startJobcardOperation(jc.id,op.id,{date:EQ_ASOF});
  assert.equal(blocked2.code,'EQUIPMENT_NOT_LINKED');
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'paused');
  // Step 3: correctly re-link, re-assign and re-check — resume must then succeed.
  WD.updateJobcard(jc.id,{machines:[{equipmentId:'E-REVIEW3-24',name:'Test Drill',plannedUsage:1}]});
  WD.assignEquipment('E-REVIEW3-24',{project:'P-2026-014',jobcard:jc.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  WD.recordEquipmentPreUseCheck('E-REVIEW3-24',{checkedBy:'Marko K.',date:EQ_ASOF,result:'passed',checklist:'OK',projectNo:'P-2026-014',jobcardNo:jc.no});
  const resumed=WD.startJobcardOperation(jc.id,op.id,{date:EQ_ASOF});
  assert.ok(!resumed.error);
  assert.equal(resumed.status,'in-progress');
  assert.equal(resumed.equipmentId,'E-REVIEW3-24','traceability: still the same equipmentId throughout');
});

// ── Pass 3.2B FOURTH independent review fixes ──────────────────────────────────────────────────
// Root cause: the 3rd-review safety checks used payload TRUTHINESS (`if(data.operations)`,
// `if(data.machines)`, `data.status?...`) instead of field PRESENCE (hasOwnProperty) and schema
// validation. A falsy-but-present malformed value (null, {}, '', 0) skipped every check yet was
// still applied via Object.assign — this section closes that gap.
const MALFORMED_COLLECTION_VALUES=[null,{},''];
const MALFORMED_STATUS_VALUES=['',' ','\t',null,0,false,{},[]];

// (1)+(2)+(3) updateJobcard rejects operations:null/{}/''.
test('4th review fix 1-3: updateJobcard rejects operations:null, {} and "" with INVALID_JOBCARD_OPERATIONS_PAYLOAD', ()=>{
  const WD=loadWorkshopData();
  const {jc}=mkStartedOpFixture(WD,'JC-REVIEW4-01','E-REVIEW4-01');
  MALFORMED_COLLECTION_VALUES.forEach(bad=>{
    const res=WD.updateJobcard(jc.id,{operations:bad});
    assert.equal(res.code,'INVALID_JOBCARD_OPERATIONS_PAYLOAD',`operations:${JSON.stringify(bad)} must be rejected`);
  });
});
// (4) Existing-record upsertJobcard rejects the same three values.
test('4th review fix 4: existing-record upsertJobcard rejects operations:null, {} and ""', ()=>{
  const WD=loadWorkshopData();
  const {jc}=mkStartedOpFixture(WD,'JC-REVIEW4-04','E-REVIEW4-04');
  MALFORMED_COLLECTION_VALUES.forEach(bad=>{
    const res=WD.upsertJobcard({id:jc.id,no:jc.no,operations:bad});
    assert.equal(res.code,'INVALID_JOBCARD_OPERATIONS_PAYLOAD',`operations:${JSON.stringify(bad)} must be rejected`);
  });
});
// (5) All six rejected operations cases preserve the complete active Jobcard and operation.
test('4th review fix 5: all six rejected malformed-operations cases leave the complete Jobcard and its active operation untouched', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW4-05','E-REVIEW4-05');
  const before=WD.findJobcard(jc.id);
  MALFORMED_COLLECTION_VALUES.forEach(bad=>{
    WD.updateJobcard(jc.id,{operations:bad});
    WD.upsertJobcard({id:jc.id,no:jc.no,operations:bad});
  });
  const after=WD.findJobcard(jc.id);
  assert.deepEqual(after,before);
  assert.equal(after.operations.find(o=>o.id===op.id).status,'in-progress');
});
// (6) updateJobcard rejects machines:null/{}/''.
test('4th review fix 6: updateJobcard rejects machines:null, {} and "" with INVALID_JOBCARD_MACHINES_PAYLOAD', ()=>{
  const WD=loadWorkshopData();
  const {jc}=mkStartedOpFixture(WD,'JC-REVIEW4-06','E-REVIEW4-06');
  MALFORMED_COLLECTION_VALUES.forEach(bad=>{
    const res=WD.updateJobcard(jc.id,{machines:bad});
    assert.equal(res.code,'INVALID_JOBCARD_MACHINES_PAYLOAD',`machines:${JSON.stringify(bad)} must be rejected`);
  });
});
// (7) Existing-record upsertJobcard rejects the same three machine values.
test('4th review fix 7: existing-record upsertJobcard rejects machines:null, {} and ""', ()=>{
  const WD=loadWorkshopData();
  const {jc}=mkStartedOpFixture(WD,'JC-REVIEW4-07','E-REVIEW4-07');
  MALFORMED_COLLECTION_VALUES.forEach(bad=>{
    const res=WD.upsertJobcard({id:jc.id,no:jc.no,machines:bad});
    assert.equal(res.code,'INVALID_JOBCARD_MACHINES_PAYLOAD',`machines:${JSON.stringify(bad)} must be rejected`);
  });
});
// (8) All six rejected machine cases preserve the equipment link and active operation.
test('4th review fix 8: all six rejected malformed-machines cases leave the equipment link and active operation untouched', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW4-08','E-REVIEW4-08');
  const before=WD.findJobcard(jc.id);
  MALFORMED_COLLECTION_VALUES.forEach(bad=>{
    WD.updateJobcard(jc.id,{machines:bad});
    WD.upsertJobcard({id:jc.id,no:jc.no,machines:bad});
  });
  const after=WD.findJobcard(jc.id);
  assert.deepEqual(after,before);
  assert.equal(after.machines.length,1);
  assert.equal(after.operations.find(o=>o.id===op.id).status,'in-progress');
});
// (9) A real empty operations array still reaches the active-deletion protection.
test('4th review fix 9: a genuine empty operations array [] is valid input and still reaches the active-deletion protection (not the payload-shape error)', ()=>{
  const WD=loadWorkshopData();
  const {jc}=mkStartedOpFixture(WD,'JC-REVIEW4-09','E-REVIEW4-09');
  const res=WD.updateJobcard(jc.id,{operations:[]});
  assert.equal(res.code,'OPERATION_ACTIVE_DELETE_REQUIRES_PAUSE','a real [] must reach the active-operation-deletion check, not be treated as an invalid payload');
  assert.notEqual(res.code,'INVALID_JOBCARD_OPERATIONS_PAYLOAD');
});
// (10) A real empty machines array still reaches the active-unlink protection.
test('4th review fix 10: a genuine empty machines array [] is valid input and still reaches the active-unlink protection', ()=>{
  const WD=loadWorkshopData();
  const {jc}=mkStartedOpFixture(WD,'JC-REVIEW4-10','E-REVIEW4-10');
  const res=WD.updateJobcard(jc.id,{machines:[]});
  assert.equal(res.code,'ACTIVE_OPERATION_EQUIPMENT_UNLINK_REQUIRES_PAUSE');
  assert.notEqual(res.code,'INVALID_JOBCARD_MACHINES_PAYLOAD');
});
// (11) Null/primitive array entries are rejected.
test('4th review fix 11: null/primitive entries inside an otherwise-array operations or machines payload are rejected', ()=>{
  const WD=loadWorkshopData();
  const {jc}=mkStartedOpFixture(WD,'JC-REVIEW4-11','E-REVIEW4-11');
  const opsRes=WD.updateJobcard(jc.id,{operations:[null,'not-an-object',42]});
  assert.equal(opsRes.code,'INVALID_JOBCARD_OPERATIONS_PAYLOAD');
  const machinesRes=WD.updateJobcard(jc.id,{machines:[null,'not-an-object',42]});
  assert.equal(machinesRes.code,'INVALID_JOBCARD_MACHINES_PAYLOAD');
});
// (12) Duplicate operation IDs are rejected.
test('4th review fix 12: duplicate operation ids in a full operations-array replacement are rejected', ()=>{
  const WD=loadWorkshopData();
  const jc=mkJobcard(WD,'JC-REVIEW4-12');
  const op=mkOp(WD,jc.id,{});
  const res=WD.updateJobcard(jc.id,{operations:[Object.assign({},op),Object.assign({},op)]});
  assert.equal(res.code,'INVALID_JOBCARD_OPERATIONS_PAYLOAD');
});
// (13) Duplicate machine equipment IDs are rejected.
test('4th review fix 13: duplicate equipmentId entries in a full machines-array replacement are rejected', ()=>{
  const WD=loadWorkshopData();
  const jc=mkJobcard(WD,'JC-REVIEW4-13');
  const res=WD.updateJobcard(jc.id,{machines:[{equipmentId:'E-DUP',name:'A'},{equipmentId:'E-DUP',name:'B'}]});
  assert.equal(res.code,'INVALID_JOBCARD_MACHINES_PAYLOAD');
});
// (14) An active operation record cannot be replaced by an object containing only its matching ID.
test('4th review fix 14: an in-progress operation cannot be replaced by a bare {id} object — every other field (including equipmentId) is treated as missing/changed', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW4-14','E-REVIEW4-14');
  const res=WD.updateJobcard(jc.id,{operations:[{id:op.id}]});
  assert.equal(res.code,'OPERATION_EQUIPMENT_CHANGE_REQUIRES_PAUSE','a bare {id} object is missing equipmentId/machine — that must count as an unauthorized equipment change, not a no-op');
  const stored=WD.findJobcard(jc.id).operations.find(o=>o.id===op.id);
  assert.equal(stored.status,'in-progress');
  assert.equal(stored.equipmentId,'E-REVIEW4-14','the real stored operation must be completely untouched');
  assert.ok(stored.desc,'the real stored operation must still have its real desc/other fields — nothing was replaced');
});
// (15) Omitting equipmentId/machine from a still-in-progress full replacement counts as a protected change.
test('4th review fix 15: omitting equipmentId (present but replaced by undefined) from a full-array replacement of a still-in-progress operation is rejected', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW4-15','E-REVIEW4-15');
  const stored=WD.findJobcard(jc.id).operations.find(o=>o.id===op.id);
  const withoutEquipment=Object.assign({},stored);
  delete withoutEquipment.equipmentId;
  const res=WD.updateJobcard(jc.id,{operations:[withoutEquipment]});
  assert.equal(res.code,'OPERATION_EQUIPMENT_CHANGE_REQUIRES_PAUSE');
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).equipmentId,'E-REVIEW4-15');
});
// (16) updateJobcardOperation rejects malformed/unknown status values atomically.
test('4th review fix 16: updateJobcardOperation rejects malformed/unrecognised status values atomically, and none of the bundled patch is applied', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW4-16','E-REVIEW4-16');
  [...MALFORMED_STATUS_VALUES,'not-a-real-status'].forEach(bad=>{
    const res=WD.updateJobcardOperation(jc.id,op.id,{status:bad,equipmentId:'SHOULD-NOT-APPLY',desc:'SHOULD-NOT-APPLY'});
    assert.equal(res.code,'INVALID_OPERATION_STATUS',`status:${JSON.stringify(bad)} must be rejected`);
  });
  const stored=WD.findJobcard(jc.id).operations.find(o=>o.id===op.id);
  assert.equal(stored.status,'in-progress');
  assert.equal(stored.equipmentId,'E-REVIEW4-16');
  assert.notEqual(stored.desc,'SHOULD-NOT-APPLY');
});
// (17) updateEquipment rejects malformed status values.
test('4th review fix 17: updateEquipment rejects status "", whitespace, null, 0, false, {} and [] with INVALID_EQUIPMENT_STATUS', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-REVIEW4-17',name:'Test Drill',category:'Power Tool'});
  const before=WD.get().equipment.find(e=>e.equipmentId==='E-REVIEW4-17');
  MALFORMED_STATUS_VALUES.forEach(bad=>{
    const res=WD.updateEquipment('E-REVIEW4-17',{status:bad});
    assert.equal(res.code,'INVALID_EQUIPMENT_STATUS',`status:${JSON.stringify(bad)} must be rejected`);
  });
  const after=WD.get().equipment.find(e=>e.equipmentId==='E-REVIEW4-17');
  assert.deepEqual(after,before,'no rejected attempt may have changed anything');
});
// (18) changeEquipmentStatus rejects the same malformed status values.
test('4th review fix 18: changeEquipmentStatus rejects the same malformed status values with INVALID_EQUIPMENT_STATUS', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-REVIEW4-18',name:'Test Drill',category:'Power Tool'});
  const before=WD.get().equipment.find(e=>e.equipmentId==='E-REVIEW4-18');
  MALFORMED_STATUS_VALUES.forEach(bad=>{
    const res=WD.changeEquipmentStatus('E-REVIEW4-18',bad);
    assert.equal(res.code,'INVALID_EQUIPMENT_STATUS',`status:${JSON.stringify(bad)} must be rejected`);
  });
  const after=WD.get().equipment.find(e=>e.equipmentId==='E-REVIEW4-18');
  assert.deepEqual(after,before);
});
// (19) Rejected status mutations do not pause the operation because no equipment mutation occurred.
test('4th review fix 19: a rejected malformed-status mutation does not pause the active operation (nothing valid happened)', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW4-19','E-REVIEW4-19');
  MALFORMED_STATUS_VALUES.forEach(bad=>{
    WD.updateEquipment('E-REVIEW4-19',{status:bad});
    WD.changeEquipmentStatus('E-REVIEW4-19',bad);
  });
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'in-progress','still running — no genuine equipment mutation ever occurred');
});
// (20) A non-empty unknown equipment status remains accepted as fail-closed and pauses the active operation.
test('4th review fix 20: a non-empty but UNKNOWN status string is still accepted (fail-closed) and still pauses the active operation — preserving existing behaviour', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW4-20','E-REVIEW4-20');
  const res=WD.changeEquipmentStatus('E-REVIEW4-20','Something Weird');
  assert.ok(!res.error,'an unrecognised but well-formed status string must still be ACCEPTED, not rejected as invalid');
  assert.equal(res.status,'Something Weird');
  assert.equal(res.pausedOperations.length,1,'an unrecognised status fails safe (blocked) and must still auto-pause the active operation');
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'paused');
});
// (21) Recognised hard-block statuses still pause operations (regression guard for the 3rd-review fix).
test('4th review fix 21: recognised hard-block statuses (Quarantined, Out of Service) still auto-pause the active operation', ()=>{
  const WD=loadWorkshopData();
  const fixtures=[mkStartedOpFixture(WD,'JC-REVIEW4-21A','E-REVIEW4-21A'),mkStartedOpFixture(WD,'JC-REVIEW4-21B','E-REVIEW4-21B')];
  const r1=WD.changeEquipmentStatus('E-REVIEW4-21A','Quarantined');
  assert.equal(r1.pausedOperations.length,1);
  const r2=WD.changeEquipmentStatus('E-REVIEW4-21B','Out of Service');
  assert.equal(r2.pausedOperations.length,1);
  fixtures.forEach(({jc,op})=>assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'paused'));
});
// (22) Ordinary descriptive equipment edits remain allowed and do not pause operations.
test('4th review fix 22: ordinary descriptive equipment edits (no status field at all) remain allowed and never pause the active operation', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW4-22','E-REVIEW4-22');
  const res=WD.updateEquipment('E-REVIEW4-22',{name:'Renamed',description:'Updated',currentLocation:'Bay 3'});
  assert.ok(!res.error);
  assert.equal(res.pausedOperations.length,0);
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'in-progress');
});
// (24) API return-only pausedOperations data must never be written into stored records.
test('4th review fix 24: the pausedOperations field returned by an API call is never persisted inside the stored equipment/breakdown/inspection/pre-use-check records', ()=>{
  const WD=loadWorkshopData();
  const {jc}=mkStartedOpFixture(WD,'JC-REVIEW4-24','E-REVIEW4-24');
  const breakdown=WD.reportBreakdown('E-REVIEW4-24',{reason:'Overheating',responsiblePerson:'Marko K.'});
  assert.ok(Array.isArray(breakdown.pausedOperations)&&breakdown.pausedOperations.length===1,'sanity: the API return value does carry pausedOperations');
  const rawEquipment=WD.get().equipment.find(e=>e.equipmentId==='E-REVIEW4-24');
  assert.equal(rawEquipment.pausedOperations,undefined,'the stored equipment record itself must never carry a pausedOperations field');
  assert.equal(rawEquipment.downtimeRecords[0].pausedOperations,undefined,'the stored breakdown record must never carry a pausedOperations field');
  WD.createEquipment({equipmentId:'E-REVIEW4-24B',name:'Test Drill',category:'Power Tool'});
  const insp=WD.addInspection('E-REVIEW4-24B',{inspector:'Aleksandar C.',result:'failed',critical:true,findings:'Cracked',date:EQ_ASOF});
  assert.ok(Array.isArray(insp.pausedOperations));
  const rawEq2=WD.get().equipment.find(e=>e.equipmentId==='E-REVIEW4-24B');
  assert.equal(rawEq2.inspections[0].pausedOperations,undefined);
  WD.createEquipment({equipmentId:'E-REVIEW4-24C',name:'Test Drill',category:'Power Tool'});
  const puc=WD.recordEquipmentPreUseCheck('E-REVIEW4-24C',{checkedBy:'Marko K.',date:EQ_ASOF,result:'failed',notes:'Guard missing'});
  assert.ok(Array.isArray(puc.pausedOperations));
  const rawEq3=WD.get().equipment.find(e=>e.equipmentId==='E-REVIEW4-24C');
  assert.equal(rawEq3.preUseChecks[0].pausedOperations,undefined);
});

// ── Pass 3.2B FIFTH independent review fixes ───────────────────────────────────────────────────
// Root cause: unsafeOperationEquipmentChanges()/updateJobcardOperation() exempted every recognised
// non-in-progress status (completed/skipped/pending/paused) from equipment protection, when only an
// explicit transition to 'paused' should be exempt — completing/skipping/reverting an in-progress
// operation could otherwise rewrite which equipment performed the work.
// (1)+(2)+(3) Single-operation patch: in-progress -> completed/skipped/pending plus an equipment
// change is rejected in every case.
test('5th review fix 1-3: updateJobcardOperation rejects an equipment change bundled with a transition to completed, skipped or pending', ()=>{
  const WD=loadWorkshopData();
  ['completed','skipped','pending'].forEach(targetStatus=>{
    const {jc,op}=mkStartedOpFixture(WD,`JC-REVIEW5-0${targetStatus}`,`E-REVIEW5-0${targetStatus}`);
    WD.createEquipment({equipmentId:`E-REVIEW5-FAB-${targetStatus}`,name:'Fabricated machine',category:'Power Tool'});
    const res=WD.updateJobcardOperation(jc.id,op.id,{status:targetStatus,equipmentId:`E-REVIEW5-FAB-${targetStatus}`,machine:'Fabricated machine',actualCompletion:EQ_ASOF});
    assert.equal(res.code,'OPERATION_EQUIPMENT_CHANGE_REQUIRES_PAUSE',`transition to "${targetStatus}" plus an equipment change must be rejected`);
    const stored=WD.findJobcard(jc.id).operations.find(o=>o.id===op.id);
    assert.equal(stored.status,'in-progress','rejected — status must not have changed either');
    assert.equal(stored.equipmentId,`E-REVIEW5-0${targetStatus}`);
  });
});
// (4) Bulk updateJobcard: all three target statuses plus equipment change are rejected.
test('5th review fix 4: updateJobcard({operations}) rejects an equipment change bundled with a transition to completed, skipped or pending', ()=>{
  const WD=loadWorkshopData();
  ['completed','skipped','pending'].forEach(targetStatus=>{
    const {jc,op}=mkStartedOpFixture(WD,`JC-REVIEW5-4${targetStatus}`,`E-REVIEW5-4${targetStatus}`);
    WD.createEquipment({equipmentId:`E-REVIEW5-4FAB-${targetStatus}`,name:'Fabricated machine',category:'Power Tool'});
    const ops=WD.findJobcard(jc.id).operations.map(o=>o.id===op.id?Object.assign({},o,{status:targetStatus,equipmentId:`E-REVIEW5-4FAB-${targetStatus}`,machine:'Fabricated machine'}):o);
    const res=WD.updateJobcard(jc.id,{operations:ops});
    assert.equal(res.code,'OPERATION_EQUIPMENT_CHANGE_REQUIRES_PAUSE',`bulk transition to "${targetStatus}" plus an equipment change must be rejected`);
    const stored=WD.findJobcard(jc.id).operations.find(o=>o.id===op.id);
    assert.equal(stored.status,'in-progress');
    assert.equal(stored.equipmentId,`E-REVIEW5-4${targetStatus}`);
  });
});
// (5) Bulk existing-record upsertJobcard: all three target statuses plus equipment change are rejected.
test('5th review fix 5: existing-record upsertJobcard({operations}) rejects an equipment change bundled with a transition to completed, skipped or pending', ()=>{
  const WD=loadWorkshopData();
  ['completed','skipped','pending'].forEach(targetStatus=>{
    const {jc,op}=mkStartedOpFixture(WD,`JC-REVIEW5-5${targetStatus}`,`E-REVIEW5-5${targetStatus}`);
    WD.createEquipment({equipmentId:`E-REVIEW5-5FAB-${targetStatus}`,name:'Fabricated machine',category:'Power Tool'});
    const ops=WD.findJobcard(jc.id).operations.map(o=>o.id===op.id?Object.assign({},o,{status:targetStatus,equipmentId:`E-REVIEW5-5FAB-${targetStatus}`,machine:'Fabricated machine'}):o);
    const res=WD.upsertJobcard({id:jc.id,no:jc.no,operations:ops});
    assert.equal(res.code,'OPERATION_EQUIPMENT_CHANGE_REQUIRES_PAUSE',`upsert transition to "${targetStatus}" plus an equipment change must be rejected`);
    const stored=WD.findJobcard(jc.id).operations.find(o=>o.id===op.id);
    assert.equal(stored.status,'in-progress');
    assert.equal(stored.equipmentId,`E-REVIEW5-5${targetStatus}`);
  });
});
// (6) Removing equipmentId while completing is rejected.
test('5th review fix 6: removing equipmentId (setting it null) while completing an in-progress operation is rejected', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW5-06','E-REVIEW5-06');
  const res=WD.updateJobcardOperation(jc.id,op.id,{status:'completed',equipmentId:null,machine:''});
  assert.equal(res.code,'OPERATION_EQUIPMENT_CHANGE_REQUIRES_PAUSE');
  const stored=WD.findJobcard(jc.id).operations.find(o=>o.id===op.id);
  assert.equal(stored.equipmentId,'E-REVIEW5-06');
  assert.equal(stored.status,'in-progress');
});
// (7) Removing machine while skipping is rejected.
test('5th review fix 7: removing the machine display name while skipping an in-progress operation is rejected', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW5-07','E-REVIEW5-07');
  const storedBefore=WD.findJobcard(jc.id).operations.find(o=>o.id===op.id);
  const res=WD.updateJobcardOperation(jc.id,op.id,{status:'skipped',machine:''});
  assert.equal(res.code,'OPERATION_EQUIPMENT_CHANGE_REQUIRES_PAUSE');
  const stored=WD.findJobcard(jc.id).operations.find(o=>o.id===op.id);
  assert.equal(stored.machine,storedBefore.machine);
  assert.equal(stored.status,'in-progress');
});
// (8) A rejected mixed patch also applies none of its description, worker or hours changes.
test('5th review fix 8: a rejected complete+equipment-change patch applies none of its bundled desc/worker/loggedHours fields either', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW5-08','E-REVIEW5-08');
  WD.createEquipment({equipmentId:'E-REVIEW5-08-FAB',name:'Fabricated machine',category:'Power Tool'});
  const res=WD.updateJobcardOperation(jc.id,op.id,{status:'completed',equipmentId:'E-REVIEW5-08-FAB',machine:'Fabricated machine',desc:'Sneaky desc',worker:'Someone Else',loggedHours:999,actualCompletion:EQ_ASOF});
  assert.equal(res.code,'OPERATION_EQUIPMENT_CHANGE_REQUIRES_PAUSE');
  const stored=WD.findJobcard(jc.id).operations.find(o=>o.id===op.id);
  assert.notEqual(stored.desc,'Sneaky desc');
  assert.notEqual(stored.worker,'Someone Else');
  assert.notEqual(stored.loggedHours,999);
  assert.equal(stored.actualCompletion,null,'actualCompletion must not have been set either');
});
// (9) The complete Jobcard remains unchanged after every rejected full-array mutation.
test('5th review fix 9: the complete Jobcard record is unchanged after a rejected bulk complete+equipment-change mutation, including unrelated bundled fields', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW5-09','E-REVIEW5-09');
  WD.createEquipment({equipmentId:'E-REVIEW5-09-FAB',name:'Fabricated machine',category:'Power Tool'});
  const before=WD.findJobcard(jc.id);
  const ops=before.operations.map(o=>o.id===op.id?Object.assign({},o,{status:'completed',equipmentId:'E-REVIEW5-09-FAB',machine:'Fabricated machine'}):o);
  const res=WD.updateJobcard(jc.id,{operations:ops,title:'Sneaky title change'});
  assert.equal(res.code,'OPERATION_EQUIPMENT_CHANGE_REQUIRES_PAUSE');
  const after=WD.findJobcard(jc.id);
  assert.deepEqual(after,before,'the whole Jobcard, including the unrelated bundled title field, must be byte-for-byte unchanged');
});
// (10) in-progress -> paused plus an equipment edit remains allowed.
test('5th review fix 10: transitioning in-progress -> paused while ALSO changing equipment in the same patch remains allowed (current established policy)', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW5-10','E-REVIEW5-10');
  WD.createEquipment({equipmentId:'E-REVIEW5-10-NEW',name:'Other machine',category:'Power Tool'});
  const res=WD.updateJobcardOperation(jc.id,op.id,{status:'paused',equipmentId:'E-REVIEW5-10-NEW',machine:'Other machine'});
  assert.ok(!res.error,'pause + equipment edit in the same call must remain allowed');
  assert.equal(res.status,'paused');
  assert.equal(res.equipmentId,'E-REVIEW5-10-NEW');
  // Same allowance through the bulk path.
  const {jc:jc2,op:op2}=mkStartedOpFixture(WD,'JC-REVIEW5-10B','E-REVIEW5-10B');
  WD.createEquipment({equipmentId:'E-REVIEW5-10B-NEW',name:'Other machine',category:'Power Tool'});
  const ops=WD.findJobcard(jc2.id).operations.map(o=>o.id===op2.id?Object.assign({},o,{status:'paused',equipmentId:'E-REVIEW5-10B-NEW',machine:'Other machine'}):o);
  const res2=WD.updateJobcard(jc2.id,{operations:ops});
  assert.ok(!res2.error,'bulk pause + equipment edit in the same call must remain allowed');
  assert.equal(WD.findJobcard(jc2.id).operations.find(o=>o.id===op2.id).equipmentId,'E-REVIEW5-10B-NEW');
});
// (11) An operation already paused can still change equipment normally.
test('5th review fix 11: an operation already stored as paused can still have its equipment changed normally (unaffected by this fix)', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW5-11','E-REVIEW5-11');
  WD.updateJobcardOperation(jc.id,op.id,{status:'paused'});
  WD.createEquipment({equipmentId:'E-REVIEW5-11-NEW',name:'Other machine',category:'Power Tool'});
  const res=WD.updateJobcardOperation(jc.id,op.id,{equipmentId:'E-REVIEW5-11-NEW',machine:'Other machine'});
  assert.ok(!res.error);
  assert.equal(res.equipmentId,'E-REVIEW5-11-NEW');
});
// (12) Completing an operation while preserving its original equipment remains allowed with no blocker.
test('5th review fix 12: completing an operation while preserving its original equipment remains allowed when nothing else blocks it', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW5-12','E-REVIEW5-12');
  const res=WD.updateJobcardOperation(jc.id,op.id,{status:'completed',equipmentId:op.equipmentId,machine:op.machine,actualCompletion:EQ_ASOF});
  assert.ok(!res.error,'completing with UNCHANGED equipment must remain allowed');
  assert.equal(res.status,'completed');
  assert.equal(res.equipmentId,'E-REVIEW5-12');
});
// (13) Completing/skipping with unchanged equipment remains blocked by an active Quality Hold.
test('5th review fix 13: completing/skipping with UNCHANGED equipment still respects an active Quality Hold (existing, unrelated protection)', ()=>{
  const WD=loadWorkshopData();
  const {jc,op}=mkStartedOpFixture(WD,'JC-REVIEW5-13','E-REVIEW5-13');
  WD.applyQualityHold({scope:'jobcard',reference:jc.no,reason:'Test hold'});
  const completeRes=WD.updateJobcardOperation(jc.id,op.id,{status:'completed',equipmentId:op.equipmentId,machine:op.machine,actualCompletion:EQ_ASOF});
  assert.equal(completeRes.code,'QUALITY_HOLD_ACTIVE','completing with unchanged equipment must still be blocked by the active hold');
  const skipRes=WD.updateJobcardOperation(jc.id,op.id,{status:'skipped',equipmentId:op.equipmentId,machine:op.machine});
  assert.equal(skipRes.code,'QUALITY_HOLD_ACTIVE');
  assert.equal(WD.findJobcard(jc.id).operations.find(o=>o.id===op.id).status,'in-progress','a hold-blocked transition must not have changed status');
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Pass 3.2C — Equipment creation and assignment control-surface hardening
// Part A: createEquipment() may never be born assigned/in-use/retired or carrying audit history,
//   and equipmentId/id/name/category must be genuine, trimmed, non-empty strings.
// Part B: reserveEquipment()/assignEquipment() share ONE context validator (real, non-archived,
//   case/whitespace-normalised non-terminal project/Jobcard; required authority fields) — never
//   duplicated — and always persist the CANONICAL resolved project.no/jobcard.no, never a raw
//   caller-supplied reference (which may be a numeric internal id).
// Part C/D: equipment-machines-desktop.html no longer contains the old demo bypass paths, and its
//   safety panel / API error display are translated by structured code in EN/SV/MK.
// ══════════════════════════════════════════════════════════════════════════════════════════════

// ── Part A: createEquipment() creation-time hardening ──────────────────────────────────────────
test('Pass 3.2C (1): createEquipment rejects initial status "Reserved" with EQUIPMENT_INITIAL_STATUS_REQUIRES_WORKFLOW', ()=>{
  const WD=loadWorkshopData();
  const res=WD.createEquipment({equipmentId:'E-32C-A1',name:'Test Drill',category:'Power Tool',status:'Reserved'});
  assert.ok(res.error);
  assert.equal(res.code,'EQUIPMENT_INITIAL_STATUS_REQUIRES_WORKFLOW');
  assert.equal(WD.getEquipment().find(e=>e.equipmentId==='E-32C-A1'),undefined);
});

test('Pass 3.2C (2): createEquipment rejects initial status "In Use" with EQUIPMENT_INITIAL_STATUS_REQUIRES_WORKFLOW', ()=>{
  const WD=loadWorkshopData();
  const res=WD.createEquipment({equipmentId:'E-32C-A2',name:'Test Drill',category:'Power Tool',status:'In Use'});
  assert.ok(res.error);
  assert.equal(res.code,'EQUIPMENT_INITIAL_STATUS_REQUIRES_WORKFLOW');
});

test('Pass 3.2C (3): createEquipment rejects initial status "Retired" with EQUIPMENT_RETIREMENT_REQUIRES_WORKFLOW', ()=>{
  const WD=loadWorkshopData();
  const res=WD.createEquipment({equipmentId:'E-32C-A3',name:'Test Drill',category:'Power Tool',status:'Retired'});
  assert.ok(res.error);
  assert.equal(res.code,'EQUIPMENT_RETIREMENT_REQUIRES_WORKFLOW');
});

test('Pass 3.2C (4): createEquipment rejects a malformed/blank status value with INVALID_EQUIPMENT_STATUS', ()=>{
  const WD=loadWorkshopData();
  for(const bad of ['','   ',null,0,false,{},[]]){
    const res=WD.createEquipment({equipmentId:'E-32C-A4',name:'Test Drill',category:'Power Tool',status:bad});
    assert.equal(res.code,'INVALID_EQUIPMENT_STATUS',`status ${JSON.stringify(bad)} must be rejected`);
  }
});

test('Pass 3.2C (5): createEquipment rejects an unrecognised (but well-formed) status string with INVALID_EQUIPMENT_STATUS', ()=>{
  const WD=loadWorkshopData();
  const res=WD.createEquipment({equipmentId:'E-32C-A5',name:'Test Drill',category:'Power Tool',status:'Sparkling Clean'});
  assert.equal(res.code,'INVALID_EQUIPMENT_STATUS');
});

test('Pass 3.2C (6): createEquipment rejects the whole creation atomically when a workflow-owned field is supplied, even falsy/empty, with EQUIPMENT_CREATION_FIELDS_PROTECTED', ()=>{
  const WD=loadWorkshopData();
  const attempts=[
    {assignedProject:'P-2026-014'},{assignedJobcard:'JC-2026-0001'},{operator:'Marko K.'},
    {currentAssignment:{worker:'Marko K.'}},{isRetired:true},{isRetired:false},{retirementReason:''},
    {inspections:[{result:'passed'}]},{maintenance:[]},{certifications:[]},{calibrations:[]},
    {preUseChecks:[]},{downtimeRecords:[]},{returnToService:[]},{usageHistory:[]},
    {usageSessions:[]},{activity:[]},{safetyWarnings:[]},{safetyWarnings:null}
  ];
  attempts.forEach((extra,i)=>{
    const res=WD.createEquipment(Object.assign({equipmentId:`E-32C-A6-${i}`,name:'Test Drill',category:'Power Tool'},extra));
    assert.equal(res.code,'EQUIPMENT_CREATION_FIELDS_PROTECTED',`payload ${JSON.stringify(extra)} must be rejected`);
    assert.ok(Array.isArray(res.protectedFields)&&res.protectedFields.length,'must report which field(s) were protected');
    assert.equal(WD.getEquipment().find(e=>e.equipmentId===`E-32C-A6-${i}`),undefined,'nothing may be created, not even with the protected fields stripped');
  });
});

test('Pass 3.2C (7): a rejected creation (bad status, protected field, or malformed identity) does not create a record or increment the equipment counter', ()=>{
  const WD=loadWorkshopData();
  const beforeCount=WD.getEquipment().length;
  const beforeCounter=WD.get().counters.equipment;
  WD.createEquipment({equipmentId:'E-32C-A7-X',name:'Test Drill',category:'Power Tool',status:'Retired'});
  WD.createEquipment({equipmentId:'E-32C-A7-Y',name:'Test Drill',category:'Power Tool',operator:'Someone'});
  WD.createEquipment({equipmentId:123,name:'Test Drill',category:'Power Tool'});
  const after=WD.get();
  assert.equal(after.equipment.length,beforeCount,'no equipment record must be added on rejection');
  assert.equal(after.counters.equipment,beforeCounter,'the equipment counter must not increment on rejection');
});

test('Pass 3.2C (8): creating equipment with status "Available" (or status omitted entirely) still works exactly as before', ()=>{
  const WD=loadWorkshopData();
  const explicit=WD.createEquipment({equipmentId:'E-32C-A8a',name:'Test Drill',category:'Power Tool',status:'Available'});
  assert.ok(!explicit.error);
  assert.equal(explicit.status,'Available');
  const omitted=WD.createEquipment({equipmentId:'E-32C-A8b',name:'Test Drill',category:'Power Tool'});
  assert.ok(!omitted.error);
  assert.equal(omitted.status,'Available');
});

test('Pass 3.2C (9): valid hard-block initial statuses succeed but are immediately gate-blocked', ()=>{
  const WD=loadWorkshopData();
  ['Maintenance Due','Under Maintenance','Inspection Required','Out of Service','Quarantined'].forEach((status,i)=>{
    const res=WD.createEquipment({equipmentId:`E-32C-A9-${i}`,name:'Test Drill',category:'Power Tool',status});
    assert.ok(!res.error,`status ${status} must be a valid initial status`);
    assert.equal(res.status,status);
    const gate=WD.getEquipmentSafetyGate(res.equipmentId,{asOf:EQ_ASOF});
    assert.equal(gate.blocked,true,`${status} must be immediately gate-blocked`);
  });
});

test('Pass 3.2C (10): requirements normalization remains intact, including on an Available record with a missing mandatory requirement', ()=>{
  const WD=loadWorkshopData();
  const created=WD.createEquipment({equipmentId:'E-32C-A10',name:'Test Drill',category:'Power Tool',
    requirements:{maintenanceRequired:true,inspectionRequired:'yes',bogus:true}});
  assert.ok(!created.error);
  assert.deepEqual(created.requirements,{maintenanceRequired:true,inspectionRequired:true});
  const gate=WD.getEquipmentSafetyGate('E-32C-A10',{asOf:EQ_ASOF});
  assert.equal(gate.blocked,true,'a mandatory requirement with no date must block the gate immediately, even though creation succeeded');
});

test('Pass 3.2C (11): createEquipment rejects malformed Equipment IDs (missing, null, number, boolean, whitespace, array, object) with INVALID_EQUIPMENT_ID', ()=>{
  const WD=loadWorkshopData();
  const before=WD.getEquipment().length;
  [undefined,null,123,true,false,'   ','',{},[]].forEach((badId)=>{
    const payload={name:'Test Drill',category:'Power Tool'};
    if(badId!==undefined)payload.equipmentId=badId;
    const res=WD.createEquipment(payload);
    assert.equal(res.code,'INVALID_EQUIPMENT_ID',`equipmentId ${JSON.stringify(badId)} must be rejected`);
  });
  assert.equal(WD.getEquipment().length,before);
});

test('Pass 3.2C (12): a valid Equipment ID is trimmed before lookup and storage', ()=>{
  const WD=loadWorkshopData();
  const res=WD.createEquipment({equipmentId:'  E-32C-A12  ',name:'Test Drill',category:'Power Tool'});
  assert.ok(!res.error);
  assert.equal(res.equipmentId,'E-32C-A12','the stored id must be trimmed, not the raw padded string');
  assert.equal(res.id,'E-32C-A12');
  assert.ok(WD.getEquipment().find(e=>e.equipmentId==='E-32C-A12'));
});

test('Pass 3.2C (13): whitespace cannot bypass duplicate detection — a padded variant of an existing ID is rejected as a duplicate', ()=>{
  const WD=loadWorkshopData();
  const before=WD.getEquipment().length;
  const first=WD.createEquipment({equipmentId:'E-32C-A13',name:'Test Drill',category:'Power Tool'});
  assert.ok(!first.error);
  const dup=WD.createEquipment({equipmentId:'  E-32C-A13  ',name:'Another Drill',category:'Power Tool'});
  assert.equal(dup.error,'Duplicate equipment ID');
  assert.equal(WD.getEquipment().length,before+1);
});

test('Pass 3.2C (14): conflicting non-empty equipmentId and id values are rejected atomically with INVALID_EQUIPMENT_ID', ()=>{
  const WD=loadWorkshopData();
  const res=WD.createEquipment({equipmentId:'E-32C-A14-ONE',id:'E-32C-A14-TWO',name:'Test Drill',category:'Power Tool'});
  assert.equal(res.code,'INVALID_EQUIPMENT_ID');
  assert.equal(WD.getEquipment().find(e=>e.equipmentId==='E-32C-A14-ONE'||e.equipmentId==='E-32C-A14-TWO'),undefined);
});

test('Pass 3.2C: createEquipment accepts matching equipmentId and id values (same non-empty string) and rejects non-string name/category', ()=>{
  const WD=loadWorkshopData();
  const ok=WD.createEquipment({equipmentId:'E-32C-A14C',id:'E-32C-A14C',name:'Test Drill',category:'Power Tool'});
  assert.ok(!ok.error);
  const badName=WD.createEquipment({equipmentId:'E-32C-A14D',name:123,category:'Power Tool'});
  assert.ok(badName.error);
  const badCategory=WD.createEquipment({equipmentId:'E-32C-A14E',name:'Test Drill',category:['x']});
  assert.ok(badCategory.error);
});

// ── Part B: the shared assignment-context validator (reserveEquipment/assignEquipment) ─────────
test('Pass 3.2C (15a): reserveEquipment rejects an unknown project number with INVALID_EQUIPMENT_ASSIGNMENT_CONTEXT', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-B1',name:'Test Drill',category:'Power Tool'});
  const res=WD.reserveEquipment('E-32C-B1',{project:'P-DOES-NOT-EXIST',reservedBy:'Marko K.'});
  assert.equal(res.code,'INVALID_EQUIPMENT_ASSIGNMENT_CONTEXT');
  const item=WD.getEquipment().find(e=>e.equipmentId==='E-32C-B1');
  assert.equal(item.status,'Available','a rejected reservation must not touch the equipment record');
  assert.equal(item.assignedProject,null);
});

test('Pass 3.2C (15b): assignEquipment rejects an unknown project number with INVALID_EQUIPMENT_ASSIGNMENT_CONTEXT', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-B2',name:'Test Drill',category:'Power Tool'});
  const jc=mkJobcard(WD,'JC-32C-B2');
  const res=WD.assignEquipment('E-32C-B2',{project:'P-DOES-NOT-EXIST',jobcard:jc.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  assert.equal(res.code,'INVALID_EQUIPMENT_ASSIGNMENT_CONTEXT');
});

test('Pass 3.2C (16a): assignEquipment rejects an unknown Jobcard number with INVALID_EQUIPMENT_ASSIGNMENT_CONTEXT', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-B3',name:'Test Drill',category:'Power Tool'});
  const res=WD.assignEquipment('E-32C-B3',{project:'P-2026-014',jobcard:'JC-DOES-NOT-EXIST',worker:'Marko K.',assignedBy:'Aleksandar C.'});
  assert.equal(res.code,'INVALID_EQUIPMENT_ASSIGNMENT_CONTEXT');
});

test('Pass 3.2C (16b): reserveEquipment rejects a supplied Jobcard number that does not exist with INVALID_EQUIPMENT_ASSIGNMENT_CONTEXT', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-B4',name:'Test Drill',category:'Power Tool'});
  const res=WD.reserveEquipment('E-32C-B4',{project:'P-2026-014',jobcard:'JC-DOES-NOT-EXIST',reservedBy:'Marko K.'});
  assert.equal(res.code,'INVALID_EQUIPMENT_ASSIGNMENT_CONTEXT');
});

test('Pass 3.2C (17): assignEquipment rejects a Jobcard that does not belong to the supplied project', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-B5',name:'Test Drill',category:'Power Tool'});
  const otherProject=WD.upsertProject({name:'Other Project For Mismatch Test'});
  assert.ok(!otherProject.error);
  const jc=mkJobcard(WD,'JC-32C-B5');
  const res=WD.assignEquipment('E-32C-B5',{project:otherProject.no,jobcard:jc.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  assert.equal(res.code,'INVALID_EQUIPMENT_ASSIGNMENT_CONTEXT');
});

test('Pass 3.2C (18a): reserveEquipment rejects an archived project', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-B6',name:'Test Drill',category:'Power Tool'});
  const proj=WD.upsertProject({name:'Archived Project Test'});
  WD.archiveProject(proj.no,'test archive');
  const res=WD.reserveEquipment('E-32C-B6',{project:proj.no,reservedBy:'Marko K.'});
  assert.equal(res.code,'INVALID_EQUIPMENT_ASSIGNMENT_CONTEXT');
});

test('Pass 3.2C (18b): assignEquipment rejects an archived Jobcard', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-B7',name:'Test Drill',category:'Power Tool'});
  const jc=mkJobcard(WD,'JC-32C-B7');
  WD.archiveJobcard(jc.no);
  const res=WD.assignEquipment('E-32C-B7',{project:'P-2026-014',jobcard:jc.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  assert.equal(res.code,'INVALID_EQUIPMENT_ASSIGNMENT_CONTEXT');
});

test('Pass 3.2C (19): assignEquipment rejects a Jobcard whose status is completed or closed', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-B8',name:'Test Drill',category:'Power Tool'});
  ['completed','closed'].forEach((status,i)=>{
    const jc=WD.upsertJobcard({no:`JC-32C-B8-${i}`,projectNo:'P-2026-014',title:'Terminal fixture',status,machines:[],operations:[]});
    assert.ok(!jc.error,`fixture setup: creating a ${status} jobcard directly must succeed (no hold present)`);
    const res=WD.assignEquipment('E-32C-B8',{project:'P-2026-014',jobcard:jc.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
    assert.equal(res.code,'INVALID_EQUIPMENT_ASSIGNMENT_CONTEXT',`a ${status} jobcard must be rejected`);
  });
});

test('Pass 3.2C (20a): assignEquipment rejects case/whitespace variants of terminal Jobcard statuses (Completed, CLOSED, " completed ")', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-B9',name:'Test Drill',category:'Power Tool'});
  ['Completed','CLOSED',' completed ','  CLOSED  '].forEach((rawStatus,i)=>{
    const jc=WD.upsertJobcard({no:`JC-32C-B9-${i}`,projectNo:'P-2026-014',title:'Terminal casing fixture',status:rawStatus,machines:[],operations:[]});
    assert.ok(!jc.error,`fixture setup: creating a "${rawStatus}" jobcard directly must succeed — ${jc.error}`);
    const res=WD.assignEquipment('E-32C-B9',{project:'P-2026-014',jobcard:jc.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
    assert.equal(res.code,'INVALID_EQUIPMENT_ASSIGNMENT_CONTEXT',`status "${rawStatus}" must still be recognised as terminal`);
  });
});

test('Pass 3.2C (20b): reserveEquipment rejects case/whitespace variants of terminal Jobcard statuses, and "in-progress" is NOT treated as terminal', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-B10',name:'Test Drill',category:'Power Tool'});
  const jcClosed=WD.upsertJobcard({no:'JC-32C-B10-CLOSED',projectNo:'P-2026-014',title:'Closed casing',status:'CLOSED',machines:[],operations:[]});
  const blocked=WD.reserveEquipment('E-32C-B10',{project:'P-2026-014',jobcard:jcClosed.no,reservedBy:'Marko K.'});
  assert.equal(blocked.code,'INVALID_EQUIPMENT_ASSIGNMENT_CONTEXT');
  const jcInProgress=WD.upsertJobcard({no:'JC-32C-B10-INPROG',projectNo:'P-2026-014',title:'Active casing',status:'in-progress',machines:[],operations:[]});
  const allowed=WD.reserveEquipment('E-32C-B10',{project:'P-2026-014',jobcard:jcInProgress.no,reservedBy:'Marko K.'});
  assert.ok(!allowed.error,'an in-progress Jobcard must NOT be treated as terminal');
});

test('Pass 3.2C (21a): reserveEquipment rejects a missing or blank reservedBy with EQUIPMENT_ASSIGNMENT_DETAILS_REQUIRED', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-B11',name:'Test Drill',category:'Power Tool'});
  const missing=WD.reserveEquipment('E-32C-B11',{project:'P-2026-014'});
  assert.equal(missing.code,'EQUIPMENT_ASSIGNMENT_DETAILS_REQUIRED');
  const blank=WD.reserveEquipment('E-32C-B11',{project:'P-2026-014',reservedBy:'   '});
  assert.equal(blank.code,'EQUIPMENT_ASSIGNMENT_DETAILS_REQUIRED','whitespace-only reservedBy must also be rejected');
});

test('Pass 3.2C (22): assignEquipment rejects a missing worker or assignedBy with EQUIPMENT_ASSIGNMENT_DETAILS_REQUIRED', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-B12',name:'Test Drill',category:'Power Tool'});
  const jc=mkJobcard(WD,'JC-32C-B12');
  const noWorker=WD.assignEquipment('E-32C-B12',{project:'P-2026-014',jobcard:jc.no,assignedBy:'Aleksandar C.'});
  assert.equal(noWorker.code,'EQUIPMENT_ASSIGNMENT_DETAILS_REQUIRED');
  const noAssignedBy=WD.assignEquipment('E-32C-B12',{project:'P-2026-014',jobcard:jc.no,worker:'Marko K.'});
  assert.equal(noAssignedBy.code,'EQUIPMENT_ASSIGNMENT_DETAILS_REQUIRED');
});

test('Pass 3.2C (23): a valid project-only reservation (no Jobcard) succeeds', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-B13',name:'Test Drill',category:'Power Tool'});
  const res=WD.reserveEquipment('E-32C-B13',{project:'P-2026-014',reservedBy:'Marko K.'});
  assert.ok(!res.error);
  assert.equal(res.status,'Reserved');
  assert.equal(res.assignedProject,'P-2026-014');
  assert.equal(res.assignedJobcard,null);
});

test('Pass 3.2C (24): a valid reservation with a matching project and Jobcard succeeds', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-B14',name:'Test Drill',category:'Power Tool'});
  const jc=mkJobcard(WD,'JC-32C-B14');
  const res=WD.reserveEquipment('E-32C-B14',{project:'P-2026-014',jobcard:jc.no,reservedBy:'Marko K.'});
  assert.ok(!res.error);
  assert.equal(res.assignedJobcard,jc.no);
});

test('Pass 3.2C (25): a valid assignment with a real matching project, Jobcard, worker and assignedBy succeeds', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-B15',name:'Test Drill',category:'Power Tool'});
  const jc=mkJobcard(WD,'JC-32C-B15');
  const res=WD.assignEquipment('E-32C-B15',{project:'P-2026-014',jobcard:jc.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  assert.ok(!res.error);
  assert.equal(res.assignedJobcard,jc.no);
  assert.equal(res.operator,'Marko K.');
  assert.equal(res.currentAssignment.assignedBy,'Aleksandar C.');
  assert.equal(res.currentAssignment.project,'P-2026-014');
  assert.equal(res.currentAssignment.jobcard,jc.no);
});

test('Pass 3.2C (26a): assigning equipment via a numeric Jobcard id persists the CANONICAL Jobcard number, not the raw numeric id', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-B16',name:'Test Drill',category:'Power Tool'});
  const jc=mkJobcard(WD,'JC-32C-B16');
  const res=WD.assignEquipment('E-32C-B16',{project:'P-2026-014',jobcard:jc.id,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  assert.ok(!res.error,`assignment via a numeric Jobcard id must succeed and canonicalize — ${res.error}`);
  assert.equal(res.assignedJobcard,jc.no,'assignedJobcard must be the canonical JC-... string, never the raw numeric id');
  assert.equal(typeof res.assignedJobcard,'string');
  assert.equal(res.currentAssignment.jobcard,jc.no);
  const stored=WD.getEquipment().find(e=>e.equipmentId==='E-32C-B16');
  assert.equal(stored.assignedJobcard,jc.no);
});

test('Pass 3.2C (26b): reserving equipment via a numeric Jobcard id also persists the canonical Jobcard number', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-B17',name:'Test Drill',category:'Power Tool'});
  const jc=mkJobcard(WD,'JC-32C-B17');
  const res=WD.reserveEquipment('E-32C-B17',{project:'P-2026-014',jobcard:jc.id,reservedBy:'Marko K.'});
  assert.ok(!res.error);
  assert.equal(res.assignedJobcard,jc.no);
});

test('Pass 3.2C (27): a record assigned through a numeric Jobcard id continues working through canonical pre-use-check, canUseEquipment, startJobcardOperation and logEquipmentUsage', ()=>{
  const WD=loadWorkshopData();
  const jc=mkJobcard(WD,'JC-32C-B18');
  WD.createEquipment({equipmentId:'E-32C-B18',name:'Test Drill',category:'Power Tool'});
  const assigned=WD.assignEquipment('E-32C-B18',{project:'P-2026-014',jobcard:jc.id,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  assert.ok(!assigned.error);
  assert.equal(assigned.assignedJobcard,jc.no);
  const check=WD.recordEquipmentPreUseCheck('E-32C-B18',{checkedBy:'Marko K.',date:EQ_ASOF,result:'passed',checklist:'OK',projectNo:'P-2026-014',jobcardNo:jc.no});
  assert.ok(!check.error,`pre-use check against the canonical Jobcard number must succeed — ${check.error}`);
  const canUse=WD.canUseEquipment('E-32C-B18',{asOf:EQ_ASOF,date:EQ_ASOF,jobcardNo:jc.no,projectNo:'P-2026-014'});
  assert.equal(canUse.allowed,true,'canUseEquipment must recognise the canonical pre-use check');
  WD.updateJobcard(jc.id,{machines:[{equipmentId:'E-32C-B18',name:'Test Drill',plannedUsage:1}]});
  const op=mkOp(WD,jc.id,{equipmentId:'E-32C-B18',machine:'Test Drill'});
  const started=WD.startJobcardOperation(jc.id,op.id,{date:EQ_ASOF});
  assert.ok(!started.error,`startJobcardOperation must succeed against the canonical assignment — ${started.error}`);
  assert.equal(started.status,'in-progress');
  const usage=WD.logEquipmentUsage('E-32C-B18',{hours:2,date:EQ_ASOF,worker:'Marko K.',project:'P-2026-014',jobcard:jc.no});
  assert.ok(!usage.error,`logEquipmentUsage against the canonical Jobcard number must succeed — ${usage.error}`);
});

test('Pass 3.2C (28): the existing assignment-conflict protection is preserved — equipment already held by one Jobcard cannot be silently reassigned to another (including via a numeric-id request)', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-B19',name:'Test Drill',category:'Power Tool'});
  const jcA=mkJobcard(WD,'JC-32C-B19A');
  const jcB=mkJobcard(WD,'JC-32C-B19B');
  const first=WD.assignEquipment('E-32C-B19',{project:'P-2026-014',jobcard:jcA.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  assert.ok(!first.error);
  const conflict=WD.assignEquipment('E-32C-B19',{project:'P-2026-014',jobcard:jcB.id,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  assert.equal(conflict.code,'EQUIPMENT_ASSIGNMENT_CONFLICT','a numeric id resolving to a DIFFERENT Jobcard must still be caught as a conflict');
  const item=WD.getEquipment().find(e=>e.equipmentId==='E-32C-B19');
  assert.equal(item.assignedJobcard,jcA.no,'the original assignment must be untouched');
});

test('Pass 3.2C (29): reassigning equipment to the SAME Jobcard it is already held by remains idempotent', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-B20',name:'Test Drill',category:'Power Tool'});
  const jc=mkJobcard(WD,'JC-32C-B20');
  const first=WD.assignEquipment('E-32C-B20',{project:'P-2026-014',jobcard:jc.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  assert.ok(!first.error);
  const second=WD.assignEquipment('E-32C-B20',{project:'P-2026-014',jobcard:jc.no,worker:'Elena N.',assignedBy:'Aleksandar C.'});
  assert.ok(!second.error,'reassigning to the identical Jobcard must be idempotent, not a conflict');
  assert.equal(second.operator,'Elena N.');
});

test('Pass 3.2C (30): equipment blocked by the safety gate still cannot be reserved or assigned, even with a fully valid context', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-B21',name:'Test Drill',category:'Power Tool',status:'Out of Service'});
  const jc=mkJobcard(WD,'JC-32C-B21');
  const reserve=WD.reserveEquipment('E-32C-B21',{project:'P-2026-014',reservedBy:'Marko K.'});
  assert.equal(reserve.code,'EQUIPMENT_SAFETY_BLOCKED');
  const assign=WD.assignEquipment('E-32C-B21',{project:'P-2026-014',jobcard:jc.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  assert.equal(assign.code,'EQUIPMENT_SAFETY_BLOCKED');
});

test('Pass 3.2C (31): returnEquipment still clears the assignment and pauses any active operation using it', ()=>{
  const WD=loadWorkshopData();
  const {op}=mkStartedOpFixture(WD,'JC-32C-B22','E-32C-B22');
  const res=WD.returnEquipment('E-32C-B22',{user:'Aleksandar C.'});
  assert.ok(!res.error);
  assert.equal(res.assignedJobcard,null);
  assert.equal(res.status,'Available');
  assert.ok(Array.isArray(res.pausedOperations)&&res.pausedOperations.length===1);
  assert.equal(res.pausedOperations[0].operationId,op.id);
  const jc=WD.findJobcard('JC-32C-B22');
  assert.equal(jc.operations.find(o=>o.id===op.id).status,'paused');
});

test('Pass 3.2C (32): Quality Hold and all Pass 3.1/3.2A/3.2B protections remain fully intact under the new context validator', ()=>{
  const WD=loadWorkshopData();
  const jc=mkJobcard(WD,'JC-32C-B23');
  WD.createEquipment({equipmentId:'E-32C-B23',name:'Test Drill',category:'Power Tool'});
  WD.applyQualityHold({scope:'jobcard',reference:jc.no,reason:'Test hold'});
  // Equipment assignment is governed by the equipment safety gate + the new assignment-context
  // validator — never by Quality Hold, which continues to govern operation starts/completions only.
  const assign=WD.assignEquipment('E-32C-B23',{project:'P-2026-014',jobcard:jc.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  assert.ok(!assign.error,'equipment assignment must remain unaffected by a Jobcard-level Quality Hold');
  WD.updateJobcard(jc.id,{machines:[{equipmentId:'E-32C-B23',name:'Test Drill',plannedUsage:1}]});
  const op=mkOp(WD,jc.id,{equipmentId:'E-32C-B23',machine:'Test Drill'});
  WD.recordEquipmentPreUseCheck('E-32C-B23',{checkedBy:'Marko K.',date:EQ_ASOF,result:'passed',checklist:'OK',projectNo:'P-2026-014',jobcardNo:jc.no});
  const started=WD.startJobcardOperation(jc.id,op.id,{date:EQ_ASOF});
  assert.equal(started.code,'QUALITY_HOLD_ACTIVE','starting an operation on a Jobcard under an active Quality Hold must still be blocked — unaffected by Pass 3.2C');
});

test('Pass 3.2C (33a): reserveEquipment preserves the optional note in the reservation activity record', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-B24',name:'Test Drill',category:'Power Tool'});
  const res=WD.reserveEquipment('E-32C-B24',{project:'P-2026-014',reservedBy:'Marko K.',note:'Needed for the north wall job'});
  assert.ok(!res.error);
  assert.ok(res.activity[0].details.includes('Needed for the north wall job'),'the note must be preserved in the audit record');
});

test('Pass 3.2C (33b): reserveEquipment with a blank/omitted note does not add stray note text, and the note survives a save+reload round trip', ()=>{
  const {WD,localStorage}=loadWorkshopDataWithStorage();
  WD.createEquipment({equipmentId:'E-32C-B25',name:'Test Drill',category:'Power Tool'});
  const blank=WD.reserveEquipment('E-32C-B25',{project:'P-2026-014',reservedBy:'Marko K.'});
  assert.ok(!blank.error);
  assert.equal(blank.activity[0].details,'P-2026-014 / —','no note supplied must produce the plain project/jobcard details with no trailing dash or empty note marker');
  WD.createEquipment({equipmentId:'E-32C-B26',name:'Test Drill',category:'Power Tool'});
  WD.reserveEquipment('E-32C-B26',{project:'P-2026-014',reservedBy:'Marko K.',note:'Fragile — handle with care'});
  const reloaded=loadWorkshopData(undefined,localStorage);
  const item=reloaded.get().equipment.find(e=>e.equipmentId==='E-32C-B26');
  assert.ok(item.activity[0].details.includes('Fragile — handle with care'),'the note must survive a save + reload round trip');
});

// ── Part C/D: equipment-machines-desktop.html no longer contains the old demo bypass paths, and
//    its translation layer covers every new structured code in EN/SV/MK ─────────────────────────
const EQUIPMENT_PAGE_SOURCE=fs.readFileSync(path.join(__dirname,'..','equipment-machines-desktop.html'),'utf8');

test('Pass 3.2C (34): the Equipment page no longer sets equipment to Reserved via a direct changeEquipmentStatus() call', ()=>{
  const bypass=/changeEquipmentStatus\([^)]*['"]Reserved['"]\)/;
  assert.equal(bypass.test(EQUIPMENT_PAGE_SOURCE),false,'Reserve must go through reserveEquipment(), never a direct status change');
});

test('Pass 3.2C (35): the Equipment page no longer auto-selects the first project or Jobcard for assignment', ()=>{
  assert.equal(EQUIPMENT_PAGE_SOURCE.includes('getProjects()[0]'),false,'assignment must never auto-pick the first project');
  assert.equal(EQUIPMENT_PAGE_SOURCE.includes('getJobcards()[0]'),false,'assignment must never auto-pick the first Jobcard');
});

test('Pass 3.2C (36): CREATABLE_STATUSES excludes Reserved, In Use and Retired but keeps Available', ()=>{
  const match=/CREATABLE_STATUSES\s*=\s*(\[[^\]]*\])/.exec(EQUIPMENT_PAGE_SOURCE);
  assert.ok(match,'a dedicated restricted creatable-status list must exist');
  const list=JSON.parse(match[1].replace(/'/g,'"'));
  ['Reserved','In Use','Retired'].forEach(bad=>assert.equal(list.includes(bad),false,`${bad} must not be offered as a creatable status`));
  assert.ok(list.includes('Available'),'Available must remain creatable');
});

test('Pass 3.2C (37): every new blocker/API-error translation key is defined in all three languages (EN/SV/MK)', ()=>{
  const keys=['blockerStatusBlocked','blockerStatusUnknown','blockerRetired','blockerEquipmentNotFound',
    'blockerMaintenanceMissing','blockerInspectionMissing','blockerCertificationMissing','blockerCalibrationMissing',
    'blockerMaintenanceOverdue','blockerInspectionOverdue','blockerCertificationOverdue','blockerCalibrationOverdue',
    'blockerCriticalInspectionFailed','blockerCriticalInspectionUnresolved','blockerInspectionFailed','blockerBreakdownOpen',
    'blockerPreUseCheckFailed','blockerPreUseCheckRequiredMissing','errorEquipmentSafetyBlocked','errorAssignmentConflict',
    'errorProjectConflict',
    'errorCreationFieldsProtected','errorInitialStatusRequiresWorkflow','errorRetirementRequiresWorkflow',
    'errorInvalidStatusMalformed','errorInvalidStatusUnrecognised','errorInvalidEquipmentIdRequired','errorInvalidEquipmentIdMismatch',
    'ctxProjectRequired','ctxProjectNotFound','ctxProjectArchived','ctxJobcardNotFound','ctxJobcardArchived','ctxJobcardTerminal',
    'ctxJobcardMismatch','ctxJobcardRequiredForAssignment','detailsWorkerRequired','detailsAssignedByRequired','detailsReservedByRequired',
    'genericUnknownError'];
  keys.forEach((key)=>{
    const matches=EQUIPMENT_PAGE_SOURCE.match(new RegExp(`\\b${key}:`,'g'))||[];
    assert.ok(matches.length>=3,`translation key "${key}" must be defined in all three language blocks (found ${matches.length})`);
  });
  assert.ok(/function translateGateBlockerMessage/.test(EQUIPMENT_PAGE_SOURCE),'translateGateBlockerMessage() must exist');
  assert.ok(/function translateApiErrorMessage/.test(EQUIPMENT_PAGE_SOURCE),'translateApiErrorMessage() must exist');
});

test('Pass 3.2C (38): the SV/MK fallback path never renders a raw English known-code message — it renders the translated generic message instead', ()=>{
  // Simulate the page's own safeFallback()/translateApiErrorMessage() logic against the real
  // structured result codes, confirming the EN branch keeps the raw message (already English)
  // while SV/MK explicitly resolve to the translated generic-error key rather than leaking it.
  const svBlock=/sv:\s*\{([\s\S]*?)\n\s*\},\s*\n\s*mk:/.exec(EQUIPMENT_PAGE_SOURCE);
  const mkBlock=/mk:\s*\{([\s\S]*?)\n\s*\}\s*\n\s*\};/.exec(EQUIPMENT_PAGE_SOURCE);
  assert.ok(svBlock&&mkBlock,'sv/mk translation blocks must be present');
  assert.ok(/genericUnknownError:/.test(svBlock[1]),'sv must define genericUnknownError');
  assert.ok(/genericUnknownError:/.test(mkBlock[1]),'mk must define genericUnknownError');
  assert.ok(/state\.language === 'en' \? rawMessage : getLanguageText\('genericUnknownError'\)/.test(EQUIPMENT_PAGE_SOURCE),
    'the safe-fallback function must route non-English languages to the translated generic message, never the raw English string');
});

// ── Part E: independent-review fix regressions (5 adversarial gaps closed) ─────────────────────
// Gap 1: dual Equipment ID validation bypass — a malformed equipmentId/id must never be rescued by
// a valid value on the OTHER field, in either direction.
test('Pass 3.2C review fix (39): createEquipment rejects a malformed equipmentId even when a valid id is also supplied — neither field may rescue the other (null, number, boolean, blank string, array, object)', ()=>{
  const WD=loadWorkshopData();
  const before=WD.getEquipment().length;
  const beforeCounter=WD.get().counters.equipment;
  [null,123,true,false,'   ',[],{}].forEach((bad,i)=>{
    const res=WD.createEquipment({equipmentId:bad,id:`E-32C-F1-${i}`,name:'Test Drill',category:'Power Tool'});
    assert.equal(res.code,'INVALID_EQUIPMENT_ID',`malformed equipmentId ${JSON.stringify(bad)} with a valid id must still be rejected`);
    assert.equal(WD.getEquipment().find(e=>e.equipmentId===`E-32C-F1-${i}`),undefined,'a valid id must never rescue a malformed equipmentId');
  });
  assert.equal(WD.getEquipment().length,before,'no record may be created on rejection');
  assert.equal(WD.get().counters.equipment,beforeCounter,'the equipment counter must not increment on rejection');
});

test('Pass 3.2C review fix (40): createEquipment rejects a malformed id even when a valid equipmentId is also supplied — neither field may rescue the other (null, number, boolean, blank string, array, object)', ()=>{
  const WD=loadWorkshopData();
  const before=WD.getEquipment().length;
  const beforeCounter=WD.get().counters.equipment;
  [null,123,true,false,'   ',[],{}].forEach((bad,i)=>{
    const res=WD.createEquipment({equipmentId:`E-32C-F2-${i}`,id:bad,name:'Test Drill',category:'Power Tool'});
    assert.equal(res.code,'INVALID_EQUIPMENT_ID',`malformed id ${JSON.stringify(bad)} with a valid equipmentId must still be rejected`);
    assert.equal(WD.getEquipment().find(e=>e.equipmentId===`E-32C-F2-${i}`),undefined,'a valid equipmentId must never rescue a malformed id');
  });
  assert.equal(WD.getEquipment().length,before);
  assert.equal(WD.get().counters.equipment,beforeCounter);
});

// Gap 2: numeric Project ID canonicalization — project() must resolve by either project.id or
// project.no, exactly like jobcard() already resolves jobcard.id/jobcard.no, and the resolved
// canonical .no must be what gets stored and propagated everywhere.
test('Pass 3.2C review fix (41a): reserving equipment via a numeric Project id persists the CANONICAL project number, not the raw numeric id', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-F3',name:'Test Drill',category:'Power Tool'});
  const res=WD.reserveEquipment('E-32C-F3',{project:14,reservedBy:'Marko K.'});
  assert.ok(!res.error,`reservation via a numeric Project id must succeed and canonicalize — ${res.error}`);
  assert.equal(res.assignedProject,'P-2026-014','assignedProject must be the canonical P-... string, never the raw numeric id');
  assert.equal(typeof res.assignedProject,'string');
});

test('Pass 3.2C review fix (41b): assigning equipment via a numeric Project id (with a real Jobcard) persists the canonical project number in assignedProject and currentAssignment.project', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-F4',name:'Test Drill',category:'Power Tool'});
  const jc=mkJobcard(WD,'JC-32C-F4');
  const res=WD.assignEquipment('E-32C-F4',{project:14,jobcard:jc.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  assert.ok(!res.error,`assignment via a numeric Project id must succeed — ${res.error}`);
  assert.equal(res.assignedProject,'P-2026-014');
  assert.equal(res.currentAssignment.project,'P-2026-014');
});

test('Pass 3.2C review fix (42): assigning equipment via BOTH a numeric Project id AND a numeric Jobcard id together persists both canonical numbers', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-F5',name:'Test Drill',category:'Power Tool'});
  const jc=mkJobcard(WD,'JC-32C-F5');
  const res=WD.assignEquipment('E-32C-F5',{project:14,jobcard:jc.id,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  assert.ok(!res.error,`assignment via a numeric project id AND a numeric Jobcard id together must succeed — ${res.error}`);
  assert.equal(res.assignedProject,'P-2026-014');
  assert.equal(res.assignedJobcard,jc.no);
  assert.equal(res.currentAssignment.project,'P-2026-014');
  assert.equal(res.currentAssignment.jobcard,jc.no);
  const stored=WD.getEquipment().find(e=>e.equipmentId==='E-32C-F5');
  assert.equal(stored.assignedProject,'P-2026-014');
  assert.equal(stored.assignedJobcard,jc.no);
});

test('Pass 3.2C review fix (43): equipment assigned via BOTH a numeric Project id and a numeric Jobcard id continues working end-to-end through canonical pre-use-check, canUseEquipment, startJobcardOperation and logEquipmentUsage', ()=>{
  const WD=loadWorkshopData();
  const jc=mkJobcard(WD,'JC-32C-F6');
  WD.createEquipment({equipmentId:'E-32C-F6',name:'Test Drill',category:'Power Tool'});
  const assigned=WD.assignEquipment('E-32C-F6',{project:14,jobcard:jc.id,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  assert.ok(!assigned.error);
  assert.equal(assigned.assignedProject,'P-2026-014');
  assert.equal(assigned.assignedJobcard,jc.no);
  const check=WD.recordEquipmentPreUseCheck('E-32C-F6',{checkedBy:'Marko K.',date:EQ_ASOF,result:'passed',checklist:'OK',projectNo:'P-2026-014',jobcardNo:jc.no});
  assert.ok(!check.error,`pre-use check against the canonical numbers must succeed — ${check.error}`);
  const canUse=WD.canUseEquipment('E-32C-F6',{asOf:EQ_ASOF,date:EQ_ASOF,jobcardNo:jc.no,projectNo:'P-2026-014'});
  assert.equal(canUse.allowed,true,'canUseEquipment must recognise the canonical pre-use check');
  WD.updateJobcard(jc.id,{machines:[{equipmentId:'E-32C-F6',name:'Test Drill',plannedUsage:1}]});
  const op=mkOp(WD,jc.id,{equipmentId:'E-32C-F6',machine:'Test Drill'});
  const started=WD.startJobcardOperation(jc.id,op.id,{date:EQ_ASOF});
  assert.ok(!started.error,`startJobcardOperation must succeed against the canonical assignment — ${started.error}`);
  assert.equal(started.status,'in-progress');
  const usage=WD.logEquipmentUsage('E-32C-F6',{hours:2,date:EQ_ASOF,worker:'Marko K.',project:'P-2026-014',jobcard:jc.no});
  assert.ok(!usage.error,`logEquipmentUsage against the canonical numbers must succeed — ${usage.error}`);
});

// Gap 3: cross-project reservation theft — a project-only reservation (assignedProject set,
// assignedJobcard still null) must block a DIFFERENT project from silently taking the equipment
// through reserveEquipment() or assignEquipment(), not just a different Jobcard within the SAME
// project (which the pre-existing assignedJobcard conflict check already covered).
test('Pass 3.2C review fix (44a): a project-only reservation blocks a DIFFERENT project from reserving the same equipment (project A -> project B rejected)', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-F7',name:'Test Drill',category:'Power Tool'});
  const projA=WD.upsertProject({name:'Cross-Project Theft Test A'});
  const projB=WD.upsertProject({name:'Cross-Project Theft Test B'});
  const first=WD.reserveEquipment('E-32C-F7',{project:projA.no,reservedBy:'Marko K.'});
  assert.ok(!first.error);
  assert.equal(first.assignedProject,projA.no);
  assert.equal(first.assignedJobcard,null,'a project-only reservation must leave assignedJobcard null');
  const stolen=WD.reserveEquipment('E-32C-F7',{project:projB.no,reservedBy:'Elena N.'});
  assert.equal(stolen.code,'EQUIPMENT_PROJECT_CONFLICT','a different project must never be able to silently steal a project-only reservation');
  assert.equal(stolen.assignedProject,projA.no);
  assert.equal(stolen.requestedProject,projB.no);
  const item=WD.getEquipment().find(e=>e.equipmentId==='E-32C-F7');
  assert.equal(item.assignedProject,projA.no,'the original reservation must be completely unchanged');
  assert.equal(item.status,'Reserved');
});

test('Pass 3.2C review fix (44b): a project-only reservation blocks a DIFFERENT project from assigning the same equipment to one of its own Jobcards (project A -> project B assignment rejected)', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-F8',name:'Test Drill',category:'Power Tool'});
  const projA=WD.upsertProject({name:'Cross-Project Theft Test C'});
  const projB=WD.upsertProject({name:'Cross-Project Theft Test D'});
  const jcB=WD.upsertJobcard({no:'JC-32C-F8B',projectNo:projB.no,title:'Project B fixture',status:'draft',machines:[],operations:[]});
  const first=WD.reserveEquipment('E-32C-F8',{project:projA.no,reservedBy:'Marko K.'});
  assert.ok(!first.error);
  const stolen=WD.assignEquipment('E-32C-F8',{project:projB.no,jobcard:jcB.no,worker:'Elena N.',assignedBy:'Aleksandar C.'});
  assert.equal(stolen.code,'EQUIPMENT_PROJECT_CONFLICT','assignment to a different project must be rejected exactly like reservation');
  assert.equal(stolen.assignedProject,projA.no);
  assert.equal(stolen.requestedProject,projB.no);
  const item=WD.getEquipment().find(e=>e.equipmentId==='E-32C-F8');
  assert.equal(item.assignedProject,projA.no);
  assert.equal(item.assignedJobcard,null,'the rejected cross-project assignment must not touch assignedJobcard either');
});

test('Pass 3.2C review fix (44c): assigning a project-only reservation to a Jobcard belonging to the SAME project remains allowed', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-F9',name:'Test Drill',category:'Power Tool'});
  const projA=WD.upsertProject({name:'Cross-Project Theft Test E'});
  const jcA=WD.upsertJobcard({no:'JC-32C-F9A',projectNo:projA.no,title:'Project A fixture',status:'draft',machines:[],operations:[]});
  const first=WD.reserveEquipment('E-32C-F9',{project:projA.no,reservedBy:'Marko K.'});
  assert.ok(!first.error);
  const assigned=WD.assignEquipment('E-32C-F9',{project:projA.no,jobcard:jcA.no,worker:'Elena N.',assignedBy:'Aleksandar C.'});
  assert.ok(!assigned.error,`assigning a same-project reservation to one of its own Jobcards must remain allowed — ${assigned.error}`);
  assert.equal(assigned.assignedProject,projA.no);
  assert.equal(assigned.assignedJobcard,jcA.no);
});

test('Pass 3.2C review fix (44d): returnEquipment() first allows a DIFFERENT project to reserve/assign the equipment afterward', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-F10',name:'Test Drill',category:'Power Tool'});
  const projA=WD.upsertProject({name:'Cross-Project Theft Test F'});
  const projB=WD.upsertProject({name:'Cross-Project Theft Test G'});
  const jcB=WD.upsertJobcard({no:'JC-32C-F10B',projectNo:projB.no,title:'Project B fixture',status:'draft',machines:[],operations:[]});
  const first=WD.reserveEquipment('E-32C-F10',{project:projA.no,reservedBy:'Marko K.'});
  assert.ok(!first.error);
  const returned=WD.returnEquipment('E-32C-F10',{user:'Aleksandar C.'});
  assert.ok(!returned.error);
  assert.equal(returned.assignedProject,null);
  const assignedToB=WD.assignEquipment('E-32C-F10',{project:projB.no,jobcard:jcB.no,worker:'Elena N.',assignedBy:'Aleksandar C.'});
  assert.ok(!assignedToB.error,`after returnEquipment(), a different project must be able to assign the equipment — ${assignedToB.error}`);
  assert.equal(assignedToB.assignedProject,projB.no);
  assert.equal(assignedToB.assignedJobcard,jcB.no);
});

test('Pass 3.2C review fix (44e): a rejected cross-project reservation attempt is fully atomic — the whole equipment record is byte-for-byte unchanged', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-F11',name:'Test Drill',category:'Power Tool'});
  const projA=WD.upsertProject({name:'Cross-Project Theft Test H'});
  const projB=WD.upsertProject({name:'Cross-Project Theft Test I'});
  const first=WD.reserveEquipment('E-32C-F11',{project:projA.no,reservedBy:'Marko K.'});
  assert.ok(!first.error);
  const before=WD.getEquipment().find(e=>e.equipmentId==='E-32C-F11');
  const stolen=WD.reserveEquipment('E-32C-F11',{project:projB.no,reservedBy:'Elena N.',note:'attempted theft'});
  assert.equal(stolen.code,'EQUIPMENT_PROJECT_CONFLICT');
  const after=WD.getEquipment().find(e=>e.equipmentId==='E-32C-F11');
  assert.deepEqual(after,before,'the entire equipment record must be unchanged after a rejected cross-project attempt');
});

// Gap 4: authority field type validation — reservedBy/worker/assignedBy must be genuine non-empty
// strings; String(value).trim() previously stringified objects/arrays into stored text.
test('Pass 3.2C review fix (45a): reserveEquipment rejects a non-string reservedBy (number, boolean, object, array, null, missing) with EQUIPMENT_ASSIGNMENT_DETAILS_REQUIRED, never stringifying it', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-F12',name:'Test Drill',category:'Power Tool'});
  [123,true,false,{},[],null,undefined].forEach((bad)=>{
    const payload={project:'P-2026-014'};
    if(bad!==undefined)payload.reservedBy=bad;
    const res=WD.reserveEquipment('E-32C-F12',payload);
    assert.equal(res.code,'EQUIPMENT_ASSIGNMENT_DETAILS_REQUIRED',`reservedBy ${JSON.stringify(bad)} must be rejected`);
    assert.equal(res.reason,'RESERVED_BY_REQUIRED');
  });
  const item=WD.getEquipment().find(e=>e.equipmentId==='E-32C-F12');
  assert.equal(item.status,'Available','no rejected reservation attempt may touch the equipment record');
  assert.equal(item.assignedProject,null);
});

test('Pass 3.2C review fix (45b): assignEquipment rejects a non-string worker or assignedBy (number, boolean, object, array, null), never stringifying them into stored text like "[object Object]"', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-F13',name:'Test Drill',category:'Power Tool'});
  const jc=mkJobcard(WD,'JC-32C-F13');
  [123,true,{},[],null].forEach((bad)=>{
    const res=WD.assignEquipment('E-32C-F13',{project:'P-2026-014',jobcard:jc.no,worker:bad,assignedBy:'Aleksandar C.'});
    assert.equal(res.code,'EQUIPMENT_ASSIGNMENT_DETAILS_REQUIRED',`worker ${JSON.stringify(bad)} must be rejected`);
    assert.equal(res.reason,'WORKER_REQUIRED');
  });
  [123,true,{},[],null].forEach((bad)=>{
    const res=WD.assignEquipment('E-32C-F13',{project:'P-2026-014',jobcard:jc.no,worker:'Marko K.',assignedBy:bad});
    assert.equal(res.code,'EQUIPMENT_ASSIGNMENT_DETAILS_REQUIRED',`assignedBy ${JSON.stringify(bad)} must be rejected`);
    assert.equal(res.reason,'ASSIGNED_BY_REQUIRED');
  });
  const item=WD.getEquipment().find(e=>e.equipmentId==='E-32C-F13');
  assert.equal(item.assignedJobcard,null,'no rejected assignment attempt may touch the equipment record');
  assert.equal(item.operator,null);
});

test('Pass 3.2C review fix (45c): a genuine, valid string worker/assignedBy/reservedBy still succeeds exactly as before', ()=>{
  const WD=loadWorkshopData();
  WD.createEquipment({equipmentId:'E-32C-F14',name:'Test Drill',category:'Power Tool'});
  const jc=mkJobcard(WD,'JC-32C-F14');
  const res=WD.assignEquipment('E-32C-F14',{project:'P-2026-014',jobcard:jc.no,worker:'Marko K.',assignedBy:'Aleksandar C.'});
  assert.ok(!res.error);
  assert.equal(res.operator,'Marko K.');
  assert.equal(res.currentAssignment.assignedBy,'Aleksandar C.');
  const reserveRes=WD.reserveEquipment('E-32C-F14',{project:'P-2026-014',jobcard:jc.no,reservedBy:'Sven O.'});
  assert.ok(!reserveRes.error);
});

// Gap 5: legacy whitespace duplicate bypass — the NEW id is trimmed before comparison, but an
// EXISTING legacy record's own equipmentId/id must also be normalized before comparison, without
// mutating that legacy record merely to check it.
function legacyEquipmentFixture(overrides){
  return Object.assign({name:'Legacy Drill',category:'Power Tool',status:'Available',
    assignedProject:null,assignedJobcard:null,operator:null,activity:[],inspections:[],maintenance:[],
    certifications:[],calibrations:[],notesLog:[],usageHistory:[],downtimeRecords:[],preUseChecks:[],
    returnToService:[],currentAssignment:null,usageSessions:[],isRetired:false,retirementReason:'',
    safetyWarnings:[],creationDate:'2026-01-01',lastActivity:'2026-01-01T00:00:00.000Z'},overrides);
}

test('Pass 3.2C review fix (46a): duplicate detection catches a legacy record whose existing equipmentId itself was stored WITH padding', ()=>{
  const legacyState=minimalState({version:5,equipment:[
    legacyEquipmentFixture({id:'E-32C-DUP-A',equipmentId:'  E-32C-DUP-A  '})
  ]});
  const WD=loadWorkshopData({[V5_KEY]:JSON.stringify(legacyState)});
  const legacyBefore=WD.getEquipment().find(e=>e.id==='E-32C-DUP-A');
  const beforeLength=WD.getEquipment().length;
  const beforeCounter=WD.get().counters.equipment;
  const res=WD.createEquipment({equipmentId:'E-32C-DUP-A',name:'New Drill',category:'Power Tool'});
  assert.equal(res.error,'Duplicate equipment ID','a trimmed new ID matching a padded existing equipmentId must be rejected as a duplicate');
  assert.equal(WD.getEquipment().length,beforeLength,'no new record may be created on rejection');
  assert.equal(WD.get().counters.equipment,beforeCounter,'the equipment counter must not increment on rejection');
  const legacyAfter=WD.getEquipment().find(e=>e.id==='E-32C-DUP-A');
  assert.deepEqual(legacyAfter,legacyBefore,'the existing legacy record must never be mutated merely to perform duplicate detection');
});

test('Pass 3.2C review fix (46b): duplicate detection catches a legacy record whose existing id was stored WITH padding (and equipmentId was backfilled from it, untrimmed, by normalize())', ()=>{
  const legacyState=minimalState({version:5,equipment:[
    legacyEquipmentFixture({id:'  E-32C-DUP-B  '})
  ]});
  const WD=loadWorkshopData({[V5_KEY]:JSON.stringify(legacyState)});
  const legacyBefore=WD.getEquipment()[0];
  assert.equal(legacyBefore.equipmentId,'  E-32C-DUP-B  ','fixture sanity check: normalize() backfills equipmentId from id verbatim, without trimming');
  const beforeLength=WD.getEquipment().length;
  const beforeCounter=WD.get().counters.equipment;
  const res=WD.createEquipment({equipmentId:'E-32C-DUP-B',name:'New Drill',category:'Power Tool'});
  assert.equal(res.error,'Duplicate equipment ID','a trimmed new ID matching a padded existing id must be rejected as a duplicate');
  assert.equal(WD.getEquipment().length,beforeLength);
  assert.equal(WD.get().counters.equipment,beforeCounter);
});

test('Pass 3.2C review fix (46c): duplicate detection catches a legacy record with MIXED padding — equipmentId and id padded differently from each other', ()=>{
  const legacyState=minimalState({version:5,equipment:[
    legacyEquipmentFixture({id:'E-32C-DUP-C  ',equipmentId:'  E-32C-DUP-C'})
  ]});
  const WD=loadWorkshopData({[V5_KEY]:JSON.stringify(legacyState)});
  const beforeLength=WD.getEquipment().length;
  const beforeCounter=WD.get().counters.equipment;
  const res=WD.createEquipment({equipmentId:'E-32C-DUP-C',name:'New Drill',category:'Power Tool'});
  assert.equal(res.error,'Duplicate equipment ID');
  assert.equal(WD.getEquipment().length,beforeLength);
  assert.equal(WD.get().counters.equipment,beforeCounter);
});

// ── Cross-tab reactivity: the native 'storage' event (fires on every OTHER same-origin tab when
// localStorage changes, never on the tab that made the change) reloads state and re-dispatches
// 'workshop:data' so an already-listening page picks up a write made in a different tab. ──────────

test('cross-tab reload: a real browser save() on the SAME instance still dispatches workshop:data (regression - previously untestable, dispatchEvent was a no-op stub)', ()=>{
  const {WD,window}=loadWorkshopDataWithEnv({[V5_KEY]:JSON.stringify(minimalState({version:5}))});
  const seen=[];
  window.addEventListener('workshop:data',e=>seen.push(e.detail&&e.detail.reason));
  WD.upsertCustomer({name:'Local Save Co'});
  assert.equal(seen.length,1,'exactly one workshop:data dispatch for one local save');
  assert.equal(seen[0],'Customer updated: Local Save Co');
});

test('cross-tab reload: a storage event for the SAME key reloads state from the fresh localStorage value', ()=>{
  const {WD,localStorage,window}=loadWorkshopDataWithEnv({[V5_KEY]:JSON.stringify(minimalState({version:5,customers:[{id:1,no:'C-001',name:'Alpha Co'}]}))});
  assert.equal(WD.get().customers[0].name,'Alpha Co','fixture sanity check');
  // Simulate a DIFFERENT tab writing directly to the shared localStorage (bypassing this
  // instance's own save()) and the browser firing the resulting native storage event.
  const otherTabState=minimalState({version:5,customers:[{id:2,no:'C-002',name:'Beta Co'}]});
  localStorage.setItem(V5_KEY,JSON.stringify(otherTabState));
  window.dispatchEvent({type:'storage',key:V5_KEY,newValue:JSON.stringify(otherTabState)});
  assert.equal(WD.get().customers.length,1);
  assert.equal(WD.get().customers[0].name,'Beta Co','state must reflect the OTHER tab\'s write, not what this instance last saw');
});

test('cross-tab reload: a storage event for the SAME key re-dispatches workshop:data so an already-listening page updates too', ()=>{
  const {localStorage,window}=loadWorkshopDataWithEnv({[V5_KEY]:JSON.stringify(minimalState({version:5}))});
  const seen=[];
  window.addEventListener('workshop:data',e=>seen.push(e.detail&&e.detail.reason));
  const otherTabState=minimalState({version:5,customers:[{id:2,no:'C-002',name:'Beta Co'}]});
  localStorage.setItem(V5_KEY,JSON.stringify(otherTabState));
  window.dispatchEvent({type:'storage',key:V5_KEY,newValue:JSON.stringify(otherTabState)});
  assert.equal(seen.length,1);
  assert.equal(seen[0],'Updated in another tab');
});

test('cross-tab reload: a storage event for an UNRELATED key is ignored (no reload, no re-dispatch)', ()=>{
  const {WD,localStorage,window}=loadWorkshopDataWithEnv({[V5_KEY]:JSON.stringify(minimalState({version:5,customers:[{id:1,no:'C-001',name:'Alpha Co'}]}))});
  const seen=[];
  window.addEventListener('workshop:data',e=>seen.push(e));
  localStorage.setItem('some.other.app.key','{"unrelated":true}');
  window.dispatchEvent({type:'storage',key:'some.other.app.key',newValue:'{"unrelated":true}'});
  assert.equal(WD.get().customers[0].name,'Alpha Co','must not reload for a key this module does not own');
  assert.equal(seen.length,0,'must not re-dispatch workshop:data for an unrelated key');
});

test('cross-tab reload: a storage event with key:null (matches the browser\'s localStorage.clear() shape) still reloads', ()=>{
  const {WD,localStorage,window}=loadWorkshopDataWithEnv({[V5_KEY]:JSON.stringify(minimalState({version:5,customers:[{id:1,no:'C-001',name:'Alpha Co'}]}))});
  const otherTabState=minimalState({version:5,customers:[{id:2,no:'C-002',name:'Beta Co'}]});
  localStorage.setItem(V5_KEY,JSON.stringify(otherTabState));
  window.dispatchEvent({type:'storage',key:null,newValue:null});
  assert.equal(WD.get().customers[0].name,'Beta Co');
});

test('cross-tab reload: the Node test harness\'s window stub omitting addEventListener does not crash module load (mirrors the guard workshop-data.js uses)', ()=>{
  // loadWorkshopData()'s plain buildEnv() (used by every other test in this file) does define
  // addEventListener now, so this specifically re-checks the guard itself never assumes it exists.
  assert.doesNotThrow(()=>{
    const g={};g.window=g;g.localStorage=new MemoryLocalStorage();g.dispatchEvent=()=>{};
    g.CustomEvent=function(type,init){this.type=type;this.detail=init&&init.detail;};
    g.QualityGates=require('../quality-gates.js');g.EquipmentGates=require('../equipment-gates.js');g.JobcardEquipmentRules=require('../jobcard-equipment-rules.js');
    const src=fs.readFileSync(path.join(__dirname,'..','workshop-data.js'),'utf8');
    new Function('window',src+'\nreturn window.WorkshopData;')(g);
  });
});

// ── Pass 3.34: real document content/folders and invoices ─────────────────────────────────────
test('document content: a small data URL persists with its metadata and survives reload', ()=>{
  const {WD,localStorage}=loadWorkshopDataWithStorage();
  const fileData='data:text/plain;base64,SGVsbG8gVmFybWFr';
  const saved=WD.upsertDocument({name:'hello.txt',type:'Document',module:'Customers',record:'MarineVent AB',fileName:'hello.txt',mimeType:'text/plain',fileSize:12,fileData});
  assert.equal(saved.fileData,fileData);
  assert.equal(WD.findDocument(saved.id).mimeType,'text/plain');
  const reloaded=loadWorkshopData(null,localStorage);
  assert.equal(reloaded.findDocument(saved.id).fileData,fileData);
  const removed=reloaded.removeDocumentContent(saved.id);
  assert.equal(removed.fileData,'');
  assert.equal(removed.fileSize,0);
  assert.ok(reloaded.getDocuments().some(d=>d.id===saved.id),'removing content must preserve document metadata');
});

test('document content: invalid and oversized content is rejected atomically', ()=>{
  const WD=loadWorkshopData();
  const before=WD.getDocuments().length;
  const invalid=WD.upsertDocument({name:'bad.bin',fileData:'not-a-data-url',fileSize:10});
  assert.ok(invalid.error);
  const oversized=WD.upsertDocument({name:'large.bin',fileData:'data:application/octet-stream;base64,AA==',fileSize:WD.maxDocumentFileBytes+1});
  assert.ok(oversized.error);
  assert.equal(WD.getDocuments().length,before);
});

test('document content: cumulative browser-storage budget rejects a write before localStorage quota is endangered', ()=>{
  const WD=loadWorkshopData();
  const size=700*1024,data='data:application/octet-stream;base64,'+'A'.repeat(Math.ceil(size*4/3));
  assert.equal(WD.upsertDocument({name:'one.bin',fileData:data,fileSize:size}).error,undefined);
  assert.equal(WD.upsertDocument({name:'two.bin',fileData:data,fileSize:size}).error,undefined);
  const before=WD.getDocuments().length;
  const third=WD.upsertDocument({name:'three.bin',fileData:data,fileSize:size});
  assert.match(third.error,/storage is full/i);
  assert.equal(WD.getDocuments().length,before);
});

test('document folders: create is persistent, duplicate scope is idempotent, and archive is non-destructive', ()=>{
  const WD=loadWorkshopData();
  const first=WD.upsertDocumentFolder({name:'Contracts',module:'Customers',record:'MarineVent AB'});
  const second=WD.upsertDocumentFolder({name:'contracts',module:'Customers',record:'MarineVent AB'});
  assert.equal(first.id,second.id);
  assert.equal(WD.getDocumentFolders().filter(f=>f.id===first.id).length,1);
  const archived=WD.archiveDocumentFolder(first.id);
  assert.equal(archived.archived,true);
  assert.ok(WD.getDocumentFolders().some(f=>f.id===first.id));
});

test('invoices: create/update/archive uses a real customer-linked shared record', ()=>{
  const WD=loadWorkshopData();
  const customer=WD.getCustomers()[0];
  const invoice=WD.upsertInvoice({customerId:customer.id,value:12500,status:'pending',reference:'P-2026-014'});
  assert.match(invoice.no,/^INV-\d{4}-\d{4}$/);
  assert.equal(invoice.customer,customer.name);
  assert.equal(WD.listInvoices().filter(i=>i.id===invoice.id).length,1);
  const paid=WD.updateInvoice(invoice.id,{status:'paid'});
  assert.equal(paid.status,'paid');
  assert.equal(WD.findInvoice(invoice.no).status,'paid');
  assert.equal(WD.archiveInvoice(invoice.id).archived,true);
  assert.ok(WD.listInvoices().some(i=>i.id===invoice.id));
});

test('invoices: invalid customer, non-positive value, and invalid status are rejected without writes', ()=>{
  const WD=loadWorkshopData();
  const before=WD.listInvoices().length;
  assert.ok(WD.upsertInvoice({customer:'Missing Co',value:10}).error);
  assert.ok(WD.upsertInvoice({customerId:WD.getCustomers()[0].id,value:0}).error);
  assert.ok(WD.upsertInvoice({customerId:WD.getCustomers()[0].id,value:10,status:'invented'}).error);
  assert.equal(WD.listInvoices().length,before);
});

test('backup validation and old-state normalization include documentFolders and invoices', ()=>{
  const WD=loadWorkshopData({[V5_KEY]:JSON.stringify(minimalState({version:5}))});
  assert.deepEqual(WD.getDocumentFolders(),[]);
  assert.deepEqual(WD.listInvoices(),[]);
  assert.equal(WD.validateBackup({documentFolders:'bad'}).valid,false);
  assert.equal(WD.validateBackup({invoices:'bad'}).valid,false);
});

// ── Pass 3.35: real Store item creation ─────────────────────────────────────────────
test('inventory: create item persists a normalized, immediately usable Store record', ()=>{
  const {WD,localStorage}=loadWorkshopDataWithStorage();
  const created=WD.createInventoryItem({code:' test-item-01 ',description:'Test plate',category:'Plate',unit:'ea',location:'Z1-01',stock:12,reserved:2,minStock:4,reorderQty:10,avgCost:25,lastPrice:27,supplier:'Test Supplier'});
  assert.equal(created.code,'TEST-ITEM-01');
  assert.equal(created.unit,'EA');
  assert.equal(created.status,'good');
  assert.equal(WD.get().inventory.find(x=>x.code==='TEST-ITEM-01').stock,12);
  const reloaded=loadWorkshopData(null,localStorage);
  assert.equal(reloaded.get().inventory.find(x=>x.code==='TEST-ITEM-01').location,'Z1-01');
});

test('inventory: duplicate, incomplete, invalid and over-reserved items are rejected atomically', ()=>{
  const WD=loadWorkshopData();
  const before=WD.get().inventory.length;
  assert.ok(WD.createInventoryItem({code:'SS-SHT-304-2.0',description:'Duplicate',category:'Plate',unit:'EA',location:'A1'}).error);
  assert.ok(WD.createInventoryItem({code:'NEW-1',category:'Plate',unit:'EA',location:'A1'}).error);
  assert.ok(WD.createInventoryItem({code:'NEW ITEM',description:'Bad code',category:'Plate',unit:'EA',location:'A1'}).error);
  assert.ok(WD.createInventoryItem({code:'NEW-2',description:'Over reserved',category:'Plate',unit:'EA',location:'A1',stock:1,reserved:2}).error);
  assert.equal(WD.get().inventory.length,before);
});

// ── Pass 3.36: Purchasing RFQs and supplier invoices ───────────────────────────────
test('purchasing: RFQ create/update/archive persists a real shared workflow record', ()=>{
  const {WD,localStorage}=loadWorkshopDataWithStorage();
  const rfq=WD.upsertPurchaseRfq({supplier:'SteelSupply AB',project:'P-2026-014',items:'8 sheets AISI 304',dueDate:'2026-09-10',status:'Sent'});
  assert.match(rfq.no,/^RFQ-\d{4}-\d{4}$/);assert.equal(rfq.status,'Sent');
  assert.equal(WD.updatePurchaseRfq(rfq.no,{status:'Replied'}).status,'Replied');
  assert.equal(loadWorkshopData(null,localStorage).findPurchaseRfq(rfq.no).supplier,'SteelSupply AB');
  assert.equal(WD.archivePurchaseRfq(rfq.id).archived,true);
});

test('purchasing: supplier invoice is positive, status-validated and linked only to a real PO', ()=>{
  const WD=loadWorkshopData(),po=WD.getPurchaseOrders()[0],before=WD.listSupplierInvoices().length;
  const invoice=WD.upsertSupplierInvoice({supplier:po.supplier,poNo:po.no,supplierReference:'EXT-991',amount:4500,status:'pending'});
  assert.match(invoice.no,/^SINV-\d{4}-\d{4}$/);assert.equal(invoice.poNo,po.no);
  assert.equal(WD.updateSupplierInvoice(invoice.id,{status:'approved'}).status,'approved');
  assert.ok(WD.upsertSupplierInvoice({supplier:'X',poNo:'PO-MISSING',amount:1}).error);
  assert.ok(WD.upsertSupplierInvoice({supplier:'X',amount:0}).error);
  assert.ok(WD.upsertSupplierInvoice({supplier:'X',amount:1,status:'invented'}).error);
  assert.equal(WD.listSupplierInvoices().length,before+1);
  assert.equal(WD.archiveSupplierInvoice(invoice.no).archived,true);
});

test('backup validation and normalization include purchase RFQs and supplier invoices', ()=>{
  const WD=loadWorkshopData({[V5_KEY]:JSON.stringify(minimalState({version:5}))});
  assert.deepEqual(WD.getPurchaseRfqs(),[]);assert.deepEqual(WD.listSupplierInvoices(),[]);
  assert.equal(WD.validateBackup({purchaseRfqs:'bad'}).valid,false);
  assert.equal(WD.validateBackup({supplierInvoices:'bad'}).valid,false);
});
