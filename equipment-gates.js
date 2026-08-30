// Central Equipment/Machine safety gate — the ONE place that decides whether a piece of Equipment
// can be reserved, assigned, placed into operational use, or have operating hours recorded against
// it. workshop-data.js's WorkshopData API wraps this pure function with real shared state (see
// getEquipmentSafetyGate/canAssignEquipment/canUseEquipment); browser pages and the Node test suite
// must both go through this same logic — never reimplement equipment safety matching elsewhere.
(function(root){
  'use strict';

  // Status vocabulary is fixed and exact (case/whitespace-normalised). An unrecognised status is
  // never guessed as safe — it fails closed (blocked), same as a known hard-block status.
  const HARD_BLOCK_STATUSES=['out of service','quarantined','under maintenance','maintenance due','inspection required','retired'];
  const OPERATIONAL_STATUSES=['available','reserved','in use'];

  function normalizeStatus(status){
    return status!=null?String(status).trim().toLowerCase():'';
  }
  function isHardBlockStatus(status){return HARD_BLOCK_STATUSES.includes(normalizeStatus(status));}
  function isOperationalStatus(status){return OPERATIONAL_STATUSES.includes(normalizeStatus(status));}
  function isKnownStatus(status){const s=normalizeStatus(status);return HARD_BLOCK_STATUSES.includes(s)||OPERATIONAL_STATUSES.includes(s);}
  function isRetiredStatus(status){return normalizeStatus(status)==='retired';}
  // Anything that isn't a recognised operational status blocks — this covers every hard-block
  // status AND any unknown/malformed value (fail safe, never guess an unrecognised status is safe).
  function statusBlocksOperation(status){return !isOperationalStatus(status);}

  function normalizeResult(result){
    return result!=null?String(result).trim().toLowerCase():'';
  }
  // A history record (inspection/breakdown/pre-use check) is "resolved" once explicitly marked so
  // by a dedicated resolution method, or if it already carries a terminal status string.
  function isResolvedRecord(rec){
    if(!rec)return true;
    if(rec.resolved===true)return true;
    const s=normalizeStatus(rec.status);
    return s==='resolved'||s==='closed'||s==='repaired';
  }

  // Dates are compared at calendar-day resolution (UTC midnight) so a date equal to `asOf` (e.g.
  // "due today") is never flagged overdue purely from a time-of-day difference.
  function toDateOnly(value){
    if(!value)return null;
    let s=null;
    if(value instanceof Date)s=isNaN(value.getTime())?null:value.toISOString().slice(0,10);
    else if(typeof value==='string')s=value.slice(0,10);
    if(!s)return null;
    const d=new Date(s+'T00:00:00.000Z');
    return isNaN(d.getTime())?null:d;
  }
  function sameCalendarDate(a,b){
    const da=toDateOnly(a),db=toDateOnly(b);
    return !!da&&!!db&&da.getTime()===db.getTime();
  }
  function resolveAsOf(options){
    return toDateOnly((options&&options.asOf))||toDateOnly(new Date());
  }

  // One date-based requirement (maintenance/inspection/certification/calibration). A missing or
  // overdue date is always reported as a blocker DETAIL for transparency, but only actually blocks
  // (`hard:true`) when the equipment record explicitly marks this specific requirement as
  // mandatory — the Pass 3.2A backwards-compatibility rule: legacy equipment with no `requirements`
  // object at all must keep behaving exactly as it did before this gate existed.
  function dateRequirementBlocker(code,label,dateValue,asOf,mandatory){
    const d=toDateOnly(dateValue);
    if(!d)return{code:code+'_MISSING',message:label+' date is missing',mandatory:!!mandatory,hard:!!mandatory};
    if(d.getTime()<asOf.getTime())return{code:code+'_OVERDUE',message:label+' is overdue (due '+dateValue+')',mandatory:!!mandatory,hard:!!mandatory};
    return null;
  }

  function buildGateResult(equipmentId,status,blockerDetails){
    const hard=blockerDetails.filter(b=>b.hard);
    return{
      blocked:hard.length>0,
      code:hard.length>0?'EQUIPMENT_SAFETY_BLOCKED':null,
      reasons:hard.map(b=>b.message),
      equipmentId:equipmentId||null,
      status:status||null,
      blockers:blockerDetails.slice()
    };
  }

  // equipment: the raw stored equipment record — read only, never mutated or written back.
  // options:
  //   asOf                — Date or 'YYYY-MM-DD' string; defaults to the current date. Always pass
  //                         this explicitly in tests for deterministic results.
  //   requirePreUseCheck  — when true, also requires a matching PASSED pre-use check (see below).
  //                         Set by the "use equipment" call sites (logEquipmentUsage/
  //                         canUseEquipment) — never by assignment/reservation.
  //   date/jobcardNo/projectNo — the intended use context, matched against stored pre-use checks.
  //   skipStatusCheck     — when true, does not block purely because the CURRENT status is non-
  //                         operational. Used only by returnEquipmentToService, which is precisely
  //                         evaluating whether it is now safe to move OUT of that status.
  function getEquipmentSafetyGate(equipment,options){
    options=options||{};
    const asOf=resolveAsOf(options);
    if(!equipment){
      return buildGateResult(options.equipmentId||null,null,[{code:'EQUIPMENT_NOT_FOUND',message:'Equipment record not found',mandatory:true,hard:true}]);
    }
    const equipmentId=equipment.equipmentId||equipment.id||null;
    const status=equipment.status!=null?equipment.status:null;
    const blockers=[];

    if(!options.skipStatusCheck&&statusBlocksOperation(status)){
      const known=isKnownStatus(status);
      blockers.push({
        code:known?'STATUS_BLOCKED':'STATUS_UNKNOWN',
        message:known?`Equipment status "${equipment.status}" is not operational`:`Equipment status "${equipment.status||'(none)'}" is unrecognised and fails safe`,
        mandatory:true,hard:true
      });
    }
    if(isRetiredStatus(status)){
      blockers.push({code:'RETIRED',message:'Equipment is retired and permanently non-operational',mandatory:true,hard:true});
    }

    const req=equipment.requirements||{};
    [
      ['MAINTENANCE','Maintenance',equipment.maintenanceDate,req.maintenanceRequired],
      ['INSPECTION','Inspection',equipment.inspectionDate,req.inspectionRequired],
      ['CERTIFICATION','Certification',equipment.certificationExpiry,req.certificationRequired],
      ['CALIBRATION','Calibration',equipment.calibrationDate,req.calibrationRequired]
    ].forEach(([code,label,dateValue,mandatory])=>{
      const b=dateRequirementBlocker(code,label,dateValue,asOf,mandatory);
      if(b)blockers.push(b);
    });

    // Inspections: the array is stored newest-first (see workshop-data.js's addInspection), so
    // index 0 is always the latest. A newer PASSED inspection naturally supersedes an older failed
    // one — that is the intended way to clear this blocker (a real re-inspection), never an edit of
    // the old record.
    const inspections=Array.isArray(equipment.inspections)?equipment.inspections:[];
    const latestInspection=inspections[0];
    if(latestInspection&&normalizeResult(latestInspection.result)==='failed'){
      blockers.push({code:'INSPECTION_FAILED',message:`Latest inspection ${latestInspection.no||latestInspection.id||''} failed`.trim(),mandatory:true,hard:true});
    }
    if(latestInspection&&latestInspection.critical&&normalizeResult(latestInspection.result)!=='passed'){
      blockers.push({code:'CRITICAL_INSPECTION_UNRESOLVED',message:`Critical inspection ${latestInspection.no||latestInspection.id||''} is unresolved`.trim(),mandatory:true,hard:true});
    }

    // Breakdowns: unlike inspections/pre-use checks, an open breakdown has no "newer record
    // supersedes it" equivalent — it must be explicitly resolved (see resolveBreakdown).
    const downtime=Array.isArray(equipment.downtimeRecords)?equipment.downtimeRecords:[];
    const openBreakdown=downtime.find(d=>d&&!isResolvedRecord(d));
    if(openBreakdown){
      blockers.push({code:'BREAKDOWN_OPEN',message:`Open breakdown ${openBreakdown.id||''} is unresolved`.trim(),mandatory:true,hard:true});
    }

    // Pre-use checks: also stored newest-first. A failed latest check blocks immediately and
    // persistently; it is cleared the same way a failed inspection is — a newer check that passes.
    const preUseChecks=Array.isArray(equipment.preUseChecks)?equipment.preUseChecks:[];
    const latestCheck=preUseChecks[0];
    if(latestCheck&&normalizeResult(latestCheck.result)==='failed'){
      blockers.push({code:'PREUSE_CHECK_FAILED',message:'Latest pre-use check failed',mandatory:true,hard:true});
    }
    // A mandatory pre-use check only applies to an actual "use" attempt (requirePreUseCheck) and
    // only when the equipment record itself marks preUseCheckRequired — legacy equipment without a
    // `requirements` object is never subject to this. A valid PASSED check must match the same
    // calendar date, and the jobcard/project reference when the caller supplied one.
    if(req.preUseCheckRequired&&options.requirePreUseCheck){
      const wantedDate=options.date||asOf.toISOString().slice(0,10);
      const wantedJobcard=options.jobcardNo||null;
      const wantedProject=options.projectNo||null;
      const matched=preUseChecks.find(c=>c&&normalizeResult(c.result)==='passed'
        &&sameCalendarDate(c.date,wantedDate)
        &&(!wantedJobcard||c.jobcardNo===wantedJobcard)
        &&(!wantedProject||c.projectNo===wantedProject));
      if(!matched){
        blockers.push({code:'PREUSE_CHECK_REQUIRED_MISSING',message:`A passed pre-use check for ${wantedDate} is required before use`,mandatory:true,hard:true});
      }
    }

    return buildGateResult(equipmentId,status,blockers);
  }

  const EquipmentGates={
    HARD_BLOCK_STATUSES,OPERATIONAL_STATUSES,
    normalizeStatus,isHardBlockStatus,isOperationalStatus,isKnownStatus,isRetiredStatus,statusBlocksOperation,
    normalizeResult,isResolvedRecord,toDateOnly,sameCalendarDate,
    getEquipmentSafetyGate
  };
  root.EquipmentGates=EquipmentGates;
  if(typeof module!=='undefined'&&module.exports)module.exports=EquipmentGates;
})(typeof window!=='undefined'?window:globalThis);
