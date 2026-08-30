// Pure Jobcard <-> Equipment linking/decision helpers — loaded by jobcard-desktop.html and by the
// Node test suite (tests/jobcard-equipment-rules.test.js) so both share exactly one implementation.
// These functions never decide SAFETY — that is always WorkshopData.getEquipmentSafetyGate() /
// canAssignEquipment() / canUseEquipment() (see equipment-gates.js). This module only resolves
// which real equipment record a Jobcard/operation reference points to, and composes small UI-facing
// decisions (duplicate links, conflicting assignment, whether a return call is appropriate) around
// that authoritative gate result — never a second, competing safety system.
(function(root){
  'use strict';
  function normName(s){return s!=null?String(s).trim().toLowerCase():'';}

  // Resolves ONE Jobcard machine link (an entry of jobcard.machines) against the real, shared
  // equipment catalog. link.equipmentId is authoritative when present. A legacy link that only has
  // a name is resolved ONLY when it uniquely matches exactly one real equipment record by name
  // (case/whitespace-insensitive) — zero or multiple matches are never guessed, they fail safe as
  // 'unlinked'. Missing equipmentId (record was deleted) fails safe as 'missing'.
  function resolveMachineLink(link,equipmentList){
    const list=Array.isArray(equipmentList)?equipmentList:[];
    if(!link)return{kind:'unlinked',equipment:null};
    if(link.equipmentId){
      const eq=list.find(e=>e&&e.equipmentId===link.equipmentId);
      return eq?{kind:'linked',equipment:eq}:{kind:'missing',equipment:null};
    }
    const name=normName(link.name);
    if(!name)return{kind:'unlinked',equipment:null};
    const matches=list.filter(e=>e&&normName(e.name)===name);
    if(matches.length===1)return{kind:'legacy-resolved',equipment:matches[0]};
    return{kind:'unlinked',equipment:null};
  }

  // Whether equipmentId is already linked (by its own stable id, never array position) somewhere
  // in this Jobcard's machines list.
  function isDuplicateEquipmentLink(machines,equipmentId){
    return (machines||[]).some(m=>m&&m.equipmentId===equipmentId);
  }
  // A real equipment record currently assigned to a DIFFERENT Jobcard than the one being edited.
  function isAssignedElsewhere(equipment,jobcardNo){
    return !!(equipment&&equipment.assignedJobcard&&jobcardNo&&equipment.assignedJobcard!==jobcardNo);
  }
  // Composite "can this equipment be added to this Jobcard right now" UI decision. `gate` must be
  // the real result of WorkshopData.getEquipmentSafetyGate()/canAssignEquipment() — this function
  // never computes safety itself, only combines it with the two Jobcard-side checks (duplicate,
  // conflicting assignment) that WorkshopData.assignEquipment() does not know about.
  function canAddEquipmentToJobcard(equipment,machines,jobcardNo,gate){
    if(!equipment)return{allowed:false,reasonCode:'NOT_FOUND'};
    if(isDuplicateEquipmentLink(machines,equipment.equipmentId))return{allowed:false,reasonCode:'DUPLICATE'};
    if(isAssignedElsewhere(equipment,jobcardNo))return{allowed:false,reasonCode:'ASSIGNED_ELSEWHERE'};
    if(gate&&gate.blocked)return{allowed:false,reasonCode:'BLOCKED'};
    return{allowed:true,reasonCode:null};
  }

  // Resolves an OPERATION's required equipment. Operations may only reference equipment already
  // linked to the SAME Jobcard (never the whole shared catalog) — via op.equipmentId, or (legacy)
  // op.machine matched by name against the Jobcard's own linked machines. An operation with neither
  // field set has no equipment requirement at all (required:false).
  function resolveOperationEquipment(op,machines,equipmentList){
    if(!op)return{required:false,kind:'none',equipment:null};
    const list=Array.isArray(equipmentList)?equipmentList:[];
    const ownMachines=machines||[];
    if(op.equipmentId){
      const linkedHere=ownMachines.some(m=>m&&m.equipmentId===op.equipmentId);
      const eq=list.find(e=>e&&e.equipmentId===op.equipmentId);
      if(!eq)return{required:true,kind:'missing',equipment:null};
      if(!linkedHere)return{required:true,kind:'unlinked',equipment:null};
      return{required:true,kind:'linked',equipment:eq};
    }
    const name=normName(op.machine);
    if(!name)return{required:false,kind:'none',equipment:null};
    const candidateLinks=ownMachines.filter(m=>normName(m&&m.name)===name);
    if(candidateLinks.length!==1)return{required:true,kind:'unlinked',equipment:null};
    const resolved=resolveMachineLink(candidateLinks[0],list);
    if(resolved.kind==='linked'||resolved.kind==='legacy-resolved')return{required:true,kind:'linked',equipment:resolved.equipment};
    return{required:true,kind:'unlinked',equipment:null};
  }

  // Whether an operation is allowed to START (or resume) using its required equipment right now.
  // This is intentionally STRICTER than resolveOperationEquipment() above: a legacy op.machine NAME
  // match is never sufficient authorization to actually USE equipment (only display) — starting
  // requires an explicit op.equipmentId, linked to THIS Jobcard's own machines, resolving to a real
  // record that is CURRENTLY assigned to exactly this Jobcard (equipment.assignedJobcard===jobcardNo).
  // A null/unassigned, missing, unlinked or assigned-elsewhere record all fail closed. Callers must
  // still separately check WorkshopData.canUseEquipment() for the actual safety-gate decision (pre-use
  // check, blockers, etc.) — this function only answers "is this the equipment this Jobcard is really
  // holding," never whether it is safe to use.
  function canStartOperationEquipment(op,machines,equipmentList,jobcardNo){
    if(!op)return{required:false,code:null,equipment:null};
    if(!op.equipmentId){
      if(!normName(op.machine))return{required:false,code:null,equipment:null};
      return{required:true,code:'EQUIPMENT_NOT_LINKED',equipment:null};
    }
    const linkedHere=(machines||[]).some(m=>m&&m.equipmentId===op.equipmentId);
    if(!linkedHere)return{required:true,code:'EQUIPMENT_NOT_LINKED',equipment:null};
    const list=Array.isArray(equipmentList)?equipmentList:[];
    const eq=list.find(e=>e&&e.equipmentId===op.equipmentId);
    if(!eq)return{required:true,code:'EQUIPMENT_MISSING',equipment:null};
    if(!eq.assignedJobcard)return{required:true,code:'EQUIPMENT_UNASSIGNED',equipment:eq};
    if(eq.assignedJobcard!==jobcardNo)return{required:true,code:'EQUIPMENT_ASSIGNED_ELSEWHERE',equipment:eq};
    return{required:true,code:null,equipment:eq};
  }

  // A Jobcard's "Remove equipment" action must only call WorkshopData.returnEquipment() when the
  // equipment is CURRENTLY assigned to THIS Jobcard — never clearing an assignment that already
  // belongs to a different Jobcard (or none at all).
  function canReturnEquipmentFromJobcard(equipment,jobcardNo){
    return !!(equipment&&equipment.assignedJobcard&&jobcardNo&&equipment.assignedJobcard===jobcardNo);
  }

  // Sums this Jobcard's share of an equipment record's real usage history (meterAfter-meterBefore
  // per session), for display alongside plannedUsage — never a value copied/edited on the Jobcard
  // itself, always derived live from the shared Equipment record.
  function equipmentUsageForJobcard(equipment,jobcardNo){
    const history=(equipment&&Array.isArray(equipment.usageHistory))?equipment.usageHistory:[];
    return history.filter(u=>u&&u.jobcard===jobcardNo)
      .reduce((sum,u)=>sum+Math.max(0,(Number(u.meterAfter)||0)-(Number(u.meterBefore)||0)),0);
  }

  const JobcardEquipmentRules={
    resolveMachineLink,isDuplicateEquipmentLink,isAssignedElsewhere,canAddEquipmentToJobcard,
    resolveOperationEquipment,canStartOperationEquipment,canReturnEquipmentFromJobcard,equipmentUsageForJobcard
  };
  root.JobcardEquipmentRules=JobcardEquipmentRules;
  if(typeof module!=='undefined'&&module.exports)module.exports=JobcardEquipmentRules;
})(typeof window!=='undefined'?window:globalThis);
