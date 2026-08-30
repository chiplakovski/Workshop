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

// ── Pass 3.2A: central Equipment safety gate (equipment-gates.js + WorkshopData enforcement) ──
// Seed fixture used throughout: E-1001 (Available, Welding Machine, no `requirements` object, all
// history arrays empty) is the healthy control; other seed statuses (E-1002 In Use, E-1003
// Maintenance Due, E-1004 Under Maintenance, E-1006 Out of Service, E-1008 Inspection Required,
// E-1010 Quarantined) already exercise the full hard-block status set without extra setup.
const EQ_ASOF='2026-08-30';

test('equipment gate: available equipment with no blocker can be reserved and then assigned', ()=>{
  const WD=loadWorkshopData();
  const reserved=WD.reserveEquipment('E-1001',{project:'P-1',jobcard:'JC-1',reservedBy:'Marko K.'});
  assert.ok(!reserved.error);
  assert.equal(reserved.status,'Reserved');
  const assigned=WD.assignEquipment('E-1001',{project:'P-1',jobcard:'JC-1',worker:'Marko K.'});
  assert.ok(!assigned.error);
  assert.equal(assigned.assignedProject,'P-1');
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
  const res=WD.assignEquipment('E-1001',{project:'P-1',status:'Available'});
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
  ['in-progress','completed','skipped'].forEach((status,idx)=>{
    const res=WD.upsertJobcard({no:`JC-TEST-C${idx}`,projectNo:'P-26-0002',title:'Bypass attempt',status:'draft',
      operations:[{id:1,desc:'Pre-seeded op',status}]});
    assert.equal(res.code,'QUALITY_HOLD_ACTIVE',`a pre-populated operation status of "${status}" must be blocked`);
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
test('bypass fix D: updateJobcard({operations}) cannot change an operation from pending to an unsafe status while held', ()=>{
  const WD=loadWorkshopData();
  const j=WD.findJobcard('JC-2026-0001');
  const ops=j.operations.map(o=>o.id===5?Object.assign({},o,{status:'in-progress'}):o);
  const res=WD.updateJobcard('JC-2026-0001',{operations:ops});
  assert.equal(res.code,'QUALITY_HOLD_ACTIVE');
  assert.ok(res.holdNumbers.includes('HOLD-2026-001'));
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
