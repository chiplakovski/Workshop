// Pure-helper tests for jobcard-rules.js — the exact module jobcard-desktop.html loads, so these
// tests exercise the real logic the page runs, not a reimplementation of it.
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {canCompleteOp,resumeTargetFor,VALID_RESUME_TARGETS}=require('../jobcard-rules.js');

test('canCompleteOp: an operation without a worker cannot be completed, even with logged hours', ()=>{
  assert.equal(canCompleteOp({worker:'',loggedHours:8}),false);
});

test('canCompleteOp: an operation without positive logged hours cannot be completed, even with a worker', ()=>{
  assert.equal(canCompleteOp({worker:'Marko K.',loggedHours:0}),false);
  assert.equal(canCompleteOp({worker:'Marko K.',loggedHours:-2}),false);
  assert.equal(canCompleteOp({worker:'Marko K.',loggedHours:NaN}),false);
  assert.equal(canCompleteOp({worker:'Marko K.',loggedHours:'not a number'}),false);
});

test('canCompleteOp: an operation with both a worker and positive logged hours can be completed', ()=>{
  assert.equal(canCompleteOp({worker:'Marko K.',loggedHours:6}),true);
});

test('resumeTargetFor: resumes to the recorded _resumeStatus when it is a legitimate status', ()=>{
  for(const status of VALID_RESUME_TARGETS){
    assert.equal(resumeTargetFor({_resumeStatus:status}),status);
  }
});

test('resumeTargetFor: falls back to a safe status when _resumeStatus is missing or invalid', ()=>{
  assert.equal(resumeTargetFor({}),'ready');
  assert.equal(resumeTargetFor({_resumeStatus:null}),'ready');
  assert.equal(resumeTargetFor({_resumeStatus:'completed'}),'ready','must never resume to a final status');
  assert.equal(resumeTargetFor({_resumeStatus:'closed'}),'ready','must never resume to a final status');
  assert.equal(resumeTargetFor({_resumeStatus:'bogus-status'}),'ready');
});
