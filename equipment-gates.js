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
  // Strict calendar-date validation for workflow input (as opposed to toDateOnly()'s lenient
  // "best effort" parsing used for the gate's own overdue comparisons). A value must be a literal
  // 'YYYY-MM-DD' string naming a REAL calendar date — '2026-02-30' round-trips to a different
  // (rolled-over) date in plain `new Date(...)` parsing, so day/month/year are checked explicitly
  // against what was actually constructed, not just "does Date() not throw".
  function isValidCalendarDateString(value){
    if(typeof value!=='string')return false;
    const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if(!m)return false;
    const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]);
    if(mo<1||mo>12||d<1||d>31)return false;
    const dt=new Date(Date.UTC(y,mo-1,d));
    return dt.getUTCFullYear()===y&&dt.getUTCMonth()===mo-1&&dt.getUTCDate()===d;
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

    // Inspections: EVERY failed inspection is evaluated, not just the latest — a later, unrelated
    // PASSED inspection must never silently supersede/hide an earlier failure. A failed inspection
    // is immutable history; the only way to clear it is an explicit, evidenced resolution (see
    // workshop-data.js's resolveEquipmentInspection), which sets `resolved:true` on that SPECIFIC
    // record. isResolvedRecord() is what recognises that.
    const inspections=Array.isArray(equipment.inspections)?equipment.inspections:[];
    inspections.filter(i=>i&&normalizeResult(i.result)==='failed'&&!isResolvedRecord(i)).forEach(i=>{
      blockers.push({
        code:i.critical?'CRITICAL_INSPECTION_UNRESOLVED':'INSPECTION_FAILED',
        message:`${i.critical?'Critical inspection':'Inspection'} ${i.id||i.no||''} failed and is unresolved`.replace(/\s+/g,' ').trim(),
        mandatory:true,hard:true
      });
    });
    // A critical inspection that has not yet reached a positive "passed" result (e.g. still
    // 'pending') also blocks — a critical safety check must be affirmatively passed, not merely
    // "not yet failed". (Failed-and-critical is already covered, with its own code, above.)
    inspections.filter(i=>i&&i.critical&&normalizeResult(i.result)!=='passed'&&normalizeResult(i.result)!=='failed'&&!isResolvedRecord(i)).forEach(i=>{
      blockers.push({code:'CRITICAL_INSPECTION_UNRESOLVED',message:`Critical inspection ${i.id||i.no||''} is unresolved`.trim(),mandatory:true,hard:true});
    });

    // Breakdowns: unlike inspections/pre-use checks, an open breakdown has no "newer record
    // supersedes it" equivalent — it must be explicitly resolved (see resolveBreakdown).
    const downtime=Array.isArray(equipment.downtimeRecords)?equipment.downtimeRecords:[];
    const openBreakdown=downtime.find(d=>d&&!isResolvedRecord(d));
    if(openBreakdown){
      blockers.push({code:'BREAKDOWN_OPEN',message:`Open breakdown ${openBreakdown.id||''} is unresolved`.trim(),mandatory:true,hard:true});
    }

    // Pre-use checks: same "every unresolved failure blocks, never superseded by an unrelated
    // later pass" principle as inspections. Cleared only by an explicit resolution/linked re-check
    // (see workshop-data.js's recordEquipmentPreUseCheck's resolvesCheckId), which marks the
    // specific failed record `resolved:true`.
    const preUseChecks=Array.isArray(equipment.preUseChecks)?equipment.preUseChecks:[];
    const unresolvedFailedChecks=preUseChecks.filter(c=>c&&normalizeResult(c.result)==='failed'&&!isResolvedRecord(c));
    if(unresolvedFailedChecks.length){
      blockers.push({code:'PREUSE_CHECK_FAILED',message:`Pre-use check ${unresolvedFailedChecks[0].id||''} failed and is unresolved`.trim(),mandatory:true,hard:true});
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
    normalizeResult,isResolvedRecord,toDateOnly,sameCalendarDate,isValidCalendarDateString,
    getEquipmentSafetyGate
  };
  root.EquipmentGates=EquipmentGates;
  if(typeof module!=='undefined'&&module.exports)module.exports=EquipmentGates;
})(typeof window!=='undefined'?window:globalThis);
