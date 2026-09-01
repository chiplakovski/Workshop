// Loads the real workshop-data.js against a minimal in-memory localStorage shim, so tests exercise
// the exact same module the browser pages load — no reimplementation, no mocking of its internals.
'use strict';
const fs=require('fs');
const path=require('path');

class MemoryLocalStorage{
  constructor(){this.store=new Map();}
  getItem(key){return this.store.has(key)?this.store.get(key):null;}
  setItem(key,value){this.store.set(key,String(value));}
  removeItem(key){this.store.delete(key);}
  key(i){return Array.from(this.store.keys())[i];}
  get length(){return this.store.size;}
}

function buildEnv(seedEntries,customLocalStorage){
  const g={};
  g.localStorage=customLocalStorage||new MemoryLocalStorage();
  g.window=g;
  // A real (if minimal) pub-sub, not a no-op - workshop-data.js registers a 'storage' listener and
  // dispatches 'workshop:data' on both a local save() and a reload triggered by that listener;
  // tests need to actually observe both to verify the cross-tab reload mechanism, not just confirm
  // it doesn't throw.
  const listeners={};
  g.addEventListener=(type,fn)=>{(listeners[type]=listeners[type]||[]).push(fn);};
  g.removeEventListener=(type,fn)=>{if(listeners[type])listeners[type]=listeners[type].filter(f=>f!==fn);};
  g.dispatchEvent=(evt)=>{(listeners[evt.type]||[]).forEach(fn=>fn(evt));};
  g.CustomEvent=function(type,init){this.type=type;this.detail=init&&init.detail;};
  // Mirrors the real browser's <script src="quality-gates.js"></script> / <script
  // src="equipment-gates.js"></script> loading BEFORE workshop-data.js, so workshop-data.js's
  // window.QualityGates/window.EquipmentGates lookups find the real modules — exactly the logic
  // the pages use, never a reimplementation.
  g.QualityGates=require(path.join(__dirname,'..','..','quality-gates.js'));
  g.EquipmentGates=require(path.join(__dirname,'..','..','equipment-gates.js'));
  // Mirrors jobcard-desktop.html's <script src="jobcard-equipment-rules.js"></script> loading BEFORE
  // workshop-data.js — startJobcardOperation() depends on it being present on `window`.
  g.JobcardEquipmentRules=require(path.join(__dirname,'..','..','jobcard-equipment-rules.js'));
  if(seedEntries){for(const[key,value]of Object.entries(seedEntries))g.localStorage.setItem(key,value);}
  return g;
}

// Returns a fresh WorkshopData instance backed by its own isolated localStorage, optionally
// pre-seeded with raw string values under given keys (to simulate existing browser data). Pass
// customLocalStorage to inject a storage implementation with different behaviour (e.g. one that
// throws on setItem, to simulate the browser rejecting a write).
function loadWorkshopData(seedEntries,customLocalStorage){
  const src=fs.readFileSync(path.join(__dirname,'..','..','workshop-data.js'),'utf8');
  const g=buildEnv(seedEntries,customLocalStorage);
  const fn=new Function('window',src+'\nreturn window.WorkshopData;');
  return fn(g);
}

// Same as loadWorkshopData, but also returns the localStorage instance backing it, so a test can
// inspect exactly what keys/raw values were written (e.g. rescue-copy keys).
function loadWorkshopDataWithStorage(seedEntries,customLocalStorage){
  const src=fs.readFileSync(path.join(__dirname,'..','..','workshop-data.js'),'utf8');
  const g=buildEnv(seedEntries,customLocalStorage);
  const fn=new Function('window',src+'\nreturn window.WorkshopData;');
  return {WD:fn(g),localStorage:g.localStorage};
}

// Same as loadWorkshopData, but also returns the raw `window` stub itself (localStorage +
// addEventListener/dispatchEvent), so a test can simulate a real browser 'storage' event firing
// (as another tab's write would trigger) and observe any event WorkshopData dispatches in response.
function loadWorkshopDataWithEnv(seedEntries,customLocalStorage){
  const src=fs.readFileSync(path.join(__dirname,'..','..','workshop-data.js'),'utf8');
  const g=buildEnv(seedEntries,customLocalStorage);
  const fn=new Function('window',src+'\nreturn window.WorkshopData;');
  return {WD:fn(g),localStorage:g.localStorage,window:g};
}

module.exports={loadWorkshopData,loadWorkshopDataWithStorage,loadWorkshopDataWithEnv,MemoryLocalStorage};
