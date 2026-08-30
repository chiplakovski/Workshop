// Central Quality Hold safety gate — the ONE place that decides whether an active Quality Hold
// blocks a Project, a Jobcard, or a Jobcard operation. workshop-data.js's WorkshopData API wraps
// these pure functions with real shared state (see getQualityGate/getProjectQualityGate/
// getJobcardQualityGate/canTransitionProject/canTransitionJobcard); browser pages and the Node
// test suite must both go through this same logic — never reimplement hold matching elsewhere.
(function(root){
  'use strict';

  // Recognised hold scopes, case/whitespace-normalised. An unrecognised scope is left as-is (never
  // guessed into 'project' or 'jobcard') so a malformed hold cannot silently start blocking things
  // it was never meant to.
  function normalizeScope(scope){
    const s=scope!=null?String(scope).trim().toLowerCase():'';
    if(s==='jobcard'||s==='job'||s==='jc')return'jobcard';
    if(s==='project'||s==='proj')return'project';
    return s;
  }

  // True only for an ACTIVE hold whose scope is 'jobcard' and whose reference is an EXACT match for
  // the given jobcard number — never a partial/blank match, so an orphan or malformed hold record
  // (empty reference, unrecognised scope) can never accidentally match every jobcard.
  function holdAppliesToJobcard(hold,jobcardNo){
    if(!hold||hold.status!=='active'||!jobcardNo)return false;
    return normalizeScope(hold.scope)==='jobcard'&&String(hold.reference||'')===String(jobcardNo);
  }
  // True only for an ACTIVE hold whose scope is 'project' and whose reference exactly matches the
  // given project number.
  function holdAppliesToProject(hold,projectNo){
    if(!hold||hold.status!=='active'||!projectNo)return false;
    return normalizeScope(hold.scope)==='project'&&String(hold.reference||'')===String(projectNo);
  }

  // Every active hold applicable to a single Jobcard: one scoped directly to it, OR one scoped to
  // its parent Project (a Project hold blocks every Jobcard under that project).
  function holdsForJobcard(holds,jobcardNo,projectNo){
    return (holds||[]).filter(h=>holdAppliesToJobcard(h,jobcardNo)||(projectNo&&holdAppliesToProject(h,projectNo)));
  }
  // Every active hold applicable to a Project: one scoped directly to it, OR one scoped to ANY
  // Jobcard that belongs to it (a Jobcard hold blocks its parent Project's completion, closure and
  // Final Release — but never a sibling Jobcard on the same project).
  function holdsForProject(holds,projectNo,jobcardNosInProject){
    const jcNos=jobcardNosInProject||[];
    return (holds||[]).filter(h=>holdAppliesToProject(h,projectNo)||jcNos.some(no=>holdAppliesToJobcard(h,no)));
  }

  function reasonForHold(h){
    const parts=[`Active Quality Hold ${h&&h.no?h.no:'(unnumbered)'}`];
    if(h&&h.severity)parts.push(`(${h.severity})`);
    return parts.join(' ')+(h&&h.reason?`: ${h.reason}`:'');
  }

  // The one authoritative result shape every caller must use: {blocked, holds, reasons, projectNo,
  // jobcardNo}. `holds` is the exact array of applicable ACTIVE hold records (not clones — callers
  // that need clones, e.g. WorkshopData, are responsible for cloning before returning to callers of
  // their own).
  function buildGateResult(holds,projectNo,jobcardNo){
    const list=holds||[];
    return{
      blocked:list.length>0,
      holds:list.slice(),
      reasons:list.map(reasonForHold),
      projectNo:projectNo||null,
      jobcardNo:jobcardNo||null
    };
  }

  function getJobcardQualityGate(holds,jobcardNo,projectNo){
    return buildGateResult(holdsForJobcard(holds,jobcardNo,projectNo),projectNo,jobcardNo);
  }
  function getProjectQualityGate(holds,projectNo,jobcardNosInProject){
    return buildGateResult(holdsForProject(holds,projectNo,jobcardNosInProject),projectNo,null);
  }

  const QualityGates={normalizeScope,holdAppliesToJobcard,holdAppliesToProject,holdsForJobcard,holdsForProject,
    reasonForHold,buildGateResult,getJobcardQualityGate,getProjectQualityGate};
  root.QualityGates=QualityGates;
  if(typeof module!=='undefined'&&module.exports)module.exports=QualityGates;
})(typeof window!=='undefined'?window:globalThis);
