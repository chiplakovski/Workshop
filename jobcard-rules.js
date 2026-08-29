// Pure Jobcard business-rule helpers, loaded by jobcard-desktop.html and by the Node test suite
// (tests/jobcard-rules.test.js) so both share exactly one implementation of these rules.
(function(root){
  'use strict';
  function isBlank(v){return v===undefined||v===null||String(v).trim()==='';}
  function isPositiveNumber(v){const n=Number(v);return Number.isFinite(n)&&n>0;}
  // An operation can only be completed once it has a worker AND positive logged hours —
  // both conditions are required, not either.
  function canCompleteOp(op){return !isBlank(op.worker)&&isPositiveNumber(Number(op.loggedHours));}
  // Only statuses that can legitimately transition into paused/blocked (per ALLOWED_TRANSITIONS
  // in jobcard-desktop.html) are valid resume targets. Draft, completed, closed and the
  // side-statuses themselves are excluded so resume can never land on a final or unreachable status.
  const VALID_RESUME_TARGETS=['released','ready','in-progress','inspection'];
  function resumeTargetFor(j){
    const stored=j._resumeStatus;
    return VALID_RESUME_TARGETS.includes(stored)?stored:'ready';
  }
  const JobcardRules={isBlank,isPositiveNumber,canCompleteOp,VALID_RESUME_TARGETS,resumeTargetFor};
  root.JobcardRules=JobcardRules;
  if(typeof module!=='undefined'&&module.exports)module.exports=JobcardRules;
})(typeof window!=='undefined'?window:globalThis);
