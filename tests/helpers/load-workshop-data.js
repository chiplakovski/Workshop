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

// Returns a fresh WorkshopData instance backed by its own isolated localStorage, optionally
// pre-seeded with raw string values under given keys (to simulate existing browser data).
function loadWorkshopData(seedEntries){
  const src=fs.readFileSync(path.join(__dirname,'..','..','workshop-data.js'),'utf8');
  const g={};
  g.localStorage=new MemoryLocalStorage();
  g.window=g;
  g.dispatchEvent=()=>{};
  g.CustomEvent=function(type,init){this.type=type;this.detail=init&&init.detail;};
  if(seedEntries){for(const[key,value]of Object.entries(seedEntries))g.localStorage.setItem(key,value);}
  const fn=new Function('window',src+'\nreturn window.WorkshopData;');
  return fn(g);
}

module.exports={loadWorkshopData,MemoryLocalStorage};
