(function(global){
  'use strict';
  const KEY='varmak.workshop.frontend.v5';
  const LEGACY_KEY_V4='varmak.workshop.frontend.v4';
  const LEGACY_KEY_V3='varmak.workshop.frontend.v3';
  const VERSION=5;
  // Legacy module-specific keys, migrated into the shared v5 state once and then left untouched
  // as recovery sources (see migrateLegacyModuleData()).
  const LEGACY_PROJECTS_KEY='varmak.projects.ui.v1';
  const LEGACY_PURCHASING_KEY='varmak.purchasing.orders';
  const LEGACY_DOCUMENTS_KEY='varmak.documents.records';
  const LEGACY_REPORTS_CONFIG_KEY='varmak.reports.config.v1';
  const LEGACY_REPORTS_SAVED_KEY='varmak.reports.saved.v1';
  // The Projects module's own (page-local, non-persisted, fixed) customer picklist — used only to
  // resolve customerId values found in varmak.projects.ui.v1 records to a real shared customer by
  // name, since that legacy key's customerId numbering is relative to this fixed local list, not
  // to the shared customers collection.
  // The fixed list those numbers pointed at was seven invented bakeries and food firms from the first
  // prototype, so it is gone: a legacy record now keeps the customer name it carries itself, if any, and
  // is never handed a made-up one.
  // A lookup for a record that is not there answers "not there". It used to throw, because
  // JSON.parse("undefined") is a syntax error - so findCustomer('nope') crashed the page rather
  // than returning nothing. Twenty-two lookups shared that fault, and on an empty system they are
  // reached constantly.
  const clone=value=>value===undefined?null:JSON.parse(JSON.stringify(value));
  const now=()=>new Date().toISOString();
  // A new workshop opens an empty system. Nothing here is invented: no customers it has not
  // won, no machines it does not own, no jobs it has not been given. The shape is complete so
  // every module has something real to read; the content is what the workshop puts in.
  // What this module writes where a caller did not say who was doing something. It used to write
  // one hardcoded name — thirty-three times, in an activity line, a note's author, a stock movement, an
  // inspection's createdBy, a CAPA's verifier — so a browser-storage workshop recorded him as having done
  // everything anybody did. This module cannot know who is signed in: the snapshot answers that, and only
  // when there is a server. So it writes the em dash and the caller supplies the name.
  const UNNAMED='\u2014';

  const emptyState=()=>({
    version:VERSION,
    counters:{customer:0,estimation:0,project:0,movement:0,offcut:0,jobcard:0,inspection:0,ncr:0,capa:0,weld:0,ndt:0,itp:0,hold:0,complaint:0,release:0,dossier:0,wps:0,welderqual:0,purchaseOrder:0,purchaseRfq:0,supplierInvoice:0,document:0,documentFolder:0,invoice:0,marketingLead:0,marketingOpportunity:0,marketingCampaign:0,marketingTender:0,hours:0,wps:0,welderqual:0},
    customers:[],
    estimations:[],
    projects:[],
    equipment:[],
    // Kept, because these are a classification scheme rather than anything invented about this
    // workshop - every metal shop sorts stock into materials, consumables, hardware and tooling,
    // and stores it on a shelf in a warehouse. Without them the first thing a new workshop must do
    // is design a numbering scheme before it can enter a single bolt. Rename or delete them freely.
    //
    // Written out here rather than borrowed from the demonstration, which is what it used to do,
    // because the demonstration's groups carried its counters: `next:1003` in Materials, `next:2002` in
    // Consumables, `next:3001` in Hardware. A workshop starting clean got those too, so its first
    // stainless steel item would have been numbered 1003 and nothing on any screen would explain
    // where 1000, 1001 and 1002 had gone. Here `next` is `start`, because nothing has been entered.
    locationGroups:[
      {id:'warehouse',name:'Warehouse',subgroups:[
        {id:'wh1-shelves',name:'Warehouse 1 - shelves'},
        {id:'wh2-rack',name:'Warehouse 2 - rack'}]}
    ],
    itemGroups:[
      {id:'materials',name:'Materials',start:1000,next:1000,subgroups:[
        {id:'stainless-steel',name:'Stainless steel'},{id:'mild-steel',name:'Mild steel'},
        {id:'aluminium',name:'Aluminium'},{id:'copper',name:'Copper'},{id:'pipe-fittings',name:'Pipe & fittings'}]},
      {id:'consumables',name:'Consumables',start:2000,next:2000,subgroups:[
        {id:'welding',name:'Welding consumables'},{id:'abrasives',name:'Abrasives'},
        {id:'gases',name:'Gases'},{id:'paint',name:'Paint & coatings'}]},
      {id:'hardware',name:'Hardware',start:3000,next:3000,subgroups:[
        {id:'fasteners',name:'Fasteners'},{id:'seals',name:'Seals & gaskets'}]},
      {id:'tooling',name:'Tooling',start:4000,next:4000,subgroups:[
        {id:'cutting-tools',name:'Cutting tools'},{id:'hand-tools',name:'Hand tools'}]}
    ],
    inventory:[],
    movements:[],
    offcuts:[],
    suppliers:[],
    jobcards:[],
    qualityInspections:[],
    qualityWelds:[],
    qualityNdt:[],
    qualityNcrs:[],
    qualityCapas:[],
    qualityHolds:[],
    qualityWps:[],
    qualityWelderQuals:[],
    qualityComplaints:[],
    qualityDossiers:[],
    qualityItps:[],
    qualityReleases:[],
    supplierQuality:[],
    purchaseOrders:[],
    purchaseRfqs:[],
    supplierInvoices:[],
    documents:[],
    documentFolders:[],
    invoices:[],
    marketingLeads:[],
    marketingOpportunities:[],
    marketingTenders:[],
    prospectFindings:[],
    prospectSeen:[],
    prospectSweeps:[],
    marketingCampaigns:[],
    savedReports:[],
    // The staff, from the snapshot. Empty in browser-storage mode, and deliberately: this module has
    // no way to know who works at a workshop, and the six pages that used to guess are the reason
    // every note in this system was signed by the same man.
    people:[],
    barcodeLinks:{},
    reportConfig:{}
  });

  // There is no demonstration here any more. A populated workshop of invented customers, people
  // and suppliers used to sit at this point as demoState(), with loadDemoData() and
  // ensureDemoEquipment() to pour it in. Nothing loaded it on its own, but it shipped in the file
  // every page loads, and every record in it was made up. The browser suites that need a populated
  // workshop take theirs from tests/fixtures/workshop-state.js, which the server never serves.
  const seed=emptyState;
  // Recognized top-level collections used to sanity-check that a stored/imported JSON blob is
  // actually workshop data (not garbage, not an unrelated app's leftover value under a reused key).
  const KNOWN_COLLECTION_KEYS=['customers','estimations','projects','inventory','equipment','jobcards',
    'suppliers','hours','movements','offcuts','stockCounts','activity','qualityInspections','qualityNcrs',
    'purchaseOrders','purchaseRfqs','supplierInvoices','documents','documentFolders','invoices','marketingLeads','marketingOpportunities','marketingCampaigns','savedReports'];
  function safeParseJSON(raw){
    if(!raw)return null;
    try{const p=JSON.parse(raw);return(p&&typeof p==='object')?p:null;}catch(e){return null;}
  }
  function looksLikeWorkshopState(obj){
    if(!obj||typeof obj!=='object')return false;
    return KNOWN_COLLECTION_KEYS.some(k=>Array.isArray(obj[k]));
  }
  // Readable migration/data-health summary exposed via WorkshopData.getDataHealth(). migrationSource
  // identifies where the active data actually came from: 'v5' (already current), 'v4' or 'v3'
  // (migrated from that legacy schema version), 'demo' (fresh install, no usable prior data) or
  // 'import' (set by importBackup()). moduleMigrations lists which legacy per-module keys (if any)
  // were folded into this state during migration.
  let dataHealth={sourceKey:KEY,migratedFromLegacy:false,recoveryWarning:null,schemaVersion:VERSION,corruptedV5Detected:false,corruptedRecordPreserved:false,migrationSource:'v5',moduleMigrations:[]};

  function resolveOrCreateCustomerInState(base,name){
    const trimmed=name?String(name).trim():'';
    if(!trimmed)return null;
    let c=base.customers.find(x=>x.name&&x.name.trim().toLowerCase()===trimmed.toLowerCase());
    if(!c){
      base.counters.customer=(base.counters.customer||0)+1;
      c={id:base.counters.customer,no:'C-'+String(base.counters.customer).padStart(3,'0'),name:trimmed,status:'active',contacts:[],notes:[],documents:[]};
      base.customers.push(c);
    }
    return c;
  }
  const PROJECTS_UI_STATUS_PHASE={draft:'design',quotation:'design',approved:'design',planned:'design',active:'production',hold:'production',completed:'closeout',closed:'closeout',cancelled:'closeout'};
  const PROJECTS_UI_STATUS_PROGRESS={draft:0,quotation:0,approved:0,planned:0,active:50,hold:40,completed:100,closed:100,cancelled:0};
  const PROJECTS_UI_NO_PATTERN=/^P-26-\d{4}$/;
  // Migrates varmak.projects.ui.v1 into base.projects. The legacy key's customerId numbering is
  // relative to the Projects module's own fixed local picklist, not the shared customers
  // collection, so every record is resolved-or-created by customer NAME instead of trusted as-is.
  // A present (even empty) legacy key is authoritative for the projects-ui-origin record set: it
  // replaces the demo set (identified by its P-26-NNNN numbering) rather than merging into it, so
  // an intentionally emptied project list stays empty and edited demo projects are not duplicated.
  function migrateLegacyProjectsKey(base){
    let raw=null;try{raw=global.localStorage&&global.localStorage.getItem(LEGACY_PROJECTS_KEY);}catch(e){}
    if(raw==null)return false;
    const parsed=safeParseJSON(raw);
    if(!Array.isArray(parsed))return false;
    base.projects=(base.projects||[]).filter(p=>!PROJECTS_UI_NO_PATTERN.test(p.no||''));
    parsed.forEach(legacyP=>{
      const customerName=legacyP.customer;
      const customer=resolveOrCreateCustomerInState(base,customerName);
      const usedHours=(legacyP.hours||[]).reduce((s,h)=>s+(Number(h.hours)||0),0);
      const workers=[...new Set([legacyP.workshop,...(legacyP.jobcards||[]).map(j=>j.assigned)].filter(Boolean).filter(w=>w!=='Team'))];
      base.counters.project=(base.counters.project||0)+1;
      const rec=Object.assign({},legacyP,{
        id:base.counters.project,
        customerId:customer?customer.id:null,
        customer:customer?customer.name:(legacyP.customer||''),
        estimationId:null,
        phase:PROJECTS_UI_STATUS_PHASE[legacyP.status]||'design',
        start:legacyP.actualStart||legacyP.plannedStart||legacyP.createdDate||'',
        expectedCompletion:legacyP.plannedCompletion||legacyP.deadline||'',
        progress:PROJECTS_UI_STATUS_PROGRESS[legacyP.status]!=null?PROJECTS_UI_STATUS_PROGRESS[legacyP.status]:0,
        plannedHours:legacyP.estLabourHours||0,usedHours,
        responsible:legacyP.pm||UNNAMED,workers,
        machines:[],materialStatus:'unchecked',bom:[],tasks:[],milestones:[]
      });
      base.projects.push(rec);
    });
    return true;
  }
  // Migrates a legacy key holding a plain array (Purchasing, Documents) into the given base
  // collection: a present (even empty) legacy array fully replaces the demo/seed set for that
  // collection — reproducing exactly the whole-array-replace behaviour those pages always had —
  // so an intentionally emptied collection stays empty rather than falling back to demo content.
  function migrateLegacyArrayKey(base,legacyKey,collectionName,ensureId){
    let raw=null;try{raw=global.localStorage&&global.localStorage.getItem(legacyKey);}catch(e){}
    if(raw==null)return false;
    const parsed=safeParseJSON(raw);
    if(!Array.isArray(parsed))return false;
    base[collectionName]=parsed.map((rec,i)=>ensureId&&rec.id==null?Object.assign({id:i+1},rec):rec);
    return true;
  }
  // Migrates varmak.reports.saved.v1 ({reports:[...]}) into base.savedReports, and
  // varmak.reports.config.v1 (a plain object) into base.reportConfig. Both replace the demo/seed
  // value when the legacy key is present and valid, for the same reason as migrateLegacyArrayKey.
  function migrateLegacyReportsKeys(base){
    const notes=[];
    let rawSaved=null;try{rawSaved=global.localStorage&&global.localStorage.getItem(LEGACY_REPORTS_SAVED_KEY);}catch(e){}
    if(rawSaved!=null){
      const parsedSaved=safeParseJSON(rawSaved);
      if(parsedSaved&&Array.isArray(parsedSaved.reports)){base.savedReports=parsedSaved.reports;notes.push(LEGACY_REPORTS_SAVED_KEY);}
    }
    let rawConfig=null;try{rawConfig=global.localStorage&&global.localStorage.getItem(LEGACY_REPORTS_CONFIG_KEY);}catch(e){}
    if(rawConfig!=null){
      const parsedConfig=safeParseJSON(rawConfig);
      if(parsedConfig&&typeof parsedConfig==='object'&&!Array.isArray(parsedConfig)){base.reportConfig=parsedConfig;notes.push(LEGACY_REPORTS_CONFIG_KEY);}
    }
    return notes;
  }
  // Folds every legacy per-module key into `base` in place. Only called while building a state
  // that will be saved as the very first v5 record — once v5 exists this never runs again, so
  // migration is idempotent by construction (see load()). Returns the list of legacy keys that
  // actually contributed data, for an honest getDataHealth() report.
  function migrateLegacyModuleData(base){
    const notes=[];
    if(migrateLegacyProjectsKey(base))notes.push(LEGACY_PROJECTS_KEY);
    if(migrateLegacyArrayKey(base,LEGACY_PURCHASING_KEY,'purchaseOrders',true))notes.push(LEGACY_PURCHASING_KEY);
    if(migrateLegacyArrayKey(base,LEGACY_DOCUMENTS_KEY,'documents',false))notes.push(LEGACY_DOCUMENTS_KEY);
    notes.push(...migrateLegacyReportsKeys(base));
    return notes;
  }

  function load(){
    let v5Raw=null;
    try{v5Raw=global.localStorage&&global.localStorage.getItem(KEY);}catch(e){}
    const v5Parsed=v5Raw?safeParseJSON(v5Raw):null;
    const v5Corrupted=!!(v5Raw&&(v5Parsed===null||!looksLikeWorkshopState(v5Parsed)));

    if(v5Parsed&&looksLikeWorkshopState(v5Parsed)){
      dataHealth={sourceKey:KEY,migratedFromLegacy:false,recoveryWarning:null,schemaVersion:VERSION,corruptedV5Detected:false,corruptedRecordPreserved:false,migrationSource:'v5',moduleMigrations:[]};
      if(v5Parsed.version===VERSION)return normalize(v5Parsed);
      return normalize(Object.assign(seed(),v5Parsed));
    }

    // v5 is corrupted (present but unreadable/unrecognisable) — rescue the raw original value to a
    // dedicated key IMMEDIATELY, exactly once per load, before any later save() can overwrite the
    // only copy. This happens whether or not a v4/v3 backup is found below, and never touches or
    // deletes the v4/v3 keys themselves.
    let rescueSaved=false;
    if(v5Corrupted){
      const rescueKey=`${KEY}.corrupted.${Date.now()}`;
      try{
        global.localStorage&&global.localStorage.setItem(rescueKey,v5Raw);
        rescueSaved=true;
      }catch(e){/* browser storage rejected the rescue write — surfaced via recoveryWarning below */}
    }

    // v5 is missing or unusable — try v4, then v3, then fall back to an empty workshop.
    // Neither legacy key is ever modified or deleted; both remain available as recovery sources.
    let v4Raw=null;try{v4Raw=global.localStorage&&global.localStorage.getItem(LEGACY_KEY_V4);}catch(e){}
    const v4Parsed=v4Raw?safeParseJSON(v4Raw):null;
    let v3Raw=null;try{v3Raw=global.localStorage&&global.localStorage.getItem(LEGACY_KEY_V3);}catch(e){}
    const v3Parsed=v3Raw?safeParseJSON(v3Raw):null;

    let base,migrationSource,sourceKey;
    if(v4Parsed&&looksLikeWorkshopState(v4Parsed)){
      base=Object.assign(seed(),clone(v4Parsed));migrationSource='v4';sourceKey=LEGACY_KEY_V4;
    }else if(v3Parsed&&looksLikeWorkshopState(v3Parsed)){
      base=Object.assign(seed(),clone(v3Parsed));migrationSource='v3';sourceKey=LEGACY_KEY_V3;
    }else{
      base=seed();migrationSource='demo';sourceKey=null;
    }

    // Fold in legacy per-module data regardless of which branch above produced `base` — a user may
    // have real Projects/Purchasing/Documents/Reports data even with no v3/v4 shared-data blob.
    const moduleMigrations=migrateLegacyModuleData(base);
    const migrated=normalize(base);
    migrated.activity=migrated.activity||[];
    const reasonParts=[];
    if(migrationSource==='v4')reasonParts.push(`Migrated data from ${LEGACY_KEY_V4} to ${KEY}.`);
    else if(migrationSource==='v3')reasonParts.push(`Migrated data from ${LEGACY_KEY_V3} to ${KEY}.`);
    if(v5Corrupted)reasonParts.push(`The current data record was found corrupted.${rescueSaved?' The corrupted record was preserved separately.':' The corrupted record could not be preserved.'}`);
    if(moduleMigrations.length)reasonParts.push(`Legacy module data migrated from: ${moduleMigrations.join(', ')}.`);
    if(reasonParts.length)migrated.activity.unshift({time:now(),reason:reasonParts.join(' ')});
    try{global.localStorage&&global.localStorage.setItem(KEY,JSON.stringify(migrated));}catch(e){}

    const recovered=migrationSource==='v4'||migrationSource==='v3';
    dataHealth={
      sourceKey,
      migratedFromLegacy:recovered,
      recoveryWarning:v5Corrupted
        ?(rescueSaved
          ?`Your current data could not be read${recovered?', so your older saved data was recovered instead':''}. The unreadable record was preserved separately and was not deleted.`
          :`Your current data could not be read${recovered?', so your older saved data was recovered instead':''}. The unreadable record could not be preserved (browser storage rejected the rescue write).`)
        :null,
      schemaVersion:VERSION,corruptedV5Detected:v5Corrupted,corruptedRecordPreserved:v5Corrupted&&rescueSaved,
      migrationSource,moduleMigrations
    };
    return migrated;
  }
  // Safe default-normalization: older localStorage records (saved before Jobcards or Equipment existed)
  // are backfilled in place rather than being wiped. This preserves the user's prior browser data while
  // adding the missing arrays and counters required by the new Equipment & Machines workflow.
  // ---- Item groups, subgroups and per-group numbering ----------------------
  // Every stock item belongs to a group whose numbers run from its own start
  // (Materials 1000, Consumables 2000, ...). The number is allocated once, on
  // creation, and never reused, so an issued or received line always points at
  // the same item even after the item is renamed or moved between subgroups.
  const round2=n=>Math.round((Number(n)||0)*100)/100;
  const slug=v=>String(v||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  // Categories the pre-group data used, mapped onto a group and subgroup so
  // inventory saved before this change keeps its meaning instead of landing in
  // an "uncategorised" bucket.
  const LEGACY_CATEGORY_MAP={
    'stainless sheet':['materials','stainless-steel'],'stainless steel':['materials','stainless-steel'],
    'mild steel tube':['materials','mild-steel'],'mild steel':['materials','mild-steel'],
    'aluminium':['materials','aluminium'],'copper':['materials','copper'],
    'pipe':['materials','pipe-fittings'],'fittings':['materials','pipe-fittings'],
    'welding consumable':['consumables','welding'],'abrasives':['consumables','abrasives'],
    'gases':['consumables','gases'],'paint':['consumables','paint'],
    'fasteners':['hardware','fasteners'],'seals':['hardware','seals'],
    'cutting tools':['tooling','cutting-tools'],'hand tools':['tooling','hand-tools']
  };
  function groupFor(st,id){return (st.itemGroups||[]).find(g=>g.id===id)||null;}
  function allocateItemNumber(st,groupId){
    const g=groupFor(st,groupId);
    if(!g)return null;
    const start=Number(g.start)||0;
    // Never hand out a number an item already holds, even if `next` is stale
    // from an import or a hand-edited backup.
    const used=(st.inventory||[]).filter(x=>x.group===groupId).reduce((m,x)=>Math.max(m,Number(x.itemNo)||0),0);
    const nextNo=Math.max(Number(g.next)||start,start,used?used+1:start);
    g.next=nextNo+1;
    return nextNo;
  }
  function migrateItemNumbers(st){
    if(!Array.isArray(st.inventory)||!Array.isArray(st.itemGroups))return;
    const fallback=st.itemGroups[0];
    st.inventory.forEach(item=>{
      if(!item.group||!groupFor(st,item.group)){
        const mapped=LEGACY_CATEGORY_MAP[String(item.category||'').trim().toLowerCase()];
        if(mapped&&groupFor(st,mapped[0])){item.group=mapped[0];if(!item.subgroup)item.subgroup=mapped[1];}
        else if(fallback)item.group=fallback.id;
      }
      if(!Number(item.itemNo))item.itemNo=allocateItemNumber(st,item.group);
    });
  }

  function normalize(s){
    if(!s||typeof s!=='object')s={};
    const base=seed();
    s.version=VERSION;
    s.counters=Object.assign({},base.counters,s.counters||{});
    if(!Array.isArray(s.customers))s.customers=base.customers;
    if(!Array.isArray(s.estimations))s.estimations=base.estimations;
    if(!Array.isArray(s.projects))s.projects=base.projects;
    if(!Array.isArray(s.inventory))s.inventory=base.inventory;
    if(!Array.isArray(s.locationGroups)||!s.locationGroups.length)s.locationGroups=base.locationGroups;
    s.locationGroups.forEach(g=>{if(!Array.isArray(g.subgroups))g.subgroups=[];});
    if(!Array.isArray(s.itemGroups)||!s.itemGroups.length)s.itemGroups=base.itemGroups;
    s.itemGroups.forEach(g=>{if(!Array.isArray(g.subgroups))g.subgroups=[];});
    migrateItemNumbers(s);
    if(!Array.isArray(s.movements))s.movements=base.movements;
    if(!Array.isArray(s.offcuts))s.offcuts=base.offcuts;
    if(!Array.isArray(s.suppliers))s.suppliers=[];
    if(!Array.isArray(s.jobcards))s.jobcards=[];
    if(!Array.isArray(s.equipment))s.equipment=base.equipment;
    if(!Array.isArray(s.stockCounts))s.stockCounts=[];
    if(!Array.isArray(s.hours))s.hours=[];
    if(!Array.isArray(s.activity))s.activity=[];
    if(!Array.isArray(s.breakdowns))s.breakdowns=[];
    if(!Array.isArray(s.qualityInspections))s.qualityInspections=base.qualityInspections;
    if(!Array.isArray(s.qualityWelds))s.qualityWelds=base.qualityWelds;
    if(!Array.isArray(s.qualityNdt))s.qualityNdt=base.qualityNdt;
    if(!Array.isArray(s.qualityNcrs))s.qualityNcrs=base.qualityNcrs;
    if(!Array.isArray(s.qualityCapas))s.qualityCapas=base.qualityCapas;
    if(!Array.isArray(s.qualityHolds))s.qualityHolds=base.qualityHolds;
    if(!Array.isArray(s.qualityWps))s.qualityWps=base.qualityWps;
    if(!Array.isArray(s.qualityWelderQuals))s.qualityWelderQuals=base.qualityWelderQuals;
    if(!Array.isArray(s.qualityComplaints))s.qualityComplaints=base.qualityComplaints;
    if(!Array.isArray(s.qualityDossiers))s.qualityDossiers=base.qualityDossiers;
    if(!Array.isArray(s.qualityItps))s.qualityItps=base.qualityItps;
    if(!Array.isArray(s.qualityReleases))s.qualityReleases=[];
    if(!Array.isArray(s.supplierQuality))s.supplierQuality=base.supplierQuality;
    if(!Array.isArray(s.purchaseOrders))s.purchaseOrders=base.purchaseOrders;
    if(!Array.isArray(s.purchaseRfqs))s.purchaseRfqs=[];
    if(!Array.isArray(s.supplierInvoices))s.supplierInvoices=[];
    if(!Array.isArray(s.documents))s.documents=base.documents;
    if(!Array.isArray(s.documentFolders))s.documentFolders=[];
    if(!Array.isArray(s.invoices))s.invoices=[];
    if(!Array.isArray(s.marketingLeads))s.marketingLeads=base.marketingLeads;
    if(!Array.isArray(s.marketingOpportunities))s.marketingOpportunities=base.marketingOpportunities;
    if(!Array.isArray(s.marketingCampaigns))s.marketingCampaigns=base.marketingCampaigns;
    if(!Array.isArray(s.marketingTenders))s.marketingTenders=[];
    if(!Array.isArray(s.prospectFindings))s.prospectFindings=[];
    if(!Array.isArray(s.prospectSeen))s.prospectSeen=[];
    if(!Array.isArray(s.prospectSweeps))s.prospectSweeps=[];
    if(!Array.isArray(s.savedReports))s.savedReports=base.savedReports;
    if(!s.reportConfig||typeof s.reportConfig!=='object')s.reportConfig={};
    s.qualityInspections.forEach(r=>{if(!Array.isArray(r.notes))r.notes=[];if(!Array.isArray(r.activity))r.activity=[];if(!Array.isArray(r.checklist))r.checklist=[];if(!Array.isArray(r.documents))r.documents=[];});
    s.qualityWelds.forEach(r=>{if(!Array.isArray(r.notes))r.notes=[];if(!Array.isArray(r.activity))r.activity=[];if(!Array.isArray(r.repairHistory))r.repairHistory=[];});
    s.qualityNdt.forEach(r=>{if(!Array.isArray(r.notes))r.notes=[];if(!Array.isArray(r.activity))r.activity=[];if(!Array.isArray(r.documents))r.documents=[];});
    s.qualityNcrs.forEach(r=>{if(!Array.isArray(r.notes))r.notes=[];if(!Array.isArray(r.activity))r.activity=[];if(!Array.isArray(r.documents))r.documents=[];if(r.status==null)r.status='open';});
    s.qualityCapas.forEach(r=>{if(!Array.isArray(r.notes))r.notes=[];if(!Array.isArray(r.activity))r.activity=[];if(!Array.isArray(r.fiveWhys))r.fiveWhys=[];if(r.fishbone==null)r.fishbone={};});
    s.qualityHolds.forEach(r=>{if(!Array.isArray(r.activity))r.activity=[];if(r.status==null)r.status='active';});
    s.qualityComplaints.forEach(r=>{if(!Array.isArray(r.notes))r.notes=[];if(!Array.isArray(r.activity))r.activity=[];if(!Array.isArray(r.documents))r.documents=[];});
    s.qualityItps.forEach(r=>{if(!Array.isArray(r.lines))r.lines=[];if(!Array.isArray(r.notes))r.notes=[];if(!Array.isArray(r.activity))r.activity=[];if(!Array.isArray(r.revisionHistory))r.revisionHistory=[];});
    s.qualityDossiers.forEach(r=>{if(!Array.isArray(r.items))r.items=[];if(!Array.isArray(r.notes))r.notes=[];if(!Array.isArray(r.activity))r.activity=[];});
    s.qualityReleases.forEach(r=>{if(!Array.isArray(r.activity))r.activity=[];});
    s.supplierQuality.forEach(r=>{if(!Array.isArray(r.notes))r.notes=[];if(!Array.isArray(r.activity))r.activity=[];});
    if(s.counters&&s.counters.jobcard==null)s.counters.jobcard=s.jobcards.length;
    if(s.counters&&s.counters.equipment==null)s.counters.equipment=s.equipment.length;
    s.jobcards.forEach(j=>{
      if(!Array.isArray(j.operations))j.operations=[];
      if(!Array.isArray(j.materials))j.materials=[];
      if(!Array.isArray(j.machines))j.machines=[];
      if(!Array.isArray(j.inspections))j.inspections=[];
      if(!Array.isArray(j.notes))j.notes=[];
      if(!Array.isArray(j.documents))j.documents=[];
      if(!Array.isArray(j.activity))j.activity=[];
      if(!Array.isArray(j.workers))j.workers=[];
      if(j.archived==null)j.archived=false;
      if(j.status==null)j.status='draft';
    });
    s.equipment.forEach(item=>{
      if(!Array.isArray(item.activity))item.activity=[];
      if(!Array.isArray(item.inspections))item.inspections=[];
      if(!Array.isArray(item.maintenance))item.maintenance=[];
      if(!Array.isArray(item.certifications))item.certifications=[];
      if(!Array.isArray(item.calibrations))item.calibrations=[];
      if(!Array.isArray(item.notesLog))item.notesLog=[];
      if(!Array.isArray(item.usageHistory))item.usageHistory=[];
      if(!Array.isArray(item.downtimeRecords))item.downtimeRecords=[];
      if(!Array.isArray(item.safetyWarnings))item.safetyWarnings=[];
      // currentAssignment is a plain object (or null) — never an array. A previous version of this
      // check used Array.isArray() to decide whether to backfill it, which (since Array.isArray on
      // a real object or on null is always false) wiped out a genuine assignment object back to []
      // on every single reload. Preserve a valid object and a real null; only a malformed array or
      // primitive value is converted to null.
      if(item.currentAssignment==null||Array.isArray(item.currentAssignment)||typeof item.currentAssignment!=='object'){
        item.currentAssignment=null;
      }
      // Pass 3.2A: two new safety-history arrays. A record from before this pass simply has neither
      // yet — backfilled the same non-destructive way as every other per-item array above, never
      // touching `requirements` (that object is intentionally left absent on legacy records; its
      // absence is what makes every requirement default to "not mandatory").
      if(!Array.isArray(item.preUseChecks))item.preUseChecks=[];
      if(!Array.isArray(item.returnToService))item.returnToService=[];
      if(item.status==null)item.status='Available';
      if(!item.equipmentId)item.equipmentId=item.id||`E-${String((s.counters.equipment||0)+1).padStart(4,'0')}`;
      if(!item.id)item.id=item.equipmentId;
    });
    // Projects now carry both the original shared-schema fields (bom/tasks/milestones/phase/...)
    // and the richer Projects-module fields (notes/jobcards/hours/materials/purchases/documents/
    // activity/...). A project created through a narrower path (e.g. createProjectFromEstimation)
    // only has the former — backfill safe empty defaults for the latter so the Projects UI never
    // has to guard against missing fields.
    s.projects.forEach(p=>{
      if(!Array.isArray(p.workers))p.workers=[];
      if(!Array.isArray(p.machines))p.machines=[];
      if(!Array.isArray(p.bom))p.bom=[];
      if(!Array.isArray(p.tasks))p.tasks=[];
      if(!Array.isArray(p.milestones))p.milestones=[];
      if(!Array.isArray(p.notes))p.notes=[];
      if(!Array.isArray(p.jobcards))p.jobcards=[];
      if(!Array.isArray(p.hours))p.hours=[];
      if(!Array.isArray(p.materials))p.materials=[];
      if(!Array.isArray(p.purchases))p.purchases=[];
      if(!Array.isArray(p.activity))p.activity=[];
      if(!Array.isArray(p.types))p.types=[];
      if(!p.documents||typeof p.documents!=='object')p.documents={};
      if(p.customerRef==null)p.customerRef='';
      if(p.poNumber==null)p.poNumber='';
      if(p.description==null)p.description='';
      if(p.pm==null)p.pm='';
      if(p.workshop==null)p.workshop='';
      if(p.sales==null)p.sales='';
      if(p.createdDate==null)p.createdDate=p.start||'';
      if(p.plannedStart==null)p.plannedStart='';
      if(p.actualStart==null)p.actualStart='';
      if(p.plannedCompletion==null)p.plannedCompletion='';
      if(p.actualCompletion==null)p.actualCompletion='';
      if(p.closedDate==null)p.closedDate='';
      if(p.quotedValue==null)p.quotedValue=0;
      if(p.estLabourHours==null)p.estLabourHours=p.plannedHours||0;
      if(p.estMaterialCost==null)p.estMaterialCost=0;
      if(p.estPurchaseCost==null)p.estPurchaseCost=0;
      if(p.otherCostEst==null)p.otherCostEst=0;
      if(p.otherCostAct==null)p.otherCostAct=0;
      if(p.holdReason==null)p.holdReason='';
      if(p.holdComment==null)p.holdComment='';
      if(p.expectedResume==null)p.expectedResume='';
      if(p.cancelReason==null)p.cancelReason='';
      if(p.progress==null)p.progress=0;
      if(p.usedHours==null)p.usedHours=0;
      if(p.materialStatus==null)p.materialStatus='unchecked';
    });
    s.purchaseOrders.forEach(po=>{
      if(po.status==null)po.status='Draft';
      if(po.items==null)po.items='';
      if(po.receivedQty==null)po.receivedQty=0;
      if(po.receivedValue==null)po.receivedValue=0;
    });
    s.documents.forEach(d=>{
      if(!Array.isArray(d.notes))d.notes=[];
      if(d.status==null)d.status='Draft';
      if(d.fileData==null)d.fileData='';
      if(d.fileName==null)d.fileName=d.name||'';
      if(d.mimeType==null)d.mimeType='';
      if(d.fileSize==null)d.fileSize=0;
    });
    s.purchaseRfqs.forEach(r=>{if(r.status==null)r.status='Draft';if(r.archived==null)r.archived=false;});
    s.supplierInvoices.forEach(i=>{if(i.status==null)i.status='pending';if(i.currency==null)i.currency='SEK';if(i.archived==null)i.archived=false;});
    if(s.counters&&s.counters.purchaseRfq==null)s.counters.purchaseRfq=s.purchaseRfqs.length;
    if(s.counters&&s.counters.supplierInvoice==null)s.counters.supplierInvoice=s.supplierInvoices.length;
    s.documentFolders.forEach(f=>{if(f.archived==null)f.archived=false;});
    s.invoices.forEach(i=>{if(i.archived==null)i.archived=false;if(i.status==null)i.status='pending';if(i.currency==null)i.currency='SEK';});
    if(s.counters&&s.counters.documentFolder==null)s.counters.documentFolder=s.documentFolders.length;
    if(s.counters&&s.counters.invoice==null)s.counters.invoice=s.invoices.length;
    s.marketingLeads.forEach(l=>{
      if(!Array.isArray(l.notes))l.notes=[];
      if(!Array.isArray(l.activity))l.activity=[];
      if(l.dnc==null)l.dnc=false;
      if(l.status==null)l.status='new';
      if(l.linkedCustomerId===undefined)l.linkedCustomerId=null;
      if(l.linkedOpportunityId===undefined)l.linkedOpportunityId=null;
    });
    s.marketingOpportunities.forEach(o=>{
      if(!Array.isArray(o.activity))o.activity=[];
      if(!Array.isArray(o.services))o.services=[];
      if(o.stage==null)o.stage='discovery';
    });
    s.marketingCampaigns.forEach(c=>{
      if(!Array.isArray(c.activity))c.activity=[];
      if(!Array.isArray(c.targetServices))c.targetServices=[];
      if(!Array.isArray(c.targetIndustries))c.targetIndustries=[];
      if(!Array.isArray(c.channels))c.channels=[];
      if(c.status==null)c.status='active';
    });
    s.savedReports.forEach(r=>{if(r.archived==null)r.archived=false;});
    return s;
  }
  let state=load();
  // Cross-tab reactivity: the native 'storage' event fires on every OTHER same-origin tab/page when
  // localStorage changes (never on the tab that made the change itself) - the only way a page can
  // hear about a write made elsewhere without a full reload. Before this, every page's `state` was
  // loaded once at script start and simply went stale until manually reloaded; WorkshopData.get()
  // (and everything built on it) would keep returning what THIS tab last saw, even though a
  // DIFFERENT tab's write had already succeeded and was sitting in localStorage.
  // Re-running load() itself (rather than a lighter re-parse) keeps this the one single source of
  // truth for "how persisted state becomes a real state object" - safe to call again here because
  // this only fires in reaction to another tab's OWN save() having already succeeded, so v5Raw is
  // always present and valid at this point: load()'s pure, no-side-effect fast path (no
  // re-migration, no re-seeding, no rescue-write).
  // Re-dispatches the SAME 'workshop:data' event save() already fires on every local save, so any
  // page already listening for it to refresh its own local cache (e.g. documents-desktop.html)
  // gets real cross-tab updates for free, with no separate per-page wiring needed.
  // Guarded: the Node test harness's window stub (tests/helpers/load-workshop-data.js) does not
  // define addEventListener, matching how it already no-ops dispatchEvent for the same reason.
  if(typeof global.addEventListener==='function'){
    global.addEventListener('storage',e=>{
      if(e.key!==KEY&&e.key!==null)return;
      state=load();
      try{global.dispatchEvent(new CustomEvent('workshop:data',{detail:{reason:'Updated in another tab',state:clone(state)}}));}catch(err){}
    });
  }
  // ── Reading from the server instead of from this browser ─────────────────────────────────
  //
  // A page that has signed in adopts a snapshot from the backend, and from that moment this module
  // is a reader: the collections are whatever the server said, and writes do not belong here at all.
  // They go through WorkshopApi, because a write has to be checked by the database and a synchronous
  // function cannot wait for an answer from another machine.
  //
  // Opt-in per page, and only the wired pages opt in. Nothing changes for the fifteen pages still
  // running on browser storage — which is all of them but the phone hours screen today.
  let servedFrom=null;
  // Which collections the snapshot actually covers. The rest are left EMPTY rather than filled with
  // demo data: a screen showing three real jobs beside eleven invented ones is worse than a screen
  // showing three real jobs and nothing else, because nobody can tell which is which.
  const SERVED_COLLECTIONS = ['customers','projects','jobcards','equipment','hours','inventory','movements',
    // The merchants, because the non-conformance form asks which one a rejected batch came from.
    'suppliers',
    // The quality register. The database was already refusing to complete held work while the screen
    // showing the holds read them out of this browser's storage — so the gate and the list somebody
    // reads to understand the gate were looking at two different sets of facts.
    'qualityHolds','qualityInspections','qualityNcrs',
    // The sales pipeline, which arrives in the office's own payload rather than in the snapshot
    // everybody reads — `lead`, `opportunity` and `tender` are not granted to the floor at all.
    'marketingLeads','marketingOpportunities','marketingTenders',
    // The document register. Read by everybody, written by the office: a welder holding revision A of a
    // drawing while revision B is on file is the failure this register exists to prevent, so the floor has
    // to be able to see what is current. No file bytes in it — there is no object storage yet, and the
    // screen says so rather than offering a download that leads nowhere.
    'documents',
    // The welding registers. Read by everybody and written by whoever did the work: a welder logs their
    // own weld, and the procedures and qualifications are the office's. All four are here rather than in
    // the office's own payload because a welder needs to read the procedure they are welding to and the
    // qualification they hold — and nothing in any of them could be a price.
    'qualityWelds','qualityNdt','qualityWps','qualityWelderQuals',
    // The staff, so a form offering "Responsible" or "Owner" offers the people this workshop has
    // instead of the three names that were written into six pages. Narrowed by the row policy on
    // app_user before it ever gets here: the office sees everybody, the floor sees itself.
    'people'];
  // Who the snapshot was taken for, kept beside the records rather than only in the page that asked for
  // it. Three facts the database answers from the session rather than being told: the name, the role, and
  // the id the offline queue is keyed on. Every page has a badge saying whose session it is, and each one
  // that wanted these had to reach into its own copy of the snapshot to get them — which is why eleven
  // pages simply did not, and showed a name written into the markup instead.
  let takenFor={by:null,role:null,byId:null};
  function signedInAs(){return Object.assign({},takenFor);}

  function adoptSnapshot(data){
    if(!data||typeof data!=='object')throw new Error('adoptSnapshot needs a snapshot');
    const fresh=emptyState();
    SERVED_COLLECTIONS.forEach(name=>{if(Array.isArray(data[name]))fresh[name]=data[name];});
    state=fresh;
    takenFor={by:data.takenBy||null,role:data.takenRole||null,byId:data.takenById||null};
    // On the state too, so a page reading WorkshopData.get() has them without a second call. The names
    // are the snapshot's own, so a page that already reads `takenBy` off the payload reads the same word.
    state.takenBy=takenFor.by;state.takenRole=takenFor.role;state.takenById=takenFor.byId;
    servedFrom=data.takenAt||new Date().toISOString();
    try{global.dispatchEvent(new CustomEvent('workshop:data',{detail:{reason:'snapshot',state:clone(state)}}))}catch(e){}
    return state;
  }
  function isServerBacked(){return servedFrom!==null}
  function servedAt(){return servedFrom}
  function servedCollections(){return SERVED_COLLECTIONS.slice()}

  const ACTIVITY_KEPT=1000;
  function save(reason){
    // Refused rather than quietly written to browser storage. A page in server-backed mode that
    // still called a mutator here would put the record in a place the server never sees and the next
    // reload wipes — the worst possible outcome, because it looks like it worked.
    if(servedFrom!==null){
      throw new Error('this page is reading from the server: writes go through WorkshopApi, not browser storage'
        +(reason?` (tried to save: ${reason})`:''));
    }
    // The activity line is kept short: every save adds one, and on a PC that keeps everything in the
    // browser an uncapped log is what would one day fill storage and stop real records being written.
    if(reason){state.activity.unshift({time:now(),reason});if(state.activity.length>ACTIVITY_KEPT)state.activity.length=ACTIVITY_KEPT;}
    // A write browser storage refuses (full, or switched off) used to be swallowed, so the screen showed
    // the change and the next reload did not have it. Say so instead; the page decides how to show it.
    let written=true;
    try{global.localStorage&&global.localStorage.setItem(KEY,JSON.stringify(state))}catch(e){written=false}
    if(!written){try{global.dispatchEvent(new CustomEvent('workshop:not-saved',{detail:{reason}}))}catch(e){}}
    try{global.dispatchEvent(new CustomEvent('workshop:data',{detail:{reason,state:clone(state)}}))}catch(e){}return state}
  function quantity(value){const parsed=Number(value);return Number.isFinite(parsed)&&parsed>0?parsed:null}
  function next(type,prefix){state.counters[type]=(state.counters[type]||0)+1;return prefix+String(state.counters[type]).padStart(3,'0')}
  function inventory(code){return state.inventory.find(x=>x.code===code)}
  // Pass 3.2C review fix (numeric Project ID canonicalization): resolves by either the real
  // project.id (possibly numeric, e.g. a caller passing 14) or the canonical project.no string
  // (e.g. 'P-2026-001') — mirrors jobcard() below, which already resolved both. Strict === (never
  // loose coercion), matching jobcard()'s behaviour exactly.
  function project(idOrNo){return state.projects.find(x=>x.no===idOrNo||x.id===idOrNo)}
  // A UI-only display placeholder (e.g. the em-dash a page shows for "no customer selected") must
  // never be mistaken for a real customer name — these must never resolve to or create a Customer.
  function isPlaceholderCustomerName(name){
    const trimmed=name!=null?String(name).trim():'';
    return !trimmed||trimmed==='—'||trimmed==='-';
  }
  // Resolves a customer by name (case-insensitive), creating a minimal real customer record if
  // none matches yet, so callers (e.g. Projects/Marketing pages with their own local id numbering)
  // never have to trust a customerId that may not correspond to the shared customers collection.
  // Never fabricates a customer from a blank/whitespace/placeholder name.
  function resolveOrCreateCustomer(name){
    if(isPlaceholderCustomerName(name))return null;
    const trimmed=String(name).trim();
    let c=state.customers.find(x=>x.name&&x.name.trim().toLowerCase()===trimmed.toLowerCase());
    if(!c){c={id:state.counters.customer=(state.counters.customer||0)+1,no:'C-'+String(state.counters.customer).padStart(3,'0'),name:trimmed,status:'active',contacts:[],notes:[],documents:[]};state.customers.push(c);}
    return c;
  }
  function estimation(idOrNo){return state.estimations.find(x=>x.id===idOrNo||x.no===idOrNo)}
  function jobcard(idOrNo){return state.jobcards.find(x=>x.id===idOrNo||x.no===idOrNo)}
  function equip(idOrNo){return state.equipment.find(x=>x.equipmentId===idOrNo||x.id===idOrNo)}
  function addMovement(m){const rec=Object.assign({id:state.counters.movement++,time:now(),user:UNNAMED},m);state.movements.unshift(rec);save(`${rec.action} ${rec.code}`);return rec}
  function projectReadiness(p){const rows=(p.bom||[]).map(line=>{const inv=inventory(line.code),available=inv?Math.max(0,inv.stock-inv.reserved):0,missing=Math.max(0,line.required-(line.reserved||0));return Object.assign({},line,{stock:inv?inv.stock:0,available,missing})});return{status:rows.some(x=>x.missing>0)?'MATERIAL SHORTAGE':'READY FOR PRODUCTION',rows}}
  // ── Quality module helpers: thin, reused across all quality record types. ──
  function qFind(arr,idOrNo){return (arr||[]).find(x=>x.id===idOrNo||x.no===idOrNo);}
  function qActivity(rec,action,from,to,reference,reason,user){
    rec.activity=rec.activity||[];
    rec.activity.unshift({timestamp:now(),action,user:user||UNNAMED,from:from||null,to:to||null,reference:reference||rec.no,reason:reason||''});
  }
  function qCollection(name){
    const map={inspection:state.qualityInspections,ncr:state.qualityNcrs,capa:state.qualityCapas,weld:state.qualityWelds,ndt:state.qualityNdt,itp:state.qualityItps,hold:state.qualityHolds,complaint:state.qualityComplaints,dossier:state.qualityDossiers,release:state.qualityReleases,supplierQuality:state.supplierQuality};
    return map[name];
  }
  // ── Central Quality Hold safety gate (see quality-gates.js) ──
  // Every Jobcard number belonging to a Project, used to resolve "does any child Jobcard have an
  // active hold" for Project-level completion/closure/release checks.
  function jobcardNosForProject(projectNo){
    if(!projectNo)return[];
    return state.jobcards.filter(j=>j.projectNo===projectNo).map(j=>j.no);
  }
  function jobcardQualityGate(jobcardNo,projectNo){
    if(!global.QualityGates)throw new Error('quality-gates.js must be loaded before workshop-data.js');
    // getQualityGate() normalises a missing projectNo option to null (not undefined) before it
    // reaches here, so the fallback must treat null the same as undefined — otherwise a
    // Project-scoped hold silently stops reaching this jobcard whenever the caller (e.g. every
    // getJobcardQualityGate(jobcardNo) call from the UI) doesn't pass a projectNo explicitly.
    const resolvedProjectNo=projectNo!=null?projectNo:(()=>{const j=jobcard(jobcardNo);return j?j.projectNo:null;})();
    return global.QualityGates.getJobcardQualityGate(state.qualityHolds,jobcardNo,resolvedProjectNo);
  }
  function projectQualityGate(projectNo){
    if(!global.QualityGates)throw new Error('quality-gates.js must be loaded before workshop-data.js');
    return global.QualityGates.getProjectQualityGate(state.qualityHolds,projectNo,jobcardNosForProject(projectNo));
  }
  // Statuses that represent unsafe "execution"/"completion" transitions while a Quality Hold is
  // active. Anything else (pausing, editing metadata, adding notes/documents) remains allowed.
  const JOBCARD_UNSAFE_STATUSES=['in-progress','completed','closed'];
  // Pass 3.2C, Part B: "terminal" for equipment-assignment-context purposes — a Jobcard that is
  // completed/closed should never receive a NEW equipment reservation/assignment. Deliberately
  // narrower than JOBCARD_UNSAFE_STATUSES above (which also includes 'in-progress' for its own,
  // unrelated Quality-Hold-transition purpose) — an in-progress Jobcard is exactly the normal,
  // active target equipment gets assigned to. Projects only need to be real and non-archived.
  const JOBCARD_TERMINAL_STATUSES=['completed','closed'];
  const OPERATION_UNSAFE_STATUSES=['in-progress','completed','skipped'];
  const PROJECT_UNSAFE_STATUSES=['completed','closed'];
  // The complete, recognised operation-status vocabulary (matches OP_STATUSES in jobcard-desktop.html)
  // — used to validate any caller-supplied operation.status value, never to decide safety by itself.
  const OPERATION_STATUSES=['pending','in-progress','paused','completed','skipped'];
  // Review fix (Pass 3.2B independent review, finding 1): 'in-progress' is not just quality-hold-gated
  // like 'completed'/'skipped' — it has exactly ONE authoritative entry point, startJobcardOperation()
  // below. Every generic mutation path (updateJobcardOperation, addJobcardOperation, updateJobcard,
  // upsertJobcard, whether via a single patch or a whole operations-array replace) unconditionally
  // refuses a transition INTO this status — there is no alternate route around the dedicated method.
  const OPERATION_START_STATUS='in-progress';
  // Structured rejection for any attempt to move an operation into OPERATION_START_STATUS through a
  // path other than startJobcardOperation() — or, once inside startJobcardOperation() itself, for a
  // failed Quality Hold / equipment-safety-gate check. Never touches the target record.
  function operationStartBlockedResult(code,message,jcNo,operationId,extra){
    save(`Blocked: operation start (${code}) for ${jcNo}${operationId!=null?' operation '+operationId:''}`);
    return Object.assign({error:message,code,jobcardNo:jcNo,operationId:operationId!=null?operationId:null},extra||{});
  }
  // Builds the structured, backward-compatible error every gated mutation returns when blocked, and
  // records a meaningful blocked-attempt audit entry (via the normal save() activity log) WITHOUT
  // touching the target Project/Jobcard/Operation record itself.
  function qualityGateBlockedResult(action,reference,gate,extra){
    const holdNumbers=gate.holds.map(h=>h.no).filter(Boolean);
    save(`Blocked by active Quality Hold: ${action} for ${reference}${holdNumbers.length?' ('+holdNumbers.join(', ')+')':''}`);
    return Object.assign({
      error:`Blocked by an active Quality Hold (${holdNumbers.join(', ')||'unnumbered'}).`,
      code:'QUALITY_HOLD_ACTIVE',
      message:`${action} is blocked while ${holdNumbers.join(', ')||'an active Quality Hold'} remain active.`,
      holdNumbers,
      holds:clone(gate.holds),
      reasons:gate.reasons.slice(),
      projectNo:gate.projectNo,
      jobcardNo:gate.jobcardNo
    },extra||{});
  }
  // Finds every operation in an incoming `operations` array that represents a genuine transition
  // into an unsafe status (in-progress/completed/skipped) versus its stored counterpart — matched
  // by stable operation id, never array position. An incoming op with no matching stored op (a
  // brand-new op smuggled into a bulk save already set to an unsafe status) counts as a transition
  // too, since there is no prior safe state to compare against. Re-saving an operation that is
  // already in the same unsafe status is NOT a transition and must stay allowed.
  function unsafeOperationTransitions(existingOps,incomingOps){
    if(!Array.isArray(incomingOps))return[];
    const existingById=new Map((existingOps||[]).map(o=>[o.id,o]));
    return incomingOps.filter(op=>{
      if(!op||!OPERATION_UNSAFE_STATUSES.includes(op.status))return false;
      const existing=existingById.get(op.id);
      return !existing||existing.status!==op.status;
    });
  }
  // Review fix (2nd review, finding 2): a same-status re-save of an already in-progress operation is
  // intentionally allowed (ordinary field edits) — but equipmentId/machine are safety-controlled
  // while an operation stays in-progress; unlike unsafeOperationTransitions above (which only looks
  // at STATUS changes), this specifically catches an equipment swap smuggled into that "allowed"
  // same-status re-save, through a bulk operations-array replace. A genuine status change AWAY from
  // in-progress (e.g. pausing) is not caught here — editing equipment while actually pausing is fine,
  // since resuming always re-validates the equipment through startJobcardOperation() anyway.
  // Review fix (4th review, finding 2): a FULL operations-array replace has full-replacement
  // semantics — the incoming object IS what gets stored via Object.assign(j,data), not merged
  // field-by-field. So, unlike updateJobcardOperation()'s single-field PATCH (where an omitted key
  // legitimately means "leave unchanged" and hasOwnProperty is the correct check), omitting
  // equipmentId/machine here means the RESULTING value would be missing — that must count as a
  // change too. Compare the resulting values directly; never gate the comparison on hasOwnProperty.
  // Whether an incoming entry is even SUBJECT to this protection is decided by the STORED status
  // (was this operation in-progress?), not the incoming one.
  // Review fix (5th review): the ONLY transition that may be combined with an equipment edit is an
  // explicit, exact 'paused' — completed/skipped/pending (and, obviously, staying/re-entering
  // in-progress, or an omitted status) all remain fully equipment-protected. A caller was previously
  // able to rewrite which equipment performed the work by completing/skipping/reverting an operation
  // in the same call that changed its equipment — that is exactly the traceability bypass this
  // closes. By the time this runs, validateOperationsArrayPayload() has already guaranteed any
  // present op.status is one of the five recognised values, so a plain equality check is sufficient
  // and correct — no further hasOwnProperty/fallback logic is needed.
  function unsafeOperationEquipmentChanges(existingOps,incomingOps){
    if(!Array.isArray(incomingOps))return[];
    const existingById=new Map((existingOps||[]).map(o=>[o.id,o]));
    return incomingOps.filter(op=>{
      if(!op)return false;
      const existing=existingById.get(op.id);
      if(!existing||existing.status!==OPERATION_START_STATUS)return false;
      if(op.status==='paused')return false;
      return op.equipmentId!==existing.equipmentId||op.machine!==existing.machine;
    });
  }
  // Review fix (3rd review, finding A): a full `operations` array replace must never be usable to
  // silently delete a currently in-progress operation by simply omitting it — matched by stable id,
  // never array position/length. An operation missing from the incoming array counts as a deletion
  // attempt exactly like an operation present but demoted would be caught by other checks.
  function activeOperationDeletionAttempts(existingOps,incomingOps){
    if(!Array.isArray(incomingOps))return[];
    const incomingIds=new Set(incomingOps.filter(o=>o).map(o=>o.id));
    return (existingOps||[]).filter(op=>op&&op.status===OPERATION_START_STATUS&&!incomingIds.has(op.id));
  }
  // Review fix (3rd review, finding B): a full `machines` array replace must never be usable to
  // silently unlink the equipmentId a currently in-progress operation depends on for its
  // authorization (see canStartOperationEquipment() in jobcard-equipment-rules.js — it requires the
  // equipmentId to be present in the Jobcard's own machines list). `operations` is whatever the
  // resulting operations array will actually be (the same patch's own incoming array when supplied,
  // otherwise the stored one) so a combined operations+machines patch is checked consistently.
  function activeOperationEquipmentUnlinkAttempts(operations,incomingMachines){
    if(!Array.isArray(incomingMachines))return[];
    const incomingEquipmentIds=new Set(incomingMachines.filter(m=>m&&m.equipmentId).map(m=>m.equipmentId));
    return (operations||[]).filter(op=>op&&op.status===OPERATION_START_STATUS&&op.equipmentId&&!incomingEquipmentIds.has(op.equipmentId));
  }
  // Review fix (4th review, finding 1): a non-null, non-array object (a bare {}, a string, a number,
  // a boolean...) previously slipped past every check above — they all start with
  // `if(!Array.isArray(incomingOps))return[]`, i.e. "nothing to flag", NOT "reject this". A caller
  // supplying operations:null/{}/'' therefore skipped the active-deletion protection entirely and
  // still had it applied via Object.assign(j,data), silently replacing the whole collection. These
  // two validators are the FIRST thing checked (only when the field is actually present, via
  // hasOwnProperty — never truthiness, so a real, valid empty array [] is never rejected here) and
  // must run before any of the other operations/machines helpers above.
  function isPlainObject(v){return v!=null&&typeof v==='object'&&!Array.isArray(v);}
  function validateOperationsArrayPayload(operations){
    if(!Array.isArray(operations)){
      return{valid:false,code:'INVALID_JOBCARD_OPERATIONS_PAYLOAD',message:'operations must be an array'};
    }
    const seenIds=new Set();
    for(const op of operations){
      if(!isPlainObject(op)){
        return{valid:false,code:'INVALID_JOBCARD_OPERATIONS_PAYLOAD',message:'every operation entry must be a non-null object'};
      }
      if(op.id==null){
        return{valid:false,code:'INVALID_JOBCARD_OPERATIONS_PAYLOAD',message:'every operation entry must have an id'};
      }
      if(seenIds.has(op.id)){
        return{valid:false,code:'INVALID_JOBCARD_OPERATIONS_PAYLOAD',message:`duplicate operation id: ${op.id}`};
      }
      seenIds.add(op.id);
      if(Object.prototype.hasOwnProperty.call(op,'status')&&!OPERATION_STATUSES.includes(op.status)){
        return{valid:false,code:'INVALID_JOBCARD_OPERATIONS_PAYLOAD',message:`unrecognised operation status: ${op.status}`};
      }
    }
    return{valid:true};
  }
  function validateMachinesArrayPayload(machines){
    if(!Array.isArray(machines)){
      return{valid:false,code:'INVALID_JOBCARD_MACHINES_PAYLOAD',message:'machines must be an array'};
    }
    const seenEquipmentIds=new Set();
    for(const m of machines){
      if(!isPlainObject(m)){
        return{valid:false,code:'INVALID_JOBCARD_MACHINES_PAYLOAD',message:'every machine entry must be a non-null object'};
      }
      const hasEquipmentId=typeof m.equipmentId==='string'&&m.equipmentId.trim()!=='';
      const hasLegacyName=typeof m.name==='string'&&m.name.trim()!=='';
      if(!hasEquipmentId&&!hasLegacyName){
        return{valid:false,code:'INVALID_JOBCARD_MACHINES_PAYLOAD',message:'every machine entry needs a usable equipmentId or a legacy name'};
      }
      if(hasEquipmentId){
        if(seenEquipmentIds.has(m.equipmentId)){
          return{valid:false,code:'INVALID_JOBCARD_MACHINES_PAYLOAD',message:`duplicate equipmentId: ${m.equipmentId}`};
        }
        seenEquipmentIds.add(m.equipmentId);
      }
    }
    return{valid:true};
  }
  function invalidJobcardPayloadResult(validation,jcNo){
    save(`Blocked: ${validation.code} for ${jcNo} — ${validation.message}`);
    return{error:validation.message,code:validation.code,jobcardNo:jcNo};
  }
  // A brand-new Jobcard has no stored operations at all, so ANY pre-populated operation already
  // set to an unsafe status is by definition a transition from "does not exist yet" into that
  // status — used to close the new-Jobcard creation bypass (see upsertJobcard below).
  function hasUnsafeSeedOperations(operations){
    return Array.isArray(operations)&&operations.some(op=>op&&OPERATION_UNSAFE_STATUSES.includes(op.status));
  }
  // ── Central Equipment safety gate (see equipment-gates.js) ──
  // Thin wrapper around the pure EquipmentGates module — the ONE place that decides whether a piece
  // of equipment can be reserved, assigned, used, or have hours logged. `item` is passed straight
  // from state (equipment-gates.js never mutates its input); the caller-facing API always clones
  // the result before returning it (see getEquipmentSafetyGate below).
  function equipmentSafetyGate(item,options){
    if(!global.EquipmentGates)throw new Error('equipment-gates.js must be loaded before workshop-data.js');
    return global.EquipmentGates.getEquipmentSafetyGate(item,options||{});
  }
  // Builds the structured, backward-compatible error every gated equipment mutation returns when
  // blocked, and records a meaningful blocked-attempt audit entry (via the normal save() activity
  // log) WITHOUT touching the target equipment record itself.
  function equipmentGateBlockedResult(action,equipmentId,gate,extra){
    save(`Blocked by equipment safety gate: ${action} for ${equipmentId}${gate.reasons.length?' ('+gate.reasons.join('; ')+')':''}`);
    return Object.assign({
      error:`Blocked by equipment safety rules: ${gate.reasons.join('; ')||'equipment is not operational'}.`,
      code:'EQUIPMENT_SAFETY_BLOCKED',
      equipmentId:equipmentId||gate.equipmentId,
      reasons:gate.reasons.slice(),
      blockers:clone(gate.blockers)
    },extra||{});
  }
  // Review fix (assignment race/stale state): equipment already assigned to one Jobcard can never be
  // silently reassigned (or have its usage/pre-use-check attributed) to a different Jobcard — the
  // holder must explicitly returnEquipment() first. Structured, WITHOUT touching the equipment record.
  function equipmentAssignmentConflictResult(action,equipmentId,currentJobcard,requestedJobcard){
    save(`Blocked by equipment assignment conflict: ${action} for ${equipmentId} (held by ${currentJobcard||'—'}, requested by ${requestedJobcard||'—'})`);
    return{
      error:`This equipment is already assigned to ${currentJobcard}. Return or reassign it before using it on another Jobcard.`,
      code:'EQUIPMENT_ASSIGNMENT_CONFLICT',
      equipmentId:equipmentId||null,
      assignedJobcard:currentJobcard||null,
      requestedJobcard:requestedJobcard||null
    };
  }
  // Pass 3.2C review fix (cross-project reservation theft): a PROJECT-ONLY reservation sets
  // assignedProject but leaves assignedJobcard null — equipmentAssignmentConflictResult() above only
  // ever fires when assignedJobcard is set, so it never caught a second project silently reserving
  // (or assigning) equipment that a first project already holds project-only. This is a distinct,
  // structured conflict — checked BEFORE the Jobcard-level conflict above, and BEFORE anything on the
  // equipment record is touched, so a rejected attempt always leaves the whole record unchanged.
  // Re-requesting the SAME project remains idempotent (the caller checks inequality, never presence
  // alone); moving to a different project always requires an explicit returnEquipment() first.
  function equipmentProjectConflictResult(action,equipmentId,currentProject,requestedProject){
    save(`Blocked by equipment project conflict: ${action} for ${equipmentId} (held by ${currentProject||'—'}, requested by ${requestedProject||'—'})`);
    return{
      error:`This equipment is already reserved for project ${currentProject}. Return it before reserving or assigning it to another project.`,
      code:'EQUIPMENT_PROJECT_CONFLICT',
      equipmentId:equipmentId||null,
      assignedProject:currentProject||null,
      requestedProject:requestedProject||null
    };
  }
  // Pass 3.2C, Part B: a Jobcard's status is compared for "terminal" purposes case/whitespace-
  // normalised — a caller-supplied or migrated 'Completed', 'CLOSED' or ' completed ' must be
  // recognised exactly like the canonical lowercase form, never silently treated as still-open just
  // because the stored casing/whitespace differs.
  function normalizeJobcardStatusForComparison(status){
    return status!=null?String(status).trim().toLowerCase():'';
  }
  // Pass 3.2C, Part B: the ONE shared context validator for both reserveEquipment() and
  // assignEquipment() — never duplicated per call site. Purely a READ-only check against live
  // state.projects/state.jobcards; it decides nothing about equipment safety itself (that remains
  // the Equipment Safety Gate's job) and never mutates anything. `kind` is 'reserve' or 'assign':
  // reservation requires only a real project (Jobcard optional but validated if given); assignment
  // requires a real project AND a real Jobcard belonging to it, plus a named worker and assignedBy.
  // Returns {valid:true, project, jobcard} — the REAL resolved records, so callers can always store
  // the canonical .no rather than whatever raw reference (possibly a numeric internal id) the
  // caller supplied — or {valid:false, code, reason, message, ...dynamic references}.
  function validateEquipmentAssignmentContext(kind,payload){
    payload=payload||{};
    const projectNo=payload.project||null;
    if(!projectNo){
      return{valid:false,code:'INVALID_EQUIPMENT_ASSIGNMENT_CONTEXT',reason:'PROJECT_REQUIRED',message:'A real project is required.'};
    }
    const p=project(projectNo);
    if(!p){
      return{valid:false,code:'INVALID_EQUIPMENT_ASSIGNMENT_CONTEXT',reason:'PROJECT_NOT_FOUND',projectNo,message:`Project "${projectNo}" was not found.`};
    }
    if(p.archived){
      return{valid:false,code:'INVALID_EQUIPMENT_ASSIGNMENT_CONTEXT',reason:'PROJECT_ARCHIVED',projectNo:p.no,message:`Project "${projectNo}" is archived.`};
    }
    const jobcardNo=payload.jobcard||null;
    let j=null;
    if(jobcardNo){
      j=jobcard(jobcardNo);
      if(!j){
        return{valid:false,code:'INVALID_EQUIPMENT_ASSIGNMENT_CONTEXT',reason:'JOBCARD_NOT_FOUND',jobcardNo,message:`Jobcard "${jobcardNo}" was not found.`};
      }
      if(j.archived){
        return{valid:false,code:'INVALID_EQUIPMENT_ASSIGNMENT_CONTEXT',reason:'JOBCARD_ARCHIVED',jobcardNo:j.no,message:`Jobcard "${jobcardNo}" is archived.`};
      }
      if(JOBCARD_TERMINAL_STATUSES.includes(normalizeJobcardStatusForComparison(j.status))){
        return{valid:false,code:'INVALID_EQUIPMENT_ASSIGNMENT_CONTEXT',reason:'JOBCARD_TERMINAL',jobcardNo:j.no,status:j.status,message:`Jobcard "${jobcardNo}" is ${j.status} and cannot receive new equipment.`};
      }
      if(j.projectNo!==p.no){
        return{valid:false,code:'INVALID_EQUIPMENT_ASSIGNMENT_CONTEXT',reason:'JOBCARD_PROJECT_MISMATCH',jobcardNo:j.no,projectNo:p.no,message:`Jobcard "${jobcardNo}" does not belong to project "${projectNo}".`};
      }
    }
    if(kind==='assign'){
      if(!j){
        return{valid:false,code:'INVALID_EQUIPMENT_ASSIGNMENT_CONTEXT',reason:'JOBCARD_REQUIRED_FOR_ASSIGNMENT',message:'Assignment requires a real Jobcard.'};
      }
      // Pass 3.2C review fix (authority field type validation): String(value).trim() previously
      // stringified ANY value — an object became the literal text "[object Object]", an array its
      // joined elements — so a caller could store that as the assignment's worker/assignedBy. These
      // must be genuine, non-empty-after-trim strings, exactly like the identity strings in
      // createEquipment() above; reuse the same helper rather than a second bespoke check.
      const worker=normalizeRequiredIdentityString(payload.worker);
      if(!worker){
        return{valid:false,code:'EQUIPMENT_ASSIGNMENT_DETAILS_REQUIRED',reason:'WORKER_REQUIRED',message:'Assignment requires a worker/operator.'};
      }
      const assignedBy=normalizeRequiredIdentityString(payload.assignedBy);
      if(!assignedBy){
        return{valid:false,code:'EQUIPMENT_ASSIGNMENT_DETAILS_REQUIRED',reason:'ASSIGNED_BY_REQUIRED',message:'Assignment requires assignedBy.'};
      }
    }else{
      const reservedBy=normalizeRequiredIdentityString(payload.reservedBy);
      if(!reservedBy){
        return{valid:false,code:'EQUIPMENT_ASSIGNMENT_DETAILS_REQUIRED',reason:'RESERVED_BY_REQUIRED',message:'Reservation requires reservedBy.'};
      }
    }
    return{valid:true,project:p,jobcard:j};
  }
  function equipmentAssignmentContextBlockedResult(action,equipmentId,validation){
    save(`Blocked: ${action} for ${equipmentId} — ${validation.message}`);
    return{
      error:validation.message,code:validation.code,equipmentId:equipmentId||null,
      // Structured reason + the real, untranslated dynamic references (never a translated string)
      // so the UI can build a translated message by code/reason and interpolate these verbatim,
      // instead of re-parsing English prose.
      reason:validation.reason||null,projectNo:validation.projectNo||null,jobcardNo:validation.jobcardNo||null,
      status:validation.status||null
    };
  }
  // Review fix (3rd review): the ONE central place that reconciles active Jobcard operations after an
  // equipment mutation. Scans every Jobcard's operations (live `state`, never a page-side cache) for
  // any operation with status 'in-progress' whose equipmentId matches the affected equipment, and
  // automatically pauses it if — recomputed fresh, right now — that equipment is no longer validly
  // held by that exact Jobcard (assignedJobcard mismatch) or the authoritative Equipment Safety Gate
  // is blocked. This single per-operation check covers all three trigger conditions the caller might
  // have created: equipment left unassigned, equipment moved to a hard-block status, or equipment
  // newly gate-blocked for any other reason (e.g. a newly-mandatory requirement) — so every call site
  // below can simply call this unconditionally after its own mutation, with no need to duplicate that
  // decision. Matched entirely by stable equipmentId/Jobcard id/operation id, never array position or
  // name. Preserves every other field on the operation (equipmentId, machine, actualStart,
  // loggedHours, ...) — only `status` changes. Naturally idempotent: an operation already 'paused'
  // never matches the 'in-progress' filter again. Never resumes or starts anything. Does NOT call
  // save() itself — every caller applies its own equipment mutation, calls this, and then calls
  // save() exactly once, so both changes are always persisted together, never as partial state.
  function reconcileActiveOperationsForEquipment(equipmentId,reason){
    const item=equip(equipmentId);
    if(!item)return{pausedOperations:[]};
    const stillAuthorized=jobcardNo=>jobcardNo===item.assignedJobcard&&!equipmentSafetyGate(item,{}).blocked;
    const pausedOperations=[];
    (state.jobcards||[]).forEach(j=>{
      (j.operations||[]).forEach(op=>{
        if(op&&op.status==='in-progress'&&op.equipmentId===equipmentId&&!stillAuthorized(j.no)){
          op.status='paused';
          j.activity=j.activity||[];
          j.activity.unshift({date:now().slice(0,10),time:new Date().toTimeString().slice(0,5),by:'System',action:`Operation "${op.desc}" automatically paused — ${reason} (${equipmentId})`});
          pausedOperations.push({jobcardId:j.id,jobcardNo:j.no,operationId:op.id,desc:op.desc,equipmentId});
        }
      });
    });
    return{pausedOperations};
  }
  // Every field the safety gate reads, or that records operational/usage state the gate's callers
  // rely on, is protected — updateEquipment() must REJECT the entire mutation (never silently drop
  // just these fields and report success) if a caller attempts to touch any of them directly.
  // Legitimate changes go through their own dedicated, validated, evidenced methods instead:
  //   requirements                                -> updateEquipmentRequirements
  //   maintenanceDate  (+ maintenance history)     -> addMaintenanceRecord
  //   inspectionDate   (+ inspections history)     -> addInspection / resolveEquipmentInspection
  //   certificationExpiry (+ certifications)       -> addCertification
  //   calibrationDate  (+ calibrations)            -> addCalibration
  //   preUseChecks                                 -> recordEquipmentPreUseCheck
  //   downtimeRecords                              -> reportBreakdown / resolveBreakdown
  //   currentAssignment/assignedProject/assignedJobcard/operator -> assignEquipment/returnEquipment/returnEquipmentToService
  //   usageHistory/usageSessions/operatingHourMeter -> logEquipmentUsage
  // Ordinary descriptive fields (name, description, manufacturer, location, responsiblePerson, ...)
  // are NOT in this list and remain freely editable.
  const EQUIPMENT_PROTECTED_FIELDS=[
    'requirements','maintenanceDate','inspectionDate','certificationExpiry','calibrationDate',
    'inspections','maintenance','certifications','calibrations','preUseChecks','downtimeRecords',
    'safetyWarnings','activity','returnToService','usageHistory','usageSessions','operatingHourMeter',
    'currentAssignment','assignedProject','assignedJobcard','operator',
    // isRetired/retirementReason may only change through the dedicated retirement workflow
    // (retireEquipment) — see Pass 3.2A fix round 2.
    'isRetired','retirementReason'
  ];
  // A caller-supplied override/force/etc. flag or a caller-supplied blockers/reasons list is never
  // a real equipment field — these are stripped from updateEquipment() patches outright (rather
  // than rejecting the whole mutation) so no future code path can accidentally start trusting them.
  const EQUIPMENT_OVERRIDE_FLAG_FIELDS=['override','managerOverride','force','safetyApproved','blockers','reasons'];
  // No record-creation payload (reportBreakdown/addInspection/recordEquipmentPreUseCheck/
  // addMaintenanceRecord/addCertification/addCalibration) may ever directly set these —
  // they are server/workflow-owned: identity, timing, and every resolution/approval field. Each
  // dedicated method computes and sets them itself, never trusting the caller's payload.
  const EQUIPMENT_RECORD_OWNED_FIELDS=[
    'id','no','timestamp','status','resolved','resolvedBy','resolvedDate','resolutionEvidence',
    'passedInspectionReference','resolvedViaCheckId','resolutionDate',
    'authorisedBy','approvalReference','returnDate'
  ];
  function stripEquipmentRecordOwnedFields(obj){
    const out=Object.assign({},obj);
    EQUIPMENT_RECORD_OWNED_FIELDS.forEach(f=>{delete out[f];});
    return out;
  }
  function equipmentProtectedFieldsBlockedResult(equipmentId,fields){
    save(`Blocked by equipment safety gate: attempted direct edit of protected field(s) [${fields.join(', ')}] for ${equipmentId}`);
    return{
      error:`These fields can only be changed through their dedicated, evidenced methods: ${fields.join(', ')}.`,
      code:'EQUIPMENT_SAFETY_FIELDS_PROTECTED',
      equipmentId:equipmentId||null,
      protectedFields:fields.slice()
    };
  }
  const EQUIPMENT_REQUIREMENT_KEYS=['maintenanceRequired','inspectionRequired','certificationRequired','calibrationRequired','preUseCheckRequired'];
  // Keeps only the known boolean requirement flags — any other supplied key is ignored, and every
  // known key is coerced to a real boolean, so `requirements` can never end up holding stray data.
  function normalizeEquipmentRequirements(obj){
    const out={};
    EQUIPMENT_REQUIREMENT_KEYS.forEach(k=>{if(obj&&Object.prototype.hasOwnProperty.call(obj,k))out[k]=!!obj[k];});
    return out;
  }
  // Pass 3.2C, Part A: a required identity string (equipmentId/id/name/category) must be a genuine
  // JS string, non-empty after trimming — never a number, boolean, null, object or array accepted
  // merely because it is truthy, and never whitespace-only.
  function normalizeRequiredIdentityString(value){
    return typeof value==='string'&&value.trim()?value.trim():null;
  }
  // Pass 3.2C, Part A: a brand-new equipment record can never be BORN already assigned, in use,
  // retired, or carrying audit/history — those are exclusively reached through their own dedicated,
  // evidenced workflows (assignEquipment/reserveEquipment/logEquipmentUsage/retireEquipment/
  // reportBreakdown/addInspection/...) after the record exists. createEquipment() rejects the WHOLE
  // creation atomically the instant any of these appear in the payload — never silently strips them
  // and creates the rest.
  const EQUIPMENT_CREATION_PROTECTED_FIELDS=[
    'assignedProject','assignedJobcard','operator','currentAssignment','isRetired','retirementReason',
    'inspections','maintenance','certifications','calibrations','preUseChecks','downtimeRecords',
    'returnToService','usageHistory','usageSessions','activity','safetyWarnings'
  ];
  function equipmentCreationFieldsBlockedResult(fields){
    save(`Blocked: equipment creation attempted to set workflow-owned field(s) [${fields.join(', ')}]`);
    return{
      error:`These fields can only be set through their dedicated workflows after creation: ${fields.join(', ')}.`,
      code:'EQUIPMENT_CREATION_FIELDS_PROTECTED',
      protectedFields:fields.slice()
    };
  }
  const api={
    // Reading from the server. adoptSnapshot replaces everything with what the backend sent; after
    // that this module is a reader and every mutator here refuses, because a write has to be checked
    // by the database and these functions cannot wait for an answer from another machine.
    adoptSnapshot,isServerBacked,servedAt,servedCollections,signedInAs,
    key:KEY,
    get:()=>clone(state),
    // Back to an empty system - the state a workshop opens on its first day.
    // Clears the workshop's records out of this browser — all of them, not just the current copy.
    // It used to overwrite the current key and stop there, which left the previous versions (v4, v3,
    // v1), every recovery copy an import or a corrupt load had set aside, and the older per-module
    // keys still holding whatever was in them. None of that showed on screen afterwards, because the
    // current key wins on load. But "clear everything" that keeps the demonstration's customers in
    // five places is not clear, and v4 and v3 are exactly what load() falls back to if the current
    // key is ever lost — so they would have come back on the one day nobody would understand why.
    //
    // What stays is what is not a record: the theme, the language, a session, and the queue of writes
    // waiting for the server, which belong to the workshop's database rather than to this browser.
    reset:()=>{
      const RECORD_KEYS=[LEGACY_KEY_V4,LEGACY_KEY_V3,'varmak.workshop.v1',LEGACY_PROJECTS_KEY,
        LEGACY_PURCHASING_KEY,LEGACY_DOCUMENTS_KEY,LEGACY_REPORTS_SAVED_KEY,LEGACY_REPORTS_CONFIG_KEY];
      try{
        const store=global.localStorage;
        if(store){
          const doomed=[];
          for(let i=0;i<store.length;i++){
            const k=store.key(i);
            if(RECORD_KEYS.includes(k)||(k&&k.startsWith(KEY+'.')))doomed.push(k);
          }
          doomed.forEach(k=>store.removeItem(k));
        }
      }catch(e){/* storage refused: the current copy below is still replaced */}
      state=normalize(emptyState());save('Cleared to an empty system');return clone(state);
    },
    // "Has this workshop entered anything yet?" — which is not the same as "is every collection
    // empty". An empty system still ships the classification scheme (item groups, warehouse
    // locations) because that is the app's, not the workshop's, and clearing the system is
    // itself an event the audit trail records. Counting those three meant this could never
    // return true, for anybody, ever — a question with no reachable answer.
    isEmpty:()=>KNOWN_COLLECTION_KEYS
      .filter(k=>k!=='activity')
      .every(k=>!Array.isArray(state[k])||state[k].length===0),
    save:reason=>save(reason),
    backupData:()=>{
      const blob=new Blob([JSON.stringify(clone(state), null, 2)], {type:'application/json'});
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');
      link.href=url; link.download='varmak-workshop-backup.json';
      document.body.appendChild(link); link.click(); setTimeout(()=>{URL.revokeObjectURL(url); link.remove();}, 1000);
      return true;
    },
    getDataHealth:()=>Object.assign({},dataHealth,{
      counts:Object.fromEntries(KNOWN_COLLECTION_KEYS.map(k=>[k,Array.isArray(state[k])?state[k].length:0]))
    }),
    validateBackup:(obj)=>{
      if(!obj||typeof obj!=='object')return{valid:false,error:'The file is not a valid backup (not a JSON object).'};
      if(!looksLikeWorkshopState(obj))return{valid:false,error:'The file does not contain recognisable Varmak Workshop data.'};
      for(const k of KNOWN_COLLECTION_KEYS){
        if(obj[k]!==undefined&&!Array.isArray(obj[k]))return{valid:false,error:`The "${k}" field in this backup is not in the expected format.`};
      }
      if(obj.reportConfig!==undefined&&(typeof obj.reportConfig!=='object'||obj.reportConfig===null||Array.isArray(obj.reportConfig)))return{valid:false,error:'The "reportConfig" field in this backup is not in the expected format.'};
      return{valid:true};
    },
    importBackup:(obj)=>{
      const check=api.validateBackup(obj);
      if(!check.valid)return{success:false,error:check.error};
      // Preserve the current state as a recovery backup before replacing it.
      try{global.localStorage&&global.localStorage.setItem(`${KEY}.before-import.${Date.now()}`,JSON.stringify(state));}catch(e){}
      const imported=normalize(Object.assign(seed(),clone(obj)));
      imported.activity=imported.activity||[];
      imported.activity.unshift({time:now(),reason:'Backup imported. Previous data was preserved as a recovery copy.'});
      state=imported;
      dataHealth={sourceKey:'import',migratedFromLegacy:false,recoveryWarning:null,schemaVersion:VERSION,corruptedV5Detected:false,corruptedRecordPreserved:false,migrationSource:'import',moduleMigrations:[]};
      save();
      return{success:true};
    },
    getCustomers:()=>clone(state.customers),
    listCustomers:()=>clone(state.customers),
    findCustomer:id=>clone(state.customers.find(x=>x.id===id)),
    // Matches by id first, then by name — case-insensitively and ignoring surrounding whitespace —
    // so "Example AB", " example ab " and "EXAMPLE AB " are all treated as the same
    // customer and never silently create a duplicate record.
    upsertCustomer(customer){
      const trimmedName=customer.name!=null?String(customer.name).trim():customer.name;
      const payload=clone(customer);
      if(trimmedName!=null)payload.name=trimmedName;
      const existing=state.customers.find(x=>x.id===payload.id||(trimmedName&&x.name&&x.name.trim().toLowerCase()===trimmedName.toLowerCase()));
      if(existing){Object.assign(existing,payload);}
      else{
        // One stable sequence value for both id and number, incremented exactly once. Guards
        // against a stale counter lower than an already-existing customer id/no (e.g. imported or
        // migrated data) so a new customer can never collide with or renumber an existing one.
        const maxExistingId=state.customers.reduce((m,c)=>Math.max(m,Number(c.id)||0),0);
        const maxExistingNo=state.customers.reduce((m,c)=>{const n=/^C-(\d+)$/.exec(c.no||'');return n?Math.max(m,parseInt(n[1],10)):m;},0);
        state.counters.customer=Math.max(state.counters.customer||0,maxExistingId,maxExistingNo)+1;
        payload.id=state.counters.customer;
        payload.no='C-'+String(state.counters.customer).padStart(3,'0');
        state.customers.push(payload);
      }
      const rec=existing||payload;
      save(`Customer updated: ${rec.name}`);
      return clone(rec);
    },
    addCustomerNote(id,note){const c=state.customers.find(x=>x.id===id);if(!c)return;c.notes=c.notes||[];c.notes.unshift(clone(note));save(`Customer note: ${c.name}`)},
    addCustomerContact(id,contact){const c=state.customers.find(x=>x.id===id);if(!c)return;c.contacts=c.contacts||[];c.contacts.push(clone(contact));save(`Customer contact: ${c.name}`)},
    listSuppliers:()=>clone(state.suppliers||[]),
    findSupplier:id=>clone((state.suppliers||[]).find(x=>x.id===id)),
    upsertSupplier(supplier){
      state.suppliers=state.suppliers||[];
      const existing=state.suppliers.find(x=>x.id===supplier.id||x.name===supplier.name);
      if(existing)Object.assign(existing,clone(supplier));
      else{supplier=clone(supplier);supplier.id=supplier.id||state.counters.supplier++;supplier.no=supplier.no||next('supplier','S-');state.suppliers.push(supplier)}
      save(`Supplier updated: ${supplier.name}`);return clone(existing||supplier);
    },
    addSupplierNote(id,note){const s=(state.suppliers||[]).find(x=>x.id===id);if(!s)return;s.notes=s.notes||[];s.notes.unshift(clone(note));save(`Supplier note: ${s.name}`)},
    addSupplierContact(id,contact){const s=(state.suppliers||[]).find(x=>x.id===id);if(!s)return;s.contacts=s.contacts||[];s.contacts.push(clone(contact));save(`Supplier contact: ${s.name}`)},
    listEstimations:()=>clone(state.estimations),
    upsertEstimation(payload){let e=estimation(payload.id)||estimation(payload.no);if(e)Object.assign(e,clone(payload));else{e=clone(payload);e.id=e.id||state.counters.estimation++;e.no=e.no||next('estimation','EST-2026-');e.revision=e.revision||0;e.revisions=e.revisions||[{rev:0,date:now().slice(0,10),author:UNNAMED,reason:'Initial quotation'}];state.estimations.push(e)}save(`Estimation saved: ${e.no}`);return clone(e)},
    updateEstimation(id,patch,reason){const e=estimation(id);if(!e)return null;Object.assign(e,clone(patch));if(reason){e.revision=(e.revision||0)+1;e.revisions=e.revisions||[];e.revisions.push({rev:e.revision,date:now().slice(0,10),author:UNNAMED,reason})}save(`Estimation updated: ${e.no}`);return clone(e)},
    archiveEstimation(idOrNo,reason){
      const e=estimation(idOrNo);
      if(!e)return{error:'Estimation not found'};
      e.archived=true;
      e.history=e.history||[];
      e.history.push({date:now().slice(0,10),action:reason||'Archived',by:UNNAMED});
      save(`Estimation archived: ${e.no}`);
      return clone(e);
    },
    deleteEstimation(idOrNo){
      const e=estimation(idOrNo);
      if(!e)return{error:'Estimation not found'};
      if(e.projectId)return{error:'This estimation is linked to a project and cannot be deleted. Archive it instead.'};
      state.estimations=state.estimations.filter(x=>x!==e);
      save(`Estimation deleted: ${e.no}`);
      return{success:true};
    },
    createProjectFromEstimation(idOrNo){const e=estimation(idOrNo);if(!e)return{error:'Estimation not found'};if(e.projectId){const p=state.projects.find(x=>x.id===e.projectId);return{project:clone(p),existing:true}}const id=state.counters.project++,no=`P-2026-${String(id).padStart(3,'0')}`;const p={id,no,customerId:e.customerId,customer:e.customer,name:e.title,estimationId:e.id,status:'planned',phase:'design',start:now().slice(0,10),deadline:e.deliveryTarget,expectedCompletion:e.deliveryTarget,progress:0,plannedHours:e.plannedHours||0,usedHours:0,responsible:UNNAMED,workers:[],machines:clone(e.machines||[]),materialStatus:'unchecked',bom:(e.bom||[]).map(x=>({code:x.code,description:x.description,required:x.qty,reserved:0,issued:0,unit:x.unit})),tasks:[],milestones:[]};state.projects.push(p);e.projectId=id;e.status='accepted';save(`Project ${no} created from ${e.no}`);return{project:clone(p),existing:false}},
    listProjects:()=>clone(state.projects),
    getProjects:()=>clone(state.projects),
    findProject:idOrNo=>clone(state.projects.find(x=>x.id===idOrNo||x.no===idOrNo)),
    logHours(entry){const hours=Number(entry.hours);if(!Number.isFinite(hours)||hours<=0)return{error:'Hours must be greater than zero'};
      // An id built from the clock is unique only while no two entries land in the same millisecond.
      // Eight rows entered from one returned sheet do exactly that, and were getting distinct ids
      // only because each save happens to take a fraction of a millisecond - luck, not design.
      // Counted like every other record here, so it is unique by construction.
      const seq=state.counters.hours=(state.counters.hours||0)+1;const record=Object.assign({id:`H-${seq}`,date:now().slice(0,10),user:UNNAMED},clone(entry),{hours});state.hours=state.hours||[];state.hours.unshift(record);save(`Hours logged: ${hours} h`);return clone(record)},
    upsertProject(payload){
      if(!payload||!payload.name)return{error:'A project name is required'};
      let p=state.projects.find(x=>(payload.id!=null&&x.id===payload.id)||(payload.no&&x.no===payload.no));
      const data=clone(payload);
      // Trust an existing customerId only if it actually resolves in the shared customers
      // collection (a caller's own local numbering, e.g. Projects' page-local picklist, cannot be
      // trusted as-is).
      if(data.customerId!=null&&!state.customers.some(c=>c.id===data.customerId))data.customerId=null;
      if(data.customerId!=null){
        // A valid shared id is authoritative — the project's customer name always comes from that
        // real record, never from a caller-supplied name that might be stale, blank or wrong.
        data.customer=state.customers.find(c=>c.id===data.customerId).name;
      }else{
        // No trusted id — only resolve/create a customer from a genuine name. A display placeholder
        // ('—', '-', empty/whitespace) must never be persisted as a fabricated customer record.
        const c=resolveOrCreateCustomer(data.customer);
        data.customerId=c?c.id:null;
        data.customer=c?c.name:null;
      }
      // A genuine transition into 'completed'/'closed' is blocked by an active Quality Hold on the
      // project or any of its child Jobcards — a redundant re-save of an already-completed/closed
      // project (e.g. adding a note) is NOT treated as a new transition and is never blocked.
      if(data.status&&PROJECT_UNSAFE_STATUSES.includes(data.status)&&(!p||p.status!==data.status)){
        const reference=p?p.no:data.no;
        const gate=projectQualityGate(reference);
        if(gate.blocked)return qualityGateBlockedResult(`Project ${data.status}`,reference,gate);
      }
      if(p){Object.assign(p,data);}
      else{
        // A caller (e.g. the Projects module) may supply only its own richer fields — apply the
        // same shared-schema defaults normalize() would, so a brand-new project is immediately
        // usable by other modules (Store reservations, Jobcards) within the same session.
        p=Object.assign({phase:'design',progress:0,plannedHours:0,usedHours:0,responsible:UNNAMED,
          workers:[],machines:[],materialStatus:'unchecked',bom:[],tasks:[],milestones:[],estimationId:null},data);
        p.id=p.id||state.counters.project++;p.no=p.no||`P-2026-${String(p.id).padStart(3,'0')}`;
        state.projects.push(p);
      }
      save(`Project saved: ${p.no}`);
      return clone(p);
    },
    // Same Quality Hold gate as upsertProject — a caller cannot bypass safety by calling this
    // lower-level method directly instead of a dedicated transition helper.
    updateProject(no,patch){
      const p=project(no);if(!p)return null;
      const data=clone(patch);
      if(data.status&&PROJECT_UNSAFE_STATUSES.includes(data.status)&&p.status!==data.status){
        const gate=projectQualityGate(no);
        if(gate.blocked)return qualityGateBlockedResult(`Project ${data.status}`,no,gate);
      }
      Object.assign(p,data);save(`Project updated: ${no}`);return clone(p);
    },
    // Projects are referenced by jobcards, estimations, materials and documents — never hard-deleted.
    // archiveProject marks it archived (a non-destructive status change) rather than removing it.
    archiveProject(idOrNo,reason){
      const p=state.projects.find(x=>x.id===idOrNo||x.no===idOrNo);
      if(!p)return{error:'Project not found'};
      p.archived=true;
      p.activity=p.activity||[];
      p.activity.push({date:now().slice(0,10),time:now().slice(11,16),user:UNNAMED,action:reason||'Project archived'});
      save(`Project archived: ${p.no}`);
      return clone(p);
    },
    readiness:no=>{const p=project(no);return p?clone(projectReadiness(p)):null},
    // ---- Where an item is referenced ---------------------------------------
    // An item that has moved, been reserved or been quoted cannot simply be
    // deleted: its number is written on records that would stop making sense.
    // This answers where it is used, so the refusal can say so rather than just
    // saying no.
    itemUsage(code){
      const key=String(code||'');
      if(!key)return[];
      const found=[];
      const add=(where,detail)=>{const hit=found.find(x=>x.where===where);
        if(hit){hit.count+=1;if(hit.examples.length<3&&detail)hit.examples.push(detail);}
        else found.push({where,count:1,examples:detail?[detail]:[]});};
      state.movements.forEach(m=>{if(String(m.code)===key)add('movements',`${m.action} ${m.qty} · ${m.time}`);});
      state.projects.forEach(p=>(p.bom||[]).forEach(line=>{if(String(line.code)===key)add('projectBom',p.no);}));
      state.jobcards.forEach(j=>(j.materials||[]).forEach(line=>{if(String(line.code)===key)add('jobcards',j.no);}));
      state.offcuts.forEach(o=>{if(String(o.materialCode)===key||String(o.code)===key)add('offcuts',o.code||o.id);});
      (state.purchaseOrders||[]).forEach(po=>{
        if(String(po.itemCode||'')===key||String(po.items||'').indexOf(key)>=0)add('purchaseOrders',po.no);});
      // An estimation's lines sit inside its work items, not on the estimation.
      (state.estimations||[]).forEach(e=>{
        const lines=[].concat(e.lines||[],e.items||[],...(e.workItems||[]).map(wi=>wi.lines||[]));
        lines.forEach(line=>{if(String(line.code||line.itemCode||'')===key)add('estimations',e.no||e.ref);});
      });
      Object.entries(state.barcodeLinks||{}).forEach(([barcode,linked])=>{if(String(linked)===key)add('barcodes',barcode);});
      (state.stockCounts||[]).forEach(c=>(c.lines||[]).forEach(line=>{
        if(String(line.code)===key)add('stockCounts',c.no||c.id);}));
      return found;
    },
    // Everything the store knows about one item's own past: where it sits, where it came from,
    // and where it went. Read-only, and it invents nothing - an item nobody has ever received
    // comes back with an empty receipts list, not with a blank date pretending to be one.
    itemHistory(code){
      const item=inventory(code);
      if(!item)return null;
      const key=String(item.code);
      const newestFirst=(a,b)=>String(b.time||'').localeCompare(String(a.time||''));
      const mine=state.movements.filter(m=>String(m.code)===key).slice().sort(newestFirst);
      const line=m=>({time:m.time||'',action:m.action,qty:Number(m.qty)||0,unit:m.unit||item.unit||'',
        from:m.from||'',to:m.to||'',projectNo:m.projectNo||'',jobcard:m.jobcard||'',user:m.user||''});
      const received=mine.filter(m=>String(m.action).toUpperCase()==='RECEIVED').map(line);
      const issued=mine.filter(m=>String(m.action).toUpperCase()==='ISSUED').map(line);
      const other=mine.filter(m=>!['RECEIVED','ISSUED'].includes(String(m.action).toUpperCase())).map(line);
      const group=(state.locationGroups||[]).find(g=>g.id===item.locationGroup);
      const sub=group&&(group.subgroups||[]).find(x=>x.id===item.locationSub);
      return {
        code:item.code,itemNo:item.itemNo,description:item.description,
        where:{warehouse:group?group.name:'',sublocation:sub?sub.name:'',bin:item.location||'',
          stock:Number(item.stock)||0,reserved:Number(item.reserved)||0,
          available:(Number(item.stock)||0)-(Number(item.reserved)||0),unit:item.unit||''},
        bought:{supplier:item.supplier||'',lastPrice:Number(item.lastPrice)||0,avgCost:Number(item.avgCost)||0,
          heat:item.heat||'',
          // The first and last time it actually came through the door, from the movements
          // themselves rather than from a field somebody could have typed anything into.
          first:received.length?received[received.length-1]:null,last:received.length?received[0]:null},
        received,issued,other,
        // Where it is committed right now, as the delete guard already reads it.
        usedIn:api.itemUsage(item.code)
      };
    },
    // A patch, not a replacement: only what is passed is changed, and the
    // fields that identify the item are not up for editing here.
    updateInventoryItem(code,patch){
      const item=state.inventory.find(x=>String(x.code)===String(code));
      if(!item)return{error:'Item not found'};
      const data=clone(patch||{});
      delete data.code;delete data.itemNo;
      if(data.group!==undefined||data.subgroup!==undefined){
        const groupId=data.group!==undefined?String(data.group):item.group;
        const g=groupFor(state,groupId);
        if(!g)return{error:'Item group is required'};
        const subId=String(data.subgroup!==undefined?data.subgroup:(item.subgroup||''));
        if(subId&&!(g.subgroups||[]).some(x=>x.id===subId))return{error:`${g.name} has no subgroup ${subId}`};
        data.group=groupId;data.subgroup=subId;
        data.category=((g.subgroups||[]).find(x=>x.id===subId)||{}).name||g.name;
      }
      if(data.locationGroup!==undefined||data.locationSub!==undefined){
        const lgId=String(data.locationGroup!==undefined?data.locationGroup:(item.locationGroup||''));
        if(lgId){
          const lg=(state.locationGroups||[]).find(x=>x.id===lgId);
          if(!lg)return{error:'Warehouse not found'};
          const lsId=String(data.locationSub!==undefined?data.locationSub:(item.locationSub||''));
          if(lsId&&!lg.subgroups.some(x=>x.id===lsId))return{error:`${lg.name} has no sublocation ${lsId}`};
          data.locationGroup=lgId;data.locationSub=lsId;
        }
      }
      if(data.description!==undefined){
        data.description=String(data.description).trim();
        if(!data.description)return{error:'Description is required'};
      }
      if(data.unit!==undefined){
        data.unit=String(data.unit).trim().toUpperCase();
        if(!data.unit)return{error:'Unit is required'};
      }
      for(const field of ['stock','reserved','minStock','reorderQty','avgCost','lastPrice','sizePerUnit','weightPerBase']){
        if(data[field]===undefined)continue;
        const value=Number(data[field]);
        if(!Number.isFinite(value)||value<0)return{error:`${field} must be zero or greater`};
        data[field]=value;
      }
      const nextStock=data.stock!==undefined?data.stock:item.stock;
      const nextReserved=data.reserved!==undefined?data.reserved:item.reserved;
      if(Number(nextReserved)>Number(nextStock))return{error:'Reserved quantity cannot exceed stock'};
      Object.assign(item,data);
      if(!(Number(item.sizePerUnit)>0))item.sizePerUnit=1;
      item.status=item.stock-item.reserved<=item.minStock?'low':'good';
      save(`Item ${item.itemNo} updated: ${item.description}`);
      return clone(item);
    },
    deleteInventoryItem(code){
      const item=state.inventory.find(x=>String(x.code)===String(code));
      if(!item)return{error:'Item not found'};
      const usage=api.itemUsage(item.code);
      if(usage.length)return{error:'Item is in use',usage};
      if(Number(item.stock)>0)return{error:'Item still has stock on the shelf',
        usage:[{where:'stock',count:Number(item.stock),examples:[`${item.stock} ${item.unit} in ${item.location||'—'}`]}]};
      state.inventory=state.inventory.filter(x=>String(x.code)!==String(item.code));
      save(`Item ${item.itemNo} deleted: ${item.description}`);
      return{ok:true,itemNo:item.itemNo,description:item.description};
    },
    // ---- What a quantity actually amounts to -------------------------------
    // Stock is counted in whole units - a length of pipe, a sheet, a spool -
    // but the measure that matters downstream is metres, square metres or
    // kilos. sizePerUnit says how much of the base measure one stock unit is,
    // so three 6 m lengths read as 18 m and, through weightPerBase, as kilos.
    itemMeasure(codeOrItem,qty){
      const item=typeof codeOrItem==='object'&&codeOrItem
        ?codeOrItem
        :state.inventory.find(x=>String(x.code)===String(codeOrItem));
      if(!item)return null;
      const units=Number(qty);
      const count=Number.isFinite(units)?units:0;
      const size=Number(item.sizePerUnit)>0?Number(item.sizePerUnit):1;
      const perBase=Number(item.weightPerBase)>0?Number(item.weightPerBase):0;
      const base=String(item.baseUnit||'pcs');
      const baseQty=round2(count*size);
      return {
        units:count,
        unit:item.unit||'EA',
        baseUnit:base,
        sizePerUnit:size,
        baseQty,
        // A zero weight means nobody has recorded one, which is not the same as
        // weighing nothing - the caller shows a dash rather than "0 kg".
        weightKg:perBase?round2(baseQty*perBase):null,
        weightPerBase:perBase||null
      };
    },
    // ---- Where stock is kept: a warehouse, its sublocations, and the bin code
    // written on the shelf. The bin stays free text because it is what is
    // physically labelled; the two above it are managed lists.
    listLocationGroups:()=>clone(state.locationGroups),
    findLocationGroup:id=>clone((state.locationGroups||[]).find(g=>g.id===id)||null),
    upsertLocationGroup(payload){
      const data=clone(payload||{});
      const name=String(data.name||'').trim();
      if(!name)return{error:'Warehouse name is required'};
      const isEdit=data.id!=null&&String(data.id).trim()!=='';
      const id=isEdit?String(data.id).trim():slug(name);
      if(!id)return{error:'Warehouse name must contain at least one letter or digit'};
      const existing=(state.locationGroups||[]).find(g=>g.id===id);
      if(isEdit&&!existing)return{error:'Warehouse not found'};
      const clash=(state.locationGroups||[]).find(g=>g.id!==id&&g.name.trim().toLowerCase()===name.toLowerCase());
      if(clash||(!isEdit&&existing))return{error:`A warehouse called ${name} already exists`};
      if(existing){existing.name=name;save(`Warehouse updated: ${name}`);return clone(existing);}
      const rec={id,name,subgroups:[]};
      state.locationGroups.push(rec);
      save(`Warehouse created: ${name}`);
      return clone(rec);
    },
    deleteLocationGroup(id){
      const g=(state.locationGroups||[]).find(x=>x.id===id);
      if(!g)return{error:'Warehouse not found'};
      const used=state.inventory.filter(x=>x.locationGroup===id).length;
      if(used)return{error:`${g.name} still holds ${used} item${used===1?'':'s'}`};
      state.locationGroups=state.locationGroups.filter(x=>x.id!==id);
      save(`Warehouse deleted: ${g.name}`);
      return{ok:true};
    },
    upsertSublocation(groupId,payload){
      const g=(state.locationGroups||[]).find(x=>x.id===groupId);
      if(!g)return{error:'Warehouse not found'};
      const data=clone(payload||{});
      const name=String(data.name||'').trim();
      if(!name)return{error:'Sublocation name is required'};
      const isEdit=data.id!=null&&String(data.id).trim()!=='';
      const id=isEdit?String(data.id).trim():slug(name);
      if(!id)return{error:'Sublocation name must contain at least one letter or digit'};
      const existing=g.subgroups.find(x=>x.id===id);
      if(isEdit&&!existing)return{error:'Sublocation not found'};
      if(g.subgroups.some(x=>x.id!==id&&x.name.trim().toLowerCase()===name.toLowerCase())||(!isEdit&&existing))return{error:`${g.name} already has ${name}`};
      if(existing){existing.name=name;save(`Sublocation updated: ${name}`);return clone(existing);}
      const rec={id,name};
      g.subgroups.push(rec);
      save(`Sublocation created: ${g.name} / ${name}`);
      return clone(rec);
    },
    deleteSublocation(groupId,id){
      const g=(state.locationGroups||[]).find(x=>x.id===groupId);
      if(!g)return{error:'Warehouse not found'};
      const sub=g.subgroups.find(x=>x.id===id);
      if(!sub)return{error:'Sublocation not found'};
      const used=state.inventory.filter(x=>x.locationGroup===groupId&&x.locationSub===id).length;
      if(used)return{error:`${sub.name} still holds ${used} item${used===1?'':'s'}`};
      g.subgroups=g.subgroups.filter(x=>x.id!==id);
      save(`Sublocation deleted: ${g.name} / ${sub.name}`);
      return{ok:true};
    },
    // ---- Item groups and subgroups ----
    listItemGroups:()=>clone(state.itemGroups),
    findItemGroup:id=>clone((state.itemGroups||[]).find(g=>g.id===id)||null),
    // Peek at the number the next item in this group would take, so the create
    // form can show it before anything is saved. It allocates nothing.
    peekItemNumber(groupId){
      const g=groupFor(state,groupId);
      if(!g)return null;
      const start=Number(g.start)||0;
      const used=state.inventory.filter(x=>x.group===groupId).reduce((m,x)=>Math.max(m,Number(x.itemNo)||0),0);
      return Math.max(Number(g.next)||start,start,used?used+1:start);
    },
    upsertItemGroup(payload){
      const data=clone(payload||{});
      const name=String(data.name||'').trim();
      if(!name)return{error:'Group name is required'};
      const start=Number(data.start);
      if(!Number.isFinite(start)||start<0||Math.floor(start)!==start)return{error:'Start number must be a whole number of zero or more'};
      const isEdit=data.id!=null&&String(data.id).trim()!=='';
      const id=isEdit?String(data.id).trim():slug(name);
      if(!id)return{error:'Group name must contain at least one letter or digit'};
      const existing=groupFor(state,id);
      if(isEdit&&!existing)return{error:'Group not found'};
      const clash=(state.itemGroups||[]).find(g=>g.id!==id&&g.name.trim().toLowerCase()===name.toLowerCase());
      if(clash||(!isEdit&&existing))return{error:`A group called ${name} already exists`};
      // Two groups sharing a number range would hand out the same item number
      // twice, so ranges have to stay apart. A group runs from its start up to
      // the next group's start.
      const others=(state.itemGroups||[]).filter(g=>g.id!==id).map(g=>Number(g.start)||0);
      if(others.includes(start))return{error:`Another group already starts at ${start}`};
      if(existing){
        const lowest=state.inventory.filter(x=>x.group===id).reduce((m,x)=>Math.min(m,Number(x.itemNo)||Infinity),Infinity);
        if(Number.isFinite(lowest)&&start>lowest)return{error:`This group already has item ${lowest}, so it cannot start at ${start}`};
        existing.name=name;existing.start=start;
        if(Number(existing.next)<start)existing.next=start;
        save(`Item group updated: ${name}`);
        return clone(existing);
      }
      const rec={id,name,start,next:start,subgroups:[]};
      state.itemGroups.push(rec);
      save(`Item group created: ${name}`);
      return clone(rec);
    },
    deleteItemGroup(id){
      const g=groupFor(state,id);
      if(!g)return{error:'Group not found'};
      const used=state.inventory.filter(x=>x.group===id).length;
      if(used)return{error:`${g.name} still holds ${used} item${used===1?'':'s'}`};
      state.itemGroups=state.itemGroups.filter(x=>x.id!==id);
      save(`Item group deleted: ${g.name}`);
      return{ok:true};
    },
    upsertSubgroup(groupId,payload){
      const g=groupFor(state,groupId);
      if(!g)return{error:'Group not found'};
      const data=clone(payload||{});
      const name=String(data.name||'').trim();
      if(!name)return{error:'Subgroup name is required'};
      const isEdit=data.id!=null&&String(data.id).trim()!=='';
      const id=isEdit?String(data.id).trim():slug(name);
      if(!id)return{error:'Subgroup name must contain at least one letter or digit'};
      const existing=g.subgroups.find(x=>x.id===id);
      if(isEdit&&!existing)return{error:'Subgroup not found'};
      if(g.subgroups.some(x=>x.id!==id&&x.name.trim().toLowerCase()===name.toLowerCase())||(!isEdit&&existing))return{error:`${g.name} already has a subgroup called ${name}`};
      if(existing){existing.name=name;save(`Subgroup updated: ${name}`);return clone(existing);}
      const rec={id,name};
      g.subgroups.push(rec);
      save(`Subgroup created: ${g.name} / ${name}`);
      return clone(rec);
    },
    deleteSubgroup(groupId,id){
      const g=groupFor(state,groupId);
      if(!g)return{error:'Group not found'};
      const sub=g.subgroups.find(x=>x.id===id);
      if(!sub)return{error:'Subgroup not found'};
      const used=state.inventory.filter(x=>x.group===groupId&&x.subgroup===id).length;
      if(used)return{error:`${sub.name} still holds ${used} item${used===1?'':'s'}`};
      g.subgroups=g.subgroups.filter(x=>x.id!==id);
      save(`Subgroup deleted: ${g.name} / ${sub.name}`);
      return{ok:true};
    },
    // Refiling an item keeps its number. The number identifies the item and is
    // already written on receipts, issues and movements, so it travels with the
    // item rather than with the shelf it is filed on.
    setItemGroup(code,groupId,subgroupId){
      const item=state.inventory.find(x=>String(x.code)===String(code));
      if(!item)return{error:'Item not found'};
      const g=groupFor(state,groupId);
      if(!g)return{error:'Group not found'};
      const subId=String(subgroupId||'');
      const sub=subId?(g.subgroups||[]).find(x=>x.id===subId):null;
      if(subId&&!sub)return{error:`${g.name} has no subgroup ${subId}`};
      if(item.group===groupId&&String(item.subgroup||'')===subId)return clone(item);
      const wasGroup=groupFor(state,item.group);
      item.group=groupId;
      item.subgroup=subId;
      item.category=(sub&&sub.name)||g.name;
      save(`Item ${item.itemNo} moved from ${wasGroup?wasGroup.name:'—'} to ${g.name}${sub?' / '+sub.name:''}`);
      return clone(item);
    },
    createInventoryItem(payload){
      const data=clone(payload||{});
      data.description=String(data.description||'').trim();
      data.category=String(data.category||'').trim();
      data.unit=String(data.unit||'').trim().toUpperCase();
      data.location=String(data.location||'').trim();
      data.group=String(data.group||'').trim();
      data.subgroup=String(data.subgroup||'').trim();
      data.locationGroup=String(data.locationGroup||'').trim();
      data.locationSub=String(data.locationSub||'').trim();
      data.baseUnit=String(data.baseUnit||'pcs').trim();
      data.sizePerUnit=Number(data.sizePerUnit)>0?Number(data.sizePerUnit):1;
      data.weightPerBase=Number(data.weightPerBase)>0?Number(data.weightPerBase):0;
      if(data.locationGroup){
        const lg=(state.locationGroups||[]).find(x=>x.id===data.locationGroup);
        if(!lg)return{error:'Warehouse not found'};
        if(data.locationSub&&!lg.subgroups.some(x=>x.id===data.locationSub))return{error:`${lg.name} has no sublocation ${data.locationSub}`};
      }
      const grp=groupFor(state,data.group);
      if(!grp)return{error:'Item group is required'};
      if(data.subgroup&&!grp.subgroups.some(x=>x.id===data.subgroup))return{error:`${grp.name} has no subgroup ${data.subgroup}`};
      // The group hands out the number. Unless the user typed a code of their
      // own - a supplier or drawing reference - the number is the code, so a
      // new item carries one identifier rather than two.
      const itemNo=allocateItemNumber(state,data.group);
      data.itemNo=itemNo;
      data.code=String(data.code||itemNo).trim().toUpperCase();
      if(!data.code)return{error:'Item code is required'};
      if(!/^[A-Z0-9][A-Z0-9._/-]*$/.test(data.code))return{error:'Item code contains unsupported characters'};
      if(state.inventory.some(item=>String(item.code||'').trim().toUpperCase()===data.code))return{error:`Item ${data.code} already exists`};
      if(!data.description)return{error:'Description is required'};
      if(!data.unit)return{error:'Unit is required'};
      if(!data.location)return{error:'Location is required'};
      const numeric=['stock','reserved','minStock','reorderQty','avgCost','lastPrice'];
      for(const field of numeric){
        const value=Number(data[field]||0);
        if(!Number.isFinite(value)||value<0)return{error:`${field} must be zero or greater`};
        data[field]=value;
      }
      if(data.reserved>data.stock)return{error:'Reserved quantity cannot exceed stock'};
      // The subgroup name stands in as the category, so records written before
      // groups existed and records written now read the same way.
      const subName=(grp.subgroups.find(x=>x.id===data.subgroup)||{}).name||grp.name;
      if(!data.category)data.category=subName;
      const rec=Object.assign({grade:'',dimensions:'',supplier:'',heat:'',certificate:null,status:'good'},data);
      rec.status=rec.stock-rec.reserved<=rec.minStock?'low':'good';
      state.inventory.push(rec);
      save(`Inventory item created: ${rec.code}`);
      return clone(rec);
    },
    reserveItem(input){const inv=inventory(input.code),p=project(input.projectNo);if(!inv||!p)return{error:'Item or project not found'};const requested=Math.max(0,Number(input.qty)||0),free=Math.max(0,inv.stock-inv.reserved),qty=Math.min(requested,free);if(!qty)return{error:'No available stock to reserve'};inv.reserved+=qty;let line=(p.bom||[]).find(x=>x.code===inv.code);if(!line){line={code:inv.code,description:inv.description,required:qty,reserved:0,issued:0,unit:inv.unit};p.bom=p.bom||[];p.bom.push(line)}line.reserved=(line.reserved||0)+qty;addMovement({action:'RESERVED',code:inv.code,qty,unit:inv.unit,from:inv.location,to:p.no,projectNo:p.no,jobcard:input.jobcard,user:input.user||UNNAMED});const r=projectReadiness(p);p.materialStatus=r.status==='READY FOR PRODUCTION'?'ready':'shortage';save(`Material reserved: ${inv.code}`);return{item:clone(inv),project:clone(p),reserved:qty,readiness:clone(r)}},
    reserveBom(no){const p=project(no);if(!p)return null;(p.bom||[]).forEach(line=>{const inv=inventory(line.code);if(!inv)return;const need=Math.max(0,line.required-(line.reserved||0)),free=Math.max(0,inv.stock-inv.reserved),qty=Math.min(need,free);line.reserved=(line.reserved||0)+qty;inv.reserved+=qty;if(qty)addMovement({action:'RESERVED',code:line.code,qty,unit:line.unit,from:inv.location,to:no,projectNo:no})});const r=projectReadiness(p);p.materialStatus=r.status==='READY FOR PRODUCTION'?'ready':'shortage';save(`BOM reserved: ${no}`);return clone(r)},
    resolveBarcode:code=>state.barcodeLinks[code]||null,
    linkBarcode(barcode,itemCode){if(!inventory(itemCode))return false;state.barcodeLinks[barcode]=itemCode;save(`Barcode linked: ${barcode}`);return true},
    receive(input){
      const inv=inventory(input.code),qty=quantity(input.qty),poNo=String(input.po||'').trim();
      if(!inv)return{error:'Item not found'};
      if(!qty)return{error:'Quantity must be greater than zero'};
      const linkedPo=poNo?state.purchaseOrders.find(po=>po.no===poNo):null;
      if(linkedPo&&linkedPo.status==='Cancelled')return{error:`Purchase order ${poNo} is cancelled`};
      if(linkedPo&&linkedPo.itemCode&&linkedPo.itemCode!==inv.code)return{error:`Purchase order ${poNo} is for ${linkedPo.itemCode}`};
      inv.stock+=qty;
      if(input.location)inv.location=input.location;
      if(input.supplier)inv.supplier=input.supplier;
      if(input.heat)inv.heat=input.heat;
      if(input.certificate)inv.certificate=input.certificate;
      inv.lastPrice=Number(input.lastPrice)||inv.lastPrice;
      inv.status=inv.stock-inv.reserved<=inv.minStock?'low':'good';
      if(linkedPo){
        linkedPo.receivedQty=(Number(linkedPo.receivedQty)||0)+qty;
        linkedPo.receivedValue=(Number(linkedPo.receivedValue)||0)+qty*(Number(input.lastPrice)||Number(inv.lastPrice)||0);
        linkedPo.lastReceiptDate=now().slice(0,10);
        linkedPo.lastDeliveryNote=String(input.deliveryNote||'').trim();
        const orderedQty=Number(linkedPo.orderedQty)||0;
        linkedPo.status=orderedQty>0&&linkedPo.receivedQty>=orderedQty?'Received':'Partially Received';
      }
      addMovement({action:'RECEIVED',code:inv.code,qty,unit:inv.unit,from:`${input.supplier||inv.supplier} / ${poNo||'No PO'}`,to:inv.location,user:input.user||UNNAMED,heat:input.heat,certificate:input.certificate,purchaseOrderNo:linkedPo?linkedPo.no:null,deliveryNote:String(input.deliveryNote||'').trim()});
      return clone(inv);
    },
    issue(input){const inv=inventory(input.code),p=project(input.projectNo),qty=quantity(input.qty);if(!inv||!p)return{error:'Item or project not found'};if(!qty)return{error:'Quantity must be greater than zero'};const available=inv.stock-inv.reserved;if(qty>available&&qty>inv.reserved)return{error:'Quantity exceeds available stock'};inv.stock-=qty;inv.reserved=Math.max(0,inv.reserved-Math.min(inv.reserved,qty));const line=(p.bom||[]).find(x=>x.code===inv.code);if(line){line.issued=(line.issued||0)+qty;line.reserved=Math.max(0,(line.reserved||0)-qty)}p.actualMaterialCost=(p.actualMaterialCost||0)+qty*inv.avgCost;addMovement({action:'ISSUED',code:inv.code,qty,unit:inv.unit,from:inv.location,to:`${p.no}${input.jobcard?' / '+input.jobcard:''}`,projectNo:p.no,jobcard:input.jobcard,user:input.user||UNNAMED});return{item:clone(inv),project:clone(p)}},
    move(input){const inv=inventory(input.code),qty=quantity(input.qty);if(!inv)return{error:'Item not found'};if(!qty)return{error:'Quantity must be greater than zero'};const from=inv.location;if(input.action==='RETURN')inv.stock+=qty;if(input.action==='SCRAP')inv.stock=Math.max(0,inv.stock-qty);if(input.action==='TRANSFER'&&input.to)inv.location=input.to;addMovement({action:input.action,code:inv.code,qty,unit:inv.unit,from,to:input.to||inv.location,projectNo:input.projectNo,jobcard:input.jobcard,user:input.user||UNNAMED});return clone(inv)},
    addOffcut(offcut){offcut=clone(offcut);offcut.id=state.counters.offcut++;offcut.code=offcut.code||`OFF-${String(offcut.id).padStart(4,'0')}`;offcut.created=now().slice(0,10);offcut.status='available';state.offcuts.unshift(offcut);save(`Offcut created: ${offcut.code}`);return clone(offcut)},
    // The one real transition out of 'available' — without this, every offcut ever registered stays
    // 'available' forever (Register offcut sets status but nothing ever moved it), so the same
    // remnant could be "used" an unlimited number of times with no record of where it actually went.
    useOffcut(idOrCode,usage={}){
      const off=state.offcuts.find(x=>x.id===idOrCode||x.code===idOrCode);
      if(!off)return{error:'Offcut not found'};
      if(off.status==='used')return{error:`Offcut ${off.code} has already been used`};
      off.status='used';
      off.usedProject=usage.project||null;
      off.usedJobcard=usage.jobcard||null;
      off.usedDate=now().slice(0,10);
      off.usedBy=usage.user||UNNAMED;
      save(`Offcut used: ${off.code}`);
      return clone(off);
    },
    recordCount(rec){const inv=inventory(rec.code),counted=Number(rec.counted);if(!inv)return{error:'Item not found'};if(!Number.isFinite(counted)||counted<0)return{error:'Count must be zero or greater'};const count={date:now(),code:rec.code,system:inv.stock,counted,difference:counted-inv.stock,scope:rec.scope,user:rec.user||UNNAMED};state.stockCounts.unshift(count);save(`Stock counted: ${rec.code}`);return clone(count)},
    adjustCount(code,counted){const inv=inventory(code);if(!inv)return null;const before=inv.stock;inv.stock=Number(counted);addMovement({action:'ADJUSTED',code,qty:inv.stock-before,unit:inv.unit,from:inv.location,to:inv.location});return clone(inv)},

    // ── Jobcards: production orders issued to the workshop, linked to a project. ──
    listJobcards:()=>clone(state.jobcards),
    findJobcard:idOrNo=>clone(jobcard(idOrNo)),
    upsertJobcard(payload){let j=payload.id?jobcard(payload.id):(payload.no?jobcard(payload.no):null);
      if(j){
        const data=clone(payload);
        if(data.status&&JOBCARD_UNSAFE_STATUSES.includes(data.status)&&j.status!==data.status){
          const gate=jobcardQualityGate(j.no);
          if(gate.blocked)return qualityGateBlockedResult(`Jobcard ${data.status}`,j.no,gate);
        }
        // A caller cannot bypass updateJobcardOperation()'s gate by submitting a whole `operations`
        // array through this method instead (e.g. copy-modify-save) — compare every incoming
        // operation against its stored counterpart by id before trusting any of them.
        // Review fix (4th review, finding 1): presence is checked with hasOwnProperty, never
        // truthiness — a genuine [] must still reach the checks below, while null/{}/''/etc. are
        // rejected outright as a malformed payload, never silently applied via Object.assign.
        const hasOperationsField=Object.prototype.hasOwnProperty.call(data,'operations');
        if(hasOperationsField){
          const validation=validateOperationsArrayPayload(data.operations);
          if(!validation.valid)return invalidJobcardPayloadResult(validation,j.no);
          // Review fix (finding A): an in-progress operation simply omitted from the incoming array
          // (a silent delete) is checked first and unconditionally — it must be paused before it can
          // be removed, exactly like it must be paused before its equipment can change.
          const deleteAttempts=activeOperationDeletionAttempts(j.operations,data.operations);
          if(deleteAttempts.length)return operationStartBlockedResult('OPERATION_ACTIVE_DELETE_REQUIRES_PAUSE','An in-progress operation cannot be deleted — pause it first.',j.no,null,{operationIds:deleteAttempts.map(o=>o.id)});
          // Review fix: an equipment swap on an already-in-progress operation, smuggled into a
          // same-status bulk operations-array replace, is checked FIRST and unconditionally — see
          // unsafeOperationEquipmentChanges() above (unsafeOperationTransitions below never catches
          // this, since the status itself does not change).
          const equipChanges=unsafeOperationEquipmentChanges(j.operations,data.operations);
          if(equipChanges.length)return operationStartBlockedResult('OPERATION_EQUIPMENT_CHANGE_REQUIRES_PAUSE','This operation is in-progress — pause it before changing its equipment.',j.no,null,{operationIds:equipChanges.map(o=>o.id)});
          const changed=unsafeOperationTransitions(j.operations,data.operations);
          if(changed.length){
            // Review fix: an 'in-progress' transition smuggled into a bulk operations-array save has
            // no exemption to check for — it is unconditionally refused, exactly like every other
            // generic path. Only startJobcardOperation() may set this status.
            const startAttempts=changed.filter(o=>o.status===OPERATION_START_STATUS);
            if(startAttempts.length)return operationStartBlockedResult('OPERATION_START_DEDICATED_METHOD_REQUIRED','Starting or resuming an operation must go through startJobcardOperation() — a bulk operations-array update cannot do it.',j.no,null,{operationIds:startAttempts.map(o=>o.id)});
            const gate=jobcardQualityGate(j.no);
            if(gate.blocked)return qualityGateBlockedResult(`Operation ${changed.map(o=>o.status).join('/')}`,j.no,gate,{operationIds:changed.map(o=>o.id)});
          }
        }
        // Review fix (finding B): a full `machines` array replace must never silently unlink the
        // equipmentId a currently in-progress operation depends on for its authorization. Checked
        // against the RESULTING operations array (this same patch's own `data.operations` when also
        // supplied, otherwise the stored one), so a combined operations+machines patch stays correct.
        // Review fix (4th review, finding 1): same hasOwnProperty + shape validation as operations.
        if(Object.prototype.hasOwnProperty.call(data,'machines')){
          const validation=validateMachinesArrayPayload(data.machines);
          if(!validation.valid)return invalidJobcardPayloadResult(validation,j.no);
          const unlinkAttempts=activeOperationEquipmentUnlinkAttempts(hasOperationsField?data.operations:j.operations,data.machines);
          if(unlinkAttempts.length)return operationStartBlockedResult('ACTIVE_OPERATION_EQUIPMENT_UNLINK_REQUIRES_PAUSE','Equipment used by an in-progress operation cannot be unlinked — pause the operation first.',j.no,null,{operationIds:unlinkAttempts.map(o=>o.id)});
        }
        Object.assign(j,data);
      }
      else{
        const data=clone(payload);
        // A brand-new Jobcard must be gated exactly like an existing one: creating it directly with
        // an unsafe status (in-progress/completed/closed), or with pre-populated operations already
        // set to in-progress/completed/skipped, must not bypass a hold on its supplied Jobcard
        // number or its parent Project — nothing is created/mutated when rejected.
        // Review fix: a seed operation already 'in-progress' has no hold-dependent exemption — new
        // operations must never be created already running, full stop.
        const seedStartAttempts=Array.isArray(data.operations)?data.operations.filter(op=>op&&op.status===OPERATION_START_STATUS):[];
        if(seedStartAttempts.length)return operationStartBlockedResult('OPERATION_START_DEDICATED_METHOD_REQUIRED','New operations cannot be created already in-progress.',data.no||'(new jobcard)',null,{operationIds:seedStartAttempts.map(o=>o.id)});
        const wantsUnsafeStatus=data.status&&JOBCARD_UNSAFE_STATUSES.includes(data.status);
        const wantsUnsafeOps=hasUnsafeSeedOperations(data.operations);
        if(wantsUnsafeStatus||wantsUnsafeOps){
          const gate=jobcardQualityGate(data.no,data.projectNo);
          if(gate.blocked)return qualityGateBlockedResult(`New Jobcard${wantsUnsafeStatus?' '+data.status:''}`,data.no||data.projectNo||'(new jobcard)',gate);
        }
        j=Object.assign({operations:[],materials:[],machines:[],inspections:[],notes:[],documents:[],activity:[],workers:[],archived:false,status:'draft'},data);
        j.id=state.counters.jobcard=(state.counters.jobcard||0)+1;
        j.no=j.no||('JC-'+new Date().getFullYear()+'-'+String(j.id).padStart(4,'0'));
        state.jobcards.push(j);
      }
      save(`Jobcard saved: ${j.no}`);return clone(j)},
    // Generic status-affecting patches (e.g. resume, direct edits) go through the same Quality Hold
    // gate as the dedicated transition helpers below — a caller cannot bypass safety by calling this
    // lower-level method directly. Non-status patches (reordering operations, editing fields) are
    // never blocked.
    updateJobcard(idOrNo,patch){
      const j=jobcard(idOrNo);if(!j)return null;
      const data=clone(patch);
      if(data.status&&JOBCARD_UNSAFE_STATUSES.includes(data.status)&&j.status!==data.status){
        const gate=jobcardQualityGate(j.no);
        if(gate.blocked)return qualityGateBlockedResult(`Jobcard ${data.status}`,j.no,gate);
      }
      // Same operations-array bypass check as upsertJobcard above — a whole-array patch (used by
      // reorder/duplicate/delete flows) must not be able to sneak an unsafe operation-status
      // transition past updateJobcardOperation()'s dedicated gate.
      // Review fix (4th review, finding 1): presence via hasOwnProperty, never truthiness — see
      // upsertJobcard above for the full rationale.
      const hasOperationsField=Object.prototype.hasOwnProperty.call(data,'operations');
      if(hasOperationsField){
        const validation=validateOperationsArrayPayload(data.operations);
        if(!validation.valid)return invalidJobcardPayloadResult(validation,j.no);
        // Review fix (finding A): same active-operation-deletion check as upsertJobcard above,
        // checked first and unconditionally.
        const deleteAttempts=activeOperationDeletionAttempts(j.operations,data.operations);
        if(deleteAttempts.length)return operationStartBlockedResult('OPERATION_ACTIVE_DELETE_REQUIRES_PAUSE','An in-progress operation cannot be deleted — pause it first.',j.no,null,{operationIds:deleteAttempts.map(o=>o.id)});
        // Review fix: same equipment-swap-on-in-progress check as upsertJobcard above, checked first
        // and unconditionally.
        const equipChanges=unsafeOperationEquipmentChanges(j.operations,data.operations);
        if(equipChanges.length)return operationStartBlockedResult('OPERATION_EQUIPMENT_CHANGE_REQUIRES_PAUSE','This operation is in-progress — pause it before changing its equipment.',j.no,null,{operationIds:equipChanges.map(o=>o.id)});
        const changed=unsafeOperationTransitions(j.operations,data.operations);
        if(changed.length){
          const startAttempts=changed.filter(o=>o.status===OPERATION_START_STATUS);
          if(startAttempts.length)return operationStartBlockedResult('OPERATION_START_DEDICATED_METHOD_REQUIRED','Starting or resuming an operation must go through startJobcardOperation() — a bulk operations-array update cannot do it.',j.no,null,{operationIds:startAttempts.map(o=>o.id)});
          const gate=jobcardQualityGate(j.no);
          if(gate.blocked)return qualityGateBlockedResult(`Operation ${changed.map(o=>o.status).join('/')}`,j.no,gate,{operationIds:changed.map(o=>o.id)});
        }
      }
      // Review fix (finding B): same active-operation-equipment-unlink check as upsertJobcard above.
      // Review fix (4th review, finding 1): same hasOwnProperty + shape validation as operations.
      if(Object.prototype.hasOwnProperty.call(data,'machines')){
        const validation=validateMachinesArrayPayload(data.machines);
        if(!validation.valid)return invalidJobcardPayloadResult(validation,j.no);
        const unlinkAttempts=activeOperationEquipmentUnlinkAttempts(hasOperationsField?data.operations:j.operations,data.machines);
        if(unlinkAttempts.length)return operationStartBlockedResult('ACTIVE_OPERATION_EQUIPMENT_UNLINK_REQUIRES_PAUSE','Equipment used by an in-progress operation cannot be unlinked — pause the operation first.',j.no,null,{operationIds:unlinkAttempts.map(o=>o.id)});
      }
      Object.assign(j,data);save(`Jobcard updated: ${j.no}`);return clone(j);
    },
    archiveJobcard(idOrNo){const j=jobcard(idOrNo);if(!j)return null;j.archived=true;j.archivedAt=now();save(`Jobcard archived: ${j.no}`);return clone(j)},
    addJobcardOperation(idOrNo,operation){
      const j=jobcard(idOrNo);if(!j)return null;
      operation=clone(operation);
      // Review fix: a brand-new operation must never be created already 'in-progress' — that status
      // may only ever be reached through startJobcardOperation(), never at creation time.
      if(operation&&operation.status===OPERATION_START_STATUS)return operationStartBlockedResult('OPERATION_START_DEDICATED_METHOD_REQUIRED','New operations cannot be created already in-progress.',j.no,null);
      j._opSeq=(j._opSeq||j.operations.reduce((a,o)=>Math.max(a,o.id||0),0))+1;operation.id=j._opSeq;j.operations.push(operation);save(`Operation added: ${j.no}`);return clone(operation)},
    // Completing or skipping an operation is blocked by an active Quality Hold on the Jobcard (or its
    // Project) — this is the single chokepoint every page path (Complete button, the operation edit
    // form's status dropdown used to "skip") already goes through. Starting/resuming ('in-progress')
    // is EXPLICITLY refused here (see review fix below) — startJobcardOperation() is its one route.
    updateJobcardOperation(idOrNo,opId,patch){
      const j=jobcard(idOrNo);if(!j)return null;
      const op=j.operations.find(o=>o.id===opId);if(!op)return null;
      const data=clone(patch);
      // Review fix (4th review, finding 2): a malformed/unknown status (null, '', a number, an
      // unrecognised string) must never be usable as a disguised "fake transition away from
      // in-progress" — every check below keys off the exact recognised status strings, so anything
      // else would otherwise slip past all of them and still get applied via Object.assign. Rejected
      // unconditionally, before any other check, using hasOwnProperty (never truthiness) so
      // status:'' / null / 0 are all caught — none of those is a valid operation status.
      if(Object.prototype.hasOwnProperty.call(data,'status')&&!OPERATION_STATUSES.includes(data.status)){
        return operationStartBlockedResult('INVALID_OPERATION_STATUS',`"${data.status}" is not a recognised operation status.`,j.no,opId);
      }
      // Review fix (edit-operation start bypass): the Edit Operation form (or any other generic
      // caller) can no longer transition an operation into 'in-progress' — only a genuine transition
      // is refused; re-saving an operation that is already in-progress with unrelated field edits
      // stays allowed, exactly like the Quality-Hold-gated statuses below.
      if(data.status===OPERATION_START_STATUS&&op.status!==OPERATION_START_STATUS){
        return operationStartBlockedResult('OPERATION_START_DEDICATED_METHOD_REQUIRED','Starting or resuming an operation must go through startJobcardOperation(), which checks the Quality Hold and Equipment safety gates.',j.no,opId);
      }
      // Review fix (running-operation equipment-swap bypass): while an operation stays in-progress
      // (its stored status is 'in-progress'), equipmentId and machine are safety-controlled — they
      // cannot be added, removed or changed. The equipment that was actually safety-checked and
      // assigned at start time must stay the equipment in use until the operation is paused;
      // resuming afterwards re-runs the full startJobcardOperation() check against whatever
      // equipment is linked at that point.
      // Review fix (5th review): the ONLY transition that may be combined with an equipment edit is
      // an explicit, exact 'paused' — completing, skipping, reverting to pending, re-confirming
      // in-progress, or omitting status entirely all remain fully equipment-protected. Completing or
      // skipping an operation must never be usable to rewrite which equipment performed the work.
      // Malformed-status values were already rejected above, so data.status here is either undefined
      // or one of the five recognised statuses — a plain equality check is sufficient and correct.
      if(op.status===OPERATION_START_STATUS&&data.status!=='paused'){
        const equipmentIdChanged=Object.prototype.hasOwnProperty.call(data,'equipmentId')&&data.equipmentId!==op.equipmentId;
        const machineChanged=Object.prototype.hasOwnProperty.call(data,'machine')&&data.machine!==op.machine;
        if(equipmentIdChanged||machineChanged){
          return operationStartBlockedResult('OPERATION_EQUIPMENT_CHANGE_REQUIRES_PAUSE','This operation is in-progress — pause it before changing its equipment.',j.no,opId);
        }
      }
      if(data.status&&OPERATION_UNSAFE_STATUSES.includes(data.status)&&op.status!==data.status){
        const gate=jobcardQualityGate(j.no);
        if(gate.blocked)return qualityGateBlockedResult(`Operation ${data.status}`,j.no,gate,{operationId:opId});
      }
      Object.assign(op,data);save(`Operation updated: ${j.no}`);return clone(op);
    },
    // The ONE authoritative path into 'in-progress' for a Jobcard operation — used for both starting
    // (pending -> in-progress) and resuming (paused -> in-progress). Re-checks, in order: the Quality
    // Hold gate (same as every other unsafe transition), then — only when the operation references
    // equipment — that it resolves to a real record EXPLICITLY linked to this Jobcard by equipmentId
    // AND currently assigned to exactly this Jobcard (never a stale link, never a resolvable legacy
    // name, never equipment assigned elsewhere), then the central canUseEquipment() safety gate
    // (mandatory pre-use check, blockers, ...). All of this reads live `state` directly — never a
    // page-side cached snapshot — so it is correct even if equipment was reassigned a moment ago by a
    // different part of the app. A rejected start leaves the Jobcard, operation and Equipment records
    // completely unchanged. Re-calling this on an operation that is ALREADY in-progress is a harmless
    // no-op (matches the "re-saving the same status is not a transition" rule used everywhere else).
    startJobcardOperation(idOrNo,opId,meta={}){
      const j=jobcard(idOrNo);if(!j)return null;
      const op=j.operations.find(o=>o.id===opId);if(!op)return null;
      if(op.status===OPERATION_START_STATUS)return clone(op);
      const qGate=jobcardQualityGate(j.no);
      if(qGate.blocked)return qualityGateBlockedResult('Operation in-progress',j.no,qGate,{operationId:opId});
      if(!global.JobcardEquipmentRules)throw new Error('jobcard-equipment-rules.js must be loaded before workshop-data.js to use startJobcardOperation()');
      const resolved=global.JobcardEquipmentRules.canStartOperationEquipment(op,j.machines,state.equipment,j.no);
      if(resolved.required&&resolved.code){
        const eqId=resolved.equipment?resolved.equipment.equipmentId:(op.equipmentId||null);
        const assignedJobcard=resolved.equipment?resolved.equipment.assignedJobcard:null;
        const messages={
          EQUIPMENT_NOT_LINKED:'Required equipment is not explicitly linked to this Jobcard by equipment ID.',
          EQUIPMENT_MISSING:'The linked equipment record no longer exists.',
          EQUIPMENT_UNASSIGNED:'This equipment is not currently assigned to this Jobcard.',
          EQUIPMENT_ASSIGNED_ELSEWHERE:`This equipment is currently assigned to ${assignedJobcard||'another Jobcard'}.`
        };
        return operationStartBlockedResult(resolved.code,messages[resolved.code],j.no,opId,{equipmentId:eqId,assignedJobcard});
      }
      if(resolved.required&&resolved.equipment){
        const use=api.canUseEquipment(resolved.equipment.equipmentId,{date:meta.date||now().slice(0,10),projectNo:j.projectNo,jobcardNo:j.no});
        if(!use.allowed)return equipmentGateBlockedResult('Start operation',resolved.equipment.equipmentId,use.gate,{jobcardNo:j.no,operationId:opId});
      }
      op.status=OPERATION_START_STATUS;
      if(!op.actualStart)op.actualStart=meta.date||now().slice(0,10);
      save(`Operation started: ${j.no}`);
      return clone(op);
    },
    assignJobcardWorker(idOrNo,worker){const j=jobcard(idOrNo);if(!j||!worker)return null;j.workers=j.workers||[];if(!j.workers.includes(worker))j.workers.push(worker);save(`Worker assigned to ${j.no}: ${worker}`);return clone(j)},
    addJobcardNote(idOrNo,note){const j=jobcard(idOrNo);if(!j)return null;note=Object.assign({id:Date.now(),date:now().slice(0,10),time:new Date().toTimeString().slice(0,5)},clone(note));j.notes=j.notes||[];j.notes.unshift(note);save(`Note added: ${j.no}`);return clone(note)},
    addJobcardInspection(idOrNo,inspection){const j=jobcard(idOrNo);if(!j)return null;inspection=Object.assign({id:Date.now()},clone(inspection));j.inspections=j.inspections||[];j.inspections.push(inspection);save(`Inspection added: ${j.no}`);return clone(inspection)},
    updateJobcardInspection(idOrNo,inspId,patch){const j=jobcard(idOrNo);if(!j)return null;const insp=(j.inspections||[]).find(i=>i.id===inspId);if(!insp)return null;Object.assign(insp,clone(patch));save(`Inspection updated: ${j.no}`);return clone(insp)},
    recordJobcardActivity(idOrNo,entry){const j=jobcard(idOrNo);if(!j)return null;entry=Object.assign({date:now().slice(0,10),time:new Date().toTimeString().slice(0,5),by:UNNAMED},clone(entry));j.activity=j.activity||[];j.activity.unshift(entry);save(`Jobcard activity: ${j.no}`);return clone(entry)},
    // A read-only accessor: it must never mutate state. normalize() already guarantees
    // state.equipment is a valid array (backfilling it only when missing/invalid, never when it is
    // a genuinely empty user collection) — see the "empty stays empty" rule. Nothing adds machines
    // a workshop did not enter itself.
    getEquipment:()=>clone(state.equipment||[]),
    createEquipment:(payload)=>{
      const item=clone(payload||{});
      // Pass 3.2C, Part A: equipmentId/id/name/category must each be a genuine, non-empty-after-
      // trim string — a bare truthiness check previously accepted numbers, booleans, whitespace-
      // only strings, objects and arrays as a "valid" identifier or name.
      // Pass 3.2C review fix (dual Equipment ID validation bypass): presence is checked via
      // hasOwnProperty, never truthiness of the normalized candidate — a SUPPLIED field must be
      // valid on its own terms. Previously, a malformed equipmentId (a number, boolean, blank
      // string, array or object) was silently "rescued" whenever a valid `id` was also present
      // (and vice versa), because only the pair `!equipmentIdCandidate&&!legacyIdCandidate` was
      // checked. Each supplied field is now validated independently before the two are reconciled.
      const hasEquipmentIdField=Object.prototype.hasOwnProperty.call(item,'equipmentId');
      const hasLegacyIdField=Object.prototype.hasOwnProperty.call(item,'id');
      const equipmentIdCandidate=hasEquipmentIdField?normalizeRequiredIdentityString(item.equipmentId):null;
      const legacyIdCandidate=hasLegacyIdField?normalizeRequiredIdentityString(item.id):null;
      if(!hasEquipmentIdField&&!hasLegacyIdField){
        return{error:'A valid, non-empty Equipment ID is required',code:'INVALID_EQUIPMENT_ID',reason:'EQUIPMENT_ID_REQUIRED'};
      }
      if((hasEquipmentIdField&&!equipmentIdCandidate)||(hasLegacyIdField&&!legacyIdCandidate)){
        return{error:'A valid, non-empty Equipment ID is required',code:'INVALID_EQUIPMENT_ID',reason:'EQUIPMENT_ID_REQUIRED'};
      }
      // `id` is accepted only as a legacy fallback when equipmentId itself is absent — if a caller
      // supplies both and they disagree, that is ambiguous and the whole creation is rejected
      // rather than silently preferring one over the other.
      if(equipmentIdCandidate&&legacyIdCandidate&&equipmentIdCandidate!==legacyIdCandidate){
        return{error:'equipmentId and id were both supplied and do not match',code:'INVALID_EQUIPMENT_ID',reason:'EQUIPMENT_ID_MISMATCH'};
      }
      const key=equipmentIdCandidate||legacyIdCandidate;
      const normalizedName=normalizeRequiredIdentityString(item.name);
      if(!normalizedName) return {error:'Equipment name is required'};
      const normalizedCategory=normalizeRequiredIdentityString(item.category);
      if(!normalizedCategory) return {error:'Category is required'};
      const EG=global.EquipmentGates;
      // Status presence via hasOwnProperty, never truthiness — malformed values (null, '',
      // whitespace, a number, a boolean, an array, an object) are rejected atomically before
      // anything else is validated.
      const hasStatusField=Object.prototype.hasOwnProperty.call(item,'status');
      if(hasStatusField&&(typeof item.status!=='string'||!item.status.trim())){
        return{error:'status must be a non-empty string',code:'INVALID_EQUIPMENT_STATUS',reason:'STATUS_MALFORMED'};
      }
      const requestedStatus=hasStatusField?item.status.trim():'Available';
      const normalizedStatus=EG?EG.normalizeStatus(requestedStatus):requestedStatus.toLowerCase();
      // Retired/Reserved/In Use are all reachable ONLY through their own dedicated, evidenced
      // workflow after the record exists — never as an initial creation status. Checked in this
      // order because 'retired' is also technically a hard-block status, but gets its own specific
      // (and stricter — retireEquipment() requires a reason) rejection code.
      if(normalizedStatus==='retired'){
        return{error:'Equipment cannot be created directly as Retired — use retireEquipment() (with a reason) after creation.',code:'EQUIPMENT_RETIREMENT_REQUIRES_WORKFLOW'};
      }
      if(normalizedStatus==='reserved'||normalizedStatus==='in use'){
        return{error:'Equipment cannot be created directly as Reserved or In Use — use the reservation/assignment workflow after creation.',code:'EQUIPMENT_INITIAL_STATUS_REQUIRES_WORKFLOW'};
      }
      // The only remaining acceptable values are 'Available' or a genuine hard-block status
      // (Maintenance Due, Under Maintenance, Inspection Required, Out of Service, Quarantined) —
      // equipment onboarded already needing attention. Anything else is not a recognised status.
      if(normalizedStatus!=='available'&&!(EG&&EG.isHardBlockStatus(requestedStatus))){
        return{error:`"${requestedStatus}" is not a recognised initial equipment status.`,code:'INVALID_EQUIPMENT_STATUS',reason:'STATUS_UNRECOGNISED',attemptedStatus:requestedStatus};
      }
      // A caller can never smuggle in assignment/retirement/audit state at creation time — the
      // whole creation is rejected atomically, never a silent partial create with just those
      // fields dropped. hasOwnProperty, never truthiness — an explicit empty array/false/null is
      // still a present, protected field.
      const touchedCreationProtected=EQUIPMENT_CREATION_PROTECTED_FIELDS.filter(f=>Object.prototype.hasOwnProperty.call(item,f));
      if(touchedCreationProtected.length)return equipmentCreationFieldsBlockedResult(touchedCreationProtected);
      // Pass 3.2C review fix (legacy whitespace duplicate bypass): the NEW key is already trimmed,
      // but a legacy stored record's own equipmentId/id (e.g. ' E-1001 ' saved before this
      // normalization existed) was compared RAW — so a new 'E-1001' was not caught as a duplicate.
      // Every existing record's equipmentId/id is now normalized the same way (genuine string,
      // trimmed) before comparison — read-only, via a local const, never writing back to `x` itself,
      // so duplicate detection never mutates the existing record.
      const isDuplicateKey=state.equipment.some(x=>{
        const existingEquipmentId=normalizeRequiredIdentityString(x&&x.equipmentId);
        const existingLegacyId=normalizeRequiredIdentityString(x&&x.id);
        return existingEquipmentId===key||existingLegacyId===key;
      });
      if(isDuplicateKey){ return {error:'Duplicate equipment ID'}; }
      const record={
        id:key,
        equipmentId:key,
        name:normalizedName,
        category:normalizedCategory,
        manufacturer:item.manufacturer||'—',
        model:item.model||'—',
        serial:item.serial||'—',
        assetNumber:item.assetNumber||`AS-${Date.now().toString().slice(-5)}`,
        status:requestedStatus,
        currentLocation:item.currentLocation||'Workshop',
        homeLocation:item.homeLocation||item.currentLocation||'Workshop',
        department:item.department||'Workshop',
        responsiblePerson:item.responsiblePerson||UNNAMED,
        condition:item.condition||'Good',
        criticality:item.criticality||'Medium',
        description:item.description||'',
        purchaseDate:item.purchaseDate||null,
        purchaseSupplier:item.purchaseSupplier||'—',
        purchasePrice:Number(item.purchasePrice)||0,
        warrantyExpiry:item.warrantyExpiry||null,
        yearOfManufacture:Number(item.yearOfManufacture)||new Date().getFullYear(),
        operatingHourMeter:Number(item.operatingHourMeter)||0,
        serviceInterval:Number(item.serviceInterval)||0,
        qrCode:item.qrCode||`EQ-${Date.now().toString().slice(-6)}`,
        maintenanceDate:item.maintenanceDate||null,
        inspectionDate:item.inspectionDate||null,
        certificationExpiry:item.certificationExpiry||null,
        calibrationDate:item.calibrationDate||null,
        requirements:normalizeEquipmentRequirements(item.requirements),
        safetyWarnings:[],
        assignedProject:null,
        assignedJobcard:null,
        operator:null,
        notes:item.notes||'Demo record created through the frontend workflow.',
        activity:[{timestamp:now(),action:'Equipment created',user:item.responsiblePerson||UNNAMED,reference:key}],
        inspections:[],
        maintenance:[],
        certifications:[],
        calibrations:[],
        notesLog:[],
        usageHistory:[],
        downtimeRecords:[],
        preUseChecks:[],
        returnToService:[],
        currentAssignment:null,
        usageSessions:[],
        isRetired:false,
        retirementReason:'',
        creationDate:now().slice(0,10),
        lastActivity:now()
      };
      state.equipment.unshift(record);
      state.counters.equipment=(state.counters.equipment||0)+1;
      save(`Equipment created: ${record.equipmentId}`);
      return clone(record);
    },
    updateEquipment:(equipmentId,patch)=>{
      const index=state.equipment.findIndex(x=>x.equipmentId===equipmentId||x.id===equipmentId);
      if(index<0) return null;
      const current=state.equipment[index];
      const data=clone(patch||{});
      // A caller-supplied override/force/blockers/reasons flag is never a real equipment field —
      // strip it before validation so it can never end up stored on the record.
      EQUIPMENT_OVERRIDE_FLAG_FIELDS.forEach(f=>{delete data[f];});
      // Close bypass: every gate-controlling / audit / usage-controlled field is protected — the
      // WHOLE mutation is rejected (never a silent partial apply) the instant the patch touches any
      // of them, so a caller cannot smuggle e.g. a future certificationExpiry alongside an unrelated
      // field and have the unrelated part quietly succeed.
      const touchedProtected=EQUIPMENT_PROTECTED_FIELDS.filter(f=>Object.prototype.hasOwnProperty.call(data,f));
      if(touchedProtected.length)return equipmentProtectedFieldsBlockedResult(equipmentId,touchedProtected);
      // Review fix (4th review, finding 3): presence via hasOwnProperty, never truthiness — a
      // malformed value (null, '', whitespace, a number, a boolean, an array, an object) must be
      // rejected atomically, before anything is touched, rather than silently applied via
      // Object.assign as a corrupted equipment.status. A non-empty-but-unrecognised STRING (e.g.
      // "Something Weird") is intentionally still accepted here — that is the existing, deliberate
      // fail-closed/fail-safe behaviour (see equipment-gates.js), not a validation failure.
      const hasStatusField=Object.prototype.hasOwnProperty.call(data,'status');
      if(hasStatusField&&(typeof data.status!=='string'||!data.status.trim())){
        return{error:'status must be a non-empty string',code:'INVALID_EQUIPMENT_STATUS',equipmentId};
      }
      // Close bypass: a genuine transition into an operational status is blocked exactly like
      // changeEquipmentStatus() below — moving OUT of an operational status (e.g. reporting it
      // broken) is always allowed; only moving INTO Available/Reserved/In Use while blocked is not.
      if(hasStatusField&&global.EquipmentGates&&global.EquipmentGates.normalizeStatus(data.status)!==global.EquipmentGates.normalizeStatus(current.status)&&global.EquipmentGates.isOperationalStatus(data.status)){
        const gate=equipmentSafetyGate(current,{});
        if(gate.blocked)return equipmentGateBlockedResult(`Equipment status update to ${data.status}`,equipmentId,gate);
      }
      const next=Object.assign({}, clone(current), data);
      next.lastActivity=now();
      state.equipment[index]=next;
      // Review fix (3rd review): a status change here can move equipment into a hard-block status —
      // reconcile before the single save() below so both changes persist together. Review fix (4th
      // review, finding 3): gated on field PRESENCE, not truthiness (now equivalent post-validation,
      // but presence is the semantically correct check).
      const recon=hasStatusField?reconcileActiveOperationsForEquipment(equipmentId,`equipment status changed to ${next.status}`):{pausedOperations:[]};
      save(`Equipment updated: ${equipmentId}`);
      return Object.assign(clone(next),{pausedOperations:recon.pausedOperations});
    },
    // Close bypass (C): moving blocked equipment back to an operational status through this
    // lower-level method is gated exactly like updateEquipment() above — a caller cannot bypass
    // safety by calling this instead. Moving to a non-operational status (e.g. Quarantined) is
    // always allowed, matching Pass 3.1's "safe direction" principle for Quality Holds.
    changeEquipmentStatus:(equipmentId,status,meta={})=>{
      const item=equip(equipmentId);
      if(!item) return {error:'Equipment not found'};
      // Review fix (4th review, finding 3): status is a positional argument here, not an object
      // field, so "presence" means the caller passed something at all — status===undefined (the
      // argument genuinely omitted) still means "keep the current status", matching every existing
      // caller's usage. Anything else EXPLICITLY supplied (null, '', whitespace, a number, a
      // boolean, an array, an object) must be rejected atomically rather than silently falling back
      // to "keep the old status" via `status||item.status` — that previously masked the fact that a
      // caller sent garbage. A non-empty-but-unrecognised STRING is still accepted (fail-closed).
      if(status!==undefined&&(typeof status!=='string'||!status.trim())){
        return{error:'status must be a non-empty string',code:'INVALID_EQUIPMENT_STATUS',equipmentId};
      }
      const nextStatus=status!==undefined?status:item.status;
      if(global.EquipmentGates&&global.EquipmentGates.normalizeStatus(nextStatus)!==global.EquipmentGates.normalizeStatus(item.status)&&global.EquipmentGates.isOperationalStatus(nextStatus)){
        const gate=equipmentSafetyGate(item,{});
        if(gate.blocked)return equipmentGateBlockedResult(`Status change to ${nextStatus}`,equipmentId,gate);
      }
      item.status=nextStatus;
      item.lastActivity=now();
      item.activity=item.activity||[];
      item.activity.unshift({timestamp:now(),action:`Status changed to ${nextStatus}`,user:meta.user||UNNAMED,reference:equipmentId,details:meta.reason||''});
      // Review fix (3rd review): reconcile before the single save() below so both changes persist together.
      const recon=reconcileActiveOperationsForEquipment(equipmentId,`equipment status changed to ${nextStatus}`);
      save(`Equipment status changed: ${equipmentId}`);
      return Object.assign(clone(item),{pausedOperations:recon.pausedOperations});
    },
    getEquipmentSafetyGate(equipmentId,options={}){
      const item=equip(equipmentId);
      const gate=equipmentSafetyGate(item,options);
      return Object.assign({},gate,{blockers:clone(gate.blockers)});
    },
    canAssignEquipment(equipmentId,options={}){const gate=api.getEquipmentSafetyGate(equipmentId,options);return{allowed:!gate.blocked,gate};},
    canUseEquipment(equipmentId,options={}){const gate=api.getEquipmentSafetyGate(equipmentId,Object.assign({requirePreUseCheck:true},options));return{allowed:!gate.blocked,gate};},
    // Reservation is its own method, never an unrestricted changeEquipmentStatus() call — it always
    // independently re-checks the gate before moving equipment into 'Reserved'.
    reserveEquipment(equipmentId,payload={}){
      const item=equip(equipmentId);
      if(!item) return {error:'Equipment not found'};
      const gate=equipmentSafetyGate(item,{});
      if(gate.blocked)return equipmentGateBlockedResult('Reserve',equipmentId,gate);
      // Pass 3.2C, Part B: the shared context validator confirms the referenced project/Jobcard are
      // real, active, correctly related, and that reservedBy was supplied — BEFORE anything is
      // touched. Never duplicated — assignEquipment() below uses the exact same function with
      // kind:'assign'.
      const context=validateEquipmentAssignmentContext('reserve',payload);
      if(!context.valid)return equipmentAssignmentContextBlockedResult('Reserve',equipmentId,context);
      // Every reference stored/compared from here on is the CANONICAL project/Jobcard number
      // resolved by the validator above — never the raw caller-supplied value. jobcard()/project()
      // resolve by either id or no, so a caller could pass a numeric Jobcard id that resolves
      // correctly here but, if persisted verbatim, would silently desynchronise assignedJobcard
      // from every other method that compares it against a canonical 'JC-...' string (the conflict
      // check immediately below included).
      const canonicalProjectNo=context.project.no;
      const canonicalJobcardNo=context.jobcard?context.jobcard.no:null;
      // Pass 3.2C review fix (cross-project reservation theft): checked FIRST, before the Jobcard
      // check below — a project-only reservation (assignedJobcard still null) must not be silently
      // stolen by a second project just because there is no Jobcard for the old conflict check to
      // catch. Same-project re-reservation remains idempotent.
      if(item.assignedProject&&item.assignedProject!==canonicalProjectNo){
        return equipmentProjectConflictResult('Reserve',equipmentId,item.assignedProject,canonicalProjectNo);
      }
      // Review fix (2nd review, finding 1): reserveEquipment() is a second route into the same
      // assignedJobcard field assignEquipment() already guards — it must never be usable to silently
      // move equipment from one Jobcard to another. Same conflict rule: an explicit SAME jobcard is
      // idempotent; anything else (a different jobcard, or an omitted jobcard while already held)
      // requires an explicit returnEquipment() first. Checked before any field is touched.
      if(item.assignedJobcard&&item.assignedJobcard!==canonicalJobcardNo){
        return equipmentAssignmentConflictResult('Reserve',equipmentId,item.assignedJobcard,canonicalJobcardNo);
      }
      // An optional reservation note is preserved in the audit trail — it is purely descriptive and
      // never influences any safety/validation decision. escapeHtml() at render time (never here)
      // is what keeps it safe to display; this stores the raw trimmed text.
      const note=payload.note!=null?String(payload.note).trim():'';
      item.status='Reserved';
      item.assignedProject=canonicalProjectNo;
      item.assignedJobcard=canonicalJobcardNo;
      item.activity=item.activity||[];
      item.activity.unshift({timestamp:now(),action:'Equipment reserved',user:String(payload.reservedBy).trim(),reference:equipmentId,details:`${canonicalProjectNo} / ${canonicalJobcardNo||'—'}${note?' — '+note:''}`});
      item.lastActivity=now();
      save(`Equipment reserved: ${equipmentId}`);
      return clone(item);
    },
    assignEquipment:(equipmentId, assignment={})=>{
      const item=equip(equipmentId);
      if(!item) return {error:'Equipment not found'};
      const gate=equipmentSafetyGate(item,{});
      if(gate.blocked)return equipmentGateBlockedResult('Assign',equipmentId,gate);
      // Pass 3.2C, Part B: same shared context validator as reserveEquipment() above — assignment
      // additionally requires a real Jobcard (never project-only) plus worker/assignedBy.
      const context=validateEquipmentAssignmentContext('assign',assignment);
      if(!context.valid)return equipmentAssignmentContextBlockedResult('Assign',equipmentId,context);
      // Canonical references only — see the matching comment in reserveEquipment() above. kind:
      // 'assign' always resolves a real Jobcard, so canonicalJobcardNo is never null here.
      const canonicalProjectNo=context.project.no;
      const canonicalJobcardNo=context.jobcard.no;
      // Pass 3.2C review fix (cross-project reservation theft): same rule as reserveEquipment()
      // above, checked first — assigning a project-only reservation to a Jobcard belonging to the
      // SAME project remains allowed (canonicalProjectNo matches); moving to another project's
      // Jobcard is rejected here, atomically, before assignedJobcard is even considered.
      if(item.assignedProject&&item.assignedProject!==canonicalProjectNo){
        return equipmentProjectConflictResult('Assign',equipmentId,item.assignedProject,canonicalProjectNo);
      }
      // Review fix: equipment already held by a different Jobcard can never be silently reassigned —
      // the caller must explicitly pass the SAME jobcard (idempotent) or return it first. A caller
      // that omits assignment.jobcard entirely while the equipment is already held is also refused,
      // rather than silently keeping the old assignedJobcard while other fields quietly change.
      if(item.assignedJobcard&&item.assignedJobcard!==canonicalJobcardNo){
        return equipmentAssignmentConflictResult('Assign',equipmentId,item.assignedJobcard,canonicalJobcardNo);
      }
      const worker=String(assignment.worker).trim();
      const assignedBy=String(assignment.assignedBy).trim();
      item.assignedProject=canonicalProjectNo;
      item.assignedJobcard=canonicalJobcardNo;
      item.currentLocation=assignment.location||item.currentLocation;
      item.operator=worker;
      // Caller-supplied assignment.status is never trusted (Pass 3.2A requirement) — assigning
      // equipment always reserves it; a later logEquipmentUsage()/canUseEquipment() call is the
      // gated path into actual operational use.
      item.status='Reserved';
      item.currentAssignment={project:canonicalProjectNo,jobcard:canonicalJobcardNo,location:assignment.location||null,worker,equipmentId:item.equipmentId, assignedBy, assignedDate:new Date().toISOString().slice(0,10)};
      item.activity=item.activity||[];
      item.activity.unshift({timestamp:now(),action:'Equipment assigned',user:assignedBy,reference:item.equipmentId,details:`${canonicalProjectNo} / ${canonicalJobcardNo}`});
      item.lastActivity=now();
      save(`Equipment assigned: ${equipmentId}`);
      return clone(item);
    },
    // Physically returning equipment (clearing its assignment, sending it home) is always allowed —
    // it is a safe direction, like Pass 3.1's pause/block. It must NEVER itself flip unsafe
    // equipment back to Available; the equipment's blocking status (if any) is preserved.
    returnEquipment:(equipmentId, meta={})=>{
      const item=equip(equipmentId);
      if(!item) return {error:'Equipment not found'};
      const gate=equipmentSafetyGate(item,{});
      item.assignedProject=null; item.assignedJobcard=null; item.currentLocation=meta.location||item.homeLocation||item.currentLocation; item.operator=null;
      item.currentAssignment=null;
      if(!gate.blocked)item.status='Available';
      item.activity=item.activity||[]; item.activity.unshift({timestamp:now(),action:'Equipment returned',user:meta.user||UNNAMED,reference:item.equipmentId,details:meta.note||''});
      item.lastActivity=now();
      // Review fix (3rd review): the assignment is gone, so ANY still-in-progress operation that was
      // using this equipment is no longer authorized — reconcile before the single save() below.
      const recon=reconcileActiveOperationsForEquipment(equipmentId,'equipment was returned');
      save(`Equipment returned: ${equipmentId}`);
      return Object.assign(clone(item),{pausedOperations:recon.pausedOperations});
    },
    logEquipmentUsage:(equipmentId,usage={})=>{
      const item=equip(equipmentId);
      if(!item) return {error:'Equipment not found'};
      const hours=Number(usage.hours);
      if(!Number.isFinite(hours)||hours<=0)return{error:'Equipment usage requires a positive, finite number of hours'};
      // Review fix (wrong-jobcard usage bypass): when a jobcard is supplied, usage can only ever be
      // recorded against the equipment's REAL current holder — never a different jobcard smuggled in
      // through this payload while the equipment sits assigned elsewhere.
      if(usage.jobcard&&item.assignedJobcard!==usage.jobcard){
        return equipmentAssignmentConflictResult('Log usage',equipmentId,item.assignedJobcard,usage.jobcard);
      }
      const gate=equipmentSafetyGate(item,{requirePreUseCheck:true,date:usage.date,jobcardNo:usage.jobcard,projectNo:usage.project});
      if(gate.blocked)return equipmentGateBlockedResult('Log usage',equipmentId,gate);
      const record={
        id:Date.now().toString(),
        startTime:usage.startTime||now(),
        stopTime:usage.stopTime||now(),
        project:usage.project||item.assignedProject||null,
        jobcard:usage.jobcard||item.assignedJobcard||null,
        worker:usage.worker||item.operator||'Unassigned',
        // Every caller supplies the validated `hours`; duration is the same usage interval unless
        // an explicit positive duration was provided. Keeping this at 0 made the Equipment Usage
        // tab disagree with the hour meter and the Jobcard/Hours records.
        duration:Number.isFinite(Number(usage.duration))&&Number(usage.duration)>0?Number(usage.duration):hours,
        meterBefore:Number(item.operatingHourMeter)||0,
        meterAfter:Number(item.operatingHourMeter||0) + hours,
        fuelOrEnergy:usage.fuelOrEnergy||'n/a',
        notes:usage.notes||'',
        reportedProblems:usage.reportedProblems||[]
      };
      item.usageHistory=item.usageHistory||[]; item.usageHistory.unshift(record);
      item.operatingHourMeter=Number(item.operatingHourMeter||0)+hours;
      // Assignment deliberately leaves equipment Reserved; the first successfully safety-gated
      // usage is the authoritative transition into real operation. Without this, equipment with
      // meter/usage history continued to look merely Reserved in every Equipment view.
      item.status='In Use';
      item.activity=item.activity||[];
      item.activity.unshift({timestamp:now(),action:'Equipment usage logged',user:record.worker,reference:item.equipmentId,details:`${hours} h${record.jobcard?' / '+record.jobcard:''}`});
      item.lastActivity=now();
      save(`Equipment usage logged: ${equipmentId}`);
      return clone(item);
    },
    // Inspection history is append-only (unshift, never overwritten/removed) — a failed critical
    // safety inspection immediately quarantines the equipment; a later PASSED inspection (a real
    // re-inspection, never an arbitrary edit of the old record) is the only way that clears it,
    // since it becomes the new latest record the safety gate reads.
    // Validated: an inspection always needs an inspector and a valid date; a passed result
    // additionally needs evidence/reference text, and a failed result needs findings — an empty
    // {result:'passed'} record is rejected outright, it can never be used as fabricated proof of
    // anything. Every server/workflow-owned field (id, resolved, resolvedBy, ...) is stripped from
    // the caller's payload FIRST — a caller can never create a record that is born "pre-resolved".
    // Only a passed inspection may advance inspectionDate (the next scheduled inspection due date);
    // a pending or failed inspection never touches it, and a failed one keeps blocking until it is
    // explicitly resolved via resolveEquipmentInspection.
    addInspection:(equipmentId,inspection)=>{
      const item=equip(equipmentId);
      if(!item) return {error:'Equipment not found'};
      const EG=global.EquipmentGates;
      const raw=clone(inspection||{});
      const result=EG?EG.normalizeResult(raw.result):String(raw.result||'').trim().toLowerCase();
      if(!['passed','failed','pending'].includes(result))return{error:'Inspection result must be "passed", "failed" or "pending"'};
      const inspector=raw.inspector!=null?String(raw.inspector).trim():'';
      const date=raw.date!=null?String(raw.date).trim():'';
      if(!inspector)return{error:'An inspection requires an inspector'};
      if(!EG||!EG.isValidCalendarDateString(date))return{error:'An inspection requires a valid YYYY-MM-DD date'};
      if(result==='passed'){
        const evidence=raw.evidence||raw.reference;
        if(!evidence||!String(evidence).trim())return{error:'A passed inspection requires evidence/reference text'};
      }
      if(result==='failed'&&(!raw.findings||!String(raw.findings).trim()))return{error:'A failed inspection requires findings'};
      let nextDueDate=null;
      if(raw.nextDueDate!=null&&String(raw.nextDueDate).trim()!==''){
        if(result!=='passed')return{error:'nextDueDate can only be set on a passed inspection'};
        const candidate=String(raw.nextDueDate).trim();
        if(!EG.isValidCalendarDateString(candidate))return{error:'nextDueDate must be a valid YYYY-MM-DD date'};
        if(EG.toDateOnly(candidate).getTime()<=EG.toDateOnly(date).getTime())return{error:'nextDueDate must be later than the inspection date'};
        nextDueDate=candidate;
      }
      const clean=stripEquipmentRecordOwnedFields(raw);
      const rec=Object.assign({},clean,{id:`INS-${String(state.counters.equipmentInspection=(state.counters.equipmentInspection||0)+1).padStart(4,'0')}`,result,inspector,date});
      item.inspections=item.inspections||[]; item.inspections.unshift(rec); item.activity=item.activity||[];
      item.activity.unshift({timestamp:now(),action:'Inspection completed',user:inspector,reference:equipmentId,details:result});
      if(result==='failed'){
        const nextStatus=rec.critical?'Quarantined':'Inspection Required';
        item.status=nextStatus;
        item.activity.unshift({timestamp:now(),action:`Status changed to ${nextStatus}`,user:inspector,reference:equipmentId,details:`Failed inspection ${rec.id}`});
      }
      if(nextDueDate){
        item.inspectionDate=nextDueDate;
        item.activity.unshift({timestamp:now(),action:'Inspection next-due date updated',user:inspector,reference:equipmentId,details:nextDueDate});
      }
      item.lastActivity=now();
      // Review fix (3rd review): a failed inspection (or, in principle, an unfavourable nextDueDate)
      // can leave the gate blocked — reconcile before the single save() below.
      const recon=reconcileActiveOperationsForEquipment(equipmentId,'an equipment inspection failed');
      save(`Inspection added: ${equipmentId}`);
      return Object.assign(clone(rec),{pausedOperations:recon.pausedOperations});
    },
    // Formal, individual resolution of ONE specific failed/critical-unresolved inspection record.
    // Never deletes or overwrites the original — only marks that exact record resolved, so it stops
    // contributing a blocker (see equipment-gates.js). Resolving one failure never touches another.
    // No caller-supplied status string (e.g. "closed"/"repaired") can substitute for this — the
    // gate's isResolvedRecord() only reads the `resolved` flag this method itself sets.
    resolveEquipmentInspection(equipmentId,failedInspectionId,payload={}){
      const item=equip(equipmentId);
      if(!item) return {error:'Equipment not found'};
      const EG=global.EquipmentGates;
      const target=(item.inspections||[]).find(i=>String(i.id)===String(failedInspectionId));
      if(!target)return{error:'Referenced inspection record not found'};
      const targetResult=EG?EG.normalizeResult(target.result):String(target.result||'').toLowerCase();
      const targetIsBlocking=targetResult==='failed'||(!!target.critical&&targetResult!=='passed');
      if(!targetIsBlocking)return{error:'Referenced inspection is not a failed or unresolved critical inspection'};
      if(EG&&EG.isResolvedRecord(target))return{error:`Inspection ${target.id} has already been resolved`};
      if(!EG||!EG.isValidCalendarDateString(target.date))return{error:'The failed inspection does not have a valid date and cannot be resolved'};
      const resolvedBy=payload.resolvedBy!=null?String(payload.resolvedBy).trim():'';
      const resolutionEvidence=payload.resolutionEvidence!=null?String(payload.resolutionEvidence).trim():'';
      const passedInspectionReference=payload.passedInspectionReference!=null?String(payload.passedInspectionReference).trim():'';
      const resolutionDate=payload.resolutionDate!=null?String(payload.resolutionDate).trim():'';
      if(!resolvedBy||!resolutionEvidence||!passedInspectionReference||!resolutionDate){
        return{error:'Resolving a failed inspection requires resolvedBy, resolutionEvidence, passedInspectionReference and resolutionDate'};
      }
      if(!EG.isValidCalendarDateString(resolutionDate))return{error:'resolutionDate must be a valid YYYY-MM-DD date'};
      const passedInsp=(item.inspections||[]).find(i=>i&&i!==target&&(String(i.id)===passedInspectionReference||String(i.no)===passedInspectionReference));
      if(!passedInsp)return{error:'passedInspectionReference must match a real inspection record on this equipment'};
      if(EG.normalizeResult(passedInsp.result)!=='passed')return{error:'passedInspectionReference must reference an inspection with result "passed"'};
      if(!passedInsp.inspector||!EG.isValidCalendarDateString(passedInsp.date)||!(passedInsp.evidence||passedInsp.reference))return{error:'passedInspectionReference must itself have inspector, a valid date and evidence/reference recorded'};
      const failedDate=EG.toDateOnly(target.date), passedDate=EG.toDateOnly(passedInsp.date);
      if(passedDate.getTime()<=failedDate.getTime())return{error:'passedInspectionReference must be newer than the failed inspection it resolves'};
      if(EG.toDateOnly(resolutionDate).getTime()<passedDate.getTime())return{error:'resolutionDate must be on or after the passed inspection date'};
      target.resolved=true; target.resolvedBy=resolvedBy; target.resolutionEvidence=resolutionEvidence; target.passedInspectionReference=passedInspectionReference; target.resolutionDate=resolutionDate;
      item.activity=item.activity||[]; item.activity.unshift({timestamp:now(),action:'Failed inspection resolved',user:resolvedBy,reference:equipmentId,details:`${target.id} resolved via ${passedInspectionReference} — ${resolutionEvidence}`});
      item.lastActivity=now();
      save(`Failed inspection resolved: ${equipmentId}`);
      return clone(target);
    },
    // Requirements are also protected (see EQUIPMENT_PROTECTED_FIELDS) — this is the only sanctioned
    // way to change them. Requires who, why AND a formal approval reference, and only ever accepts
    // real booleans for the known flags — a string like "false" is rejected outright rather than
    // coerced, so a typo/type-confusion attempt can never silently disable a requirement.
    updateEquipmentRequirements(equipmentId,requirements,meta={}){
      const item=equip(equipmentId);
      if(!item) return {error:'Equipment not found'};
      const updatedBy=meta.updatedBy!=null?String(meta.updatedBy).trim():'';
      const reason=meta.reason!=null?String(meta.reason).trim():'';
      const approvalReference=meta.approvalReference!=null?String(meta.approvalReference).trim():'';
      if(!updatedBy||!reason||!approvalReference)return{error:'Updating safety requirements requires updatedBy, a reason and an approvalReference'};
      if(!requirements||typeof requirements!=='object'||Array.isArray(requirements))return{error:'requirements must be an object'};
      for(const k of EQUIPMENT_REQUIREMENT_KEYS){
        if(Object.prototype.hasOwnProperty.call(requirements,k)&&typeof requirements[k]!=='boolean'){
          return{error:`requirements.${k} must be a real boolean, not "${requirements[k]}"`};
        }
      }
      item.requirements=normalizeEquipmentRequirements(Object.assign({},item.requirements||{},requirements));
      item.activity=item.activity||[]; item.activity.unshift({timestamp:now(),action:'Safety requirements updated',user:updatedBy,reference:equipmentId,details:`${reason} (${approvalReference})`});
      item.lastActivity=now();
      // Review fix (3rd review): a newly-mandatory requirement can make the gate blocked purely from a
      // stale existing date, with no status field changing at all — reconcile before the single save().
      const recon=reconcileActiveOperationsForEquipment(equipmentId,'equipment safety requirements changed');
      save(`Equipment safety requirements updated: ${equipmentId}`);
      return Object.assign(clone(item),{pausedOperations:recon.pausedOperations});
    },
    // The dedicated, validated way to record maintenance completion — and, only for a genuinely
    // completed/passed record with real evidence, to legitimately advance the gate-controlling
    // maintenanceDate (with its own audit trail) instead of that date being editable directly
    // through updateEquipment().
    addMaintenanceRecord:(equipmentId,maintenance)=>{
      const item=equip(equipmentId);
      if(!item) return {error:'Equipment not found'};
      const EG=global.EquipmentGates;
      const raw=clone(maintenance||{});
      const completedBy=raw.completedBy!=null?String(raw.completedBy).trim():'';
      const date=raw.date!=null?String(raw.date).trim():'';
      const result=raw.result!=null?String(raw.result).trim().toLowerCase():'';
      const evidence=raw.evidence||raw.serviceReportReference;
      if(!completedBy)return{error:'A maintenance record requires completedBy'};
      if(!EG||!EG.isValidCalendarDateString(date))return{error:'A maintenance record requires a valid completion date'};
      if(result!=='completed'&&result!=='passed')return{error:'A maintenance record requires result "completed" or "passed"'};
      if(!evidence||!String(evidence).trim())return{error:'A maintenance record requires evidence or a serviceReportReference'};
      let nextDueDate=null;
      if(raw.nextDueDate!=null&&String(raw.nextDueDate).trim()!==''){
        const candidate=String(raw.nextDueDate).trim();
        if(!EG.isValidCalendarDateString(candidate))return{error:'nextDueDate must be a valid YYYY-MM-DD date'};
        if(EG.toDateOnly(candidate).getTime()<=EG.toDateOnly(date).getTime())return{error:'nextDueDate must be later than the completion date'};
        nextDueDate=candidate;
      }
      const clean=stripEquipmentRecordOwnedFields(raw);
      const rec=Object.assign({},clean,{id:`MAINT-${String(state.counters.equipmentMaintenance=(state.counters.equipmentMaintenance||0)+1).padStart(4,'0')}`,completedBy,date,result});
      item.maintenance=item.maintenance||[]; item.maintenance.unshift(rec);
      item.activity=item.activity||[]; item.activity.unshift({timestamp:now(),action:'Maintenance completed',user:completedBy,reference:equipmentId,details:String(evidence)});
      if(nextDueDate){
        item.maintenanceDate=nextDueDate;
        item.activity.unshift({timestamp:now(),action:'Maintenance next-due date updated',user:completedBy,reference:equipmentId,details:nextDueDate});
      }
      item.lastActivity=now();
      // Review fix (3rd review): a backdated record's nextDueDate could still land before today —
      // reconcile before the single save() below (a no-op in the normal, non-blocked case).
      const recon=reconcileActiveOperationsForEquipment(equipmentId,'equipment maintenance record changed the safety gate');
      save(`Maintenance added: ${equipmentId}`);
      return Object.assign(clone(rec),{pausedOperations:recon.pausedOperations});
    },
    // The dedicated, validated way to record a certification — always sets/advances the
    // gate-controlling certificationExpiry, and only from real, referenced, authorised evidence.
    addCertification:(equipmentId,cert)=>{
      const item=equip(equipmentId);
      if(!item) return {error:'Equipment not found'};
      const EG=global.EquipmentGates;
      const raw=clone(cert||{});
      const issuedBy=(raw.issuedBy!=null?String(raw.issuedBy):(raw.authority!=null?String(raw.authority):'')).trim();
      const date=raw.date!=null?String(raw.date).trim():'';
      const expiryDate=raw.expiryDate!=null?String(raw.expiryDate).trim():'';
      const reference=raw.certificateNumber||raw.approvalReference;
      const evidence=raw.evidence||raw.reference||reference;
      if(!issuedBy)return{error:'A certification record requires issuedBy (or authority)'};
      if(!reference||!String(reference).trim())return{error:'A certification record requires certificateNumber or approvalReference'};
      if(!EG||!EG.isValidCalendarDateString(date))return{error:'A certification record requires a valid issue date'};
      if(!EG.isValidCalendarDateString(expiryDate))return{error:'A certification record requires a valid expiryDate'};
      if(EG.toDateOnly(expiryDate).getTime()<=EG.toDateOnly(date).getTime())return{error:'expiryDate must be later than the issue date'};
      if(!evidence||!String(evidence).trim())return{error:'A certification record requires evidence/reference'};
      const clean=stripEquipmentRecordOwnedFields(raw);
      const rec=Object.assign({},clean,{id:`CERT-${String(state.counters.equipmentCertification=(state.counters.equipmentCertification||0)+1).padStart(4,'0')}`,issuedBy,date,expiryDate});
      item.certifications=item.certifications||[]; item.certifications.unshift(rec);
      item.certificationExpiry=expiryDate;
      item.activity=item.activity||[]; item.activity.unshift({timestamp:now(),action:'Certification recorded',user:issuedBy,reference:equipmentId,details:`${reference} — expires ${expiryDate}`});
      item.lastActivity=now();
      // Review fix (3rd review): a backdated certification's expiryDate could still land before today
      // — reconcile before the single save() below (a no-op in the normal, non-blocked case).
      const recon=reconcileActiveOperationsForEquipment(equipmentId,'equipment certification changed the safety gate');
      save(`Certification added: ${equipmentId}`);
      return Object.assign(clone(rec),{pausedOperations:recon.pausedOperations});
    },
    // The dedicated, validated way to record a calibration — only for a genuinely passed record
    // with real evidence does a supplied nextDueDate legitimately advance calibrationDate.
    addCalibration:(equipmentId,calibration)=>{
      const item=equip(equipmentId);
      if(!item) return {error:'Equipment not found'};
      const EG=global.EquipmentGates;
      const raw=clone(calibration||{});
      const calibratedBy=raw.calibratedBy!=null?String(raw.calibratedBy).trim():'';
      const date=raw.date!=null?String(raw.date).trim():'';
      const result=raw.result!=null?String(raw.result).trim().toLowerCase():'';
      const evidence=raw.evidence||raw.certificate||raw.reference;
      if(!calibratedBy)return{error:'A calibration record requires calibratedBy'};
      if(result!=='passed')return{error:'A calibration record requires result "passed"'};
      if(!EG||!EG.isValidCalendarDateString(date))return{error:'A calibration record requires a valid calibration date'};
      if(!evidence||!String(evidence).trim())return{error:'A calibration record requires certificate/reference/evidence'};
      let nextDueDate=null;
      if(raw.nextDueDate!=null&&String(raw.nextDueDate).trim()!==''){
        const candidate=String(raw.nextDueDate).trim();
        if(!EG.isValidCalendarDateString(candidate))return{error:'nextDueDate must be a valid YYYY-MM-DD date'};
        if(EG.toDateOnly(candidate).getTime()<=EG.toDateOnly(date).getTime())return{error:'nextDueDate must be later than the calibration date'};
        nextDueDate=candidate;
      }
      const clean=stripEquipmentRecordOwnedFields(raw);
      const rec=Object.assign({},clean,{id:`CAL-${String(state.counters.equipmentCalibration=(state.counters.equipmentCalibration||0)+1).padStart(4,'0')}`,calibratedBy,date,result});
      item.calibrations=item.calibrations||[]; item.calibrations.unshift(rec);
      item.activity=item.activity||[]; item.activity.unshift({timestamp:now(),action:'Calibration recorded',user:calibratedBy,reference:equipmentId,details:String(evidence)});
      if(nextDueDate){
        item.calibrationDate=nextDueDate;
        item.activity.unshift({timestamp:now(),action:'Calibration next-due date updated',user:calibratedBy,reference:equipmentId,details:nextDueDate});
      }
      item.lastActivity=now();
      // Review fix (3rd review): a backdated record's nextDueDate could still land before today —
      // reconcile before the single save() below (a no-op in the normal, non-blocked case).
      const recon=reconcileActiveOperationsForEquipment(equipmentId,'equipment calibration record changed the safety gate');
      save(`Calibration added: ${equipmentId}`);
      return Object.assign(clone(rec),{pausedOperations:recon.pausedOperations});
    },
    addNote:(equipmentId,note)=>{
      const item=state.equipment.find(x=>x.equipmentId===equipmentId||x.id===equipmentId);
      if(!item) return {error:'Equipment not found'};
      const rec={...clone(note), timestamp:now()};
      item.notesLog=item.notesLog||[]; item.notesLog.unshift(rec); item.activity=item.activity||[]; item.activity.unshift({timestamp:now(),action:'Note added',user:note.author||UNNAMED,reference:equipmentId,details:note.text||''});
      item.lastActivity=now();
      save(`Equipment note added: ${equipmentId}`);
      return clone(rec);
    },
    addActivity:(equipmentId,entry)=>{
      const item=state.equipment.find(x=>x.equipmentId===equipmentId||x.id===equipmentId);
      if(!item) return {error:'Equipment not found'};
      const rec={timestamp:now(),action:entry.action||'Activity',user:entry.user||UNNAMED,reference:equipmentId,details:entry.details||''};
      item.activity=item.activity||[]; item.activity.unshift(rec); item.lastActivity=now();
      save(`Equipment activity: ${equipmentId}`);
      return clone(rec);
    },
    // Reporting a breakdown always places the equipment Out of Service (a genuine transition INTO a
    // hard-block status is always allowed, matching Pass 3.1's "safe direction" principle) — this,
    // combined with the open-breakdown gate rule itself, prevents subsequent reservation, assignment
    // and usage through every path. The affected project/jobcard is preserved on the breakdown
    // record for traceability, falling back to the equipment's current assignment when not given.
    // status/resolved are always workflow-owned: a caller can never create a breakdown that is
    // born "already resolved" — stripEquipmentRecordOwnedFields() removes any caller-supplied
    // status/resolved/resolvedBy/... before they are set explicitly, here, to their real values.
    reportBreakdown:(equipmentId,record={})=>{
      const item=equip(equipmentId);
      if(!item) return {error:'Equipment not found'};
      const raw=clone(record||{});
      const reason=raw.reason!=null?String(raw.reason).trim():'';
      const responsiblePerson=(raw.responsiblePerson!=null?String(raw.responsiblePerson):(raw.reportedBy!=null?String(raw.reportedBy):'')).trim();
      if(!reason)return{error:'Reporting a breakdown requires a non-whitespace reason'};
      if(!responsiblePerson)return{error:'Reporting a breakdown requires responsiblePerson (or reportedBy)'};
      const clean=stripEquipmentRecordOwnedFields(raw);
      const rec=Object.assign({},clean,{
        id:`BR-${String(state.counters.equipmentBreakdown=(state.counters.equipmentBreakdown||0)+1).padStart(4,'0')}`,
        timestamp:now(),status:'Reported',resolved:false,reason,responsiblePerson,
        projectNo:raw.projectNo||item.assignedProject||null,jobcardNo:raw.jobcardNo||item.assignedJobcard||null
      });
      item.downtimeRecords=item.downtimeRecords||[]; item.downtimeRecords.unshift(rec); item.activity=item.activity||[]; item.activity.unshift({timestamp:now(),action:'Breakdown reported',user:responsiblePerson,reference:equipmentId,details:reason});
      item.status='Out of Service';
      item.activity.unshift({timestamp:now(),action:'Status changed to Out of Service',user:responsiblePerson,reference:equipmentId,details:`Breakdown ${rec.id}`});
      item.lastActivity=now();
      state.breakdowns=state.breakdowns||[]; state.breakdowns.unshift(rec);
      // Review fix (3rd review): reconcile before the single save() below so both changes persist together.
      const recon=reconcileActiveOperationsForEquipment(equipmentId,'a breakdown was reported on this equipment');
      save(`Breakdown reported: ${equipmentId}`);
      return Object.assign(clone(rec),{pausedOperations:recon.pausedOperations});
    },
    // Explicit, authorised resolution — never deletes or overwrites the original breakdown record,
    // just marks it resolved with who/why so the safety gate stops treating it as open. Updates
    // BOTH stored copies (equipment.downtimeRecords AND the shared state.breakdowns list) by id —
    // after a localStorage reload these are two independent object copies, not the same reference
    // they were at creation time, so each must be found and patched separately.
    resolveBreakdown(equipmentId,breakdownId,payload={}){
      const item=equip(equipmentId);
      if(!item) return {error:'Equipment not found'};
      const rec=(item.downtimeRecords||[]).find(d=>String(d.id)===String(breakdownId));
      if(!rec) return {error:'Breakdown record not found'};
      const resolvedBy=payload.resolvedBy!=null?String(payload.resolvedBy).trim():'';
      const resolutionEvidence=payload.resolutionEvidence!=null?String(payload.resolutionEvidence).trim():'';
      if(!resolvedBy||!resolutionEvidence)return{error:'Resolving a breakdown requires resolvedBy and resolutionEvidence'};
      if(global.EquipmentGates&&global.EquipmentGates.isResolvedRecord(rec))return{error:`Breakdown ${rec.id} has already been resolved`};
      const patch={status:'resolved',resolved:true,resolvedBy,resolutionEvidence,resolvedDate:now()};
      Object.assign(rec,patch);
      const sharedRec=(state.breakdowns||[]).find(d=>String(d.id)===String(breakdownId));
      if(sharedRec)Object.assign(sharedRec,patch);
      item.activity=item.activity||[]; item.activity.unshift({timestamp:now(),action:'Breakdown resolved',user:resolvedBy,reference:equipmentId,details:resolutionEvidence});
      item.lastActivity=now();
      save(`Breakdown resolved: ${equipmentId}`);
      return clone(rec);
    },
    // Pre-use checks are stored as append-only history, never a single toggle boolean. A failed
    // check immediately makes the equipment non-operational and remains so — an unrelated later
    // passed check never silently clears it; only an explicit link (resolvesCheckId, on a NEW
    // passed check) marks that specific failed record resolved, preserving it unmodified otherwise.
    // An explicit resolvesCheckId is validated BEFORE anything is created — an invalid/stale/
    // mismatched reference rejects the WHOLE new check (never silently recorded without the
    // resolution it claimed to provide, and never a partial mutation).
    recordEquipmentPreUseCheck(equipmentId,payload={}){
      const item=equip(equipmentId);
      if(!item) return {error:'Equipment not found'};
      const raw=clone(payload||{});
      // Review fix (2nd review, finding 1): a check submitted WITH Jobcard context can only ever be
      // recorded by the equipment's real, current holder — a stale Jobcard-side link must never let
      // a Jobcard record a Jobcard-specific pre-use check for equipment now held elsewhere. A check
      // with NO Jobcard context at all (the plain Equipment-module workflow) is unaffected.
      if(raw.jobcardNo&&item.assignedJobcard!==raw.jobcardNo){
        return equipmentAssignmentConflictResult('Record pre-use check',equipmentId,item.assignedJobcard,raw.jobcardNo);
      }
      const EG=global.EquipmentGates;
      const checkedBy=raw.checkedBy!=null?String(raw.checkedBy).trim():'';
      const date=raw.date!=null?String(raw.date).trim():'';
      const result=EG?EG.normalizeResult(raw.result):String(raw.result||'').trim().toLowerCase();
      if(!checkedBy)return{error:'A pre-use check requires checkedBy'};
      if(!EG||!EG.isValidCalendarDateString(date))return{error:'A pre-use check requires a valid date'};
      if(result!=='passed'&&result!=='failed')return{error:'A pre-use check result must be "passed" or "failed"'};
      const evidence=raw.checklist||raw.evidence;
      const hasEvidence=Array.isArray(evidence)?evidence.length>0:(evidence!=null&&String(evidence).trim()!=='');
      if(result==='passed'&&!hasEvidence)return{error:'A passed pre-use check requires evidence/checklist text'};

      let resolveTarget=null;
      if(raw.resolvesCheckId!=null&&String(raw.resolvesCheckId).trim()!==''){
        if(result!=='passed')return{error:'resolvesCheckId can only be supplied on a passed pre-use check'};
        const targetId=String(raw.resolvesCheckId).trim();
        resolveTarget=(item.preUseChecks||[]).find(c=>c&&String(c.id)===targetId);
        if(!resolveTarget)return{error:'resolvesCheckId must match a real pre-use check record on this equipment'};
        if(EG.normalizeResult(resolveTarget.result)!=='failed')return{error:'resolvesCheckId must reference a failed pre-use check'};
        if(EG.isResolvedRecord(resolveTarget))return{error:`Pre-use check ${resolveTarget.id} has already been resolved`};
        if(!EG.isValidCalendarDateString(resolveTarget.date))return{error:'The failed pre-use check does not have a valid date and cannot be resolved'};
        if(EG.toDateOnly(date).getTime()<=EG.toDateOnly(resolveTarget.date).getTime())return{error:'The resolving pre-use check must be newer than the failed check it resolves'};
        if(resolveTarget.projectNo&&resolveTarget.projectNo!==(raw.projectNo||null))return{error:"The resolving pre-use check must match the failed check's projectNo"};
        if(resolveTarget.jobcardNo&&resolveTarget.jobcardNo!==(raw.jobcardNo||null))return{error:"The resolving pre-use check must match the failed check's jobcardNo"};
      }

      const clean=stripEquipmentRecordOwnedFields(raw);
      delete clean.resolvesCheckId;
      const rec=Object.assign({},clean,{
        id:`PUC-${String(state.counters.equipmentPreUseCheck=(state.counters.equipmentPreUseCheck||0)+1).padStart(4,'0')}`,
        result,checkedBy,date,projectNo:raw.projectNo||null,jobcardNo:raw.jobcardNo||null,
        checklist:raw.checklist||null,evidence:raw.evidence||null,notes:raw.notes||''
      });
      item.preUseChecks=item.preUseChecks||[]; item.preUseChecks.unshift(rec);
      item.activity=item.activity||[];
      item.activity.unshift({timestamp:now(),action:`Pre-use check ${result}`,user:checkedBy,reference:equipmentId,details:raw.notes||''});
      if(result==='failed'){
        item.status='Inspection Required';
        item.activity.unshift({timestamp:now(),action:'Status changed to Inspection Required',user:checkedBy,reference:equipmentId,details:`Failed pre-use check ${rec.id}`});
      }
      if(resolveTarget){
        resolveTarget.resolved=true; resolveTarget.resolvedBy=checkedBy; resolveTarget.resolutionEvidence=hasEvidence?String(evidence):''; resolveTarget.resolvedViaCheckId=rec.id; resolveTarget.resolvedDate=date;
        item.activity.unshift({timestamp:now(),action:'Failed pre-use check resolved',user:checkedBy,reference:equipmentId,details:`${resolveTarget.id} resolved via ${rec.id}`});
      }
      item.lastActivity=now();
      // Review fix (3rd review): a failed check blocks the gate — reconcile before the single save().
      const recon=reconcileActiveOperationsForEquipment(equipmentId,'a pre-use check failed');
      save(`Pre-use check recorded: ${equipmentId}`);
      return Object.assign(clone(rec),{pausedOperations:recon.pausedOperations});
    },
    // The ONLY API allowed to move blocked equipment back to Available. Requires full authority and
    // evidence, independently recalculates every OTHER blocker (status itself is excluded — that is
    // precisely what is being reversed), and never auto-assigns or starts the equipment.
    returnEquipmentToService(equipmentId,payload={}){
      const item=equip(equipmentId);
      if(!item) return {error:'Equipment not found'};
      const EG=global.EquipmentGates;
      const authorisedBy=payload.authorisedBy!=null?String(payload.authorisedBy).trim():'';
      const approvalReference=payload.approvalReference!=null?String(payload.approvalReference).trim():'';
      const resolutionEvidence=payload.resolutionEvidence!=null?String(payload.resolutionEvidence).trim():'';
      const passedInspectionReference=payload.passedInspectionReference!=null?String(payload.passedInspectionReference).trim():'';
      const returnDate=payload.returnDate!=null?String(payload.returnDate).trim():'';
      if(!authorisedBy||!approvalReference||!resolutionEvidence||!passedInspectionReference||!returnDate){
        return{error:'Returning equipment to service requires authorisedBy, approvalReference, resolutionEvidence, passedInspectionReference and returnDate'};
      }
      if(!EG||!EG.isValidCalendarDateString(returnDate))return{error:'returnDate must be a valid YYYY-MM-DD date'};
      if(EG.isRetiredStatus(item.status))return{error:'Retired equipment is permanently non-operational and cannot be returned to service'};
      // Only equipment whose CURRENT status is a recognised hard-block status may use this method:
      // an unknown/malformed status fails safe (rejected here, never an easy way back to
      // Available), and equipment that is already operational should never call this method at all.
      if(!EG.isHardBlockStatus(item.status))return{error:'returnEquipmentToService can only be used on equipment whose current status is a recognised blocked status'};
      const matchedInspection=(item.inspections||[]).find(i=>i&&(String(i.id)===passedInspectionReference||String(i.no)===passedInspectionReference)
        &&EG.normalizeResult(i.result)==='passed');
      if(!matchedInspection)return{error:'passedInspectionReference must match a real, passed inspection record stored on this equipment'};
      if(!matchedInspection.inspector||!EG.isValidCalendarDateString(matchedInspection.date)||!(matchedInspection.evidence||matchedInspection.reference)){
        return{error:'passedInspectionReference must itself have inspector, a valid date and evidence/reference recorded'};
      }
      const matchedDate=EG.toDateOnly(matchedInspection.date);
      const returnDateOnly=EG.toDateOnly(returnDate);
      if(returnDateOnly.getTime()<matchedDate.getTime())return{error:'returnDate cannot predate the passed inspection it relies on'};
      // An old historical passed inspection cannot be reused as post-repair approval — the
      // reference must be dated on or after the most recent known failure/breakdown, so it actually
      // speaks to the equipment's CURRENT fitness, not some unrelated earlier point in time.
      const failureDates=(item.inspections||[]).filter(i=>i&&EG.normalizeResult(i.result)==='failed').map(i=>EG.toDateOnly(i.date)).filter(Boolean);
      const breakdownDates=(item.downtimeRecords||[]).map(d=>EG.toDateOnly(d.timestamp||d.date)).filter(Boolean);
      const problemDates=failureDates.concat(breakdownDates);
      if(problemDates.length){
        const latestProblem=new Date(Math.max(...problemDates.map(d=>d.getTime())));
        if(matchedDate.getTime()<latestProblem.getTime())return{error:'passedInspectionReference must be a passed inspection performed on or after the most recent failure or breakdown'};
      }
      // returnDate must not predate the passed inspection (checked above) OR any formal resolution
      // already recorded against this equipment (a resolved inspection/breakdown).
      const resolutionDates=(item.inspections||[]).filter(i=>i&&i.resolutionDate&&EG.isValidCalendarDateString(i.resolutionDate)).map(i=>EG.toDateOnly(i.resolutionDate))
        .concat((item.downtimeRecords||[]).filter(d=>d&&d.resolvedDate&&EG.isValidCalendarDateString(d.resolvedDate)).map(d=>EG.toDateOnly(d.resolvedDate)));
      if(resolutionDates.length){
        const latestResolution=new Date(Math.max(...resolutionDates.map(d=>d.getTime())));
        if(returnDateOnly.getTime()<latestResolution.getTime())return{error:'returnDate cannot predate the most recent formal resolution recorded on this equipment'};
      }
      const gate=equipmentSafetyGate(item,{skipStatusCheck:true});
      if(gate.blocked)return equipmentGateBlockedResult('Return to service',equipmentId,gate);
      const from=item.status;
      item.status='Available';
      // "Not auto-assign or start" means the equipment comes back unassigned, not still silently
      // tied to whatever job it was on when it became unsafe — a genuinely NEW assignment/use is a
      // separate, later, independently-gated action (assignEquipment/logEquipmentUsage).
      item.assignedProject=null; item.assignedJobcard=null; item.operator=null; item.currentAssignment=null;
      const rec={timestamp:now(),from,authorisedBy,approvalReference,resolutionEvidence,passedInspectionReference,returnDate};
      item.returnToService=item.returnToService||[]; item.returnToService.unshift(rec);
      item.activity=item.activity||[];
      item.activity.unshift({timestamp:now(),action:`Returned to service (from ${from})`,user:authorisedBy,reference:equipmentId,details:`${approvalReference} — ${resolutionEvidence}`});
      item.lastActivity=now();
      save(`Equipment returned to service: ${equipmentId}`);
      return clone(item);
    },
    // isRetired/retirementReason are also protected fields — retireEquipment() is the only
    // sanctioned way to set them. Requires a non-whitespace reason (no silent default) and always
    // records both authority (activity.user) and evidence (activity.details, the reason itself).
    retireEquipment:(equipmentId,reason,meta={})=>{
      const item=equip(equipmentId);
      if(!item) return {error:'Equipment not found'};
      const cleanReason=reason!=null?String(reason).trim():'';
      if(!cleanReason)return{error:'Retiring equipment requires a non-whitespace reason'};
      const retiredBy=meta&&meta.retiredBy!=null?String(meta.retiredBy).trim():UNNAMED;
      item.isRetired=true; item.retirementReason=cleanReason; item.status='Retired'; item.activity=item.activity||[];
      item.activity.unshift({timestamp:now(),action:'Equipment retired',user:retiredBy,reference:equipmentId,details:cleanReason});
      item.lastActivity=now();
      // Review fix (3rd review): reconcile before the single save() below so both changes persist together.
      const recon=reconcileActiveOperationsForEquipment(equipmentId,'equipment was retired');
      save(`Equipment retired: ${equipmentId}`);
      return Object.assign(clone(item),{pausedOperations:recon.pausedOperations});
    },

    // ══════════════ QUALITY MODULE ══════════════
    // Thin persistence layer only: blocking-condition logic (holds, release readiness,
    // dossier completeness) is computed by the Quality page from this shared data,
    // consistent with how Reports computes its KPIs from WorkshopData.get().
    listQualityInspections:()=>clone(state.qualityInspections),
    findQualityInspection:idOrNo=>clone(qFind(state.qualityInspections,idOrNo)),
    createInspection(payload){
      const rec=Object.assign({id:state.counters.inspection=(state.counters.inspection||0)+1,checklist:[],notes:[],documents:[],activity:[],createdBy:payload.createdBy||UNNAMED,created:now().slice(0,10),modified:now().slice(0,10)},clone(payload));
      rec.no=rec.no||('INS-'+new Date().getFullYear()+'-'+String(rec.id).padStart(3,'0'));
      rec.status=rec.status||'draft';
      rec.result=rec.result||'pending';
      qActivity(rec,'Record created',null,rec.status,rec.no,'');
      state.qualityInspections.unshift(rec);
      save(`Inspection created: ${rec.no}`);
      return clone(rec);
    },
    requestInspection(payload){
      const rec=api.createInspection(Object.assign({},payload,{status:'requested'}));
      return rec;
    },
    updateInspection(idOrNo,patch){
      const rec=qFind(state.qualityInspections,idOrNo); if(!rec)return{error:'Inspection not found'};
      const from=rec.status; Object.assign(rec,clone(patch)); rec.modified=now().slice(0,10);
      if(patch.status&&patch.status!==from)qActivity(rec,'Status changed',from,patch.status,rec.no,patch.reason||'');
      save(`Inspection updated: ${rec.no}`); return clone(rec);
    },
    startInspection(idOrNo){
      const rec=qFind(state.qualityInspections,idOrNo); if(!rec)return{error:'Inspection not found'};
      const from=rec.status; rec.status='in-progress'; rec.modified=now().slice(0,10);
      qActivity(rec,'Inspection started',from,'in-progress',rec.no,'');
      save(`Inspection started: ${rec.no}`); return clone(rec);
    },
    completeInspection(idOrNo,resultData){
      const rec=qFind(state.qualityInspections,idOrNo); if(!rec)return{error:'Inspection not found'};
      if(!resultData||!resultData.result||resultData.result==='pending')return{error:'A result is required to complete an inspection'};
      if(resultData.result==='passed-observations'&&!(resultData.findings||'').trim())return{error:'Passed with Observations requires a comment'};
      const from=rec.status;
      Object.assign(rec,{result:resultData.result,findings:resultData.findings||rec.findings||'',checklist:Array.isArray(resultData.checklist)?resultData.checklist:rec.checklist,actualDate:resultData.actualDate||now().slice(0,10),inspector:resultData.inspector||rec.inspector,critical:!!resultData.critical});
      rec.status=resultData.result==='failed'?'completed':(resultData.status||'completed');
      rec.modified=now().slice(0,10);
      qActivity(rec,resultData.result==='failed'?'Inspection failed':'Inspection completed',from,rec.status,rec.no,resultData.reason||'');
      let hold=null;
      if(resultData.result==='failed'&&resultData.critical){
        hold=api.applyQualityHold({scope:resultData.holdScope||'jobcard',reference:resultData.holdReference||rec.jobcard||rec.projectNo,relatedRef:rec.no,reason:`Critical failed inspection ${rec.no} — ${rec.findings||'see inspection record'}`,severity:'critical',requiredAction:'Corrective action and reinspection required.',appliedBy:resultData.inspector||UNNAMED});
      }
      save(`Inspection completed: ${rec.no}`);
      return{inspection:clone(rec),hold};
    },
    createReinspection(originalIdOrNo,payload){
      const original=qFind(state.qualityInspections,originalIdOrNo); if(!original)return{error:'Original inspection not found'};
      const rec=api.createInspection(Object.assign({},clone(original),payload,{id:undefined,no:undefined,reinspectionOf:original.no,result:'pending',status:'planned',actualDate:null,checklist:(original.checklist||[]).map(c=>({...c,resultItem:''}))}));
      save(`Reinspection created for: ${original.no}`);
      return rec;
    },
    cancelInspection(idOrNo,reason){
      if(!reason||!reason.trim())return{error:'Cancellation requires a reason'};
      const rec=qFind(state.qualityInspections,idOrNo); if(!rec)return{error:'Inspection not found'};
      const from=rec.status; rec.status='cancelled'; rec.modified=now().slice(0,10);
      qActivity(rec,'Inspection cancelled',from,'cancelled',rec.no,reason);
      save(`Inspection cancelled: ${rec.no}`); return clone(rec);
    },

    listQualityNcrs:()=>clone(state.qualityNcrs),
    findQualityNcr:idOrNo=>clone(qFind(state.qualityNcrs,idOrNo)),
    createNcr(payload){
      if(['major','critical'].includes(payload.severity)&&(!payload.responsiblePerson||!payload.dueDate))return{error:'Major and Critical NCRs require a responsible person and due date'};
      const rec=Object.assign({id:state.counters.ncr=(state.counters.ncr||0)+1,notes:[],documents:[],activity:[]},clone(payload));
      rec.no=rec.no||('NCR-'+new Date().getFullYear()+'-'+String(rec.id).padStart(3,'0'));
      rec.status=rec.status||'open';
      rec.detectionDate=rec.detectionDate||now().slice(0,10);
      qActivity(rec,'NCR created',null,rec.status,rec.no,'');
      state.qualityNcrs.unshift(rec);
      let hold=null;
      if(rec.severity==='critical'){
        hold=api.applyQualityHold({scope:rec.jobcard?'jobcard':(rec.projectNo?'project':'other'),reference:rec.jobcard||rec.projectNo||rec.no,relatedRef:rec.no,reason:`Critical NCR ${rec.no} — ${rec.title||rec.description||''}`,severity:'critical',requiredAction:'Resolve NCR and verify corrective action before release.',appliedBy:rec.detectedBy||UNNAMED});
      }
      save(`NCR created: ${rec.no}`);
      return{ncr:clone(rec),hold};
    },
    updateNcr(idOrNo,patch){
      const rec=qFind(state.qualityNcrs,idOrNo); if(!rec)return{error:'NCR not found'};
      if(rec.status==='closed'&&!patch.allowClosedEdit)return{error:'Closed NCRs cannot be silently edited — reopen first'};
      const from=rec.status; Object.assign(rec,clone(patch));
      if(patch.status&&patch.status!==from)qActivity(rec,'Status changed',from,patch.status,rec.no,patch.reason||'');
      save(`NCR updated: ${rec.no}`); return clone(rec);
    },
    addNcrContainment(idOrNo,text){
      const rec=qFind(state.qualityNcrs,idOrNo); if(!rec)return{error:'NCR not found'};
      rec.containment=text; const from=rec.status; rec.status=rec.status==='open'?'under-investigation':rec.status;
      qActivity(rec,'Containment recorded',from,rec.status,rec.no,'');
      save(`NCR containment recorded: ${rec.no}`); return clone(rec);
    },
    setNcrDisposition(idOrNo,disposition,meta={}){
      const rec=qFind(state.qualityNcrs,idOrNo); if(!rec)return{error:'NCR not found'};
      if(disposition==='use-as-is'&&!meta.approvalRef)return{error:'"Use As-Is" requires a recorded approval reference'};
      rec.disposition=disposition; Object.assign(rec,meta);
      const from=rec.status; rec.status='disposition-required'===from?'corrective-action':rec.status;
      qActivity(rec,'Disposition recorded',from,rec.status,rec.no,disposition);
      save(`NCR disposition set: ${rec.no}`); return clone(rec);
    },
    assignNcrCorrectiveAction(idOrNo,capaNo){
      const rec=qFind(state.qualityNcrs,idOrNo); if(!rec)return{error:'NCR not found'};
      rec.correctiveActionRef=capaNo; const from=rec.status; rec.status='corrective-action';
      qActivity(rec,'Corrective action assigned',from,'corrective-action',rec.no,capaNo);
      save(`NCR corrective action assigned: ${rec.no}`); return clone(rec);
    },
    verifyNcrCorrective(idOrNo,verificationResult,verifiedBy){
      const rec=qFind(state.qualityNcrs,idOrNo); if(!rec)return{error:'NCR not found'};
      if(!verificationResult||!verificationResult.trim())return{error:'Verification result is required'};
      rec.verificationResult=verificationResult; const from=rec.status; rec.status='waiting-verification'===from||rec.status==='corrective-action'?'waiting-verification':rec.status;
      qActivity(rec,'Verification completed',from,rec.status,rec.no,`Verified by ${verifiedBy||UNNAMED}`);
      save(`NCR verification recorded: ${rec.no}`); return clone(rec);
    },
    closeNcr(idOrNo,closureApproval){
      const rec=qFind(state.qualityNcrs,idOrNo); if(!rec)return{error:'NCR not found'};
      if(!rec.verificationResult)return{error:'NCR closure requires verification evidence'};
      if(!closureApproval||!closureApproval.trim())return{error:'NCR closure requires a closure approval reference'};
      rec.closureApproval=closureApproval; const from=rec.status; rec.status='closed';
      qActivity(rec,'NCR closed',from,'closed',rec.no,closureApproval);
      save(`NCR closed: ${rec.no}`); return clone(rec);
    },
    reopenNcr(idOrNo,reason){
      if(!reason||!reason.trim())return{error:'Reopening an NCR requires a reason'};
      const rec=qFind(state.qualityNcrs,idOrNo); if(!rec)return{error:'NCR not found'};
      const from=rec.status; rec.status='reopened';
      qActivity(rec,'NCR reopened',from,'reopened',rec.no,reason);
      save(`NCR reopened: ${rec.no}`); return clone(rec);
    },

    listQualityCapas:()=>clone(state.qualityCapas),
    findQualityCapa:idOrNo=>clone(qFind(state.qualityCapas,idOrNo)),
    createCapa(payload){
      const rec=Object.assign({id:state.counters.capa=(state.counters.capa||0)+1,notes:[],activity:[],fiveWhys:[],fishbone:{}},clone(payload));
      rec.no=rec.no||('CAPA-'+new Date().getFullYear()+'-'+String(rec.id).padStart(3,'0'));
      rec.status=rec.status||'open';
      qActivity(rec,'Corrective action created',null,rec.status,rec.no,'');
      state.qualityCapas.unshift(rec);
      save(`CAPA created: ${rec.no}`); return clone(rec);
    },
    updateCapa(idOrNo,patch){
      const rec=qFind(state.qualityCapas,idOrNo); if(!rec)return{error:'Corrective action not found'};
      const from=rec.status; Object.assign(rec,clone(patch));
      if(patch.status&&patch.status!==from)qActivity(rec,'Status changed',from,patch.status,rec.no,patch.reason||'');
      save(`CAPA updated: ${rec.no}`); return clone(rec);
    },
    verifyCapa(idOrNo,{verifiedBy,effectivenessCheck,result}={}){
      const rec=qFind(state.qualityCapas,idOrNo); if(!rec)return{error:'Corrective action not found'};
      if(!effectivenessCheck||!effectivenessCheck.trim())return{error:'Effectiveness check evidence is required'};
      rec.verifiedBy=verifiedBy||UNNAMED; rec.verificationDate=now().slice(0,10); rec.effectivenessCheck=effectivenessCheck;
      const from=rec.status; rec.status=result==='ineffective'?'ineffective':'effective';
      qActivity(rec,'Verification completed',from,rec.status,rec.no,effectivenessCheck);
      save(`CAPA verified: ${rec.no}`); return clone(rec);
    },

    listQualityHolds:()=>clone(state.qualityHolds),
    getActiveQualityHolds:()=>clone(state.qualityHolds.filter(h=>h.status==='active')),
    // ── Central Quality Hold safety gate (see quality-gates.js) ──
    // getQualityGate({projectNo, jobcardNo}) is the general-purpose entry point; the more specific
    // getProjectQualityGate/getJobcardQualityGate below are thin convenience wrappers around it.
    getQualityGate(opts){
      const projectNo=(opts&&opts.projectNo)||null, jobcardNo=(opts&&opts.jobcardNo)||null;
      const gate=jobcardNo?jobcardQualityGate(jobcardNo,projectNo):(projectNo?projectQualityGate(projectNo):null);
      if(!gate)return{blocked:false,holds:[],reasons:[],projectNo:null,jobcardNo:null};
      return Object.assign({},gate,{holds:clone(gate.holds)});
    },
    getProjectQualityGate(projectNo){return api.getQualityGate({projectNo});},
    getJobcardQualityGate(jobcardNo){return api.getQualityGate({jobcardNo});},
    canTransitionProject(projectNo){const gate=api.getProjectQualityGate(projectNo);return{allowed:!gate.blocked,gate};},
    canTransitionJobcard(jobcardNo){const gate=api.getJobcardQualityGate(jobcardNo);return{allowed:!gate.blocked,gate};},
    // Operation-level transitions are gated by their parent Jobcard's own gate — a hold never
    // applies to one operation differently than to the rest of its Jobcard.
    canTransitionJobcardOperation(jobcardNo){return api.canTransitionJobcard(jobcardNo);},
    applyQualityHold(payload){
      // Automatic hold creation (a critical failed inspection, a critical NCR) can otherwise fire
      // repeatedly for the same underlying issue and stack up duplicate active holds on the same
      // scope+reference — an identical-scope/reference/reason active hold is reused instead of
      // creating a new record; a hold for the same reference but a genuinely different reason (a
      // second, distinct quality issue) is NOT merged and still creates its own hold.
      const scope=global.QualityGates?global.QualityGates.normalizeScope(payload.scope):payload.scope;
      const reference=String(payload.reference||''), reason=String(payload.reason||'').trim();
      const existing=state.qualityHolds.find(h=>h.status==='active'&&(global.QualityGates?global.QualityGates.normalizeScope(h.scope):h.scope)===scope&&String(h.reference||'')===reference&&String(h.reason||'').trim()===reason);
      if(existing)return clone(existing);
      const rec=Object.assign({id:state.counters.hold=(state.counters.hold||0)+1,activity:[]},clone(payload));
      rec.no=rec.no||('HOLD-'+new Date().getFullYear()+'-'+String(rec.id).padStart(3,'0'));
      rec.appliedDate=rec.appliedDate||now();
      rec.status='active';
      qActivity(rec,'Quality Hold applied',null,'active',rec.no,rec.reason||'');
      state.qualityHolds.unshift(rec);
      save(`Quality Hold applied: ${rec.no}`); return clone(rec);
    },
    // Formal release: requires a real (non-whitespace) release authority and resolution evidence,
    // and only ever changes the ONE hold record identified by idOrNo. Does not touch, auto-complete
    // or auto-close any Jobcard/Project — after release, the user must manually retry whatever
    // transition was previously blocked (see Part 4).
    releaseQualityHold(idOrNo,{releaseAuthority,releaseReason}={}){
      const rec=qFind(state.qualityHolds,idOrNo); if(!rec)return{error:'Hold not found'};
      const authority=releaseAuthority!=null?String(releaseAuthority).trim():'';
      const reason=releaseReason!=null?String(releaseReason).trim():'';
      if(!authority||!reason)return{error:'Releasing a hold requires resolution evidence and an authorised approval reference'};
      if(rec.status==='released')return{error:`Hold ${rec.no} has already been released and cannot be released again`};
      const from=rec.status; rec.status='released'; rec.releaseAuthority=authority; rec.releaseReason=reason; rec.releaseDate=now();
      qActivity(rec,'Quality Hold released',from,'released',rec.no,reason);
      save(`Quality Hold released: ${rec.no}`); return clone(rec);
    },

    listQualityItps:()=>clone(state.qualityItps),
    findQualityItp:idOrNo=>clone(qFind(state.qualityItps,idOrNo)),
    createItp(payload){
      const rec=Object.assign({id:state.counters.itp=(state.counters.itp||0)+1,lines:[],notes:[],activity:[],revisionHistory:[]},clone(payload));
      rec.no=rec.no||('ITP-'+new Date().getFullYear()+'-'+String(rec.id).padStart(3,'0'));
      rec.status=rec.status||'active'; rec.revision=rec.revision||0;
      rec.revisionHistory.push({revision:rec.revision,date:now().slice(0,10),author:rec.preparedBy||UNNAMED,reason:'Initial issue'});
      qActivity(rec,'ITP created',null,rec.status,rec.no,'');
      state.qualityItps.unshift(rec);
      save(`ITP created: ${rec.no}`); return clone(rec);
    },
    addItpLine(itpIdOrNo,line){
      const rec=qFind(state.qualityItps,itpIdOrNo); if(!rec)return{error:'ITP not found'};
      const seq=(rec.lines||[]).reduce((m,l)=>Math.max(m,l.seq||0),0)+1;
      rec.lines=rec.lines||[]; rec.lines.push(Object.assign({seq,status:'open',result:'pending'},clone(line)));
      qActivity(rec,'ITP line added',null,null,rec.no,`Line ${seq}`);
      save(`ITP line added: ${rec.no}`); return clone(rec);
    },
    updateItpLine(itpIdOrNo,seq,patch){
      const rec=qFind(state.qualityItps,itpIdOrNo); if(!rec)return{error:'ITP not found'};
      const line=(rec.lines||[]).find(l=>l.seq===seq); if(!line)return{error:'ITP line not found'};
      if(patch.status==='skipped'&&(!patch.comments||!patch.approvalRef))return{error:'Skipping an inspection point requires a reason and approval reference'};
      if(line.pointType==='H'&&patch.status==='resolved'&&!patch.result)return{error:'A Hold Point requires a recorded result before it can be resolved'};
      Object.assign(line,clone(patch));
      qActivity(rec,'ITP line updated',null,patch.status||null,rec.no,`Line ${seq}`);
      save(`ITP line updated: ${rec.no}`); return clone(rec);
    },

    listQualityWelds:()=>clone(state.qualityWelds),
    findQualityWeld:idOrNo=>clone(qFind(state.qualityWelds,idOrNo)),
    recordWeld(payload){
      const rec=Object.assign({id:state.counters.weld=(state.counters.weld||0)+1,notes:[],activity:[],repairHistory:[]},clone(payload));
      rec.no=rec.no||('WLD-'+new Date().getFullYear()+'-'+String(rec.id).padStart(3,'0'));
      rec.status=rec.status||'planned'; rec.finalResult=rec.finalResult||'pending';
      qActivity(rec,'Weld record created',null,rec.status,rec.no,'');
      state.qualityWelds.unshift(rec);
      save(`Weld record created: ${rec.no}`); return clone(rec);
    },
    updateWeld(idOrNo,patch){
      const rec=qFind(state.qualityWelds,idOrNo); if(!rec)return{error:'Weld record not found'};
      const from=rec.status; Object.assign(rec,clone(patch));
      if(patch.status&&patch.status!==from)qActivity(rec,'Status changed',from,patch.status,rec.no,patch.reason||'');
      save(`Weld record updated: ${rec.no}`); return clone(rec);
    },
    addWeldRepair(idOrNo,repairEntry){
      const rec=qFind(state.qualityWelds,idOrNo); if(!rec)return{error:'Weld record not found'};
      rec.repairHistory=rec.repairHistory||[]; rec.repairHistory.push(Object.assign({date:now().slice(0,10)},clone(repairEntry)));
      const from=rec.status; rec.status='repaired';
      qActivity(rec,'Weld repair recorded',from,'repaired',rec.no,repairEntry.reason||'');
      save(`Weld repair recorded: ${rec.no}`); return clone(rec);
    },

    // The welding registers' remaining doors, so the Quality screen has one name to call for each thing it
    // does. On browser storage these write here; on the database the page's bridge intercepts every one of
    // them, and the rules that matter — an unapproved procedure, an expired qualification, a weld signed off
    // on evidence that does not exist — are the database's. Nothing below pretends to enforce them: that is
    // the point of the refusals being over there, where an import or a console meets them too.
    recordWeldRepair(idOrNo,reason,notes){
      return this.addWeldRepair(idOrNo,{reason:reason,notes:notes||null,by:UNNAMED});
    },
    acceptWeld(idOrNo,accepted){
      const rec=qFind(state.qualityWelds,idOrNo); if(!rec)return{error:'Weld record not found'};
      const to=accepted===false?'rejected':'accepted';
      const from=rec.status; rec.status=to; rec.finalResult=to;
      qActivity(rec,'Weld '+to,from,to,rec.no,'');
      save(`Weld ${to}: ${rec.no}`); return clone(rec);
    },
    listQualityWps:()=>clone(state.qualityWps),
    saveWps(payload){
      if(!payload||!payload.no)return{error:'A procedure needs a reference'};
      if(!payload.process)return{error:'A procedure needs a process'};
      let rec=payload.id!=null?qFind(state.qualityWps,payload.id):null;
      if(rec){Object.assign(rec,clone(payload));}
      else{
        rec=Object.assign({status:'draft',setStatus:'draft',notes:null},clone(payload));
        rec.id=rec.id||(state.counters.wps=(state.counters.wps||0)+1);
        state.qualityWps.unshift(rec);
      }
      save(`Procedure saved: ${rec.no}`); return clone(rec);
    },
    approveWps(idOrNo){
      const rec=qFind(state.qualityWps,idOrNo); if(!rec)return{error:'Procedure not found'};
      // The one rule kept here as well, because it is the reason the register exists: a procedure is
      // approved on a qualification record, not on its own say-so. The database refuses it too.
      if(!rec.supportingWpqr)return{error:`procedure ${rec.no} cannot be approved with no supporting WPQR`};
      rec.status='valid'; rec.setStatus='approved'; rec.approvedOn=now().slice(0,10);
      save(`Procedure approved: ${rec.no}`); return clone(rec);
    },
    listQualityWelderQuals:()=>clone(state.qualityWelderQuals),
    saveWelderQual(payload){
      if(!payload||!payload.qualNo)return{error:'A qualification needs a number'};
      if(!payload.expiryDate||!payload.issueDate)return{error:'A qualification needs both dates'};
      if(payload.expiryDate<=payload.issueDate)return{error:'A qualification cannot expire before it was issued'};
      let rec=payload.id!=null?qFind(state.qualityWelderQuals,payload.id):null;
      if(rec){Object.assign(rec,clone(payload));}
      else{
        rec=Object.assign({setStatus:'valid'},clone(payload));
        rec.id=rec.id||(state.counters.welderqual=(state.counters.welderqual||0)+1);
        state.qualityWelderQuals.unshift(rec);
      }
      // Expiring soon and expired are the date's answer, not a stored one — worked out here the same way
      // the view works them out, so the two halves of the app agree about a word nobody types.
      const left=Math.round((new Date(rec.expiryDate)-new Date(now().slice(0,10)))/86400000);
      rec.daysLeft=left;
      rec.status=(rec.setStatus&&rec.setStatus!=='valid')?rec.setStatus
        :(left<0?'expired':left<=60?'expiring-soon':'valid');
      save(`Qualification saved: ${rec.qualNo}`); return clone(rec);
    },
    addWeldingNote(entity,idOrNo,text){
      const lists={weld:state.qualityWelds,ndt_report:state.qualityNdt,
                   wps:state.qualityWps,welder_qual:state.qualityWelderQuals};
      const list=lists[entity]; if(!list)return{error:`There is no welding register called ${entity}`};
      const rec=qFind(list,idOrNo); if(!rec)return{error:'Record not found'};
      if(!text||!String(text).trim())return{error:'An empty note is not a note'};
      rec.notes=rec.notes||[]; rec.notes.unshift({date:now().slice(0,10),author:UNNAMED,text:String(text).trim()});
      save(`Note added: ${rec.no||rec.qualNo}`); return clone(rec);
    },

    listQualityNdt:()=>clone(state.qualityNdt),
    findQualityNdt:idOrNo=>clone(qFind(state.qualityNdt,idOrNo)),
    recordNdt(payload){
      const rec=Object.assign({id:state.counters.ndt=(state.counters.ndt||0)+1,notes:[],activity:[],documents:[]},clone(payload));
      rec.no=rec.no||('NDT-'+new Date().getFullYear()+'-'+String(rec.id).padStart(3,'0'));
      rec.status=rec.status||'required'; rec.result=rec.result||'pending';
      qActivity(rec,'NDT record created',null,rec.status,rec.no,'');
      state.qualityNdt.unshift(rec);
      save(`NDT record created: ${rec.no}`); return clone(rec);
    },
    updateNdt(idOrNo,patch){
      const rec=qFind(state.qualityNdt,idOrNo); if(!rec)return{error:'NDT record not found'};
      const from=rec.status; Object.assign(rec,clone(patch));
      if(patch.status&&patch.status!==from)qActivity(rec,'Status changed',from,patch.status,rec.no,patch.reason||'');
      save(`NDT record updated: ${rec.no}`); return clone(rec);
    },

    linkMaterialCertificate(itemCode,certInfo={}){
      const inv=inventory(itemCode); if(!inv)return{error:'Store item not found'};
      inv.certificate=certInfo.certificateNumber||inv.certificate;
      inv.certificateType=certInfo.certificateType||inv.certificateType;
      inv.certificateStatus=certInfo.certificateStatus||'valid';
      save(`Material certificate linked: ${itemCode}`); return clone(inv);
    },

    listSupplierQuality:()=>clone(state.supplierQuality),
    findSupplierQuality:supplierName=>clone(state.supplierQuality.find(x=>x.supplier===supplierName)),
    upsertSupplierQuality(supplierName,patch){
      let rec=state.supplierQuality.find(x=>x.supplier===supplierName);
      if(rec)Object.assign(rec,clone(patch));
      else{rec=Object.assign({id:state.supplierQuality.length+1,supplier:supplierName,approvalStatus:'under-review',rating:null,totalDeliveries:0,acceptedDeliveries:0,rejectedDeliveries:0,missingCertificates:0,openNcrs:0,overdueActions:0,repeatedDefects:'',lastReview:'',nextReview:'',notes:[],activity:[]},clone(patch));state.supplierQuality.push(rec);}
      qActivity(rec,'Supplier quality updated',null,rec.approvalStatus,supplierName,'');
      save(`Supplier quality updated: ${supplierName}`); return clone(rec);
    },
    addSupplierQualityReview(supplierName,review){
      const rec=state.supplierQuality.find(x=>x.supplier===supplierName); if(!rec)return{error:'Supplier quality record not found'};
      rec.notes=rec.notes||[]; rec.notes.unshift(Object.assign({date:now().slice(0,10)},clone(review)));
      rec.lastReview=now().slice(0,10);
      qActivity(rec,'Review added',null,null,supplierName,review.text||'');
      save(`Supplier review added: ${supplierName}`); return clone(rec);
    },

    listQualityComplaints:()=>clone(state.qualityComplaints),
    findQualityComplaint:idOrNo=>clone(qFind(state.qualityComplaints,idOrNo)),
    createComplaint(payload){
      const rec=Object.assign({id:state.counters.complaint=(state.counters.complaint||0)+1,notes:[],documents:[],activity:[]},clone(payload));
      rec.no=rec.no||('CMP-'+new Date().getFullYear()+'-'+String(rec.id).padStart(3,'0'));
      rec.status=rec.status||'received'; rec.complaintDate=rec.complaintDate||now().slice(0,10);
      qActivity(rec,'Complaint received',null,rec.status,rec.no,'');
      state.qualityComplaints.unshift(rec);
      save(`Complaint created: ${rec.no}`); return clone(rec);
    },
    updateComplaint(idOrNo,patch){
      const rec=qFind(state.qualityComplaints,idOrNo); if(!rec)return{error:'Complaint not found'};
      const from=rec.status; Object.assign(rec,clone(patch));
      if(patch.status&&patch.status!==from)qActivity(rec,'Status changed',from,patch.status,rec.no,patch.reason||'');
      save(`Complaint updated: ${rec.no}`); return clone(rec);
    },
    convertComplaintToNcr(idOrNo){
      const complaint=qFind(state.qualityComplaints,idOrNo); if(!complaint)return{error:'Complaint not found'};
      if(complaint.ncrRef)return{error:'Complaint already linked to '+complaint.ncrRef};
      const result=api.createNcr({title:'Customer complaint: '+(complaint.description||'').slice(0,80),projectNo:complaint.projectNo,customer:complaint.customer,description:complaint.description,category:'customer-requirement',severity:complaint.severity==='critical'?'critical':'major',detectedBy:UNNAMED,responsiblePerson:complaint.responsiblePerson,dueDate:complaint.dueDate});
      if(result.error)return result;
      complaint.ncrRef=result.ncr.no;
      qActivity(complaint,'Converted to NCR',complaint.status,complaint.status,complaint.no,result.ncr.no);
      save(`Complaint converted to NCR: ${complaint.no}`);
      return result;
    },

    listQualityDossiers:()=>clone(state.qualityDossiers),
    findQualityDossier:projectNoOrId=>clone(state.qualityDossiers.find(x=>x.id===projectNoOrId||x.no===projectNoOrId||x.projectNo===projectNoOrId)),
    upsertQualityDossier(projectNo,payload){
      let rec=state.qualityDossiers.find(x=>x.projectNo===projectNo);
      if(rec)Object.assign(rec,clone(payload));
      else{rec=Object.assign({id:state.counters.dossier=(state.counters.dossier||0)+1,no:'DOS-'+new Date().getFullYear()+'-'+String((state.counters.dossier||0)).padStart(3,'0'),projectNo,revision:0,items:[],notes:[],activity:[]},clone(payload));state.qualityDossiers.push(rec);}
      qActivity(rec,'Dossier updated',null,null,rec.no,'');
      save(`Dossier updated: ${projectNo}`); return clone(rec);
    },
    updateDossierItem(dossierIdOrNo,itemName,patch){
      const rec=qFind(state.qualityDossiers,dossierIdOrNo)||state.qualityDossiers.find(x=>x.projectNo===dossierIdOrNo); if(!rec)return{error:'Dossier not found'};
      const item=(rec.items||[]).find(i=>i.name===itemName); if(!item)return{error:'Dossier item not found'};
      Object.assign(item,clone(patch));
      qActivity(rec,'Dossier item updated',null,patch.status||null,rec.no,itemName);
      save(`Dossier item updated: ${rec.no}`); return clone(rec);
    },

    listQualityReleases:()=>clone(state.qualityReleases),
    findQualityRelease:idOrNo=>clone(qFind(state.qualityReleases,idOrNo)),
    createFinalRelease(payload){
      if(!payload)return{error:'A release payload is required'};
      // Released / Released with Conditions are operational releases — independently recompute
      // active Quality Holds from shared state (never trust a caller-supplied blockingReasons list,
      // an absent/empty one, or any override flag) before allowing either result.
      if(payload.result==='released'||payload.result==='released-conditions'){
        const jobcardNo=payload.jobcard||payload.jobcardNo||null;
        const gate=jobcardNo?jobcardQualityGate(jobcardNo,payload.projectNo||null):projectQualityGate(payload.projectNo||null);
        if(gate.blocked)return qualityGateBlockedResult(`Final Release (${payload.result})`,jobcardNo||payload.projectNo||'(no project)',gate);
      }
      if(payload.result==='released'&&Array.isArray(payload.blockingReasons)&&payload.blockingReasons.length>0)return{error:'Cannot issue Released while mandatory blocking conditions remain'};
      if(payload.result==='released-conditions'&&(!payload.conditions||!payload.approvalRef))return{error:'Released with Conditions requires written conditions and an approval reference'};
      const rec=Object.assign({id:state.counters.release=(state.counters.release||0)+1,activity:[]},clone(payload));
      rec.no=rec.no||('REL-'+new Date().getFullYear()+'-'+String(rec.id).padStart(3,'0'));
      rec.releaseDate=rec.releaseDate||now();
      qActivity(rec,'Final release issued',null,rec.result,rec.no,'');
      state.qualityReleases.unshift(rec);
      save(`Final release issued: ${rec.no}`); return clone(rec);
    },
    reopenFinalRelease(idOrNo,reason){
      if(!reason||!reason.trim())return{error:'Reopening a release requires a reason'};
      const rec=qFind(state.qualityReleases,idOrNo); if(!rec)return{error:'Release record not found'};
      const from=rec.result; rec.result='pending';
      qActivity(rec,'Final release reopened',from,'pending',rec.no,reason);
      save(`Final release reopened: ${rec.no}`); return clone(rec);
    },

    addQualityNote(collection,idOrNo,note){
      const arr=qCollection(collection); if(!arr)return{error:'Unknown quality record type'};
      const rec=qFind(arr,idOrNo); if(!rec)return{error:'Record not found'};
      rec.notes=rec.notes||[]; rec.notes.unshift(Object.assign({date:now().slice(0,10),time:new Date().toTimeString().slice(0,5)},clone(note)));
      save(`Quality note added: ${rec.no}`); return clone(rec.notes[0]);
    },
    addQualityActivity(collection,idOrNo,entry){
      const arr=qCollection(collection); if(!arr)return{error:'Unknown quality record type'};
      const rec=qFind(arr,idOrNo); if(!rec)return{error:'Record not found'};
      qActivity(rec,entry.action||'Activity',entry.from,entry.to,rec.no,entry.reason||'',entry.user);
      save(`Quality activity: ${rec.no}`); return clone(rec.activity[0]);
    },

    // ── Purchasing: purchase orders, shared with the Purchasing and Reports modules. ──
    getPurchaseOrders:()=>clone(state.purchaseOrders),
    findPurchaseOrder:idOrNo=>clone(state.purchaseOrders.find(x=>x.id===idOrNo||x.no===idOrNo)),
    upsertPurchaseOrder(payload){
      if(!payload||!payload.supplier)return{error:'A supplier is required'};
      let po=state.purchaseOrders.find(x=>(payload.id!=null&&x.id===payload.id)||(payload.no&&x.no===payload.no));
      const data=clone(payload);
      for(const field of ['orderedQty','receivedQty','receivedValue']){
        if(data[field]==null)continue;
        const value=Number(data[field]);
        if(!Number.isFinite(value)||value<0)return{error:`${field} must be zero or greater`};
        data[field]=value;
      }
      if(po){Object.assign(po,data);}
      else{
        po=data;
        po.id=po.id||(state.counters.purchaseOrder=(state.counters.purchaseOrder||0)+1);
        po.no=po.no||(`PO-${new Date().getFullYear()}-${String(state.counters.purchaseOrder).padStart(4,'0')}`);
        po.status=po.status||'Draft';
        state.purchaseOrders.unshift(po);
      }
      save(`Purchase order saved: ${po.no}`);
      return clone(po);
    },
    updatePurchaseOrder(idOrNo,patch){
      const po=state.purchaseOrders.find(x=>x.id===idOrNo||x.no===idOrNo);
      if(!po)return{error:'Purchase order not found'};
      Object.assign(po,clone(patch));
      save(`Purchase order updated: ${po.no}`);
      return clone(po);
    },
    // Purchase orders are referenced by projects and documents — never hard-deleted.
    archivePurchaseOrder(idOrNo,reason){
      const po=state.purchaseOrders.find(x=>x.id===idOrNo||x.no===idOrNo);
      if(!po)return{error:'Purchase order not found'};
      po.archived=true;
      save(`Purchase order archived: ${po.no}${reason?' — '+reason:''}`);
      return clone(po);
    },

    // Purchasing workflows that sit alongside purchase orders.
    getPurchaseRfqs:()=>clone(state.purchaseRfqs),
    findPurchaseRfq:idOrNo=>clone(state.purchaseRfqs.find(x=>x.id===idOrNo||x.no===idOrNo)),
    upsertPurchaseRfq(payload){
      if(!payload||!String(payload.supplier||'').trim())return{error:'An RFQ supplier is required'};
      if(!String(payload.items||'').trim())return{error:'RFQ items or scope are required'};
      const status=String(payload.status||'Draft');
      if(!['Draft','Sent','Replied','Closed','Cancelled'].includes(status))return{error:'Invalid RFQ status'};
      let rfq=state.purchaseRfqs.find(x=>(payload.id!=null&&x.id===payload.id)||(payload.no&&x.no===payload.no));
      const data=clone(payload);data.supplier=String(data.supplier).trim();data.items=String(data.items).trim();data.status=status;
      if(rfq)Object.assign(rfq,data);
      else{
        rfq=Object.assign({id:(state.counters.purchaseRfq=(state.counters.purchaseRfq||0)+1),no:`RFQ-${new Date().getFullYear()}-${String(state.counters.purchaseRfq).padStart(4,'0')}`,date:now().slice(0,10),dueDate:'',project:'',buyer:UNNAMED,archived:false},data);
        state.purchaseRfqs.unshift(rfq);
      }
      save(`Purchase RFQ saved: ${rfq.no}`);return clone(rfq);
    },
    updatePurchaseRfq(idOrNo,patch){const rfq=state.purchaseRfqs.find(x=>x.id===idOrNo||x.no===idOrNo);if(!rfq)return{error:'RFQ not found'};return api.upsertPurchaseRfq(Object.assign({},rfq,clone(patch||{})));},
    archivePurchaseRfq(idOrNo){const rfq=state.purchaseRfqs.find(x=>x.id===idOrNo||x.no===idOrNo);if(!rfq)return{error:'RFQ not found'};rfq.archived=true;save(`Purchase RFQ archived: ${rfq.no}`);return clone(rfq);},

    listSupplierInvoices:()=>clone(state.supplierInvoices),
    findSupplierInvoice:idOrNo=>clone(state.supplierInvoices.find(x=>x.id===idOrNo||x.no===idOrNo||x.supplierReference===idOrNo)),
    upsertSupplierInvoice(payload){
      if(!payload||!String(payload.supplier||'').trim())return{error:'An invoice supplier is required'};
      const amount=Number(payload.amount);
      if(!Number.isFinite(amount)||amount<=0)return{error:'Invoice amount must be greater than zero'};
      const status=String(payload.status||'pending').toLowerCase();
      if(!['pending','approved','paid','disputed','cancelled'].includes(status))return{error:'Invalid supplier invoice status'};
      if(payload.poNo&&!state.purchaseOrders.some(po=>po.no===payload.poNo))return{error:'Linked purchase order not found'};
      let invoice=state.supplierInvoices.find(x=>(payload.id!=null&&x.id===payload.id)||(payload.no&&x.no===payload.no));
      const data=clone(payload);data.supplier=String(data.supplier).trim();data.amount=amount;data.status=status;
      if(invoice)Object.assign(invoice,data);
      else{
        invoice=Object.assign({id:(state.counters.supplierInvoice=(state.counters.supplierInvoice||0)+1),no:`SINV-${new Date().getFullYear()}-${String(state.counters.supplierInvoice).padStart(4,'0')}`,date:now().slice(0,10),dueDate:'',poNo:'',supplierReference:'',currency:'SEK',notes:'',archived:false},data);
        state.supplierInvoices.unshift(invoice);
      }
      save(`Supplier invoice saved: ${invoice.no}`);return clone(invoice);
    },
    updateSupplierInvoice(idOrNo,patch){const invoice=state.supplierInvoices.find(x=>x.id===idOrNo||x.no===idOrNo);if(!invoice)return{error:'Supplier invoice not found'};return api.upsertSupplierInvoice(Object.assign({},invoice,clone(patch||{})));},
    archiveSupplierInvoice(idOrNo){const invoice=state.supplierInvoices.find(x=>x.id===idOrNo||x.no===idOrNo);if(!invoice)return{error:'Supplier invoice not found'};invoice.archived=true;save(`Supplier invoice archived: ${invoice.no}`);return clone(invoice);},

    // Documents: shared metadata plus optional browser-stored file content. localStorage has a
    // small per-origin quota, so content is deliberately capped.
    maxDocumentFileBytes:768*1024,
    maxDocumentStorageBytes:2*1024*1024,
    getDocuments:()=>clone(state.documents),
    findDocument:id=>clone(state.documents.find(x=>x.id===id)),
    upsertDocument(payload){
      if(!payload||!payload.name)return{error:'A document name is required'};
      if(payload.fileData!==undefined){
        if(typeof payload.fileData!=='string'||(payload.fileData&&!payload.fileData.startsWith('data:')))return{error:'Document content must be a valid data URL'};
        const size=Number(payload.fileSize)||0;
        if(size>api.maxDocumentFileBytes)return{error:`File is too large for browser storage (maximum ${Math.round(api.maxDocumentFileBytes/1024)} KB)`};
        if(payload.fileData.length>api.maxDocumentFileBytes*1.5+512)return{error:'Encoded document content exceeds the browser-storage limit'};
        const used=state.documents.filter(x=>payload.id==null||x.id!==payload.id).reduce((sum,x)=>sum+(Number(x.fileSize)||0),0);
        if(used+size>api.maxDocumentStorageBytes)return{error:'Document storage is full. Download and remove stored file content before adding more'};
      }
      let d=state.documents.find(x=>payload.id!=null&&x.id===payload.id);
      const data=clone(payload);
      if(d){Object.assign(d,data);d.updated=data.updated||now();}
      else{
        d=Object.assign({revision:'1',status:'Draft'},data);
        d.id=d.id||(state.counters.document=(state.counters.document||0)+1);
        d.updated=d.updated||now();
        state.documents.unshift(d);
      }
      save(`Document saved: ${d.name}`);
      return clone(d);
    },
    updateDocument(id,patch){
      const d=state.documents.find(x=>x.id===id);
      if(!d)return{error:'Document not found'};
      if(patch&&patch.fileData!==undefined){
        if(typeof patch.fileData!=='string'||(patch.fileData&&!patch.fileData.startsWith('data:')))return{error:'Document content must be a valid data URL'};
        const size=Number(patch.fileSize)||0;
        if(size>api.maxDocumentFileBytes)return{error:`File is too large for browser storage (maximum ${Math.round(api.maxDocumentFileBytes/1024)} KB)`};
        const used=state.documents.filter(x=>x.id!==id).reduce((sum,x)=>sum+(Number(x.fileSize)||0),0);
        if(used+size>api.maxDocumentStorageBytes)return{error:'Document storage is full. Download and remove stored file content before adding more'};
      }
      Object.assign(d,clone(patch));
      d.updated=now();
      save(`Document updated: ${d.name}`);
      return clone(d);
    },
    // Documents use status:'Archived' as their archive state (matches the Documents module's own
    // existing convention) rather than being removed from the collection.
    archiveDocument(id,reason){
      const d=state.documents.find(x=>x.id===id);
      if(!d)return{error:'Document not found'};
      d.status='Archived';
      d.updated=now();
      save(`Document archived: ${d.name}${reason?' — '+reason:''}`);
      return clone(d);
    },
    removeDocumentContent(id){
      const d=state.documents.find(x=>x.id===id);
      if(!d)return{error:'Document not found'};
      d.fileData='';d.fileName='';d.mimeType='';d.fileSize=0;d.updated=now();
      save(`Document file content removed: ${d.name}`);
      return clone(d);
    },
    getDocumentFolders:()=>clone(state.documentFolders),
    upsertDocumentFolder(payload){
      const name=payload&&String(payload.name||'').trim();
      if(!name)return{error:'A folder name is required'};
      const module=String(payload.module||'General'),record=String(payload.record||'General');
      let folder=state.documentFolders.find(f=>payload.id!=null&&f.id===payload.id);
      if(!folder)folder=state.documentFolders.find(f=>!f.archived&&f.name.toLowerCase()===name.toLowerCase()&&f.module===module&&f.record===record);
      if(folder){Object.assign(folder,clone(payload),{name,module,record,archived:false});}
      else{
        folder=Object.assign({id:(state.counters.documentFolder=(state.counters.documentFolder||0)+1),name,module,record,created:now(),author:UNNAMED,archived:false},clone(payload),{name,module,record});
        state.documentFolders.unshift(folder);
      }
      save(`Document folder saved: ${folder.name}`);
      return clone(folder);
    },
    archiveDocumentFolder(id){
      const folder=state.documentFolders.find(f=>f.id===id);
      if(!folder)return{error:'Document folder not found'};
      folder.archived=true;
      save(`Document folder archived: ${folder.name}`);
      return clone(folder);
    },

    // ── Invoices: customer-linked commercial records used by Customers and Reports. ──
    listInvoices:()=>clone(state.invoices),
    findInvoice:idOrNo=>clone(state.invoices.find(i=>i.id===idOrNo||i.no===idOrNo)),
    upsertInvoice(payload){
      if(!payload)return{error:'Invoice data is required'};
      const customer=state.customers.find(c=>(payload.customerId!=null&&c.id===payload.customerId)||(payload.customer&&c.name===payload.customer));
      if(!customer)return{error:'A valid customer is required'};
      const value=Number(payload.value);
      if(!Number.isFinite(value)||value<=0)return{error:'Invoice value must be greater than zero'};
      const allowed=['draft','pending','paid','overdue','cancelled'];
      const status=String(payload.status||'pending').toLowerCase();
      if(!allowed.includes(status))return{error:'Invalid invoice status'};
      let invoice=state.invoices.find(i=>(payload.id!=null&&i.id===payload.id)||(payload.no&&i.no===payload.no));
      const data=Object.assign({},clone(payload),{customerId:customer.id,customer:customer.name,value,status});
      if(invoice)Object.assign(invoice,data);
      else{
        invoice=Object.assign({id:(state.counters.invoice=(state.counters.invoice||0)+1),no:`INV-${new Date().getFullYear()}-${String(state.counters.invoice).padStart(4,'0')}`,date:now().slice(0,10),currency:'SEK',dueDate:'',reference:'',notes:'',archived:false},data);
        state.invoices.unshift(invoice);
      }
      save(`Invoice saved: ${invoice.no}`);
      return clone(invoice);
    },
    updateInvoice(idOrNo,patch){
      const invoice=state.invoices.find(i=>i.id===idOrNo||i.no===idOrNo);
      if(!invoice)return{error:'Invoice not found'};
      return api.upsertInvoice(Object.assign({},invoice,clone(patch||{})));
    },
    archiveInvoice(idOrNo){
      const invoice=state.invoices.find(i=>i.id===idOrNo||i.no===idOrNo);
      if(!invoice)return{error:'Invoice not found'};
      invoice.archived=true;
      save(`Invoice archived: ${invoice.no}`);
      return clone(invoice);
    },

    // ── Marketing: leads, opportunities and campaigns. ──
    getMarketingLeads:()=>clone(state.marketingLeads),
    findMarketingLead:idOrNo=>clone(state.marketingLeads.find(x=>x.id===idOrNo||x.no===idOrNo)),
    upsertMarketingLead(payload){
      if(!payload||!payload.company)return{error:'A company name is required'};
      let l=state.marketingLeads.find(x=>(payload.id!=null&&x.id===payload.id)||(payload.no&&x.no===payload.no));
      const data=clone(payload);
      if(l){Object.assign(l,data);}
      else{
        l=Object.assign({notes:[],activity:[],dnc:false,linkedCustomerId:null,linkedOpportunityId:null},data);
        l.id=l.id||(state.counters.marketingLead=(state.counters.marketingLead||0)+1);
        l.no=l.no||(`LD-${new Date().getFullYear()}-0${state.counters.marketingLead}`);
        l.status=l.status||'new';
        state.marketingLeads.unshift(l);
      }
      save(`Marketing lead saved: ${l.no}`);
      return clone(l);
    },
    getMarketingOpportunities:()=>clone(state.marketingOpportunities),
    findMarketingOpportunity:idOrNo=>clone(state.marketingOpportunities.find(x=>x.id===idOrNo||x.no===idOrNo)),
    upsertMarketingOpportunity(payload){
      if(!payload||!payload.title)return{error:'An opportunity title is required'};
      let o=state.marketingOpportunities.find(x=>(payload.id!=null&&x.id===payload.id)||(payload.no&&x.no===payload.no));
      const data=clone(payload);
      if(o){Object.assign(o,data);}
      else{
        o=Object.assign({activity:[],services:[]},data);
        o.id=o.id||(state.counters.marketingOpportunity=(state.counters.marketingOpportunity||0)+1);
        o.no=o.no||(`OPP-${new Date().getFullYear()}-1${state.counters.marketingOpportunity}`);
        o.stage=o.stage||'discovery';
        state.marketingOpportunities.unshift(o);
      }
      save(`Marketing opportunity saved: ${o.no}`);
      return clone(o);
    },
    // Tenders and RFQs. These lived inside the Marketing page as a plain array until now, which
    // meant a tender survived exactly as long as the tab stayed open - closing it lost the lot.
    getMarketingTenders:()=>clone(state.marketingTenders),
    findMarketingTender:idOrRef=>clone(state.marketingTenders.find(x=>x.id===idOrRef||x.ref===idOrRef)),
    upsertMarketingTender(payload){
      if(!payload||!String(payload.ref||'').trim())return{error:'A reference number is required'};
      if(!String(payload.company||'').trim())return{error:'A company name is required'};
      let t=state.marketingTenders.find(x=>(payload.id!=null&&x.id===payload.id)||(payload.ref&&x.ref===payload.ref));
      const data=clone(payload);
      if(t){Object.assign(t,data);}
      else{
        t=Object.assign({documents:[],status:'reviewing',linkedOpportunityId:null,linkedEstimateNo:null},data);
        t.id=t.id||(state.counters.marketingTender=(state.counters.marketingTender||0)+1);
        state.marketingTenders.unshift(t);
      }
      save(`Tender saved: ${t.ref}`);
      return clone(t);
    },
    getMarketingCampaigns:()=>clone(state.marketingCampaigns),
    findMarketingCampaign:id=>clone(state.marketingCampaigns.find(x=>x.id===id)),
    upsertMarketingCampaign(payload){
      if(!payload||!payload.name)return{error:'A campaign name is required'};
      let c=state.marketingCampaigns.find(x=>payload.id!=null&&x.id===payload.id);
      const data=clone(payload);
      if(c){Object.assign(c,data);}
      else{
        c=Object.assign({activity:[],targetServices:[],targetIndustries:[],channels:[],leads:0,qualified:0,estimates:0,wonValue:0},data);
        c.id=c.id||(state.counters.marketingCampaign=(state.counters.marketingCampaign||0)+1);
        c.status=c.status||'active';
        state.marketingCampaigns.unshift(c);
      }
      save(`Marketing campaign saved: ${c.name}`);
      return clone(c);
    },

    // ── The outward sweep: findings waiting to be judged. ──
    // The rules in prospect-rules.js decide what is worth showing; this side only remembers. The
    // division matters: nothing is stored that the rules have not already triaged against the real
    // equipment register, so the queue can never offer work the shop cannot do.
    getProspectFindings:()=>clone(state.prospectFindings),
    findProspectFinding(id){const f=state.prospectFindings.find(x=>x.id===id);return f?clone(f):null;},
    getProspectSweeps:()=>clone(state.prospectSweeps),
    // null, not undefined: "no sweep has ever run" is an answer the page has to be able to show.
    lastProspectSweep(){return state.prospectSweeps.length?clone(state.prospectSweeps[0]):null;},
    // Everything the queue has ever shown, so a finding reported once is never reported again —
    // including the ones that were binned. A rejected finding coming back tomorrow is exactly how
    // a review queue teaches people to stop reading it.
    getProspectSeen:()=>clone(state.prospectSeen),

    // Takes the raw output of a sweep, triages it, and keeps what is worth a person's time.
    // Returns what was stored and what was not, so the page can report the shape of the sweep
    // honestly: how much came back, how much had been seen before, how much had nowhere to point.
    recordProspectSweep(findings,options){
      if(!global.ProspectRules)return{error:'prospect-rules.js must be loaded before workshop-data.js'};
      const opts=options||{};
      const list=Array.isArray(findings)?findings:[];
      const t=global.ProspectRules.triage(list,state.prospectSeen,state.equipment,opts);
      const sweep={
        id:`sw-${Date.now()}`,
        ranAt:now(),
        source:opts.source||'stub',
        sourcesChecked:Number(opts.sourcesChecked)||null,
        durationMs:Number(opts.durationMs)||null,
        tally:t.tally
      };
      state.prospectSweeps.unshift(sweep);
      if(state.prospectSweeps.length>50)state.prospectSweeps.length=50;
      t.ready.forEach(f=>{
        state.prospectFindings.unshift(Object.assign(clone(f),{
          id:`pf-${sweep.id}-${state.prospectFindings.length}-${Math.random().toString(36).slice(2,7)}`,
          sweepId:sweep.id,
          foundAt:sweep.ranAt,
          status:'new',
          decidedAt:null,decidedBy:'',leadNo:null
        }));
        if(!state.prospectSeen.includes(f.fingerprint))state.prospectSeen.push(f.fingerprint);
      });
      save(`Prospect sweep: ${t.tally.ready} new of ${t.tally.found} found`);
      return clone({sweep,ready:t.ready,tally:t.tally});
    },

    // Accepting turns a finding into a real lead. What it knows goes across; what it does not know
    // stays empty. A forum post carries no contact name, no email and no value, so the lead is
    // created without them rather than with plausible-looking blanks filled in.
    acceptProspectFinding(id,extra){
      const f=state.prospectFindings.find(x=>x.id===id);
      if(!f)return{error:'Finding not found'};
      if(f.status!=='new')return{error:`This finding was already ${f.status}`};
      const who=(extra&&extra.by)||'';
      const lead=this.upsertMarketingLead({
        company:(extra&&extra.company)||f.company||f.title,
        contact:(extra&&extra.contact)||'',
        email:'',phone:'',
        country:'Sweden',
        city:f.place||'',
        industry:'',
        source:'prospect',
        service:f.need||f.title,
        value:Number.isFinite(Number(f.value))?Number(f.value):null,
        priority:f.verdict==='go'?'high':(f.verdict==='skip'?'low':'medium'),
        status:'new',
        owner:who,
        created:now().slice(0,10),
        fromProspect:f.id,
        demo:!!f.demo,
        notes:[{date:now().slice(0,10),author:who,
          text:`From the outward sweep${f.demo?' (sample finding, nothing was actually found)':''}. `+
               `Source: ${f.sourceName||'—'} ${f.sourceUrl||''}`.trim()}],
        activity:[{date:now().slice(0,10),type:'created',
          text:`Accepted from the findings queue — ${f.klass}, ${f.verdict.toUpperCase()}.`}]
      });
      if(lead&&lead.error)return lead;
      f.status='accepted';f.decidedAt=now();f.decidedBy=who;f.leadNo=lead.no;
      save(`Finding accepted: ${f.title} → ${lead.no}`);
      return clone({finding:f,lead});
    },

    dismissProspectFinding(id,extra){
      const f=state.prospectFindings.find(x=>x.id===id);
      if(!f)return{error:'Finding not found'};
      if(f.status!=='new')return{error:`This finding was already ${f.status}`};
      f.status='dismissed';
      f.decidedAt=now();
      f.decidedBy=(extra&&extra.by)||'';
      f.dismissReason=(extra&&extra.reason)||'';
      save(`Finding dismissed: ${f.title}`);
      return clone(f);
    },

    // What the queue looks like right now: what is waiting, and what has been decided since.
    prospectQueueSummary(){
      const all=state.prospectFindings;
      const waiting=all.filter(f=>f.status==='new');
      const count=v=>waiting.filter(f=>f.verdict===v).length;
      return clone({
        waiting:waiting.length,
        go:count('go'),maybe:count('maybe'),skip:count('skip'),
        accepted:all.filter(f=>f.status==='accepted').length,
        dismissed:all.filter(f=>f.status==='dismissed').length,
        seen:state.prospectSeen.length,
        lastSweep:state.prospectSweeps[0]||null
      });
    },

    // ── Reports: saved report definitions and report-page configuration (UI state that Pass 2
    // explicitly moves into shared storage so it survives across devices/browsers like other data). ──
    getSavedReports:()=>clone(state.savedReports),
    saveReport(payload){
      if(!payload||!payload.name)return{error:'A report name is required'};
      let r=state.savedReports.find(x=>payload.id!=null&&x.id===payload.id);
      const data=clone(payload);
      if(r){Object.assign(r,data);}
      else{
        r=Object.assign({favourite:false,archived:false},data);
        r.id=r.id||(`rpt-${Date.now()}`);
        r.created=r.created||now().slice(0,10);
        r.lastUsed=r.lastUsed||r.created;
        state.savedReports.push(r);
      }
      save(`Report saved: ${r.name}`);
      return clone(r);
    },
    archiveSavedReport(id){
      const r=state.savedReports.find(x=>x.id===id);
      if(!r)return{error:'Saved report not found'};
      r.archived=true;
      save(`Report archived: ${r.name}`);
      return clone(r);
    },
    getReportConfig:()=>clone(state.reportConfig||{}),
    updateReportConfig(patch){
      state.reportConfig=Object.assign({},state.reportConfig||{},clone(patch||{}));
      save();
      return clone(state.reportConfig);
    }
  };
  global.WorkshopData=api;
})(window);
