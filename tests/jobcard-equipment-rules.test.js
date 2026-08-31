// Pure-helper tests for jobcard-equipment-rules.js — the exact module jobcard-desktop.html loads,
// so these tests exercise the real logic the page runs, not a reimplementation of it. Actual safety
// enforcement is never re-derived here — these functions only resolve references and compose small
// UI-facing decisions around a real WorkshopData gate result (see tests/workshop-data.test.js for
// the authoritative safety-gate tests).
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  resolveMachineLink,isDuplicateEquipmentLink,isAssignedElsewhere,canAddEquipmentToJobcard,
  resolveOperationEquipment,canStartOperationEquipment,canReturnEquipmentFromJobcard,equipmentUsageForJobcard,
  resolveLogTimeEquipment
}=require('../jobcard-equipment-rules.js');

function eq(overrides){return Object.assign({equipmentId:'E-1',name:'Welder',status:'Available'},overrides);}

// ── resolveMachineLink ──
test('resolveMachineLink: an equipmentId link resolves directly to the matching real record', ()=>{
  const list=[eq({equipmentId:'E-1',name:'Welder'}),eq({equipmentId:'E-2',name:'Grinder'})];
  const res=resolveMachineLink({equipmentId:'E-2',name:'Grinder'},list);
  assert.equal(res.kind,'linked');
  assert.equal(res.equipment.equipmentId,'E-2');
});
test('resolveMachineLink: an equipmentId that no longer exists resolves to "missing", never guessed by name', ()=>{
  const list=[eq({equipmentId:'E-1',name:'Welder'})];
  const res=resolveMachineLink({equipmentId:'E-9',name:'Welder'},list);
  assert.equal(res.kind,'missing');
  assert.equal(res.equipment,null);
});
test('resolveMachineLink: a legacy name-only link resolves when it uniquely matches exactly one real record', ()=>{
  const list=[eq({equipmentId:'E-1',name:'Welder'}),eq({equipmentId:'E-2',name:'Grinder'})];
  const res=resolveMachineLink({name:'welder'},list); // case-insensitive
  assert.equal(res.kind,'legacy-resolved');
  assert.equal(res.equipment.equipmentId,'E-1');
});
test('resolveMachineLink: a legacy name matching ZERO real records fails safe as unlinked', ()=>{
  const list=[eq({equipmentId:'E-1',name:'Welder'})];
  const res=resolveMachineLink({name:'Forklift'},list);
  assert.equal(res.kind,'unlinked');
  assert.equal(res.equipment,null);
});
test('resolveMachineLink: a legacy name matching MULTIPLE real records (ambiguous) fails safe as unlinked', ()=>{
  const list=[eq({equipmentId:'E-1',name:'Welder'}),eq({equipmentId:'E-2',name:'Welder'})];
  const res=resolveMachineLink({name:'Welder'},list);
  assert.equal(res.kind,'unlinked');
});
test('resolveMachineLink: a blank/missing name with no equipmentId is unlinked, not a crash', ()=>{
  assert.equal(resolveMachineLink({name:''},[]).kind,'unlinked');
  assert.equal(resolveMachineLink(null,[]).kind,'unlinked');
  assert.equal(resolveMachineLink({},[]).kind,'unlinked');
});

// ── isDuplicateEquipmentLink / isAssignedElsewhere ──
test('isDuplicateEquipmentLink: true only when the SAME equipmentId is already linked', ()=>{
  const machines=[{equipmentId:'E-1',name:'Welder'},{name:'Legacy only'}];
  assert.equal(isDuplicateEquipmentLink(machines,'E-1'),true);
  assert.equal(isDuplicateEquipmentLink(machines,'E-2'),false);
});
test('isAssignedElsewhere: true only when assignedJobcard is set AND differs from the given jobcardNo', ()=>{
  assert.equal(isAssignedElsewhere(eq({assignedJobcard:'JC-2026-0002'}),'JC-2026-0001'),true);
  assert.equal(isAssignedElsewhere(eq({assignedJobcard:'JC-2026-0001'}),'JC-2026-0001'),false);
  assert.equal(isAssignedElsewhere(eq({assignedJobcard:null}),'JC-2026-0001'),false);
  assert.equal(isAssignedElsewhere(null,'JC-2026-0001'),false);
});

// ── canAddEquipmentToJobcard ──
test('canAddEquipmentToJobcard: allowed when safe, unlinked here, and not assigned elsewhere', ()=>{
  const res=canAddEquipmentToJobcard(eq({assignedJobcard:null}),[],'JC-2026-0001',{blocked:false});
  assert.deepEqual(res,{allowed:true,reasonCode:null});
});
test('canAddEquipmentToJobcard: rejected as DUPLICATE when already linked to this same jobcard', ()=>{
  const res=canAddEquipmentToJobcard(eq(),[{equipmentId:'E-1',name:'Welder'}],'JC-2026-0001',{blocked:false});
  assert.equal(res.allowed,false);
  assert.equal(res.reasonCode,'DUPLICATE');
});
test('canAddEquipmentToJobcard: rejected as ASSIGNED_ELSEWHERE when linked to a different jobcard', ()=>{
  const res=canAddEquipmentToJobcard(eq({assignedJobcard:'JC-2026-0002'}),[],'JC-2026-0001',{blocked:false});
  assert.equal(res.allowed,false);
  assert.equal(res.reasonCode,'ASSIGNED_ELSEWHERE');
});
test('canAddEquipmentToJobcard: rejected as BLOCKED when the supplied gate says blocked', ()=>{
  const res=canAddEquipmentToJobcard(eq(),[],'JC-2026-0001',{blocked:true,reasons:['Out of Service']});
  assert.equal(res.allowed,false);
  assert.equal(res.reasonCode,'BLOCKED');
});
test('canAddEquipmentToJobcard: NOT_FOUND when there is no equipment record at all', ()=>{
  const res=canAddEquipmentToJobcard(null,[],'JC-2026-0001',{blocked:false});
  assert.equal(res.allowed,false);
  assert.equal(res.reasonCode,'NOT_FOUND');
});

// ── resolveOperationEquipment ──
test('resolveOperationEquipment: no machine/equipmentId on the operation means no requirement at all', ()=>{
  const res=resolveOperationEquipment({desc:'Cut'},[],[]);
  assert.equal(res.required,false);
  assert.equal(res.kind,'none');
});
test('resolveOperationEquipment: op.equipmentId linked to this jobcard AND a real record resolves cleanly', ()=>{
  const machines=[{equipmentId:'E-1',name:'Welder'}];
  const list=[eq({equipmentId:'E-1',name:'Welder'})];
  const res=resolveOperationEquipment({equipmentId:'E-1'},machines,list);
  assert.equal(res.required,true);
  assert.equal(res.kind,'linked');
  assert.equal(res.equipment.equipmentId,'E-1');
});
test('resolveOperationEquipment: op.equipmentId not linked to THIS jobcard is unlinked, even if the record exists globally', ()=>{
  const list=[eq({equipmentId:'E-1',name:'Welder'})];
  const res=resolveOperationEquipment({equipmentId:'E-1'},[],list); // no machines linked to this jobcard
  assert.equal(res.required,true);
  assert.equal(res.kind,'unlinked');
});
test('resolveOperationEquipment: op.equipmentId referencing a deleted equipment record is "missing"', ()=>{
  const machines=[{equipmentId:'E-1',name:'Welder'}];
  const res=resolveOperationEquipment({equipmentId:'E-1'},machines,[]);
  assert.equal(res.required,true);
  assert.equal(res.kind,'missing');
});
test('resolveOperationEquipment: legacy op.machine name resolves via the jobcard\'s own uniquely-matching linked machine', ()=>{
  const machines=[{equipmentId:'E-1',name:'Welder'}];
  const list=[eq({equipmentId:'E-1',name:'Welder'})];
  const res=resolveOperationEquipment({machine:'Welder'},machines,list);
  assert.equal(res.required,true);
  assert.equal(res.kind,'linked');
  assert.equal(res.equipment.equipmentId,'E-1');
});
test('resolveOperationEquipment: legacy op.machine name matching zero or multiple jobcard machines fails safe as unlinked', ()=>{
  assert.equal(resolveOperationEquipment({machine:'Forklift'},[{name:'Welder'}],[]).kind,'unlinked');
  const dup=[{equipmentId:'E-1',name:'Welder'},{name:'Welder'}];
  assert.equal(resolveOperationEquipment({machine:'Welder'},dup,[eq({equipmentId:'E-1',name:'Welder'})]).kind,'unlinked');
});

// ── canStartOperationEquipment ── (Pass 3.2B review fix: stricter than resolveOperationEquipment —
// only an explicit op.equipmentId, linked here AND currently assigned to exactly this Jobcard, may
// authorize a start; a resolvable legacy name is never sufficient.)
test('canStartOperationEquipment: no equipmentId and no machine name means no requirement at all', ()=>{
  const res=canStartOperationEquipment({desc:'Cut'},[],[],'JC-1');
  assert.equal(res.required,false);
  assert.equal(res.code,null);
});
test('canStartOperationEquipment: a legacy machine NAME (no equipmentId) never authorizes a start, even if it would resolve for display', ()=>{
  const machines=[{equipmentId:'E-1',name:'Welder'}];
  const list=[eq({equipmentId:'E-1',name:'Welder',assignedJobcard:'JC-1'})];
  const res=canStartOperationEquipment({machine:'Welder'},machines,list,'JC-1');
  assert.equal(res.required,true);
  assert.equal(res.code,'EQUIPMENT_NOT_LINKED');
});
test('canStartOperationEquipment: op.equipmentId not present in this Jobcard\'s own machines is EQUIPMENT_NOT_LINKED', ()=>{
  const list=[eq({equipmentId:'E-1',name:'Welder',assignedJobcard:'JC-1'})];
  const res=canStartOperationEquipment({equipmentId:'E-1'},[],list,'JC-1');
  assert.equal(res.required,true);
  assert.equal(res.code,'EQUIPMENT_NOT_LINKED');
});
test('canStartOperationEquipment: op.equipmentId linked here but the equipment record no longer exists is EQUIPMENT_MISSING', ()=>{
  const machines=[{equipmentId:'E-1',name:'Welder'}];
  const res=canStartOperationEquipment({equipmentId:'E-1'},machines,[],'JC-1');
  assert.equal(res.required,true);
  assert.equal(res.code,'EQUIPMENT_MISSING');
});
test('canStartOperationEquipment: equipment resolved and linked but not assigned to ANY Jobcard is EQUIPMENT_UNASSIGNED', ()=>{
  const machines=[{equipmentId:'E-1',name:'Welder'}];
  const list=[eq({equipmentId:'E-1',name:'Welder',assignedJobcard:null})];
  const res=canStartOperationEquipment({equipmentId:'E-1'},machines,list,'JC-1');
  assert.equal(res.required,true);
  assert.equal(res.code,'EQUIPMENT_UNASSIGNED');
});
test('canStartOperationEquipment: equipment resolved and linked but assigned to a DIFFERENT Jobcard is EQUIPMENT_ASSIGNED_ELSEWHERE (stale-link bypass)', ()=>{
  const machines=[{equipmentId:'E-1',name:'Welder'}];
  const list=[eq({equipmentId:'E-1',name:'Welder',assignedJobcard:'JC-OTHER'})];
  const res=canStartOperationEquipment({equipmentId:'E-1'},machines,list,'JC-1');
  assert.equal(res.required,true);
  assert.equal(res.code,'EQUIPMENT_ASSIGNED_ELSEWHERE');
  assert.equal(res.equipment.equipmentId,'E-1');
});
test('canStartOperationEquipment: equipment resolved, linked here, AND assigned to exactly this Jobcard is authorized (code:null)', ()=>{
  const machines=[{equipmentId:'E-1',name:'Welder'}];
  const list=[eq({equipmentId:'E-1',name:'Welder',assignedJobcard:'JC-1'})];
  const res=canStartOperationEquipment({equipmentId:'E-1'},machines,list,'JC-1');
  assert.equal(res.required,true);
  assert.equal(res.code,null);
  assert.equal(res.equipment.equipmentId,'E-1');
});

// ── canReturnEquipmentFromJobcard ──
test('canReturnEquipmentFromJobcard: true only when the equipment is CURRENTLY assigned to this exact jobcard', ()=>{
  assert.equal(canReturnEquipmentFromJobcard(eq({assignedJobcard:'JC-2026-0001'}),'JC-2026-0001'),true);
  assert.equal(canReturnEquipmentFromJobcard(eq({assignedJobcard:'JC-2026-0002'}),'JC-2026-0001'),false);
  assert.equal(canReturnEquipmentFromJobcard(eq({assignedJobcard:null}),'JC-2026-0001'),false);
  assert.equal(canReturnEquipmentFromJobcard(null,'JC-2026-0001'),false);
});

// ── equipmentUsageForJobcard ──
test('equipmentUsageForJobcard: sums only this jobcard\'s usage sessions, computed from meterBefore/meterAfter', ()=>{
  const record=eq({usageHistory:[
    {jobcard:'JC-2026-0001',meterBefore:10,meterAfter:14},
    {jobcard:'JC-2026-0002',meterBefore:0,meterAfter:100},
    {jobcard:'JC-2026-0001',meterBefore:14,meterAfter:16.5}
  ]});
  assert.equal(equipmentUsageForJobcard(record,'JC-2026-0001'),6.5);
});
test('equipmentUsageForJobcard: no usage history, or none for this jobcard, is zero — never a crash', ()=>{
  assert.equal(equipmentUsageForJobcard(eq({usageHistory:[]}),'JC-2026-0001'),0);
  assert.equal(equipmentUsageForJobcard(eq({usageHistory:undefined}),'JC-2026-0001'),0);
  assert.equal(equipmentUsageForJobcard(null,'JC-2026-0001'),0);
});

// ── resolveLogTimeEquipment ── (shared by jobcard-desktop.html's Log Time modal and the Hours module)
test('resolveLogTimeEquipment: no equipmentId means no requirement at all — ok with a null machine/equipment', ()=>{
  const res=resolveLogTimeEquipment([{equipmentId:'E-1',name:'Welder'}],'',[eq({equipmentId:'E-1',assignedJobcard:'JC-1'})],'JC-1');
  assert.equal(res.ok,true);
  assert.equal(res.machine,null);
  assert.equal(res.equipment,null);
});
test('resolveLogTimeEquipment: equipmentId not present in this jobcard\'s own machines is EQUIPMENT_NOT_LINKED', ()=>{
  const list=[eq({equipmentId:'E-1',assignedJobcard:'JC-1'})];
  const res=resolveLogTimeEquipment([],'E-1',list,'JC-1');
  assert.equal(res.ok,false);
  assert.equal(res.code,'EQUIPMENT_NOT_LINKED');
});
test('resolveLogTimeEquipment: linked here but the equipment record no longer exists is EQUIPMENT_MISSING', ()=>{
  const machines=[{equipmentId:'E-1',name:'Welder'}];
  const res=resolveLogTimeEquipment(machines,'E-1',[],'JC-1');
  assert.equal(res.ok,false);
  assert.equal(res.code,'EQUIPMENT_MISSING');
});
test('resolveLogTimeEquipment: resolved and linked but not assigned to ANY jobcard is EQUIPMENT_UNASSIGNED', ()=>{
  const machines=[{equipmentId:'E-1',name:'Welder'}];
  const list=[eq({equipmentId:'E-1',assignedJobcard:null})];
  const res=resolveLogTimeEquipment(machines,'E-1',list,'JC-1');
  assert.equal(res.ok,false);
  assert.equal(res.code,'EQUIPMENT_UNASSIGNED');
  assert.equal(res.assignedJobcard,null);
});
test('resolveLogTimeEquipment: resolved and linked but assigned to a DIFFERENT jobcard is EQUIPMENT_ASSIGNED_ELSEWHERE (stale-link bypass)', ()=>{
  const machines=[{equipmentId:'E-1',name:'Welder'}];
  const list=[eq({equipmentId:'E-1',assignedJobcard:'JC-OTHER'})];
  const res=resolveLogTimeEquipment(machines,'E-1',list,'JC-1');
  assert.equal(res.ok,false);
  assert.equal(res.code,'EQUIPMENT_ASSIGNED_ELSEWHERE');
  assert.equal(res.assignedJobcard,'JC-OTHER');
});
test('resolveLogTimeEquipment: resolved, linked here, AND assigned to exactly this jobcard is authorized', ()=>{
  const machines=[{equipmentId:'E-1',name:'Welder'}];
  const list=[eq({equipmentId:'E-1',name:'Welder',assignedJobcard:'JC-1'})];
  const res=resolveLogTimeEquipment(machines,'E-1',list,'JC-1');
  assert.equal(res.ok,true);
  assert.equal(res.machine.equipmentId,'E-1');
  assert.equal(res.equipment.equipmentId,'E-1');
});
