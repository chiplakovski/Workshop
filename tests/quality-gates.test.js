// Pure logic tests for the central Quality Hold safety gate (quality-gates.js). These exercise the
// module directly with synthetic hold arrays — no WorkshopData/localStorage involved — so hold
// matching/scope rules are verified in isolation from the shared-data plumbing (covered separately,
// against the real API and seed data, in tests/workshop-data.test.js).
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const QualityGates=require('../quality-gates.js');

function hold(overrides){
  return Object.assign({id:1,no:'HOLD-TEST-001',scope:'jobcard',reference:'JC-1',relatedRef:'',reason:'Test reason',
    severity:'critical',requiredAction:'Fix it',status:'active'},overrides);
}

// ── normalizeScope ──
test('gate: normalizeScope recognises known scope names case/whitespace-insensitively', ()=>{
  assert.equal(QualityGates.normalizeScope('jobcard'),'jobcard');
  assert.equal(QualityGates.normalizeScope('Jobcard'),'jobcard');
  assert.equal(QualityGates.normalizeScope(' JOBCARD '),'jobcard');
  assert.equal(QualityGates.normalizeScope('jc'),'jobcard');
  assert.equal(QualityGates.normalizeScope('project'),'project');
  assert.equal(QualityGates.normalizeScope(' Project '),'project');
  assert.equal(QualityGates.normalizeScope('proj'),'project');
});
test('gate: normalizeScope passes an unrecognised scope through unchanged rather than guessing', ()=>{
  assert.equal(QualityGates.normalizeScope('equipment'),'equipment');
  assert.equal(QualityGates.normalizeScope(''),'');
  assert.equal(QualityGates.normalizeScope(null),'');
  assert.equal(QualityGates.normalizeScope(undefined),'');
});

// ── holdAppliesToJobcard / holdAppliesToProject ──
test('gate: a jobcard-scoped active hold applies to its exact reference only', ()=>{
  const h=hold({scope:'jobcard',reference:'JC-1'});
  assert.equal(QualityGates.holdAppliesToJobcard(h,'JC-1'),true);
  assert.equal(QualityGates.holdAppliesToJobcard(h,'JC-2'),false,'must not match a different jobcard number');
  assert.equal(QualityGates.holdAppliesToProject(h,'P-1'),false,'a jobcard-scoped hold is not a project-scoped match');
});
test('gate: a project-scoped active hold applies to its exact reference only', ()=>{
  const h=hold({scope:'project',reference:'P-1'});
  assert.equal(QualityGates.holdAppliesToProject(h,'P-1'),true);
  assert.equal(QualityGates.holdAppliesToProject(h,'P-2'),false);
  assert.equal(QualityGates.holdAppliesToJobcard(h,'P-1'),false);
});
test('gate: a released hold never applies, regardless of scope/reference match', ()=>{
  const h=hold({scope:'jobcard',reference:'JC-1',status:'released'});
  assert.equal(QualityGates.holdAppliesToJobcard(h,'JC-1'),false);
});
test('gate: malformed holds (missing scope/reference, null) never apply and never throw', ()=>{
  assert.equal(QualityGates.holdAppliesToJobcard(null,'JC-1'),false);
  assert.equal(QualityGates.holdAppliesToJobcard(hold({scope:'',reference:''}),'JC-1'),false);
  assert.equal(QualityGates.holdAppliesToJobcard(hold({scope:'jobcard',reference:null}),'JC-1'),false);
  assert.equal(QualityGates.holdAppliesToJobcard(hold({scope:'bogus-scope',reference:'JC-1'}),'JC-1'),false,'an unrecognised scope must not be guessed as jobcard');
  assert.equal(QualityGates.holdAppliesToJobcard(hold({scope:'jobcard',reference:'JC-1'}),''),false,'no jobcardNo to check against must never match');
});

// ── holdsForJobcard / holdsForProject ──
test('gate: holdsForJobcard returns a jobcard-scoped hold on that jobcard AND a project-scoped hold on its parent project', ()=>{
  const holds=[hold({id:1,no:'H1',scope:'jobcard',reference:'JC-1'}),hold({id:2,no:'H2',scope:'project',reference:'P-1'}),hold({id:3,no:'H3',scope:'jobcard',reference:'JC-2'})];
  const result=QualityGates.holdsForJobcard(holds,'JC-1','P-1');
  assert.deepEqual(result.map(h=>h.no).sort(),['H1','H2']);
});
test('gate: holdsForJobcard ignores a hold scoped to an unrelated jobcard or project', ()=>{
  const holds=[hold({id:1,no:'H1',scope:'jobcard',reference:'JC-9'}),hold({id:2,no:'H2',scope:'project',reference:'P-9'})];
  assert.deepEqual(QualityGates.holdsForJobcard(holds,'JC-1','P-1'),[]);
});
test('gate: holdsForProject returns a project-scoped hold on that project AND a jobcard-scoped hold on any of its listed child jobcards', ()=>{
  const holds=[hold({id:1,no:'H1',scope:'project',reference:'P-1'}),hold({id:2,no:'H2',scope:'jobcard',reference:'JC-1'}),hold({id:3,no:'H3',scope:'jobcard',reference:'JC-9'})];
  const result=QualityGates.holdsForProject(holds,'P-1',['JC-1','JC-2']);
  assert.deepEqual(result.map(h=>h.no).sort(),['H1','H2']);
});
test('gate: holdsForProject does not block on a jobcard-scoped hold whose jobcard is not actually a child of this project', ()=>{
  const holds=[hold({id:1,no:'H1',scope:'jobcard',reference:'JC-9'})];
  assert.deepEqual(QualityGates.holdsForProject(holds,'P-1',['JC-1','JC-2']),[]);
});
test('gate: an orphan hold referencing a jobcard/project number that does not exist anywhere never blocks an unrelated project', ()=>{
  const holds=[hold({id:1,no:'ORPHAN',scope:'jobcard',reference:'JC-DOES-NOT-EXIST'})];
  assert.deepEqual(QualityGates.holdsForProject(holds,'P-1',['JC-1']),[]);
  assert.deepEqual(QualityGates.holdsForJobcard(holds,'JC-1','P-1'),[]);
});
test('gate: multiple simultaneously-applicable holds are all returned, not just the first match', ()=>{
  const holds=[hold({id:1,no:'H1',scope:'jobcard',reference:'JC-1',reason:'First issue'}),hold({id:2,no:'H2',scope:'jobcard',reference:'JC-1',reason:'Second issue'})];
  const result=QualityGates.holdsForJobcard(holds,'JC-1',null);
  assert.equal(result.length,2);
});

// ── buildGateResult / getJobcardQualityGate / getProjectQualityGate ──
test('gate: buildGateResult shape is {blocked,holds,reasons,projectNo,jobcardNo} and blocked matches hold count', ()=>{
  const empty=QualityGates.buildGateResult([],'P-1',null);
  assert.deepEqual(empty,{blocked:false,holds:[],reasons:[],projectNo:'P-1',jobcardNo:null});
  const h=hold();
  const withHold=QualityGates.buildGateResult([h],'P-1','JC-1');
  assert.equal(withHold.blocked,true);
  assert.equal(withHold.holds.length,1);
  assert.equal(withHold.reasons.length,1);
  assert.match(withHold.reasons[0],/HOLD-TEST-001/);
});
test('gate: getJobcardQualityGate/getProjectQualityGate compose holdsFor* + buildGateResult correctly end-to-end', ()=>{
  const holds=[hold({id:1,no:'H1',scope:'jobcard',reference:'JC-1'})];
  const jcGate=QualityGates.getJobcardQualityGate(holds,'JC-1','P-1');
  assert.equal(jcGate.blocked,true);
  assert.equal(jcGate.jobcardNo,'JC-1');
  const projGate=QualityGates.getProjectQualityGate(holds,'P-1',['JC-1']);
  assert.equal(projGate.blocked,true);
  assert.equal(projGate.projectNo,'P-1');
  const unrelatedGate=QualityGates.getJobcardQualityGate(holds,'JC-2','P-2');
  assert.equal(unrelatedGate.blocked,false);
});
