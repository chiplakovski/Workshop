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
  const LEGACY_PROJECTS_CUSTOMER_NAMES={1:'Sanus Glutenfri AB',2:'Schröder Nordic',3:'Lund Konditori',4:'Helsingborg Foods',5:'Malmö Livs',6:'Ystad Bageri',7:'Trelleborg Snacks'};
  const clone=value=>JSON.parse(JSON.stringify(value));
  const now=()=>new Date().toISOString();
  const seed=()=>({
    version:VERSION,
    counters:{customer:40,estimation:25,project:110,movement:6,offcut:3,jobcard:2,
      inspection:6,ncr:3,capa:2,weld:2,ndt:2,itp:1,hold:1,complaint:1,release:0,dossier:1,wps:1,welderqual:2,
      purchaseOrder:145,document:9,marketingLead:50,marketingOpportunity:109,marketingCampaign:4},
    customers:[
      {id:1,no:'C-001',name:'MarineVent AB',status:'active',city:'Malmö',country:'Sweden',org:'556789-1234',vat:'SE556789123401',email:'info@marinevent.se',phone:'+46 40 123 45 67',website:'www.marinevent.se',since:'2023-03-15',terms:'30 days',credit:250000,currency:'SEK',industry:'Marine / Ventilation Systems',type:'Company',preferred:'Email',priceList:'Standard Price List 2026',deliveryTerms:'EXW Marieholm',discountAgreement:'0%',billing:['MarineVent AB','Att: Purchasing','Östra Varvsgatan 12','211 19 Malmö','Sweden'],shipping:['MarineVent AB','Östra Varvsgatan 12','211 19 Malmö','Sweden'],contacts:[{name:'Per Bengtsson',role:'CEO',department:'Management',primary:true,email:'per.bengtsson@marinevent.se',phone:'+46 70 555 66 77'},{name:'Lena Mårtensson',role:'Purchasing Manager',department:'Purchasing',primary:false,email:'lena.martensson@marinevent.se',phone:'+46 70 888 99 00'}],notes:[{date:'2026-08-22',author:'Aleksandar C.',text:'Discussed new ventilation unit project. Waiting for drawings.'}],documents:[{name:'Company Profile.pdf',type:'pdf',date:'2026-03-15'}]},
      {id:2,no:'C-002',name:'Sanus Glutenfri AB',status:'active',city:'Landskrona',country:'Sweden',org:'559812-4471',vat:'SE559812447101',email:'info@sanusglutenfri.se',phone:'+46 42 123 45 67',terms:'30 days',credit:150000,currency:'SEK',industry:'Food Production',type:'Company',contacts:[],notes:[],documents:[]},
      {id:3,no:'C-003',name:'Schröder Nordic',status:'active',city:'Helsingborg',country:'Sweden',org:'556234-9012',vat:'SE556234901201',email:'info@schroder.se',phone:'+46 42 987 65 43',terms:'30 days',credit:300000,currency:'SEK',industry:'Industrial Machinery',type:'Company',contacts:[],notes:[],documents:[]},
      {id:4,no:'C-004',name:'Lund Konditori',status:'active',city:'Lund',country:'Sweden',org:'559045-1123',terms:'30 days',credit:0,currency:'SEK',industry:'Food Production',type:'Company',contacts:[{name:'Sofia L.',role:'Contact',primary:true,email:'sofia@lundkond.se',phone:''}],notes:[],documents:[]},
      {id:5,no:'C-005',name:'Helsingborg Foods',status:'active',city:'Helsingborg',country:'Sweden',org:'556678-3345',terms:'30 days',credit:0,currency:'SEK',industry:'Food Production',type:'Company',contacts:[{name:'Erik S.',role:'Contact',primary:true,email:'erik@hbgfoods.se',phone:''}],notes:[],documents:[]},
      {id:6,no:'C-006',name:'Malmö Livs',status:'active',city:'Malmö',country:'Sweden',org:'559211-7789',terms:'30 days',credit:0,currency:'SEK',industry:'Food Production',type:'Company',contacts:[{name:'Karim A.',role:'Contact',primary:true,email:'info@malmolivs.se',phone:''}],notes:[],documents:[]},
      {id:7,no:'C-007',name:'Ystad Bageri',status:'active',city:'Ystad',country:'Sweden',org:'556990-2201',terms:'30 days',credit:0,currency:'SEK',industry:'Food Production',type:'Company',contacts:[{name:'Nina H.',role:'Contact',primary:true,email:'nina@ystadbageri.se',phone:''}],notes:[],documents:[]},
      {id:8,no:'C-008',name:'Trelleborg Snacks',status:'active',city:'Trelleborg',country:'Sweden',org:'559333-6654',terms:'30 days',credit:0,currency:'SEK',industry:'Food Production',type:'Company',contacts:[{name:'Jonas P.',role:'Contact',primary:true,email:'jonas@trelleborgsnacks.se',phone:''}],notes:[],documents:[]}
    ],
    estimations:[
      {id:18,no:'EST-2026-018',customerId:1,customer:'MarineVent AB',title:'Ventilation Duct System',status:'accepted',revision:1,created:'2026-08-14',validUntil:'2026-09-14',currency:'SEK',estimatedMaterial:72450,estimatedLabour:48600,estimatedMachine:12600,estimatedOther:8400,totalCost:142050,sellingPrice:198000,plannedHours:184,machines:['Laser','Press Brake','TIG Station 1'],deliveryTarget:'2026-11-12',projectId:14,bom:[{code:'SS-SHT-304-2.0',description:'AISI 304 sheet 2 mm',qty:8,unit:'EA'},{code:'MS-TUBE-40SQ-2.0',description:'Square tube 40x40x2 mm',qty:36,unit:'EA'},{code:'ER70S-6-1.0',description:'Welding wire ER70S-6',qty:45,unit:'KG'},{code:'BOLT-HEX-M10X25',description:'Hex bolts M10x25',qty:40,unit:'EA'}],revisions:[{rev:0,date:'2026-08-14',author:'Aleksandar C.',reason:'Initial quotation'},{rev:1,date:'2026-08-18',author:'Aleksandar C.',reason:'Updated material grade and delivery'}]},
      {id:23,no:'EST-2026-023',customerId:1,customer:'MarineVent AB',title:'Ventilation Upgrade Package',status:'draft',revision:0,created:'2026-08-22',validUntil:'2026-09-22',currency:'SEK',estimatedMaterial:9800,estimatedLabour:7200,estimatedMachine:3200,estimatedOther:1920,totalCost:22120,sellingPrice:28503,plannedHours:30,machines:['Laser','TIG Station 1'],deliveryTarget:'2026-10-15',projectId:null,bom:[],revisions:[{rev:0,date:'2026-08-22',author:'Aleksandar C.',reason:'Initial quotation'}]}
      ,{id:24,no:'EST-2026-024',customerId:2,customer:'Sanus Glutenfri AB',title:'Stainless Platform Extension',status:'accepted',revision:0,created:'2026-08-24',validUntil:'2026-09-24',currency:'SEK',estimatedMaterial:48500,estimatedLabour:36200,estimatedMachine:9800,estimatedOther:5500,totalCost:100000,sellingPrice:138000,plannedHours:126,machines:['Laser','Press Brake','TIG Station 1'],deliveryTarget:'2026-11-28',projectId:null,bom:[{code:'SS-SHT-304-2.0',description:'AISI 304 sheet 2 mm',qty:12,unit:'EA'},{code:'MS-TUBE-40SQ-2.0',description:'Square tube 40x40x2 mm',qty:24,unit:'EA'},{code:'ER70S-6-1.0',description:'Welding wire ER70S-6',qty:18,unit:'KG'}],revisions:[{rev:0,date:'2026-08-24',author:'Aleksandar C.',reason:'Accepted quotation'}]}
    ],
    projects:[
      {id:14,no:'P-2026-014',customerId:1,customer:'MarineVent AB',name:'Ventilation Duct System',estimationId:18,status:'production',phase:'production',start:'2026-08-15',deadline:'2026-09-12',expectedCompletion:'2026-09-12',progress:62,plannedHours:184,usedHours:96,responsible:'Aleksandar C.',workers:['Marko K.','Elena N.'],machines:['Laser','Press Brake','TIG Station 1'],materialStatus:'shortage',bom:[{code:'SS-SHT-304-2.0',description:'AISI 304 sheet 2 mm',required:8,reserved:8,issued:4,unit:'EA'},{code:'MS-TUBE-40SQ-2.0',description:'Square tube 40x40x2 mm',required:36,reserved:30,issued:12,unit:'EA'},{code:'ER70S-6-1.0',description:'Welding wire ER70S-6',required:45,reserved:12,issued:10,unit:'KG'},{code:'BOLT-HEX-M10X25',description:'Hex bolts M10x25',required:40,reserved:40,issued:40,unit:'EA'}],tasks:[],milestones:[]},
      {"id":101,"no":"P-26-0001","customerId":2,"customer":"Sanus Glutenfri AB","name":"Bakery Conveyor Modification","estimationId":null,"status":"active","phase":"production","start":"2026-08-18","deadline":"2026-09-10","expectedCompletion":"2026-09-08","progress":50,"plannedHours":80,"usedHours":25,"responsible":"Aleksandar","workers":["Marko","Elena"],"machines":[],"materialStatus":"unchecked","bom":[],"tasks":[],"milestones":[],"customerRef":"PO-48215","poNumber":"PO-48215","description":"Fabricate and install stainless steel conveyor extension including supports and guarding.","notes":[{"date":"2026-08-15","author":"Aleksandar","text":"Customer confirmed guard color RAL 7035.","tag":"customer","pinned":false},{"date":"2026-08-20","author":"Elena","text":"Drawing revision B approved — proceed with cutting.","tag":"workshop","pinned":true}],"types":["Fabrication","Stainless Steel","Installation"],"pm":"Aleksandar","workshop":"Marko","sales":"Aleksandar","createdDate":"2026-08-10","plannedStart":"2026-08-18","actualStart":"2026-08-18","plannedCompletion":"2026-09-08","actualCompletion":"","closedDate":"","quotedValue":92000,"estLabourHours":80,"estMaterialCost":20000,"estPurchaseCost":8000,"otherCostEst":0,"otherCostAct":500,"holdReason":"","holdComment":"","expectedResume":"","cancelReason":"","jobcards":[{"no":"JC-26-0034","desc":"Cut Frame Profiles","assigned":"Marko","status":"completed","est":8,"act":8,"progress":100,"estMaterial":3200},{"no":"JC-26-0035","desc":"Weld Main Frame","assigned":"Marko","status":"active","est":20,"act":14,"progress":70,"estMaterial":9000},{"no":"JC-26-0036","desc":"Fabricate Guarding","assigned":"Elena","status":"planned","est":10,"act":0,"progress":0,"estMaterial":4800},{"no":"JC-26-0037","desc":"Installation","assigned":"Team","status":"planned","est":16,"act":0,"progress":0,"estMaterial":1500},{"no":"JC-26-0038","desc":"Panel & Controls Wiring","assigned":"Marko","status":"planned","est":26,"act":0,"progress":0,"estMaterial":1500}],"hours":[{"date":"2026-08-18","worker":"Marko","jobcard":"JC-26-0034","desc":"Cut Frame Profiles","hours":8},{"date":"2026-08-19","worker":"Marko","jobcard":"JC-26-0035","desc":"Weld Main Frame — setup","hours":6},{"date":"2026-08-20","worker":"Marko","jobcard":"JC-26-0035","desc":"Weld Main Frame","hours":8},{"date":"2026-08-21","worker":"Aleksandar","jobcard":"","desc":"Project management / site coordination","hours":3}],"materials":[{"name":"304L Sheet 2mm","spec":"2mm stainless","qty":3,"unit":"sheets","source":"store","jobcard":"JC-26-0034","cost":4800,"status":"used"},{"name":"RHS 40x40x2","spec":"box section","qty":24,"unit":"m","source":"store","jobcard":"JC-26-0035","cost":1560,"status":"issued"},{"name":"M8 Stainless Bolts","spec":"A2 stainless","qty":40,"unit":"pcs","source":"store","jobcard":"JC-26-0034","cost":280,"status":"used"},{"name":"Stainless Hinges","spec":"316 grade","qty":6,"unit":"pcs","source":"purchase","jobcard":"JC-26-0037","cost":780,"status":"reserved"}],"purchases":[{"po":"PO-26-0018","supplier":"Ahlsell","date":"2026-08-20","items":"Fittings, Bolts, Grinding Discs","ordered":12350,"received":8550,"status":"partdelivered","expected":"2026-08-27"}],"documents":{"Drawings":[{"name":"Frame Drawing","rev":"A","date":"2026-08-10","by":"Aleksandar","status":"superseded"},{"name":"Frame Drawing","rev":"B","date":"2026-08-20","by":"Aleksandar","status":"current"},{"name":"Guard Drawing.dxf","rev":"-","date":"2026-08-15","by":"Elena","status":"current"}],"Customer Documents":[{"name":"Customer PO.pdf","rev":"-","date":"2026-08-08","by":"Aleksandar","status":"current"},{"name":"Customer Specification.pdf","rev":"-","date":"2026-08-08","by":"Aleksandar","status":"current"}],"Material Certificates":[{"name":"EN 10204 3.1 Certificate.pdf","rev":"-","date":"2026-08-19","by":"Marko","status":"current"}],"Photos":[{"name":"Before Work.jpg","rev":"-","date":"2026-08-18","by":"Marko","status":"current"},{"name":"Fabrication.jpg","rev":"-","date":"2026-08-20","by":"Marko","status":"current"}],"Quality":[{"name":"WPS-01.pdf","rev":"-","date":"2026-08-10","by":"Aleksandar","status":"current"}],"Inspection Reports":[{"name":"Inspection Report RPT-26-0001 (Approved)","rev":"-","date":"2026-08-20","by":"Aleksandar","status":"current"},{"name":"Welding Report RPT-26-0002 (Draft)","rev":"-","date":"2026-08-21","by":"Marko","status":"current"}]},"activity":[{"date":"2026-08-10","time":"09:00","user":"Aleksandar","action":"Project Created"},{"date":"2026-08-10","time":"09:05","user":"Aleksandar","action":"Status changed: DRAFT → QUOTATION"},{"date":"2026-08-12","time":"11:20","user":"Aleksandar","action":"Quotation approved by customer — status changed: QUOTATION → APPROVED"},{"date":"2026-08-14","time":"10:00","user":"Aleksandar","action":"Jobcards created (JC-26-0034 … JC-26-0038)"},{"date":"2026-08-15","time":"14:40","user":"Aleksandar","action":"Note added (customer)"},{"date":"2026-08-16","time":"08:30","user":"Aleksandar","action":"Status changed: APPROVED → PLANNED"},{"date":"2026-08-18","time":"07:15","user":"Marko","action":"Status changed: PLANNED → ACTIVE — first hours logged"},{"date":"2026-08-18","time":"15:30","user":"Marko","action":"Logged 8h on JC-26-0034"},{"date":"2026-08-20","time":"09:10","user":"Aleksandar","action":"Drawing updated REV A → REV B"},{"date":"2026-08-20","time":"09:42","user":"Aleksandar","action":"PO-26-0018 created (Ahlsell)"},{"date":"2026-08-20","time":"16:05","user":"Elena","action":"Note pinned (workshop)"},{"date":"2026-08-21","time":"17:00","user":"Aleksandar","action":"Logged 3h — Project management"}]},
      {"id":102,"no":"P-26-0002","customerId":3,"customer":"Schröder Nordic","name":"Folding Machine Retrofit","estimationId":null,"status":"quotation","phase":"design","start":"2026-08-14","deadline":"2026-09-20","expectedCompletion":"2026-09-20","progress":0,"plannedHours":0,"usedHours":0,"responsible":"Aleksandar","workers":[],"machines":[],"materialStatus":"unchecked","bom":[],"tasks":[],"milestones":[],"customerRef":"SN-Q-114","poNumber":"","description":"Retrofit MAK 2500/1.25 folding machine — new panel wiring, HMI bracket and safety cover.","notes":[{"date":"2026-08-16","author":"Aleksandar","text":"Waiting for customer confirmation on final scope.","tag":"customer","pinned":false}],"types":["Fabrication","Electrical"],"pm":"Aleksandar","workshop":"","sales":"Aleksandar","createdDate":"2026-08-14","plannedStart":"","actualStart":"","plannedCompletion":"","actualCompletion":"","closedDate":"","quotedValue":145000,"estLabourHours":0,"estMaterialCost":0,"estPurchaseCost":0,"otherCostEst":0,"otherCostAct":0,"holdReason":"","holdComment":"","expectedResume":"","cancelReason":"","jobcards":[],"hours":[],"materials":[],"purchases":[],"documents":{"Customer Documents":[{"name":"Specification Draft.pdf","rev":"-","date":"2026-08-14","by":"Aleksandar","status":"current"}]},"activity":[{"date":"2026-08-14","time":"10:00","user":"Aleksandar","action":"Project Created"},{"date":"2026-08-14","time":"10:05","user":"Aleksandar","action":"Status changed: DRAFT → QUOTATION"}]},
      {"id":103,"no":"P-26-0003","customerId":4,"customer":"Lund Konditori","name":"Mixer Overhaul — Preliminary","estimationId":null,"status":"draft","phase":"design","start":"2026-08-22","deadline":"","expectedCompletion":"","progress":0,"plannedHours":0,"usedHours":0,"responsible":"Aleksandar","workers":[],"machines":[],"materialStatus":"unchecked","bom":[],"tasks":[],"milestones":[],"customerRef":"","poNumber":"","description":"Preliminary gearbox service and bowl guard replacement.","notes":[],"types":["Repair"],"pm":"Aleksandar","workshop":"","sales":"","createdDate":"2026-08-22","plannedStart":"","actualStart":"","plannedCompletion":"","actualCompletion":"","closedDate":"","quotedValue":0,"estLabourHours":0,"estMaterialCost":0,"estPurchaseCost":0,"otherCostEst":0,"otherCostAct":0,"holdReason":"","holdComment":"","expectedResume":"","cancelReason":"","jobcards":[],"hours":[],"materials":[],"purchases":[],"documents":{},"activity":[{"date":"2026-08-22","time":"13:10","user":"Aleksandar","action":"Project Created"}]},
      {"id":104,"no":"P-26-0004","customerId":5,"customer":"Helsingborg Foods","name":"Guard Fabrication","estimationId":null,"status":"completed","phase":"closeout","start":"2026-06-02","deadline":"2026-06-20","expectedCompletion":"2026-06-19","progress":100,"plannedHours":24,"usedHours":23.5,"responsible":"Aleksandar","workers":["Marko"],"machines":[],"materialStatus":"unchecked","bom":[],"tasks":[],"milestones":[],"customerRef":"HF-2201","poNumber":"HF-2201","description":"Sheet metal guards for packing line P2, fabricated and installed on-site.","notes":[],"types":["Fabrication","Installation"],"pm":"Aleksandar","workshop":"Marko","sales":"Aleksandar","createdDate":"2026-05-28","plannedStart":"2026-06-02","actualStart":"2026-06-02","plannedCompletion":"2026-06-19","actualCompletion":"2026-06-20","closedDate":"","quotedValue":58000,"estLabourHours":24,"estMaterialCost":12000,"estPurchaseCost":0,"otherCostEst":0,"otherCostAct":0,"holdReason":"","holdComment":"","expectedResume":"","cancelReason":"","jobcards":[{"no":"JC-26-0011","desc":"Sheet metal guards","assigned":"Marko","status":"completed","est":18,"act":17,"progress":100,"estMaterial":9500},{"no":"JC-26-0012","desc":"Install on-site","assigned":"Team","status":"completed","est":6,"act":6.5,"progress":100,"estMaterial":2500}],"hours":[{"date":"2026-06-18","worker":"Marko","jobcard":"JC-26-0011","desc":"Guard fabrication","hours":17},{"date":"2026-06-20","worker":"Elena","jobcard":"JC-26-0012","desc":"Site install","hours":6.5}],"materials":[{"name":"Mild Steel Sheet 3mm","spec":"3mm","qty":6,"unit":"sheets","source":"store","jobcard":"JC-26-0011","cost":4100,"status":"used"}],"purchases":[],"documents":{"Photos":[{"name":"Install Complete.jpg","rev":"-","date":"2026-06-20","by":"Marko","status":"current"}],"Inspection Reports":[{"name":"Completion Report RPT-26-0001 (Signed)","rev":"-","date":"2026-06-20","by":"Aleksandar","status":"current"}]},"activity":[{"date":"2026-05-28","time":"09:00","user":"Aleksandar","action":"Project Created"},{"date":"2026-06-20","time":"16:00","user":"Aleksandar","action":"Status changed: ACTIVE → COMPLETED"}]},
      {"id":105,"no":"P-26-0005","customerId":6,"customer":"Malmö Livs","name":"Service — Malmö Slicer","estimationId":null,"status":"closed","phase":"closeout","start":"2026-08-10","deadline":"2026-08-20","expectedCompletion":"2026-08-18","progress":100,"plannedHours":12,"usedHours":12,"responsible":"Aleksandar","workers":["Marko"],"machines":[],"materialStatus":"unchecked","bom":[],"tasks":[],"milestones":[],"customerRef":"ML-99","poNumber":"","description":"On-site inspection and bearing replacement on Slicer L-40.","notes":[],"types":["Service"],"pm":"Aleksandar","workshop":"Marko","sales":"Aleksandar","createdDate":"2026-08-05","plannedStart":"2026-08-10","actualStart":"2026-08-10","plannedCompletion":"2026-08-18","actualCompletion":"2026-08-18","closedDate":"2026-08-19","quotedValue":16500,"estLabourHours":12,"estMaterialCost":900,"estPurchaseCost":0,"otherCostEst":0,"otherCostAct":0,"holdReason":"","holdComment":"","expectedResume":"","cancelReason":"","jobcards":[{"no":"JC-26-0009","desc":"On-site inspection","assigned":"Marko","status":"completed","est":4,"act":4,"progress":100,"estMaterial":0},{"no":"JC-26-0010","desc":"Bearing replacement","assigned":"Marko","status":"completed","est":8,"act":8,"progress":100,"estMaterial":900}],"hours":[{"date":"2026-08-10","worker":"Marko","jobcard":"JC-26-0009","desc":"Inspection","hours":4},{"date":"2026-08-18","worker":"Marko","jobcard":"JC-26-0010","desc":"Bearing replacement","hours":8}],"materials":[{"name":"Bearing 6205-2RS","spec":"-","qty":2,"unit":"pcs","source":"store","jobcard":"JC-26-0010","cost":900,"status":"used"}],"purchases":[],"documents":{"Inspection Reports":[{"name":"Inspection Report RPT-26-0001 (Signed)","rev":"-","date":"2026-08-18","by":"Marko","status":"current"}]},"activity":[{"date":"2026-08-05","time":"09:00","user":"Aleksandar","action":"Project Created"},{"date":"2026-08-19","time":"09:00","user":"Aleksandar","action":"Status changed: COMPLETED → CLOSED"}]},
      {"id":106,"no":"P-26-0006","customerId":7,"customer":"Ystad Bageri","name":"Spiral Mixer Service","estimationId":null,"status":"hold","phase":"production","start":"2026-08-19","deadline":"2026-09-05","expectedCompletion":"2026-09-05","progress":40,"plannedHours":16,"usedHours":3,"responsible":"Aleksandar","workers":["Marko","Elena"],"machines":[],"materialStatus":"unchecked","bom":[],"tasks":[],"milestones":[],"customerRef":"YB-33","poNumber":"","description":"Gearbox service on spiral mixer SM-80.","notes":[{"date":"2026-08-19","author":"Aleksandar","text":"Supplier delay on gearbox seal kit.","tag":"purchase","pinned":true}],"types":["Repair","Service"],"pm":"Aleksandar","workshop":"Marko","sales":"","createdDate":"2026-08-12","plannedStart":"2026-08-19","actualStart":"2026-08-19","plannedCompletion":"","actualCompletion":"","closedDate":"","quotedValue":24000,"estLabourHours":16,"estMaterialCost":3700,"estPurchaseCost":0,"otherCostEst":0,"otherCostAct":0,"holdReason":"material","holdComment":"Waiting for gearbox seal kit from supplier.","expectedResume":"2026-09-01","cancelReason":"","jobcards":[{"no":"JC-26-0022","desc":"Gearbox service","assigned":"Marko","status":"active","est":10,"act":3,"progress":30,"estMaterial":2400},{"no":"JC-26-0023","desc":"New bowl guard","assigned":"Elena","status":"planned","est":6,"act":0,"progress":0,"estMaterial":1300}],"hours":[{"date":"2026-08-19","worker":"Marko","jobcard":"JC-26-0022","desc":"Gearbox teardown","hours":3}],"materials":[],"purchases":[{"po":"PO-26-0016","supplier":"SKF Sverige","date":"2026-08-19","items":"Gearbox seal kit","ordered":1300,"received":0,"status":"ordered","expected":"2026-09-02"}],"documents":{},"activity":[{"date":"2026-08-12","time":"09:00","user":"Aleksandar","action":"Project Created"},{"date":"2026-08-19","time":"10:00","user":"Aleksandar","action":"Status changed: ACTIVE → ON HOLD (Waiting for Material)"}]},
      {"id":107,"no":"P-26-0007","customerId":8,"customer":"Trelleborg Snacks","name":"Packing Line Extension","estimationId":null,"status":"cancelled","phase":"closeout","start":"2026-07-20","deadline":"2026-10-01","expectedCompletion":"2026-10-01","progress":0,"plannedHours":0,"usedHours":0,"responsible":"Aleksandar","workers":[],"machines":[],"materialStatus":"unchecked","bom":[],"tasks":[],"milestones":[],"customerRef":"TS-500","poNumber":"","description":"Extension of packing line with additional conveyor section.","notes":[],"types":["Fabrication","Installation"],"pm":"Aleksandar","workshop":"","sales":"Aleksandar","createdDate":"2026-07-20","plannedStart":"","actualStart":"","plannedCompletion":"","actualCompletion":"","closedDate":"","quotedValue":210000,"estLabourHours":0,"estMaterialCost":0,"estPurchaseCost":0,"otherCostEst":0,"otherCostAct":0,"holdReason":"","holdComment":"","expectedResume":"","cancelReason":"Customer postponed investment.","jobcards":[],"hours":[],"materials":[],"purchases":[],"documents":{},"activity":[{"date":"2026-07-20","time":"09:00","user":"Aleksandar","action":"Project Created"},{"date":"2026-08-05","time":"12:00","user":"Aleksandar","action":"Status changed: QUOTATION → CANCELLED"}]},
      {"id":108,"no":"P-26-0008","customerId":6,"customer":"Malmö Livs","name":"Bearing Replacement","estimationId":null,"status":"approved","phase":"design","start":"2026-08-20","deadline":"2026-09-15","expectedCompletion":"2026-09-15","progress":0,"plannedHours":8,"usedHours":0,"responsible":"Aleksandar","workers":["Marko"],"machines":[],"materialStatus":"unchecked","bom":[],"tasks":[],"milestones":[],"customerRef":"ML-101","poNumber":"","description":"Bearing replacement on Slicer L-40, approved and awaiting scheduling.","notes":[],"types":["Repair"],"pm":"Aleksandar","workshop":"Marko","sales":"Aleksandar","createdDate":"2026-08-20","plannedStart":"","actualStart":"","plannedCompletion":"","actualCompletion":"","closedDate":"","quotedValue":14000,"estLabourHours":8,"estMaterialCost":900,"estPurchaseCost":0,"otherCostEst":0,"otherCostAct":0,"holdReason":"","holdComment":"","expectedResume":"","cancelReason":"","jobcards":[],"hours":[],"materials":[],"purchases":[],"documents":{},"activity":[{"date":"2026-08-20","time":"09:00","user":"Aleksandar","action":"Project Created"},{"date":"2026-08-22","time":"14:00","user":"Aleksandar","action":"Status changed: QUOTATION → APPROVED"}]},
      {"id":109,"no":"P-26-0009","customerId":3,"customer":"Schröder Nordic","name":"HMI Upgrade","estimationId":null,"status":"planned","phase":"design","start":"2026-08-28","deadline":"2026-09-18","expectedCompletion":"2026-09-15","progress":0,"plannedHours":18,"usedHours":0,"responsible":"Aleksandar","workers":["Marko","Elena"],"machines":[],"materialStatus":"unchecked","bom":[],"tasks":[],"milestones":[],"customerRef":"SN-Q-108","poNumber":"","description":"HMI panel upgrade, jobcards prepared, work not yet started.","notes":[],"types":["Electrical"],"pm":"Aleksandar","workshop":"Marko","sales":"Aleksandar","createdDate":"2026-08-10","plannedStart":"2026-08-28","actualStart":"","plannedCompletion":"2026-09-15","actualCompletion":"","closedDate":"","quotedValue":31000,"estLabourHours":18,"estMaterialCost":4200,"estPurchaseCost":0,"otherCostEst":0,"otherCostAct":0,"holdReason":"","holdComment":"","expectedResume":"","cancelReason":"","jobcards":[{"no":"JC-26-0030","desc":"HMI panel wiring","assigned":"Marko","status":"planned","est":12,"act":0,"progress":0,"estMaterial":2700},{"no":"JC-26-0031","desc":"Bracket fabrication","assigned":"Elena","status":"planned","est":6,"act":0,"progress":0,"estMaterial":1500}],"hours":[],"materials":[],"purchases":[],"documents":{},"activity":[{"date":"2026-08-10","time":"09:00","user":"Aleksandar","action":"Project Created"},{"date":"2026-08-24","time":"08:00","user":"Aleksandar","action":"Status changed: APPROVED → PLANNED"}]}
    ],
    equipment:[
      {id:'E-1001',equipmentId:'E-1001',name:'MIG/MAG Welding Machine',category:'Welding Machine',manufacturer:'ESAB',model:'Renegade VOLT',serial:'ESB-24105',assetNumber:'AS-1001',status:'Available',currentLocation:'Bay 1',homeLocation:'Welding bay',department:'Fabrication',responsiblePerson:'Marko K.',condition:'Good',criticality:'High',description:'Industrial MIG/MAG process machine used for sheet and tube fabrication.',purchaseDate:'2024-02-14',purchaseSupplier:'WeldSupply',purchasePrice:18200,warrantyExpiry:'2028-02-14',yearOfManufacture:2024,operatingHourMeter:2845,serviceInterval:250,qrCode:'EQ-1001-MIG',maintenanceDate:'2026-09-08',inspectionDate:'2026-09-12',certificationExpiry:'2026-11-20',calibrationDate:'2026-10-15',safetyWarnings:['Guard inspection due'],assignedProject:'P-2026-014',assignedJobcard:'JC-2026-0001',operator:'Marko K.',notes:'Demo equipment record; production safety controls require backend in real use.',activity:[],inspections:[],maintenance:[],certifications:[],calibrations:[],notesLog:[],usageHistory:[],downtimeRecords:[],currentAssignment:null,usageSessions:[],isRetired:false,retirementReason:'',creationDate:'2026-08-22',lastActivity:new Date().toISOString() },
      {id:'E-1002',equipmentId:'E-1002',name:'TIG Welding Machine',category:'Welding Machine',manufacturer:'Lincoln Electric',model:'Square Wave TIG 200',serial:'LIN-9124',assetNumber:'AS-1002',status:'In Use',currentLocation:'Bay 2',homeLocation:'Welding bay',department:'Fabrication',responsiblePerson:'Elena N.',condition:'Good',criticality:'High',description:'Precision TIG welding unit for stainless steel and aluminum work.',purchaseDate:'2023-09-05',purchaseSupplier:'WeldTech AB',purchasePrice:15400,warrantyExpiry:'2027-09-05',yearOfManufacture:2023,operatingHourMeter:2940,serviceInterval:200,qrCode:'EQ-1002-TIG',maintenanceDate:'2026-08-30',inspectionDate:'2026-08-27',certificationExpiry:'2026-10-18',calibrationDate:'2026-09-16',safetyWarnings:['Safety check required before use'],assignedProject:'P-2026-014',assignedJobcard:'JC-2026-0001',operator:'Elena N.',notes:'Future automated telemetry is a planned integration.',activity:[],inspections:[],maintenance:[],certifications:[],calibrations:[],notesLog:[],usageHistory:[],downtimeRecords:[],currentAssignment:null,usageSessions:[],isRetired:false,retirementReason:'',creationDate:'2026-08-15',lastActivity:new Date().toISOString() },
      {id:'E-1003',equipmentId:'E-1003',name:'Plasma Cutting Machine',category:'Cutting Equipment',manufacturer:'Hypertherm',model:'Powermax 125',serial:'HT-5531',assetNumber:'AS-1003',status:'Maintenance Due',currentLocation:'Cutting cell',homeLocation:'Cutting cell',department:'Fabrication',responsiblePerson:'Aleksandar C.',condition:'Fair',criticality:'High',description:'Manual plate cutting station used for fabrication and site support.',purchaseDate:'2021-05-20',purchaseSupplier:'CutEdge Nordic',purchasePrice:22200,warrantyExpiry:'2026-05-20',yearOfManufacture:2021,operatingHourMeter:4680,serviceInterval:180,qrCode:'EQ-1003-PLASMA',maintenanceDate:'2026-08-29',inspectionDate:'2026-09-02',certificationExpiry:'2026-12-14',calibrationDate:'2026-09-20',safetyWarnings:['Cutting nozzle due for replacement'],assignedProject:null,assignedJobcard:null,operator:'Marko K.',notes:'Demonstrates preventive maintenance planning.',activity:[],inspections:[],maintenance:[],certifications:[],calibrations:[],notesLog:[],usageHistory:[],downtimeRecords:[],currentAssignment:null,usageSessions:[],isRetired:false,retirementReason:'',creationDate:'2026-08-10',lastActivity:new Date().toISOString() },
      {id:'E-1004',equipmentId:'E-1004',name:'CNC Plasma Table',category:'CNC Machine',manufacturer:'Bodor',model:'CUT 1530',serial:'BOD-18961',assetNumber:'AS-1004',status:'Under Maintenance',currentLocation:'Machine shop',homeLocation:'Machine shop',department:'Production',responsiblePerson:'Aleksandar C.',condition:'Poor',criticality:'Critical',description:'CNC plasma cutting table with integrated nesting and cut quality checks.',purchaseDate:'2022-04-18',purchaseSupplier:'MachineWorks',purchasePrice:94500,warrantyExpiry:'2027-04-18',yearOfManufacture:2022,operatingHourMeter:8875,serviceInterval:300,qrCode:'EQ-1004-CNC',maintenanceDate:'2026-08-25',inspectionDate:'2026-08-28',certificationExpiry:'2026-09-10',calibrationDate:'2026-08-31',safetyWarnings:['Failed critical pre-use inspection requires repair before return to service'],assignedProject:null,assignedJobcard:null,operator:null,notes:'This record simulates a machine blocked by failed safety checks.',activity:[],inspections:[],maintenance:[],certifications:[],calibrations:[],notesLog:[],usageHistory:[],downtimeRecords:[],currentAssignment:null,usageSessions:[],isRetired:false,retirementReason:'',creationDate:'2026-08-08',lastActivity:new Date().toISOString() },
      {id:'E-1005',equipmentId:'E-1005',name:'Forklift',category:'Forklift',manufacturer:'Toyota',model:'7FBE18',serial:'TY-77110',assetNumber:'AS-1005',status:'Available',currentLocation:'Yard',homeLocation:'Yard',department:'Logistics',responsiblePerson:'Sven O.',condition:'Good',criticality:'Medium',description:'Counterbalance forklift used for loading and yard movements.',purchaseDate:'2020-08-11',purchaseSupplier:'LiftNord',purchasePrice:48000,warrantyExpiry:'2025-08-11',yearOfManufacture:2020,operatingHourMeter:5234,serviceInterval:240,qrCode:'EQ-1005-FORKLIFT',maintenanceDate:'2026-09-05',inspectionDate:'2026-09-18',certificationExpiry:'2026-10-28',calibrationDate:null, safetyWarnings:['Monthly inspection due'],assignedProject:'P-2026-014',assignedJobcard:'JC-2026-0002',operator:'Sven O.',notes:'Demo equipment for lifting equipment compliance.',activity:[],inspections:[],maintenance:[],certifications:[],calibrations:[],notesLog:[],usageHistory:[],downtimeRecords:[],currentAssignment:null,usageSessions:[],isRetired:false,retirementReason:'',creationDate:'2026-07-20',lastActivity:new Date().toISOString() },
      {id:'E-1006',equipmentId:'E-1006',name:'Air Compressor',category:'Compressor',manufacturer:'Atlas Copco',model:'GA 11',serial:'AT-1122',assetNumber:'AS-1006',status:'Out of Service',currentLocation:'Service bay',homeLocation:'Service bay',department:'Utilities',responsiblePerson:'Aleksandar C.',condition:'Poor',criticality:'High',description:'Workshop air compressor serving pneumatic tools and cleaning stations.',purchaseDate:'2019-11-09',purchaseSupplier:'Atlas Copco Sweden',purchasePrice:36000,warrantyExpiry:'2024-11-09',yearOfManufacture:2019,operatingHourMeter:11832,serviceInterval:200,qrCode:'EQ-1006-COMP',maintenanceDate:'2026-08-22',inspectionDate:'2026-08-20',certificationExpiry:'2026-09-09',calibrationDate:null,safetyWarnings:['Pressure check failed - blocked from service'],assignedProject:null,assignedJobcard:null,operator:null,notes:'Compressor is out of service pending a return-to-service inspection.',activity:[],inspections:[],maintenance:[],certifications:[],calibrations:[],notesLog:[],usageHistory:[],downtimeRecords:[],currentAssignment:null,usageSessions:[],isRetired:false,retirementReason:'',creationDate:'2026-07-10',lastActivity:new Date().toISOString() },
      {id:'E-1007',equipmentId:'E-1007',name:'Angle Grinder',category:'Power Tool',manufacturer:'Makita',model:'GA5040C',serial:'MK-4762',assetNumber:'AS-1007',status:'Available',currentLocation:'Tool crib',homeLocation:'Tool crib',department:'Workshop',responsiblePerson:'Marko K.',condition:'Good',criticality:'Medium',description:'Portable grinder for deburring and finishing operations.',purchaseDate:'2025-01-10',purchaseSupplier:'ToolPro',purchasePrice:4200,warrantyExpiry:'2029-01-10',yearOfManufacture:2025,operatingHourMeter:264,serviceInterval:60,qrCode:'EQ-1007-GRINDER',maintenanceDate:'2026-09-16',inspectionDate:'2026-09-25',certificationExpiry:'2026-12-12',calibrationDate:null,safetyWarnings:[],assignedProject:null,assignedJobcard:null,operator:'Marko K.',notes:'Demo tool for quick issue and return workflow.',activity:[],inspections:[],maintenance:[],certifications:[],calibrations:[],notesLog:[],usageHistory:[],downtimeRecords:[],currentAssignment:null,usageSessions:[],isRetired:false,retirementReason:'',creationDate:'2026-08-07',lastActivity:new Date().toISOString() },
      {id:'E-1008',equipmentId:'E-1008',name:'Vernier Caliper',category:'Measuring Instrument',manufacturer:'Mitutoyo',model:'CD-6" CS',serial:'MIT-60240',assetNumber:'AS-1008',status:'Inspection Required',currentLocation:'Quality lab',homeLocation:'Quality lab',department:'Quality',responsiblePerson:'Elena N.',condition:'Good',criticality:'Critical',description:'Precision measurement tool used for quality inspection and first-article check.',purchaseDate:'2022-05-09',purchaseSupplier:'Metrolab',purchasePrice:3200,warrantyExpiry:'2027-05-09',yearOfManufacture:2022,operatingHourMeter:0,serviceInterval:0,qrCode:'EQ-1008-CALIPER',maintenanceDate:'2026-09-01',inspectionDate:'2026-08-11',certificationExpiry:'2026-08-30',calibrationDate:'2026-08-12',safetyWarnings:['Calibration overdue. Quality inspection use blocked.'],assignedProject:null,assignedJobcard:null,operator:'Elena N.',notes:'Example of an overdue calibration that blocks inspection use.',activity:[],inspections:[],maintenance:[],certifications:[],calibrations:[],notesLog:[],usageHistory:[],downtimeRecords:[],currentAssignment:null,usageSessions:[],isRetired:false,retirementReason:'',creationDate:'2026-07-24',lastActivity:new Date().toISOString() },
      {id:'E-1009',equipmentId:'E-1009',name:'Gas Detector',category:'Safety Equipment',manufacturer:'Crowcon',model:'Gas-Pro',serial:'CRW-9012',assetNumber:'AS-1009',status:'Available',currentLocation:'Safety locker',homeLocation:'Safety locker',department:'Safety',responsiblePerson:'Sven O.',condition:'Good',criticality:'Critical',description:'Portable gas detector safety check instrument for confined spaces and welding areas.',purchaseDate:'2024-04-12',purchaseSupplier:'SafetyWorks',purchasePrice:7800,warrantyExpiry:'2027-04-12',yearOfManufacture:2024,operatingHourMeter:620,serviceInterval:90,qrCode:'EQ-1009-GAS',maintenanceDate:'2026-09-21',inspectionDate:'2026-09-04',certificationExpiry:'2026-09-11',calibrationDate:'2026-09-10',safetyWarnings:['Safety certificate expiring soon'],assignedProject:null,assignedJobcard:null,operator:'Sven O.',notes:'Demo safety equipment record for certification expiry logic.',activity:[],inspections:[],maintenance:[],certifications:[],calibrations:[],notesLog:[],usageHistory:[],downtimeRecords:[],currentAssignment:null,usageSessions:[],isRetired:false,retirementReason:'',creationDate:'2026-08-14',lastActivity:new Date().toISOString() },
      {id:'E-1010',equipmentId:'E-1010',name:'Overhead Lifting Equipment',category:'Lifting Equipment',manufacturer:'Demag',model:'Gantry 5T',serial:'DEM-9901',assetNumber:'AS-1010',status:'Quarantined',currentLocation:'Service bay',homeLocation:'Service bay',department:'Fabrication',responsiblePerson:'Aleksandar C.',condition:'Fair',criticality:'Critical',description:'Workshop gantry lifting assembly used for moving sheet packs and fabricated sections.',purchaseDate:'2018-06-11',purchaseSupplier:'LiftNord',purchasePrice:56200,warrantyExpiry:'2026-06-11',yearOfManufacture:2018,operatingHourMeter:9100,serviceInterval:180,qrCode:'EQ-1010-LIFT',maintenanceDate:'2026-08-27',inspectionDate:'2026-08-15',certificationExpiry:'2026-08-18',calibrationDate:null,safetyWarnings:['Failure on lifting inspection requires return-to-service review'],assignedProject:null,assignedJobcard:null,operator:null,notes:'This item demonstrates quarantine and blocking safety workflow.',activity:[],inspections:[],maintenance:[],certifications:[],calibrations:[],notesLog:[],usageHistory:[],downtimeRecords:[],currentAssignment:null,usageSessions:[],isRetired:false,retirementReason:'',creationDate:'2026-08-04',lastActivity:new Date().toISOString() }
    ],
    inventory:[
      {code:'SS-SHT-304-2.0',description:'Stainless sheet AISI 304',category:'Stainless Sheet',grade:'AISI 304',dimensions:'2.0 × 1250 × 2500 mm',unit:'EA',stock:68,reserved:24,location:'A1-01-02',minStock:20,reorderQty:40,avgCost:1840,lastPrice:1910,supplier:'SteelCo Pty Ltd',heat:'H240516-S534',certificate:'MTC_H240516-S534.pdf',status:'good'},
      {code:'MS-TUBE-25SQ-1.6',description:'Square tube 25×25×1.6 mm 6 m',category:'Mild Steel Tube',grade:'S235JR',dimensions:'25 × 25 × 1.6 mm · 6 m',unit:'EA',stock:120,reserved:30,location:'A2-03-01',minStock:30,reorderQty:60,avgCost:210,lastPrice:219,supplier:'Nordic Steel',heat:'B250814-41',certificate:'MTC_B250814-41.pdf',status:'good'},
      {code:'MS-TUBE-40SQ-2.0',description:'Square tube 40×40×2.0 mm 6 m',category:'Mild Steel Tube',grade:'S235JR',dimensions:'40 × 40 × 2.0 mm · 6 m',unit:'EA',stock:85,reserved:45,location:'A2-03-02',minStock:25,reorderQty:50,avgCost:318,lastPrice:329,supplier:'Nordic Steel',heat:'B250812-09',certificate:'MTC_B250812-09.pdf',status:'good'},
      {code:'ER70S-6-1.0',description:'Welding wire ER70S-6 1.0 mm 15 kg',category:'Welding Consumable',grade:'ER70S-6',dimensions:'1.0 mm · 15 kg',unit:'KG',stock:56,reserved:12,location:'B1-02-01',minStock:10,reorderQty:30,avgCost:465,lastPrice:482,supplier:'WeldSupply',heat:'L260801',certificate:'CERT_L260801.pdf',status:'good'},
      {code:'BOLT-HEX-M10X25',description:'Hex bolt M10 × 25 mm zinc',category:'Fasteners',grade:'8.8 Zn',dimensions:'M10 × 25 mm',unit:'EA',stock:920,reserved:110,location:'C1-04-01',minStock:200,reorderQty:500,avgCost:2.8,lastPrice:3.1,supplier:'FastenAll',heat:'L260822',certificate:null,status:'good'},
      {code:'GRD-DISC-4.5',description:'Grinding disc 115×4.5×22.2 mm',category:'Abrasives',grade:'A24R',dimensions:'115 × 4.5 × 22.2 mm',unit:'EA',stock:64,reserved:10,location:'D1-01-01',minStock:60,reorderQty:100,avgCost:18,lastPrice:19,supplier:'ToolPro',heat:'L260701',certificate:null,status:'low'}
    ],
    barcodeLinks:{'7350123456789':'SS-SHT-304-2.0','7350123456796':'MS-TUBE-25SQ-1.6','7350123456802':'MS-TUBE-40SQ-2.0'},
    movements:[
      {id:1,time:'2026-08-25T10:42:00',action:'ISSUED',code:'MS-TUBE-25SQ-1.6',qty:20,unit:'EA',from:'A2-03-01',to:'P-2026-014 / JC-1456',projectNo:'P-2026-014',jobcard:'JC-1456',user:'Aleksandar C.'},
      {id:2,time:'2026-08-25T09:18:00',action:'RECEIVED',code:'SS-SHT-304-2.0',qty:12,unit:'EA',from:'SteelCo Pty Ltd / PO-5567',to:'A1-01-02',projectNo:null,jobcard:null,user:'John Smith'}
    ],
    offcuts:[
      {id:1,code:'OFF-SS304-5-600X420',materialCode:'SS-SHT-304-2.0',description:'AISI 304 plate offcut',grade:'AISI 304',thickness:5,width:600,length:420,unit:'mm',location:'O1-01-01',status:'available',created:'2026-08-20',sourceProject:'P-2026-009'},
      {id:2,code:'OFF-TUBE-50-1450',materialCode:'MS-TUBE-40SQ-2.0',description:'Square tube offcut',grade:'S235JR',dimensions:'50×50×3',length:1450,unit:'mm',location:'O2-01-04',status:'available',created:'2026-08-24',sourceProject:'P-2026-014'}
    ],
    suppliers:[],stockCounts:[],hours:[],activity:[],
    jobcards:[
      {id:1,no:'JC-2026-0001',projectId:14,projectNo:'P-2026-014',customerId:1,customer:'MarineVent AB',
        title:'Ventilation Duct Fabrication',item:'Duct Section Assembly A',quantity:4,revision:0,drawingNo:'DWG-VD-014-A',
        workType:'fabrication',location:'workshop',priority:'high',responsible:'Aleksandar C.',workers:['Marko K.','Elena N.'],
        plannedStart:'2026-08-18',plannedCompletion:'2026-09-05',actualStart:'2026-08-18',actualCompletion:null,
        plannedHours:120,progress:55,status:'in-progress',materialReadiness:'partial',inspectionRequired:true,
        deliveryTarget:'2026-11-12',created:'2026-08-15',createdBy:'Aleksandar C.',archived:false,
        operations:[
          {id:1,no:1,desc:'Material preparation',instructions:'Check heat numbers against MTC before cutting.',worker:'Marko K.',machine:'Laser',plannedHours:8,loggedHours:8,plannedStart:'2026-08-18',actualStart:'2026-08-18',actualCompletion:'2026-08-18',status:'completed',dependency:null,inspectionCheckpoint:false,notes:'',attachments:''},
          {id:2,no:2,desc:'Measuring and marking',instructions:'Mark cut lines per DWG-VD-014-A rev A.',worker:'Marko K.',machine:'',plannedHours:6,loggedHours:6,plannedStart:'2026-08-18',actualStart:'2026-08-18',actualCompletion:'2026-08-19',status:'completed',dependency:1,inspectionCheckpoint:false,notes:'',attachments:''},
          {id:3,no:3,desc:'Cutting',instructions:'Laser cut sheet sections, verify kerf allowance.',worker:'Marko K.',machine:'Laser',plannedHours:16,loggedHours:18,plannedStart:'2026-08-19',actualStart:'2026-08-19',actualCompletion:'2026-08-21',status:'completed',dependency:2,inspectionCheckpoint:false,notes:'Ran 2h over due to laser lens change.',attachments:''},
          {id:4,no:4,desc:'Fit-up',instructions:'Tack sections per drawing, check squareness before welding.',worker:'Elena N.',machine:'',plannedHours:20,loggedHours:14,plannedStart:'2026-08-22',actualStart:'2026-08-22',actualCompletion:null,status:'in-progress',dependency:3,inspectionCheckpoint:false,notes:'',attachments:''},
          {id:5,no:5,desc:'Welding',instructions:'TIG weld per WPS-304-02, stainless filler only.',worker:'Elena N.',machine:'TIG Station 1',plannedHours:40,loggedHours:0,plannedStart:'2026-08-27',actualStart:null,actualCompletion:null,status:'pending',dependency:4,inspectionCheckpoint:false,notes:'',attachments:''},
          {id:6,no:6,desc:'Grinding',instructions:'Grind and finish welds, break sharp edges.',worker:'',machine:'',plannedHours:12,loggedHours:0,plannedStart:'2026-08-29',actualStart:null,actualCompletion:null,status:'pending',dependency:5,inspectionCheckpoint:false,notes:'',attachments:''},
          {id:7,no:7,desc:'Final inspection',instructions:'Dimensional and visual weld check before packing.',worker:'Aleksandar C.',machine:'',plannedHours:4,loggedHours:0,plannedStart:'2026-09-02',actualStart:null,actualCompletion:null,status:'pending',dependency:6,inspectionCheckpoint:true,notes:'',attachments:''},
          {id:8,no:8,desc:'Packing',instructions:'Pack for delivery, protect welded edges.',worker:'',machine:'',plannedHours:4,loggedHours:0,plannedStart:'2026-09-04',actualStart:null,actualCompletion:null,status:'pending',dependency:7,inspectionCheckpoint:false,notes:'',attachments:''}
        ],
        materials:[
          {code:'SS-SHT-304-2.0',description:'AISI 304 sheet 2 mm',spec:'AISI 304',grade:'AISI 304',dimension:'2.0 × 1250 × 2500 mm',required:8,reserved:8,issued:4,unit:'EA',location:'A1-01-02',heat:'H240516-S534',certificate:'MTC_H240516-S534.pdf',status:'partial'},
          {code:'MS-TUBE-40SQ-2.0',description:'Square tube 40x40x2 mm',spec:'S235JR',grade:'S235JR',dimension:'40 × 40 × 2.0 mm · 6 m',required:36,reserved:30,issued:12,unit:'EA',location:'A2-03-02',heat:'B250812-09',certificate:'MTC_B250812-09.pdf',status:'partial'},
          {code:'ER70S-6-1.0',description:'Welding wire ER70S-6',spec:'ER70S-6',grade:'ER70S-6',dimension:'1.0 mm · 15 kg',required:45,reserved:12,issued:10,unit:'KG',location:'B1-02-01',heat:'L260801',certificate:'CERT_L260801.pdf',status:'shortage'},
          {code:'BOLT-HEX-M10X25',description:'Hex bolts M10x25',spec:'8.8 Zn',grade:'8.8 Zn',dimension:'M10 × 25 mm',required:40,reserved:40,issued:40,unit:'EA',location:'C1-04-01',heat:'L260822',certificate:null,status:'issued'}
        ],
        machines:[
          {name:'Laser',assigned:true,status:'available',plannedUsage:16,actualUsage:18,operator:'Marko K.',preUseCheck:'passed',maintenanceWarning:false},
          {name:'Press Brake',assigned:true,status:'available',plannedUsage:8,actualUsage:0,operator:'',preUseCheck:'pending',maintenanceWarning:false},
          {name:'TIG Station 1',assigned:true,status:'reserved',plannedUsage:40,actualUsage:0,operator:'Elena N.',preUseCheck:'pending',maintenanceWarning:false}
        ],
        inspections:[
          {id:1,type:'material-cert',inspector:'Aleksandar C.',requirement:'required',status:'passed',date:'2026-08-18',result:'passed',comments:'MTC 3.1 verified against heat H240516-S534.',relatedOperation:1,reference:'MTC_H240516-S534.pdf'},
          {id:2,type:'dimensional',inspector:'Aleksandar C.',requirement:'required',status:'pending',date:null,result:'pending',comments:'',relatedOperation:7,reference:''},
          {id:3,type:'visual-weld',inspector:'Aleksandar C.',requirement:'required',status:'pending',date:null,result:'pending',comments:'',relatedOperation:7,reference:''},
          {id:4,type:'drawing-revision',inspector:'Aleksandar C.',requirement:'required',status:'passed',date:'2026-08-15',result:'passed',comments:'Confirmed DWG-VD-014-A rev A is current.',relatedOperation:null,reference:'DWG-VD-014-A'}
        ],
        notes:[
          {id:1,date:'2026-08-21',time:'14:20',author:'Marko K.',type:'worker',text:'Laser lens changed mid-run, cutting took longer than planned.'},
          {id:2,date:'2026-08-22',time:'08:05',author:'Aleksandar C.',type:'supervisor',text:'Prioritise fit-up on section A before starting section B.'}
        ],
        documents:[{name:'DWG-VD-014-A.pdf',type:'pdf',date:'2026-08-14'},{name:'WPS-304-02.pdf',type:'pdf',date:'2026-08-14'}],
        activity:[
          {date:'2026-08-15',time:'09:00',action:'Jobcard created (Draft)',by:'Aleksandar C.'},
          {date:'2026-08-15',time:'09:10',action:'Status changed to Released',by:'Aleksandar C.'},
          {date:'2026-08-16',time:'10:00',action:'Status changed to Ready',by:'Aleksandar C.'},
          {date:'2026-08-18',time:'07:30',action:'Status changed to In Progress',by:'Aleksandar C.'},
          {date:'2026-08-18',time:'07:31',action:'Worker assigned: Marko K.',by:'Aleksandar C.'},
          {date:'2026-08-22',time:'08:00',action:'Worker assigned: Elena N.',by:'Aleksandar C.'}
        ]},
      {id:2,no:'JC-2026-0002',projectId:14,projectNo:'P-2026-014',customerId:1,customer:'MarineVent AB',
        title:'Ventilation Duct Installation',item:'Duct Section Assembly A',quantity:4,revision:0,drawingNo:'DWG-VD-014-A',
        workType:'installation',location:'site',priority:'medium',responsible:'Aleksandar C.',workers:[],
        plannedStart:'2026-09-06',plannedCompletion:'2026-09-11',actualStart:null,actualCompletion:null,
        plannedHours:40,progress:0,status:'ready',materialReadiness:'not-checked',inspectionRequired:true,
        deliveryTarget:'2026-11-12',created:'2026-08-15',createdBy:'Aleksandar C.',archived:false,
        operations:[
          {id:1,no:1,desc:'Delivery to site',instructions:'Load and transport, protect finished welds.',worker:'',machine:'',plannedHours:8,loggedHours:0,plannedStart:'2026-09-06',actualStart:null,actualCompletion:null,status:'pending',dependency:null,inspectionCheckpoint:false,notes:'',attachments:''},
          {id:2,no:2,desc:'Installation',instructions:'Install per site drawing, torque bolts to spec.',worker:'',machine:'',plannedHours:24,loggedHours:0,plannedStart:'2026-09-07',actualStart:null,actualCompletion:null,status:'pending',dependency:1,inspectionCheckpoint:false,notes:'',attachments:''},
          {id:3,no:3,desc:'Final inspection',instructions:'Customer walk-through and sign-off.',worker:'',machine:'',plannedHours:8,loggedHours:0,plannedStart:'2026-09-11',actualStart:null,actualCompletion:null,status:'pending',dependency:2,inspectionCheckpoint:true,notes:'',attachments:''}
        ],
        materials:[],
        machines:[],
        inspections:[
          {id:1,type:'final',inspector:'Aleksandar C.',requirement:'required',status:'pending',date:null,result:'pending',comments:'',relatedOperation:3,reference:''},
          {id:2,type:'customer',inspector:'',requirement:'required',status:'pending',date:null,result:'pending',comments:'',relatedOperation:3,reference:''}
        ],
        notes:[],
        documents:[{name:'DWG-VD-014-A.pdf',type:'pdf',date:'2026-08-14'}],
        activity:[
          {date:'2026-08-15',time:'09:05',action:'Jobcard created (Draft)',by:'Aleksandar C.'},
          {date:'2026-08-16',time:'10:05',action:'Status changed to Released',by:'Aleksandar C.'},
          {date:'2026-08-16',time:'10:06',action:'Status changed to Ready',by:'Aleksandar C.'}
        ]}
    ],
    qualityInspections:[
      {id:1,no:'INS-2026-001',projectNo:'P-2026-014',customer:'MarineVent AB',jobcard:null,operation:null,component:'SS-SHT-304-2.0 batch H240516-S534',drawingNo:'',drawingRev:'',type:'incoming-material',method:'Visual + Documentation Check',plannedDate:'2026-08-18',actualDate:'2026-08-18',inspector:'Aleksandar C.',customerWitness:false,acceptanceCriteria:'EN 10204 3.1 certificate matches heat number; no visible transport damage',result:'passed',status:'completed',findings:'Certificate verified against heat H240516-S534. No damage observed.',correctiveActionRef:null,ncrRef:null,reinspectionOf:null,documents:['MTC_H240516-S534.pdf'],createdBy:'Aleksandar C.',created:'2026-08-18',modified:'2026-08-18',checklist:[{item:'Certificate present and matches heat number',resultItem:'pass'},{item:'Visual condition of delivered sheet',resultItem:'pass'}],notes:[],activity:[{timestamp:'2026-08-18T09:00:00',action:'Inspection completed',user:'Aleksandar C.',from:'in-progress',to:'completed',reference:'INS-2026-001',reason:''}]},
      {id:2,no:'INS-2026-002',projectNo:'P-2026-014',customer:'MarineVent AB',jobcard:'JC-2026-0001',operation:'Cutting',component:'Duct Section Assembly A',drawingNo:'DWG-VD-014-A',drawingRev:'A',type:'dimensional',method:'Callipers / Tape Measure',plannedDate:'2026-08-21',actualDate:'2026-08-21',inspector:'Aleksandar C.',customerWitness:false,acceptanceCriteria:'±1.5 mm per DWG-VD-014-A',result:'passed-observations',status:'completed',findings:'Kerf allowance measured 1.2 mm above nominal on panel 3, within tolerance but noted for laser lens follow-up.',correctiveActionRef:null,ncrRef:null,reinspectionOf:null,documents:[],createdBy:'Aleksandar C.',created:'2026-08-21',modified:'2026-08-21',
        checklist:[{item:'Panel length',resultItem:'measurement',nominal:1250,lower:-1.5,upper:1.5,actual:1250.9},{item:'Panel width',resultItem:'measurement',nominal:600,lower:-1.5,upper:1.5,actual:599.4},{item:'Squareness',resultItem:'pass'}],
        notes:[],activity:[{timestamp:'2026-08-21T10:00:00',action:'Inspection completed',user:'Aleksandar C.',from:'in-progress',to:'completed',reference:'INS-2026-002',reason:''}]},
      {id:3,no:'INS-2026-003',projectNo:'P-2026-014',customer:'MarineVent AB',jobcard:'JC-2026-0001',operation:'Fit-up',component:'Duct Section Assembly A',drawingNo:'DWG-VD-014-A',drawingRev:'A',type:'fitup',method:'Visual + Gap Gauge',plannedDate:'2026-08-29',actualDate:null,inspector:'Aleksandar C.',customerWitness:false,acceptanceCriteria:'Root gap 1.5-3.0 mm per WPS-304-02',result:'pending',status:'ready',findings:'',correctiveActionRef:null,ncrRef:null,reinspectionOf:null,documents:[],createdBy:'Aleksandar C.',created:'2026-08-22',modified:'2026-08-22',checklist:[{item:'Root gap within tolerance',resultItem:''},{item:'Alignment / squareness',resultItem:''}],notes:[],activity:[{timestamp:'2026-08-22T08:00:00',action:'Inspection requested',user:'Aleksandar C.',from:'draft',to:'ready',reference:'INS-2026-003',reason:''}]},
      {id:4,no:'INS-2026-004',projectNo:'P-2026-014',customer:'MarineVent AB',jobcard:'JC-2026-0001',operation:'Welding',component:'Duct Section Assembly A — Weld W-03',drawingNo:'DWG-VD-014-A',drawingRev:'A',type:'welding',method:'Visual Weld Inspection (AWS D1.6 / EN ISO 5817)',plannedDate:'2026-08-27',actualDate:'2026-08-27',inspector:'Aleksandar C.',customerWitness:true,acceptanceCriteria:'EN ISO 5817 level C, WPS-304-02',result:'failed',status:'completed',critical:true,findings:'Undercut depth 0.6 mm exceeds EN ISO 5817 level C limit (0.5 mm) on weld run 3, length 40 mm.',correctiveActionRef:'CAPA-2026-001',ncrRef:'NCR-2026-001',reinspectionOf:null,documents:[],createdBy:'Aleksandar C.',created:'2026-08-27',modified:'2026-08-27',
        checklist:[{item:'Undercut',resultItem:'fail',comment:'0.6 mm depth, 40 mm length on run 3'},{item:'Porosity',resultItem:'pass'},{item:'Weld profile',resultItem:'pass'}],
        notes:[],activity:[{timestamp:'2026-08-27T14:00:00',action:'Inspection failed',user:'Aleksandar C.',from:'in-progress',to:'completed',reference:'INS-2026-004',reason:'Undercut exceeds acceptance criteria'}]},
      {id:5,no:'INS-2026-005',projectNo:'P-2026-014',customer:'MarineVent AB',jobcard:'JC-2026-0001',operation:'Welding',component:'Duct Section Assembly A — Weld W-03 (repair)',drawingNo:'DWG-VD-014-A',drawingRev:'A',type:'welding',method:'Visual Weld Inspection (AWS D1.6 / EN ISO 5817)',plannedDate:'2026-09-03',actualDate:null,inspector:'Aleksandar C.',customerWitness:true,acceptanceCriteria:'EN ISO 5817 level C, WPS-304-02',result:'pending',status:'planned',findings:'',correctiveActionRef:'CAPA-2026-001',ncrRef:'NCR-2026-001',reinspectionOf:'INS-2026-004',documents:[],createdBy:'Aleksandar C.',created:'2026-08-27',modified:'2026-08-27',checklist:[{item:'Undercut (repair check)',resultItem:''},{item:'Porosity',resultItem:''}],notes:[],activity:[{timestamp:'2026-08-27T14:05:00',action:'Reinspection created',user:'Aleksandar C.',from:null,to:'planned',reference:'INS-2026-005',reason:'Reinspection of INS-2026-004'}]},
      {id:6,no:'INS-2026-006',projectNo:'P-2026-014',customer:'MarineVent AB',jobcard:'JC-2026-0002',operation:'Final inspection',component:'Duct Section Assembly A — Installation',drawingNo:'DWG-VD-014-A',drawingRev:'A',type:'final',method:'Visual + Functional Check',plannedDate:'2026-09-11',actualDate:null,inspector:'',customerWitness:true,acceptanceCriteria:'Customer walk-through per ITP-2026-001',result:'pending',status:'requested',findings:'',correctiveActionRef:null,ncrRef:null,reinspectionOf:null,documents:[],createdBy:'Aleksandar C.',created:'2026-08-16',modified:'2026-08-16',checklist:[{item:'Installation alignment',resultItem:''},{item:'Customer sign-off',resultItem:''}],notes:[],activity:[{timestamp:'2026-08-16T10:00:00',action:'Inspection requested',user:'Aleksandar C.',from:null,to:'requested',reference:'INS-2026-006',reason:''}]}
    ],
    qualityWelds:[
      {id:1,no:'WLD-2026-001',projectNo:'P-2026-014',jobcard:'JC-2026-0001',operation:'Welding',component:'Duct Section Assembly A',drawingNo:'DWG-VD-014-A',weldMapPosition:'W-03',jointType:'Butt',baseMaterial:'AISI 304',materialGrade:'AISI 304',thickness:2.0,process:'TIG',wpsNo:'WPS-304-02',wpqrRef:'WPQR-304-02-R1',welder:'Elena N.',welderQualRef:'WPQ-EN-2024-11',fillerMaterial:'ER308L',consumableBatch:'L260801',shieldingGas:'Argon 99.99%',preheatRequired:false,interpassTempReq:'≤150°C',weldDate:'2026-08-27',visualRequired:true,ndtRequired:true,ndtMethod:'PT',repairHistory:[{date:'2026-08-27',reason:'Undercut on run 3',by:'Elena N.'}],finalResult:'pending',status:'repair-required',notes:[],activity:[{timestamp:'2026-08-27T14:00:00',action:'Status changed',user:'Aleksandar C.',from:'awaiting-visual',to:'repair-required',reference:'WLD-2026-001',reason:'Failed visual inspection INS-2026-004'}]},
      {id:2,no:'WLD-2026-002',projectNo:'P-2026-014',jobcard:'JC-2026-0001',operation:'Welding',component:'Duct Section Assembly A',drawingNo:'DWG-VD-014-A',weldMapPosition:'W-01',jointType:'Butt',baseMaterial:'AISI 304',materialGrade:'AISI 304',thickness:2.0,process:'TIG',wpsNo:'WPS-304-02',wpqrRef:'WPQR-304-02-R1',welder:'Elena N.',welderQualRef:'WPQ-EN-2024-11',fillerMaterial:'ER308L',consumableBatch:'L260801',shieldingGas:'Argon 99.99%',preheatRequired:false,interpassTempReq:'≤150°C',weldDate:'2026-08-24',visualRequired:true,ndtRequired:true,ndtMethod:'PT',repairHistory:[],finalResult:'accepted',status:'accepted',notes:[],activity:[{timestamp:'2026-08-25T09:00:00',action:'Status changed',user:'Aleksandar C.',from:'awaiting-ndt',to:'accepted',reference:'WLD-2026-002',reason:'PT accepted (NDT-2026-001)'}]}
    ],
    qualityNdt:[
      {id:1,no:'NDT-2026-001',projectNo:'P-2026-014',jobcard:'JC-2026-0001',weldRef:'WLD-2026-002',drawingNo:'DWG-VD-014-A',method:'PT',procedureRef:'EN ISO 3452-1',inspectionPercent:100,inspectionArea:'Full weld length W-01',technician:'Aleksandar C.',externalCompany:'',technicianCertRef:'PCN-AC-2025-02',inspectionDate:'2026-08-25',acceptanceCriteria:'EN ISO 23277 level 2',result:'accepted',findings:'No relevant indications.',repairRequired:false,reinspectionRequired:false,ncrRef:null,documents:[],status:'accepted',notes:[],activity:[{timestamp:'2026-08-25T09:00:00',action:'NDT completed',user:'Aleksandar C.',from:'in-progress',to:'accepted',reference:'NDT-2026-001',reason:''}]},
      {id:2,no:'NDT-2026-002',projectNo:'P-2026-014',jobcard:'JC-2026-0001',weldRef:'WLD-2026-001',drawingNo:'DWG-VD-014-A',method:'PT',procedureRef:'EN ISO 3452-1',inspectionPercent:100,inspectionArea:'Full weld length W-03',technician:'Aleksandar C.',externalCompany:'',technicianCertRef:'PCN-AC-2025-02',inspectionDate:'2026-08-27',acceptanceCriteria:'EN ISO 23277 level 2',result:'rejected',findings:'Linear indication, length 8 mm, mid-length of weld run 3 — exceeds acceptance level.',repairRequired:true,reinspectionRequired:true,ncrRef:'NCR-2026-002',documents:[],status:'rejected',notes:[],activity:[{timestamp:'2026-08-27T15:00:00',action:'NDT rejected',user:'Aleksandar C.',from:'in-progress',to:'rejected',reference:'NDT-2026-002',reason:'Linear indication exceeds acceptance level'}]}
    ],
    qualityNcrs:[
      {id:1,no:'NCR-2026-001',title:'Undercut on weld W-03 exceeds EN ISO 5817 level C',projectNo:'P-2026-014',customer:'MarineVent AB',jobcard:'JC-2026-0001',operation:'Welding',component:'Duct Section Assembly A — Weld W-03',supplier:null,material:null,relatedInspection:'INS-2026-004',relatedWeld:'WLD-2026-001',description:'Visual weld inspection found undercut depth 0.6 mm over 40 mm length on weld run 3, exceeding the WPS-304-02 / EN ISO 5817 level C acceptance criteria.',category:'welding',severity:'major',detectedBy:'Aleksandar C.',detectionDate:'2026-08-27',containment:'Weld W-03 flagged, jobcard operation held pending repair.',disposition:'repair',rootCause:'Interpass temperature drifted above WPS limit during run 3, reducing fusion control.',correction:'Grind out undercut and re-weld run 3 per WPS-304-02.',correctiveActionRef:'CAPA-2026-001',preventiveAction:'Refresher briefing for welder on interpass temperature monitoring.',responsiblePerson:'Aleksandar C.',dueDate:'2026-09-05',verificationMethod:'Reinspection INS-2026-005 + PT reinspection',verificationResult:'',closureApproval:'',costImpact:1800,reworkHours:3,documents:[],status:'corrective-action',
        activity:[
          {timestamp:'2026-08-27T14:10:00',action:'NCR created',user:'Aleksandar C.',from:null,to:'open',reference:'NCR-2026-001',reason:'Failed inspection INS-2026-004'},
          {timestamp:'2026-08-27T14:30:00',action:'Disposition recorded',user:'Aleksandar C.',from:'open',to:'disposition-required',reference:'NCR-2026-001',reason:'Repair selected'},
          {timestamp:'2026-08-27T15:00:00',action:'Corrective action assigned',user:'Aleksandar C.',from:'disposition-required',to:'corrective-action',reference:'NCR-2026-001',reason:'CAPA-2026-001 assigned'}
        ],notes:[]},
      {id:2,no:'NCR-2026-002',title:'PT indication rejected on weld W-03',projectNo:'P-2026-014',customer:'MarineVent AB',jobcard:'JC-2026-0001',operation:'Welding',component:'Duct Section Assembly A — Weld W-03',supplier:null,material:null,relatedInspection:null,relatedWeld:'WLD-2026-001',relatedNdt:'NDT-2026-002',description:'Penetrant testing found a linear indication (8 mm) mid-length on weld run 3, exceeding EN ISO 23277 level 2 acceptance. Possible subsurface continuation cannot be excluded from PT alone.',category:'welding',severity:'critical',detectedBy:'Aleksandar C.',detectionDate:'2026-08-27',containment:'Weld W-03 and jobcard JC-2026-0001 placed on Quality Hold pending repair and reinspection.',disposition:'repair',rootCause:'',correction:'',correctiveActionRef:'CAPA-2026-002',preventiveAction:'',responsiblePerson:'Aleksandar C.',dueDate:'2026-09-05',verificationMethod:'',verificationResult:'',closureApproval:'',costImpact:0,reworkHours:0,documents:[],status:'containment-required',
        activity:[{timestamp:'2026-08-27T15:10:00',action:'NCR created',user:'Aleksandar C.',from:null,to:'open',reference:'NCR-2026-002',reason:'Rejected NDT NDT-2026-002'},
          {timestamp:'2026-08-27T15:15:00',action:'Quality Hold applied',user:'Aleksandar C.',from:'open',to:'containment-required',reference:'HOLD-2026-001',reason:'Critical NCR — rejected mandatory NDT'}
        ],notes:[]},
      {id:3,no:'NCR-2026-003',title:'Missing EN 10204 3.1 certificate — hex bolts M10x25',projectNo:'P-2026-014',customer:'MarineVent AB',jobcard:'JC-2026-0001',operation:null,component:'BOLT-HEX-M10X25 batch L260822',supplier:'FastenAll',material:'BOLT-HEX-M10X25',relatedInspection:null,relatedWeld:null,description:'Fasteners issued to jobcard JC-2026-0001 do not have a recorded EN 10204 3.1 certificate. Traceability chain is incomplete for this batch.',category:'traceability',severity:'major',detectedBy:'Aleksandar C.',detectionDate:'2026-08-22',containment:'Batch flagged in Store; further issue from this batch paused pending certificate.',disposition:'pending',rootCause:'',correction:'',correctiveActionRef:null,preventiveAction:'',responsiblePerson:'',dueDate:'',verificationMethod:'',verificationResult:'',closureApproval:'',costImpact:0,reworkHours:0,documents:[],status:'disposition-required',
        activity:[{timestamp:'2026-08-22T09:00:00',action:'NCR created',user:'Aleksandar C.',from:null,to:'open',reference:'NCR-2026-003',reason:'Missing material certificate'}],notes:[]}
    ],
    qualityCapas:[
      {id:1,no:'CAPA-2026-001',relatedRef:'NCR-2026-001',problemStatement:'Undercut on weld W-03 exceeds acceptance criteria.',immediateCorrection:'Grind out and re-weld run 3.',rootCause:'Interpass temperature drifted above WPS-304-02 limit.',correctiveAction:'Refresher briefing on interpass temperature monitoring for TIG welders.',preventiveAction:'Add interpass-temperature checkpoint to fit-up/weld checklist.',responsiblePerson:'Aleksandar C.',startDate:'2026-08-27',dueDate:'2026-09-05',completionDate:'',evidence:'',effectivenessCheck:'',verifiedBy:'',verificationDate:'',status:'waiting-verification',fiveWhys:['Undercut formed on run 3','Interpass temperature exceeded WPS limit','Welder did not check temperature between passes','No checkpoint requires a temperature check','Checklist does not include interpass temperature step'],fishbone:{method:'No interpass-temperature checkpoint in weld checklist',people:'Welder time pressure on multi-pass run'},notes:[],activity:[{timestamp:'2026-08-27T15:00:00',action:'Corrective action assigned',user:'Aleksandar C.',from:null,to:'in-progress',reference:'CAPA-2026-001',reason:''}]},
      {id:2,no:'CAPA-2026-002',relatedRef:'NCR-2026-002',problemStatement:'PT indication rejected on weld W-03.',immediateCorrection:'Weld placed on Quality Hold pending repair.',rootCause:'',correctiveAction:'Repair weld and re-test by PT after root cause of undercut is corrected.',preventiveAction:'',responsiblePerson:'Aleksandar C.',startDate:'2026-08-27',dueDate:'2026-09-05',completionDate:'',evidence:'',effectivenessCheck:'',verifiedBy:'',verificationDate:'',status:'open',fiveWhys:[],fishbone:{},notes:[],activity:[{timestamp:'2026-08-27T15:15:00',action:'Corrective action assigned',user:'Aleksandar C.',from:null,to:'open',reference:'CAPA-2026-002',reason:''}]}
    ],
    qualityHolds:[
      {id:1,no:'HOLD-2026-001',scope:'jobcard',reference:'JC-2026-0001',relatedRef:'NCR-2026-002',reason:'Critical NCR NCR-2026-002 — rejected mandatory NDT (NDT-2026-002) on weld W-03.',appliedBy:'Aleksandar C.',appliedDate:'2026-08-27T15:15:00',severity:'critical',requiredAction:'Repair weld W-03, obtain accepted PT reinspection, verify NCR-2026-002 corrective action.',releaseAuthority:'',releaseDate:'',releaseReason:'',status:'active',activity:[{timestamp:'2026-08-27T15:15:00',action:'Quality Hold applied',user:'Aleksandar C.',from:null,to:'active',reference:'HOLD-2026-001',reason:'Critical NCR NCR-2026-002'}]}
    ],
    qualityWps:[
      {id:1,no:'WPS-304-02',revision:1,process:'TIG',materialGroup:'Stainless Steel (Group 8)',thicknessRange:'1.5–6.0 mm',diameterRange:'N/A',jointType:'Butt',position:'All positions (1G-4G)',fillerMaterial:'ER308L',shieldingGas:'Argon 99.99%',preheatInterpass:'No preheat; interpass ≤150°C',supportingWpqr:'WPQR-304-02-R1',status:'valid',documentRef:'WPS-304-02.pdf'}
    ],
    qualityWelderQuals:[
      {id:1,welder:'Elena N.',qualNo:'WPQ-EN-2024-11',process:'TIG',materialGroup:'Stainless Steel (Group 8)',thicknessRange:'1.5–8 mm',position:'All positions',issuedBy:'Nordic Weld Cert AB',issueDate:'2024-09-10',expiryDate:'2026-09-10',status:'expiring-soon',documentRef:'WPQ-EN-2024-11.pdf'},
      {id:2,welder:'Marko K.',qualNo:'WPQ-MK-2023-05',process:'MAG',materialGroup:'Mild Steel (Group 1)',thicknessRange:'3–20 mm',position:'All positions',issuedBy:'Nordic Weld Cert AB',issueDate:'2023-05-14',expiryDate:'2027-05-14',status:'valid',documentRef:'WPQ-MK-2023-05.pdf'}
    ],
    qualityComplaints:[
      {id:1,no:'CMP-2026-001',customer:'MarineVent AB',projectNo:'P-2026-014',deliveredItem:'Ventilation duct section (prior delivery)',deliveryDate:'2026-06-02',complaintDate:'2026-08-20',description:'Customer reports coating damage on one duct section on arrival at site.',severity:'major',warrantyStatus:'Under warranty',immediateResponse:'Acknowledged receipt, requested photos from customer.',investigation:'Reviewing transport packaging and pre-dispatch inspection records.',rootCause:'',correction:'',correctiveActionRef:null,costImpact:0,customerResponse:'',responsiblePerson:'Aleksandar C.',dueDate:'2026-09-03',closureConfirmation:'',documents:[],status:'under-investigation',activity:[{timestamp:'2026-08-20T11:00:00',action:'Complaint received',user:'Aleksandar C.',from:null,to:'received',reference:'CMP-2026-001',reason:''},{timestamp:'2026-08-20T13:00:00',action:'Status changed',user:'Aleksandar C.',from:'received',to:'under-investigation',reference:'CMP-2026-001',reason:''}],notes:[]}
    ],
    qualityDossiers:[
      {id:1,no:'DOS-2026-001',projectNo:'P-2026-014',revision:0,items:[
        {name:'Approved drawings',required:true,status:'approved',reference:'DWG-VD-014-A rev A'},
        {name:'Material certificates',required:true,status:'missing',reference:'Missing 3.1 cert — BOLT-HEX-M10X25 (NCR-2026-003)'},
        {name:'WPS',required:true,status:'available',reference:'WPS-304-02'},
        {name:'WPQR/PQR',required:true,status:'available',reference:'WPQR-304-02-R1'},
        {name:'Welder qualifications',required:true,status:'awaiting-approval',reference:'WPQ-EN-2024-11 expiring soon'},
        {name:'Weld map',required:true,status:'available',reference:'DWG-VD-014-A weld map'},
        {name:'Visual inspection reports',required:true,status:'available',reference:'INS-2026-002, INS-2026-004'},
        {name:'NDT reports',required:true,status:'rejected',reference:'NDT-2026-002 rejected — pending reinspection'},
        {name:'NCR summary',required:true,status:'available',reference:'NCR-2026-001, NCR-2026-002, NCR-2026-003 open'},
        {name:'Final inspection',required:true,status:'missing',reference:'INS-2026-006 not yet completed'},
        {name:'Final release certificate',required:true,status:'missing',reference:'Not issued'}
      ],notes:[],activity:[{timestamp:'2026-08-16T09:00:00',action:'Dossier created',user:'Aleksandar C.',from:null,to:'in-progress',reference:'DOS-2026-001',reason:''}]}
    ],
    qualityItps:[
      {id:1,no:'ITP-2026-001',projectNo:'P-2026-014',customer:'MarineVent AB',revision:0,preparedBy:'Aleksandar C.',reviewedBy:'',approvalRef:'',status:'active',effectiveDate:'2026-08-15',
        lines:[
          {seq:1,phase:'Receiving',jobcard:null,operation:'Incoming material inspection',activity:'Verify material certificate and visual condition',acceptanceCriteria:'EN 10204 3.1 matches heat number',procedureRef:'Store SOP',responsible:'Aleksandar C.',requiredRecord:'INS-2026-001',pointType:'R',customerInvolvement:'Not required',plannedDate:'2026-08-18',actualDate:'2026-08-18',result:'passed',status:'resolved',comments:''},
          {seq:2,phase:'Fabrication',jobcard:'JC-2026-0001',operation:'Fit-up',activity:'Fit-up dimensional and gap check',acceptanceCriteria:'Root gap 1.5–3.0 mm',procedureRef:'WPS-304-02',responsible:'Aleksandar C.',requiredRecord:'INS-2026-003',pointType:'H',customerInvolvement:'Notify customer 24h in advance',plannedDate:'2026-08-29',actualDate:'',result:'pending',status:'open',comments:''},
          {seq:3,phase:'Fabrication',jobcard:'JC-2026-0001',operation:'Welding',activity:'Visual weld inspection',acceptanceCriteria:'EN ISO 5817 level C',procedureRef:'WPS-304-02',responsible:'Aleksandar C.',requiredRecord:'INS-2026-004',pointType:'H',customerInvolvement:'Customer witnessed',plannedDate:'2026-08-27',actualDate:'2026-08-27',result:'failed',status:'open',comments:'Undercut found — see NCR-2026-001'},
          {seq:4,phase:'Fabrication',jobcard:'JC-2026-0001',operation:'Welding',activity:'PT of welds',acceptanceCriteria:'EN ISO 23277 level 2',procedureRef:'EN ISO 3452-1',responsible:'Aleksandar C.',requiredRecord:'NDT-2026-002',pointType:'H',customerInvolvement:'Not required',plannedDate:'2026-08-27',actualDate:'2026-08-27',result:'rejected',status:'open',comments:'See NCR-2026-002 and HOLD-2026-001'},
          {seq:5,phase:'Delivery',jobcard:'JC-2026-0002',operation:'Final inspection',activity:'Customer witnessed final walk-through',acceptanceCriteria:'Visual + functional per drawing',procedureRef:'ITP-2026-001',responsible:'Aleksandar C.',requiredRecord:'INS-2026-006',pointType:'W',customerInvolvement:'Customer witness required',plannedDate:'2026-09-11',actualDate:'',result:'pending',status:'open',comments:''}
        ],
        revisionHistory:[{revision:0,date:'2026-08-15',author:'Aleksandar C.',reason:'Initial issue'}],
        notes:[],activity:[{timestamp:'2026-08-15T09:00:00',action:'ITP created',user:'Aleksandar C.',from:null,to:'active',reference:'ITP-2026-001',reason:''}]}
    ],
    qualityReleases:[],
    supplierQuality:[
      {id:1,supplier:'FastenAll',approvalStatus:'conditionally-approved',rating:3.4,totalDeliveries:6,acceptedDeliveries:5,rejectedDeliveries:1,missingCertificates:1,openNcrs:1,overdueActions:0,repeatedDefects:'Missing certificate documentation (1 occurrence)',lastReview:'2026-06-01',nextReview:'2026-12-01',notes:[],activity:[{timestamp:'2026-08-22T09:00:00',action:'Supplier NCR linked',user:'Aleksandar C.',from:null,to:'conditionally-approved',reference:'NCR-2026-003',reason:'Missing material certificate'}]}
    ],
    purchaseOrders:[
      {"id":1,"no":"PO-2026-0145","supplier":"Stål & Rörspecialisten AB","project":"P-2026-014","date":"2026-08-12","expected":"2026-09-02","value":184200,"buyer":"Aleksandar C.","status":"Confirmed","items":"Ventilation duct materials"},
      {"id":2,"no":"PO-2026-0144","supplier":"Nordic Hydraulik AB","project":"P-2026-011","date":"2026-08-11","expected":"2026-08-28","value":96450,"buyer":"Anna Berg","status":"Confirmed","items":"Hydraulic pump unit"},
      {"id":3,"no":"PO-2026-0143","supplier":"Elkomponenter Sverige AB","project":"P-2026-003","date":"2026-08-10","expected":"2026-08-27","value":72860,"buyer":"Marcus Lind","status":"Partially Received","items":"Electrical cabinet IP65"},
      {"id":4,"no":"PO-2026-0142","supplier":"Maskin & Transmission AB","project":"P-2026-009","date":"2026-08-07","expected":"2026-08-24","value":215300,"buyer":"Aleksandar C.","status":"Overdue","items":"Machine transmission parts"},
      {"id":5,"no":"PO-2026-0141","supplier":"SvetsTeknik i Malmö AB","project":"P-2026-008","date":"2026-08-06","expected":"2026-08-31","value":138750,"buyer":"Anna Berg","status":"Awaiting Approval","items":"Welding equipment"},
      {"id":6,"no":"PO-2026-0140","supplier":"Lager & Verktyg i Sverige AB","project":"P-2026-007","date":"2026-08-05","expected":"2026-09-04","value":58920,"buyer":"Marcus Lind","status":"Awaiting Approval","items":"Bearings and tools"}
    ],
    documents:[
      {"id":1,"name":"Material Certificate MTC-240516.pdf","type":"Certificate","module":"Purchasing","record":"PO-2026-0145","category":"Materials","updated":"2026-08-28T10:24:00","status":"Valid","expiry":"2026-09-12","revision":"1","author":"Anna Berg"},
      {"id":2,"name":"Project Drawing Rev B.pdf","type":"Drawing","module":"Projects","record":"P-2026-014","category":"Drawings","updated":"2026-08-27T14:12:00","status":"Review Soon","expiry":"","revision":"B","author":"Marcus Lind"},
      {"id":3,"name":"Supplier Agreement 2026.pdf","type":"Document","module":"Suppliers","record":"SteelSupply AB","category":"Contracts","updated":"2026-08-26T09:31:00","status":"Valid","expiry":"2027-01-01","revision":"2","author":"Anna Berg"},
      {"id":4,"name":"Delivery Note DN-87452.pdf","type":"Document","module":"Purchasing","record":"PO-2026-0145","category":"Delivery","updated":"2026-08-25T16:45:00","status":"Valid","expiry":"","revision":"1","author":"Aleksandar C."},
      {"id":5,"name":"Quality Report NCR-026.pdf","type":"Report","module":"Quality","record":"P-2026-014","category":"Quality","updated":"2026-08-24T11:08:00","status":"Expired","expiry":"2026-08-24","revision":"1","author":"David H."},
      {"id":6,"name":"Workshop Safety Manual.pdf","type":"Document","module":"Workshop","record":"General","category":"Safety","updated":"2026-08-22T08:55:00","status":"Draft","expiry":"","revision":"4","author":"Marcus Lind"},
      {"id":7,"name":"Inspection Checklist IC-101.pdf","type":"Document","module":"Quality","record":"P-2026-014","category":"Inspection","updated":"2026-08-21T15:22:00","status":"Approved","expiry":"","revision":"3","author":"Anna Berg"},
      {"id":8,"name":"Calibration Certificate CAL-556.pdf","type":"Certificate","module":"Workshop","record":"CAL-556","category":"Calibration","updated":"2026-08-20T10:17:00","status":"Review Soon","expiry":"2026-10-15","revision":"1","author":"Aleksandar C."},
      {"id":9,"name":"Standard Project Handover.docx","type":"Template","module":"Projects","record":"Template","category":"Templates","updated":"2026-08-18T09:00:00","status":"Approved","expiry":"","revision":"2","author":"Aleksandar C."}
    ],
    marketingLeads:[
      {"id":1,"no":"LD-2026-041","company":"Nordic Bageri Group","contact":"Sofia Lindqvist","email":"sofia.lindqvist@nordicbageri.se","phone":"+46 70 112 34 56","country":"Sweden","city":"Malmö","industry":"Food-production equipment","size":"50-200","source":"referral","service":"Stainless proofing racks & conveyor line","value":145000,"priority":"high","status":"qualified","owner":"Elena N.","created":"2026-08-05","lastContact":"2026-08-22","nextFollowUp":"2026-08-29","commPref":"Email","dnc":false,"linkedCustomerId":null,"linkedOpportunityId":null,"notes":[{"date":"2026-08-22","author":"Elena N.","text":"Wants a site visit before committing to spec — scheduling for next week."}],"activity":[{"date":"2026-08-05","type":"created","text":"Lead created from referral by Sanus Glutenfri."},{"date":"2026-08-11","type":"call","text":"Introductory call, discussed proofing capacity needs."},{"date":"2026-08-22","type":"qualify","text":"Marked as qualified — budget and timeline confirmed."}]},
      {"id":2,"no":"LD-2026-042","company":"Öresund Marine Service","contact":"Henrik Dahl","email":"henrik.dahl@oresundmarine.se","phone":"+46 70 223 45 67","country":"Sweden","city":"Malmö","industry":"Marine and shipyard work","size":"20-50","source":"website","service":"Deck fabrication & welding","value":320000,"priority":"high","status":"new","owner":"Marko K.","created":"2026-08-24","lastContact":"2026-08-24","nextFollowUp":"2026-08-31","commPref":"Phone","dnc":false,"linkedCustomerId":null,"linkedOpportunityId":5,"notes":[],"activity":[{"date":"2026-08-24","type":"created","text":"Submitted enquiry form on website about deck fabrication capacity."}]},
      {"id":3,"no":"LD-2026-043","company":"Ventia HVAC Syd","contact":"Camilla Ek","email":"camilla.ek@ventiahvac.se","phone":"+46 70 334 56 78","country":"Sweden","city":"Lund","industry":"Ventilation and HVAC fabrication","size":"10-50","source":"linkedin","service":"Ventilation duct fabrication","value":98000,"priority":"medium","status":"qualified","owner":"Aleksandar C.","created":"2026-08-14","lastContact":"2026-08-25","nextFollowUp":"2026-09-01","commPref":"Email","dnc":false,"linkedCustomerId":null,"linkedOpportunityId":6,"notes":[{"date":"2026-08-25","author":"Aleksandar C.","text":"Requested drawings before RFQ — sending duct layout templates."}],"activity":[{"date":"2026-08-14","type":"created","text":"Lead created from LinkedIn campaign click."},{"date":"2026-08-19","type":"email","text":"Sent capability overview and past duct projects."},{"date":"2026-08-25","type":"qualify","text":"Qualified — confirmed project scope and rough budget."}]},
      {"id":4,"no":"LD-2026-044","company":"Kranfors Verkstad","contact":"Jonas Berg","email":"jonas.berg@kranforsverkstad.se","phone":"+46 70 445 67 89","country":"Sweden","city":"Kristianstad","industry":"Machinery repair","size":"1-10","source":"phone","service":"Gearbox & machinery repair","value":42000,"priority":"medium","status":"qualified","owner":"Marko K.","created":"2026-08-10","lastContact":"2026-08-20","nextFollowUp":"2026-08-27","commPref":"Phone","dnc":false,"linkedCustomerId":null,"linkedOpportunityId":7,"notes":[],"activity":[{"date":"2026-08-10","type":"created","text":"Called in about a broken gearbox on their press line."},{"date":"2026-08-20","type":"qualify","text":"Qualified — sent for RFQ preparation."}]},
      {"id":5,"no":"LD-2026-045","company":"Sydstål Prototyping","contact":"Lina Holm","email":"lina.holm@sydstalproto.se","phone":"+46 70 556 78 90","country":"Sweden","city":"Malmö","industry":"Custom equipment and prototypes","size":"1-10","source":"tender","service":"Prototype fabrication","value":210000,"priority":"high","status":"qualified","owner":"Aleksandar C.","created":"2026-07-28","lastContact":"2026-08-21","nextFollowUp":"2026-09-02","commPref":"Email","dnc":false,"linkedCustomerId":null,"linkedOpportunityId":1,"notes":[{"date":"2026-08-21","author":"Aleksandar C.","text":"Private RFQ received (RFQ-2026-014) — preparing estimate."}],"activity":[{"date":"2026-07-28","type":"created","text":"Lead created from tender portal notification."},{"date":"2026-08-05","type":"call","text":"Scoping call — reviewed prototype drawings."},{"date":"2026-08-21","type":"qualify","text":"Qualified and RFQ logged for bid."}]},
      {"id":6,"no":"LD-2026-046","company":"Fabriksservice Syd AB","contact":"Erik Palm","email":"erik.palm@fabriksservice.se","phone":"+46 70 667 89 01","country":"Sweden","city":"Helsingborg","industry":"Industrial maintenance","size":"10-50","source":"existing","service":"Planned maintenance contract","value":76000,"priority":"medium","status":"contacted","owner":"Elena N.","created":"2026-08-18","lastContact":"2026-08-26","nextFollowUp":"2026-08-25","commPref":"Email","dnc":false,"linkedCustomerId":null,"linkedOpportunityId":null,"notes":[],"activity":[{"date":"2026-08-18","type":"created","text":"Existing contact expanded scope enquiry to full maintenance contract."},{"date":"2026-08-26","type":"email","text":"Sent maintenance contract outline and reference sites."}]},
      {"id":7,"no":"LD-2026-047","company":"Nordvent Installation AB","contact":"Michael Sørensen","email":"michael.sorensen@nordvent.dk","phone":"+45 22 778 90 12","country":"Denmark","city":"Copenhagen","industry":"Welding and installation","size":"50-200","source":"linkedin","service":"Welding & installation framework agreement","value":156000,"priority":"high","status":"qualified","owner":"Aleksandar C.","created":"2026-07-15","lastContact":"2026-08-23","nextFollowUp":"2026-08-28","commPref":"Phone","dnc":false,"linkedCustomerId":null,"linkedOpportunityId":8,"notes":[{"date":"2026-08-23","author":"Aleksandar C.","text":"In negotiation on framework pricing — competitor also bidding."}],"activity":[{"date":"2026-07-15","type":"created","text":"Connected via LinkedIn after case study share."},{"date":"2026-08-01","type":"call","text":"Discussed cross-border installation logistics."},{"date":"2026-08-23","type":"qualify","text":"Qualified — moved to negotiation stage."}]},
      {"id":8,"no":"LD-2026-048","company":"Sanus Rostfri AB","contact":"Peter Nyström","email":"peter.nystrom@sanusrostfri.se","phone":"+46 70 889 01 23","country":"Sweden","city":"Landskrona","industry":"Stainless-steel fabrication","size":"10-50","source":"email","service":"Stainless tank fabrication","value":118000,"priority":"medium","status":"contacted","owner":"Elena N.","created":"2026-08-20","lastContact":"2026-08-27","nextFollowUp":"2026-09-03","commPref":"Email","dnc":false,"linkedCustomerId":null,"linkedOpportunityId":null,"notes":[],"activity":[{"date":"2026-08-20","type":"created","text":"Direct email enquiry about stainless tank fabrication."},{"date":"2026-08-27","type":"email","text":"Sent stainless grade options and lead time estimate."}]},
      {"id":9,"no":"LD-2026-049","company":"Ystad Konditori Grupp","contact":"Anna Svensson","email":"anna.svensson@ystadkonditori.se","phone":"+46 70 990 12 34","country":"Sweden","city":"Ystad","industry":"Food-production equipment","size":"1-10","source":"referral","service":"Bakery rack expansion","value":18000,"priority":"low","status":"disqualified","owner":"Marko K.","created":"2026-07-30","lastContact":"2026-08-12","nextFollowUp":null,"commPref":"Phone","dnc":true,"linkedCustomerId":null,"linkedOpportunityId":null,"notes":[{"date":"2026-08-12","author":"Marko K.","text":"Budget far below minimum project size — disqualified. Asked not to be contacted again this year."}],"activity":[{"date":"2026-07-30","type":"created","text":"Referral from Ystad Bageri."},{"date":"2026-08-12","type":"disqualify","text":"Disqualified — budget too small, do-not-contact requested."}]},
      {"id":10,"no":"LD-2026-050","company":"MarineVent AB","contact":"Per Bengtsson","email":"per.bengtsson@marinevent.se","phone":"+46 70 555 66 77","country":"Sweden","city":"Malmö","industry":"Marine and shipyard work","size":"50-200","source":"existing","service":"Ventilation duct system","value":198000,"priority":"high","status":"converted","owner":"Aleksandar C.","created":"2026-08-14","lastContact":"2026-08-18","nextFollowUp":null,"commPref":"Email","dnc":false,"linkedCustomerId":1,"linkedOpportunityId":3,"notes":[{"date":"2026-08-18","author":"Aleksandar C.","text":"Converted to existing customer record — project already in production."}],"activity":[{"date":"2026-08-14","type":"created","text":"Repeat enquiry from existing customer contact."},{"date":"2026-08-18","type":"convert","text":"Converted to customer — linked to MarineVent AB (C-001)."}]}
    ],
    marketingOpportunities:[
      {"id":1,"no":"OPP-2026-101","company":"Sydstål Prototyping","contact":"Lina Holm","leadId":5,"customerId":null,"title":"Prototype Fabrication Programme","services":["Prototype fabrication","CNC machining"],"scope":"Series of 3 prototype enclosures for a robotics application, stainless frame with CNC-machined panels.","industry":"Custom equipment and prototypes","value":210000,"probability":60,"stage":"preparing","expectedDecision":"2026-09-15","requiredDelivery":"2026-10-30","competitor":"","decisionReason":"","owner":"Aleksandar C.","linkedEstimateNo":null,"linkedProjectNo":null,"nextAction":"Finalize BOM and issue estimate","followUpDate":"2026-09-02","activity":[{"date":"2026-07-28","text":"Opportunity created from qualified lead."},{"date":"2026-08-21","text":"RFQ-2026-014 received, moved to Preparing Estimate."}]},
      {"id":2,"no":"OPP-2026-102","company":"MarineVent AB","contact":"Lena Mårtensson","leadId":null,"customerId":1,"title":"Ventilation Upgrade Package","services":["Ventilation fabrication"],"scope":"Upgrade package for existing ventilation duct system, additional filtration stage.","industry":"Marine / Ventilation Systems","value":28503,"probability":55,"stage":"quotesent","expectedDecision":"2026-09-10","requiredDelivery":"2026-10-15","competitor":"","decisionReason":"","owner":"Aleksandar C.","linkedEstimateNo":"EST-2026-023","linkedProjectNo":null,"nextAction":"Follow up on quote EST-2026-023","followUpDate":"2026-09-01","activity":[{"date":"2026-08-22","text":"Quotation EST-2026-023 sent to customer."}]},
      {"id":3,"no":"OPP-2026-103","company":"MarineVent AB","contact":"Per Bengtsson","leadId":10,"customerId":1,"title":"Ventilation Duct System","services":["Fabrication","Welding","Installation"],"scope":"Full ventilation duct system for vessel retrofit.","industry":"Marine / Ventilation Systems","value":198000,"probability":100,"stage":"won","expectedDecision":"2026-08-18","requiredDelivery":"2026-11-12","competitor":"","decisionReason":"Best technical fit and delivery time.","owner":"Aleksandar C.","linkedEstimateNo":"EST-2026-018","linkedProjectNo":"P-2026-014","nextAction":"Monitor production progress","followUpDate":null,"activity":[{"date":"2026-08-14","text":"Estimate EST-2026-018 accepted."},{"date":"2026-08-15","text":"Project P-2026-014 created and moved into production."}]},
      {"id":4,"no":"OPP-2026-104","company":"Sanus Glutenfri AB","contact":"Per Nilsson","leadId":null,"customerId":2,"title":"Stainless Platform Extension","services":["Fabrication","Installation"],"scope":"Extension of stainless platform for food safety compliance.","industry":"Food Production","value":138000,"probability":100,"stage":"won","expectedDecision":"2026-08-24","requiredDelivery":"2026-11-28","competitor":"","decisionReason":"Existing supplier relationship and fast turnaround.","owner":"Elena N.","linkedEstimateNo":"EST-2026-024","linkedProjectNo":null,"nextAction":"Convert estimate to project","followUpDate":null,"activity":[{"date":"2026-08-24","text":"Estimate EST-2026-024 accepted by customer."}]},
      {"id":5,"no":"OPP-2026-105","company":"Öresund Marine Service","contact":"Henrik Dahl","leadId":2,"customerId":null,"title":"Deck Fabrication & Welding","services":["Fabrication","Welding"],"scope":"Steel deck sections and railings for a service vessel refit.","industry":"Marine and shipyard work","value":320000,"probability":20,"stage":"discovery","expectedDecision":"2026-10-01","requiredDelivery":"2026-12-01","competitor":"Sydsvensk Svets AB","decisionReason":"","owner":"Marko K.","linkedEstimateNo":null,"linkedProjectNo":null,"nextAction":"Arrange site visit to scope deck works","followUpDate":null,"activity":[{"date":"2026-08-24","text":"Opportunity opened from new website lead."}]},
      {"id":6,"no":"OPP-2026-106","company":"Ventia HVAC Syd","contact":"Camilla Ek","leadId":3,"customerId":null,"title":"Ventilation Duct Fabrication","services":["Ventilation fabrication"],"scope":"Ductwork fabrication for a new production hall.","industry":"Ventilation and HVAC fabrication","value":98000,"probability":35,"stage":"qualified","expectedDecision":"2026-09-20","requiredDelivery":"2026-11-05","competitor":"","decisionReason":"","owner":"Aleksandar C.","linkedEstimateNo":null,"linkedProjectNo":null,"nextAction":"Prepare RFQ documents once drawings confirmed","followUpDate":"2026-09-04","activity":[{"date":"2026-08-25","text":"Lead qualified, opportunity opened."}]},
      {"id":7,"no":"OPP-2026-107","company":"Kranfors Verkstad","contact":"Jonas Berg","leadId":4,"customerId":null,"title":"Gearbox & Machinery Repair Contract","services":["Machinery repair"],"scope":"Repair and preventive service contract for press line gearboxes.","industry":"Machinery repair","value":42000,"probability":45,"stage":"rfq","expectedDecision":"2026-09-05","requiredDelivery":"2026-09-25","competitor":"","decisionReason":"","owner":"Marko K.","linkedEstimateNo":null,"linkedProjectNo":null,"nextAction":"Prepare estimate from RFQ scope","followUpDate":"2026-08-26","activity":[{"date":"2026-08-20","text":"RFQ received for gearbox repair."}]},
      {"id":8,"no":"OPP-2026-108","company":"Nordvent Installation AB","contact":"Michael Sørensen","leadId":7,"customerId":null,"title":"Welding & Installation Framework Agreement","services":["Welding","Installation"],"scope":"Multi-site framework agreement for welding and installation call-outs.","industry":"Welding and installation","value":156000,"probability":70,"stage":"negotiation","expectedDecision":"2026-09-08","requiredDelivery":"2026-10-01","competitor":"Baltic Weld Partners","decisionReason":"","owner":"Aleksandar C.","linkedEstimateNo":null,"linkedProjectNo":null,"nextAction":"Finalize framework pricing tiers","followUpDate":"2026-08-31","activity":[{"date":"2026-08-23","text":"Entered negotiation on framework pricing."}]},
      {"id":9,"no":"OPP-2026-109","company":"Schröder Nordic","contact":"Anna Berg","leadId":null,"customerId":3,"title":"Machinery Retrofit Inquiry","services":["Retrofit"],"scope":"Retrofit of folding machine line — postponed by customer.","industry":"Industrial Machinery","value":85000,"probability":0,"stage":"lost","expectedDecision":"2026-08-10","requiredDelivery":"","competitor":"","decisionReason":"Customer reallocated budget to another site.","owner":"Aleksandar C.","linkedEstimateNo":null,"linkedProjectNo":null,"nextAction":"Re-engage in Q1 2027","followUpDate":null,"activity":[{"date":"2026-07-20","text":"Retrofit inquiry opened."},{"date":"2026-08-10","text":"Marked lost — budget reallocated."}]}
    ],
    marketingCampaigns:[
      {"id":1,"name":"Stainless Solutions for Food Producers","objective":"Generate qualified leads among food-production and bakery companies in Skåne.","targetIndustries":["Food-production equipment","Stainless-steel fabrication"],"targetServices":["Fabrication","Installation"],"segment":"Food-production companies","channels":["LinkedIn","Email","Trade fair"],"start":"2026-06-01","end":"2026-09-30","budget":45000,"spend":31200,"owner":"Elena N.","status":"active","leads":14,"qualified":6,"estimates":4,"wonValue":138000,"activity":[{"date":"2026-08-10","text":"Trade fair follow-up emails sent to 22 contacts."}]},
      {"id":2,"name":"Workshop Repair & Maintenance Services","objective":"Drive service call-outs and maintenance contracts from local industrial sites.","targetIndustries":["Industrial maintenance","Machinery repair"],"targetServices":["Repair","Maintenance contracts"],"segment":"Property and facility maintenance","channels":["Google Ads","Referral programme"],"start":"2026-05-15","end":"2026-09-15","budget":25000,"spend":24100,"owner":"Marko K.","status":"active","leads":22,"qualified":5,"estimates":3,"wonValue":42000,"activity":[{"date":"2026-08-05","text":"Referral programme generated 4 new leads this week."}]},
      {"id":3,"name":"Marine Steel & Welding Services","objective":"Build pipeline with marine and shipyard operators in the Öresund region.","targetIndustries":["Marine and shipyard work","Welding and installation"],"targetServices":["Welding","Fabrication"],"segment":"Marine and shipyard companies","channels":["LinkedIn","Direct email","Port trade show"],"start":"2026-07-01","end":"2026-10-31","budget":60000,"spend":58900,"owner":"Aleksandar C.","status":"active","leads":9,"qualified":4,"estimates":2,"wonValue":0,"activity":[{"date":"2026-08-18","text":"Port trade show — 9 new contacts collected."}]},
      {"id":4,"name":"Custom Machinery & Prototype Fabrication","objective":"Position Varmak for prototype and custom-equipment RFQs.","targetIndustries":["Custom equipment and prototypes","Ventilation and HVAC fabrication"],"targetServices":["CNC machining","Prototype fabrication"],"segment":"Industrial manufacturers","channels":["Website","LinkedIn"],"start":"2026-03-01","end":"2026-08-15","budget":30000,"spend":30000,"owner":"Elena N.","status":"completed","leads":11,"qualified":5,"estimates":3,"wonValue":0,"activity":[{"date":"2026-08-15","text":"Campaign closed — 3 estimates still in active pipeline."}]}
    ],
    savedReports:[
      {id:'demo-1',name:'Weekly Production Review',category:'Production',favourite:true,created:now().slice(0,10),lastUsed:now().slice(0,10),section:'production',filters:{dateFilter:'week'},type:'view',archived:false},
      {id:'demo-2',name:'Projects Over Budget',category:'Projects',favourite:false,created:now().slice(0,10),lastUsed:now().slice(0,10),section:'projects',filters:{dateFilter:'all'},type:'view',archived:false},
      {id:'demo-3',name:'Quotations Requiring Follow-Up',category:'Estimation',favourite:true,created:now().slice(0,10),lastUsed:now().slice(0,10),section:'estimation',filters:{dateFilter:'all'},type:'view',archived:false},
      {id:'demo-4',name:'Low Stock and Late Purchasing',category:'Store',favourite:false,created:now().slice(0,10),lastUsed:now().slice(0,10),section:'store',filters:{dateFilter:'all'},type:'view',archived:false},
      {id:'demo-5',name:'Monthly Hours Summary',category:'Hours',favourite:false,created:now().slice(0,10),lastUsed:now().slice(0,10),section:'hours',filters:{dateFilter:'month'},type:'view',archived:false},
      {id:'demo-6',name:'Open Quality Actions',category:'Quality',favourite:false,created:now().slice(0,10),lastUsed:now().slice(0,10),section:'quality',filters:{dateFilter:'all'},type:'view',archived:false},
      {id:'demo-7',name:'Equipment Maintenance Due',category:'Equipment',favourite:false,created:now().slice(0,10),lastUsed:now().slice(0,10),section:'equipment',filters:{dateFilter:'all'},type:'view',archived:false}
    ],
    reportConfig:{}
  });
  // Recognized top-level collections used to sanity-check that a stored/imported JSON blob is
  // actually workshop data (not garbage, not an unrelated app's leftover value under a reused key).
  const KNOWN_COLLECTION_KEYS=['customers','estimations','projects','inventory','equipment','jobcards',
    'suppliers','hours','movements','offcuts','stockCounts','activity','qualityInspections','qualityNcrs',
    'purchaseOrders','documents','marketingLeads','marketingOpportunities','marketingCampaigns','savedReports'];
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
      const customerName=LEGACY_PROJECTS_CUSTOMER_NAMES[legacyP.customerId]||legacyP.customer;
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
        responsible:legacyP.pm||'Aleksandar C.',workers,
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

    // v5 is missing or unusable — try v4, then v3, then fall back to a clean demonstration state.
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
  function normalize(s){
    if(!s||typeof s!=='object')s={};
    const base=seed();
    s.version=VERSION;
    s.counters=Object.assign({},base.counters,s.counters||{});
    if(!Array.isArray(s.customers))s.customers=base.customers;
    if(!Array.isArray(s.estimations))s.estimations=base.estimations;
    if(!Array.isArray(s.projects))s.projects=base.projects;
    if(!Array.isArray(s.inventory))s.inventory=base.inventory;
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
    if(!Array.isArray(s.documents))s.documents=base.documents;
    if(!Array.isArray(s.marketingLeads))s.marketingLeads=base.marketingLeads;
    if(!Array.isArray(s.marketingOpportunities))s.marketingOpportunities=base.marketingOpportunities;
    if(!Array.isArray(s.marketingCampaigns))s.marketingCampaigns=base.marketingCampaigns;
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
    });
    s.documents.forEach(d=>{
      if(!Array.isArray(d.notes))d.notes=[];
      if(d.status==null)d.status='Draft';
    });
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
  function save(reason){if(reason)state.activity.unshift({time:now(),reason});try{global.localStorage&&global.localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}try{global.dispatchEvent(new CustomEvent('workshop:data',{detail:{reason,state:clone(state)}}))}catch(e){}return state}
  function quantity(value){const parsed=Number(value);return Number.isFinite(parsed)&&parsed>0?parsed:null}
  function next(type,prefix){state.counters[type]=(state.counters[type]||0)+1;return prefix+String(state.counters[type]).padStart(3,'0')}
  function inventory(code){return state.inventory.find(x=>x.code===code)}
  function project(no){return state.projects.find(x=>x.no===no)}
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
  function addMovement(m){const rec=Object.assign({id:state.counters.movement++,time:now(),user:'Aleksandar C.'},m);state.movements.unshift(rec);save(`${rec.action} ${rec.code}`);return rec}
  function projectReadiness(p){const rows=(p.bom||[]).map(line=>{const inv=inventory(line.code),available=inv?Math.max(0,inv.stock-inv.reserved):0,missing=Math.max(0,line.required-(line.reserved||0));return Object.assign({},line,{stock:inv?inv.stock:0,available,missing})});return{status:rows.some(x=>x.missing>0)?'MATERIAL SHORTAGE':'READY FOR PRODUCTION',rows}}
  // ── Quality module helpers: thin, reused across all quality record types. ──
  function qFind(arr,idOrNo){return (arr||[]).find(x=>x.id===idOrNo||x.no===idOrNo);}
  function qActivity(rec,action,from,to,reference,reason,user){
    rec.activity=rec.activity||[];
    rec.activity.unshift({timestamp:now(),action,user:user||'Aleksandar C.',from:from||null,to:to||null,reference:reference||rec.no,reason:reason||''});
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
  const OPERATION_UNSAFE_STATUSES=['in-progress','completed','skipped'];
  const PROJECT_UNSAFE_STATUSES=['completed','closed'];
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
  const api={
    key:KEY,
    get:()=>clone(state),
    reset:()=>{state=normalize(seed());save('Demo data reset');return clone(state)},
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
    ensureDemoEquipment:()=>{
      if(!Array.isArray(state.equipment)||state.equipment.length===0){
        state.equipment=clone(seed().equipment);
        state.counters.equipment=state.equipment.length;
        save('Demo equipment initialised');
      }
      return clone(state.equipment);
    },
    getCustomers:()=>clone(state.customers),
    listCustomers:()=>clone(state.customers),
    findCustomer:id=>clone(state.customers.find(x=>x.id===id)),
    // Matches by id first, then by name — case-insensitively and ignoring surrounding whitespace —
    // so "MarineVent AB", " marinevent ab " and "MARINEVENT AB " are all treated as the same
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
    upsertEstimation(payload){let e=estimation(payload.id)||estimation(payload.no);if(e)Object.assign(e,clone(payload));else{e=clone(payload);e.id=e.id||state.counters.estimation++;e.no=e.no||next('estimation','EST-2026-');e.revision=e.revision||0;e.revisions=e.revisions||[{rev:0,date:now().slice(0,10),author:'Aleksandar C.',reason:'Initial quotation'}];state.estimations.push(e)}save(`Estimation saved: ${e.no}`);return clone(e)},
    updateEstimation(id,patch,reason){const e=estimation(id);if(!e)return null;Object.assign(e,clone(patch));if(reason){e.revision=(e.revision||0)+1;e.revisions=e.revisions||[];e.revisions.push({rev:e.revision,date:now().slice(0,10),author:'Aleksandar C.',reason})}save(`Estimation updated: ${e.no}`);return clone(e)},
    archiveEstimation(idOrNo,reason){
      const e=estimation(idOrNo);
      if(!e)return{error:'Estimation not found'};
      e.archived=true;
      e.history=e.history||[];
      e.history.push({date:now().slice(0,10),action:reason||'Archived',by:'Aleksandar C.'});
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
    createProjectFromEstimation(idOrNo){const e=estimation(idOrNo);if(!e)return{error:'Estimation not found'};if(e.projectId){const p=state.projects.find(x=>x.id===e.projectId);return{project:clone(p),existing:true}}const id=state.counters.project++,no=`P-2026-${String(id).padStart(3,'0')}`;const p={id,no,customerId:e.customerId,customer:e.customer,name:e.title,estimationId:e.id,status:'planned',phase:'design',start:now().slice(0,10),deadline:e.deliveryTarget,expectedCompletion:e.deliveryTarget,progress:0,plannedHours:e.plannedHours||0,usedHours:0,responsible:'Aleksandar C.',workers:[],machines:clone(e.machines||[]),materialStatus:'unchecked',bom:(e.bom||[]).map(x=>({code:x.code,description:x.description,required:x.qty,reserved:0,issued:0,unit:x.unit})),tasks:[],milestones:[]};state.projects.push(p);e.projectId=id;e.status='accepted';save(`Project ${no} created from ${e.no}`);return{project:clone(p),existing:false}},
    listProjects:()=>clone(state.projects),
    getProjects:()=>clone(state.projects),
    findProject:idOrNo=>clone(state.projects.find(x=>x.id===idOrNo||x.no===idOrNo)),
    logHours(entry){const hours=Number(entry.hours);if(!Number.isFinite(hours)||hours<=0)return{error:'Hours must be greater than zero'};const record=Object.assign({id:`H-${Date.now()}`,date:now().slice(0,10),user:'Aleksandar C.'},clone(entry),{hours});state.hours=state.hours||[];state.hours.unshift(record);save(`Hours logged: ${hours} h`);return clone(record)},
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
        p=Object.assign({phase:'design',progress:0,plannedHours:0,usedHours:0,responsible:'Aleksandar C.',
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
      p.activity.push({date:now().slice(0,10),time:now().slice(11,16),user:'Aleksandar C.',action:reason||'Project archived'});
      save(`Project archived: ${p.no}`);
      return clone(p);
    },
    readiness:no=>{const p=project(no);return p?clone(projectReadiness(p)):null},
    reserveItem(input){const inv=inventory(input.code),p=project(input.projectNo);if(!inv||!p)return{error:'Item or project not found'};const requested=Math.max(0,Number(input.qty)||0),free=Math.max(0,inv.stock-inv.reserved),qty=Math.min(requested,free);if(!qty)return{error:'No available stock to reserve'};inv.reserved+=qty;let line=(p.bom||[]).find(x=>x.code===inv.code);if(!line){line={code:inv.code,description:inv.description,required:qty,reserved:0,issued:0,unit:inv.unit};p.bom=p.bom||[];p.bom.push(line)}line.reserved=(line.reserved||0)+qty;addMovement({action:'RESERVED',code:inv.code,qty,unit:inv.unit,from:inv.location,to:p.no,projectNo:p.no,jobcard:input.jobcard,user:input.user||'Aleksandar C.'});const r=projectReadiness(p);p.materialStatus=r.status==='READY FOR PRODUCTION'?'ready':'shortage';save(`Material reserved: ${inv.code}`);return{item:clone(inv),project:clone(p),reserved:qty,readiness:clone(r)}},
    reserveBom(no){const p=project(no);if(!p)return null;(p.bom||[]).forEach(line=>{const inv=inventory(line.code);if(!inv)return;const need=Math.max(0,line.required-(line.reserved||0)),free=Math.max(0,inv.stock-inv.reserved),qty=Math.min(need,free);line.reserved=(line.reserved||0)+qty;inv.reserved+=qty;if(qty)addMovement({action:'RESERVED',code:line.code,qty,unit:line.unit,from:inv.location,to:no,projectNo:no})});const r=projectReadiness(p);p.materialStatus=r.status==='READY FOR PRODUCTION'?'ready':'shortage';save(`BOM reserved: ${no}`);return clone(r)},
    resolveBarcode:code=>state.barcodeLinks[code]||null,
    linkBarcode(barcode,itemCode){if(!inventory(itemCode))return false;state.barcodeLinks[barcode]=itemCode;save(`Barcode linked: ${barcode}`);return true},
    receive(input){const inv=inventory(input.code),qty=quantity(input.qty);if(!inv)return{error:'Item not found'};if(!qty)return{error:'Quantity must be greater than zero'};inv.stock+=qty;if(input.location)inv.location=input.location;if(input.supplier)inv.supplier=input.supplier;if(input.heat)inv.heat=input.heat;if(input.certificate)inv.certificate=input.certificate;inv.lastPrice=Number(input.lastPrice)||inv.lastPrice;addMovement({action:'RECEIVED',code:inv.code,qty,unit:inv.unit,from:`${input.supplier||inv.supplier} / ${input.po||'No PO'}`,to:inv.location,user:input.user||'John Smith',heat:input.heat,certificate:input.certificate});return clone(inv)},
    issue(input){const inv=inventory(input.code),p=project(input.projectNo),qty=quantity(input.qty);if(!inv||!p)return{error:'Item or project not found'};if(!qty)return{error:'Quantity must be greater than zero'};const available=inv.stock-inv.reserved;if(qty>available&&qty>inv.reserved)return{error:'Quantity exceeds available stock'};inv.stock-=qty;inv.reserved=Math.max(0,inv.reserved-Math.min(inv.reserved,qty));const line=(p.bom||[]).find(x=>x.code===inv.code);if(line){line.issued=(line.issued||0)+qty;line.reserved=Math.max(0,(line.reserved||0)-qty)}p.actualMaterialCost=(p.actualMaterialCost||0)+qty*inv.avgCost;addMovement({action:'ISSUED',code:inv.code,qty,unit:inv.unit,from:inv.location,to:`${p.no}${input.jobcard?' / '+input.jobcard:''}`,projectNo:p.no,jobcard:input.jobcard,user:input.user||'Aleksandar C.'});return{item:clone(inv),project:clone(p)}},
    move(input){const inv=inventory(input.code),qty=quantity(input.qty);if(!inv)return{error:'Item not found'};if(!qty)return{error:'Quantity must be greater than zero'};const from=inv.location;if(input.action==='RETURN')inv.stock+=qty;if(input.action==='SCRAP')inv.stock=Math.max(0,inv.stock-qty);if(input.action==='TRANSFER'&&input.to)inv.location=input.to;addMovement({action:input.action,code:inv.code,qty,unit:inv.unit,from,to:input.to||inv.location,projectNo:input.projectNo,jobcard:input.jobcard,user:input.user||'Aleksandar C.'});return clone(inv)},
    addOffcut(offcut){offcut=clone(offcut);offcut.id=state.counters.offcut++;offcut.code=offcut.code||`OFF-${String(offcut.id).padStart(4,'0')}`;offcut.created=now().slice(0,10);offcut.status='available';state.offcuts.unshift(offcut);save(`Offcut created: ${offcut.code}`);return clone(offcut)},
    recordCount(rec){const inv=inventory(rec.code),counted=Number(rec.counted);if(!inv)return{error:'Item not found'};if(!Number.isFinite(counted)||counted<0)return{error:'Count must be zero or greater'};const count={date:now(),code:rec.code,system:inv.stock,counted,difference:counted-inv.stock,scope:rec.scope,user:rec.user||'Aleksandar C.'};state.stockCounts.unshift(count);save(`Stock counted: ${rec.code}`);return clone(count)},
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
        if(data.operations){
          const changed=unsafeOperationTransitions(j.operations,data.operations);
          if(changed.length){
            const gate=jobcardQualityGate(j.no);
            if(gate.blocked)return qualityGateBlockedResult(`Operation ${changed.map(o=>o.status).join('/')}`,j.no,gate,{operationIds:changed.map(o=>o.id)});
          }
        }
        Object.assign(j,data);
      }
      else{
        const data=clone(payload);
        // A brand-new Jobcard must be gated exactly like an existing one: creating it directly with
        // an unsafe status (in-progress/completed/closed), or with pre-populated operations already
        // set to in-progress/completed/skipped, must not bypass a hold on its supplied Jobcard
        // number or its parent Project — nothing is created/mutated when rejected.
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
      if(data.operations){
        const changed=unsafeOperationTransitions(j.operations,data.operations);
        if(changed.length){
          const gate=jobcardQualityGate(j.no);
          if(gate.blocked)return qualityGateBlockedResult(`Operation ${changed.map(o=>o.status).join('/')}`,j.no,gate,{operationIds:changed.map(o=>o.id)});
        }
      }
      Object.assign(j,data);save(`Jobcard updated: ${j.no}`);return clone(j);
    },
    archiveJobcard(idOrNo){const j=jobcard(idOrNo);if(!j)return null;j.archived=true;j.archivedAt=now();save(`Jobcard archived: ${j.no}`);return clone(j)},
    addJobcardOperation(idOrNo,operation){const j=jobcard(idOrNo);if(!j)return null;operation=clone(operation);j._opSeq=(j._opSeq||j.operations.reduce((a,o)=>Math.max(a,o.id||0),0))+1;operation.id=j._opSeq;j.operations.push(operation);save(`Operation added: ${j.no}`);return clone(operation)},
    // Starting, completing or skipping an operation is blocked by an active Quality Hold on the
    // Jobcard (or its Project) — this is the single chokepoint every page path (start/pause button,
    // Complete button, the operation edit form's status dropdown used to "skip") already goes
    // through, so no separate skip-specific method is needed.
    updateJobcardOperation(idOrNo,opId,patch){
      const j=jobcard(idOrNo);if(!j)return null;
      const op=j.operations.find(o=>o.id===opId);if(!op)return null;
      const data=clone(patch);
      if(data.status&&OPERATION_UNSAFE_STATUSES.includes(data.status)&&op.status!==data.status){
        const gate=jobcardQualityGate(j.no);
        if(gate.blocked)return qualityGateBlockedResult(`Operation ${data.status}`,j.no,gate,{operationId:opId});
      }
      Object.assign(op,data);save(`Operation updated: ${j.no}`);return clone(op);
    },
    assignJobcardWorker(idOrNo,worker){const j=jobcard(idOrNo);if(!j||!worker)return null;j.workers=j.workers||[];if(!j.workers.includes(worker))j.workers.push(worker);save(`Worker assigned to ${j.no}: ${worker}`);return clone(j)},
    addJobcardNote(idOrNo,note){const j=jobcard(idOrNo);if(!j)return null;note=Object.assign({id:Date.now(),date:now().slice(0,10),time:new Date().toTimeString().slice(0,5)},clone(note));j.notes=j.notes||[];j.notes.unshift(note);save(`Note added: ${j.no}`);return clone(note)},
    addJobcardInspection(idOrNo,inspection){const j=jobcard(idOrNo);if(!j)return null;inspection=Object.assign({id:Date.now()},clone(inspection));j.inspections=j.inspections||[];j.inspections.push(inspection);save(`Inspection added: ${j.no}`);return clone(inspection)},
    updateJobcardInspection(idOrNo,inspId,patch){const j=jobcard(idOrNo);if(!j)return null;const insp=(j.inspections||[]).find(i=>i.id===inspId);if(!insp)return null;Object.assign(insp,clone(patch));save(`Inspection updated: ${j.no}`);return clone(insp)},
    recordJobcardActivity(idOrNo,entry){const j=jobcard(idOrNo);if(!j)return null;entry=Object.assign({date:now().slice(0,10),time:new Date().toTimeString().slice(0,5),by:'Aleksandar C.'},clone(entry));j.activity=j.activity||[];j.activity.unshift(entry);save(`Jobcard activity: ${j.no}`);return clone(entry)},
    // A read-only accessor: it must never mutate state. normalize() already guarantees
    // state.equipment is a valid array (backfilling it only when missing/invalid, never when it is
    // a genuinely empty user collection) — see the "empty stays empty" rule. Only the explicit
    // ensureDemoEquipment() call below may add demonstration records.
    getEquipment:()=>clone(state.equipment||[]),
    createEquipment:(payload)=>{
      const item=clone(payload||{});
      if(!item.equipmentId && !item.id) return {error:'Equipment ID is required'};
      if(!item.name) return {error:'Equipment name is required'};
      if(!item.category) return {error:'Category is required'};
      if(!item.status) item.status='Available';
      const key=item.equipmentId || item.id;
      if(state.equipment.some(x=>x.equipmentId===key||x.id===key)){ return {error:'Duplicate equipment ID'}; }
      const record={
        id:key,
        equipmentId:key,
        name:item.name,
        category:item.category,
        manufacturer:item.manufacturer||'—',
        model:item.model||'—',
        serial:item.serial||'—',
        assetNumber:item.assetNumber||`AS-${Date.now().toString().slice(-5)}`,
        status:item.status,
        currentLocation:item.currentLocation||'Workshop',
        homeLocation:item.homeLocation||item.currentLocation||'Workshop',
        department:item.department||'Workshop',
        responsiblePerson:item.responsiblePerson||'Aleksandar C.',
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
        safetyWarnings:Array.isArray(item.safetyWarnings)?item.safetyWarnings:[],
        assignedProject:item.assignedProject||null,
        assignedJobcard:item.assignedJobcard||null,
        operator:item.operator||null,
        notes:item.notes||'Demo record created through the frontend workflow.',
        activity:[{timestamp:now(),action:'Equipment created',user:item.responsiblePerson||'Aleksandar C.',reference:key}],
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
      // Close bypass: a genuine transition into an operational status is blocked exactly like
      // changeEquipmentStatus() below — moving OUT of an operational status (e.g. reporting it
      // broken) is always allowed; only moving INTO Available/Reserved/In Use while blocked is not.
      if(data.status&&global.EquipmentGates&&global.EquipmentGates.normalizeStatus(data.status)!==global.EquipmentGates.normalizeStatus(current.status)&&global.EquipmentGates.isOperationalStatus(data.status)){
        const gate=equipmentSafetyGate(current,{});
        if(gate.blocked)return equipmentGateBlockedResult(`Equipment status update to ${data.status}`,equipmentId,gate);
      }
      const next=Object.assign({}, clone(current), data);
      next.lastActivity=now();
      state.equipment[index]=next;
      save(`Equipment updated: ${equipmentId}`);
      return clone(next);
    },
    // Close bypass (C): moving blocked equipment back to an operational status through this
    // lower-level method is gated exactly like updateEquipment() above — a caller cannot bypass
    // safety by calling this instead. Moving to a non-operational status (e.g. Quarantined) is
    // always allowed, matching Pass 3.1's "safe direction" principle for Quality Holds.
    changeEquipmentStatus:(equipmentId,status,meta={})=>{
      const item=equip(equipmentId);
      if(!item) return {error:'Equipment not found'};
      const nextStatus=status||item.status;
      if(global.EquipmentGates&&global.EquipmentGates.normalizeStatus(nextStatus)!==global.EquipmentGates.normalizeStatus(item.status)&&global.EquipmentGates.isOperationalStatus(nextStatus)){
        const gate=equipmentSafetyGate(item,{});
        if(gate.blocked)return equipmentGateBlockedResult(`Status change to ${nextStatus}`,equipmentId,gate);
      }
      item.status=nextStatus;
      item.lastActivity=now();
      item.activity=item.activity||[];
      item.activity.unshift({timestamp:now(),action:`Status changed to ${nextStatus}`,user:meta.user||'Aleksandar C.',reference:equipmentId,details:meta.reason||''});
      save(`Equipment status changed: ${equipmentId}`);
      return clone(item);
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
      item.status='Reserved';
      item.assignedProject=payload.project||item.assignedProject||null;
      item.assignedJobcard=payload.jobcard||item.assignedJobcard||null;
      item.activity=item.activity||[];
      item.activity.unshift({timestamp:now(),action:'Equipment reserved',user:payload.reservedBy||'Aleksandar C.',reference:equipmentId,details:`${payload.project||'—'} / ${payload.jobcard||'—'}`});
      item.lastActivity=now();
      save(`Equipment reserved: ${equipmentId}`);
      return clone(item);
    },
    assignEquipment:(equipmentId, assignment={})=>{
      const item=equip(equipmentId);
      if(!item) return {error:'Equipment not found'};
      const gate=equipmentSafetyGate(item,{});
      if(gate.blocked)return equipmentGateBlockedResult('Assign',equipmentId,gate);
      item.assignedProject=assignment.project||item.assignedProject||null;
      item.assignedJobcard=assignment.jobcard||item.assignedJobcard||null;
      item.currentLocation=assignment.location||item.currentLocation;
      item.operator=assignment.worker||item.operator||null;
      // Caller-supplied assignment.status is never trusted (Pass 3.2A requirement) — assigning
      // equipment always reserves it; a later logEquipmentUsage()/canUseEquipment() call is the
      // gated path into actual operational use.
      item.status='Reserved';
      item.currentAssignment={project:assignment.project||null,jobcard:assignment.jobcard||null,location:assignment.location||null,worker:assignment.worker||null,equipmentId:item.equipmentId, assignedBy:assignment.assignedBy||'Aleksandar C.', assignedDate:new Date().toISOString().slice(0,10)};
      item.activity=item.activity||[];
      item.activity.unshift({timestamp:now(),action:'Equipment assigned',user:assignment.assignedBy||'Aleksandar C.',reference:item.equipmentId,details:`${assignment.project||'—'} / ${assignment.jobcard||'—'}`});
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
      item.activity=item.activity||[]; item.activity.unshift({timestamp:now(),action:'Equipment returned',user:meta.user||'Aleksandar C.',reference:item.equipmentId,details:meta.note||''});
      item.lastActivity=now();
      save(`Equipment returned: ${equipmentId}`);
      return clone(item);
    },
    logEquipmentUsage:(equipmentId,usage={})=>{
      const item=equip(equipmentId);
      if(!item) return {error:'Equipment not found'};
      const hours=Number(usage.hours);
      if(!Number.isFinite(hours)||hours<=0)return{error:'Equipment usage requires a positive, finite number of hours'};
      const gate=equipmentSafetyGate(item,{requirePreUseCheck:true,date:usage.date,jobcardNo:usage.jobcard,projectNo:usage.project});
      if(gate.blocked)return equipmentGateBlockedResult('Log usage',equipmentId,gate);
      const record={
        id:Date.now().toString(),
        startTime:usage.startTime||now(),
        stopTime:usage.stopTime||now(),
        project:usage.project||item.assignedProject||null,
        jobcard:usage.jobcard||item.assignedJobcard||null,
        worker:usage.worker||item.operator||'Unassigned',
        duration:usage.duration||0,
        meterBefore:Number(item.operatingHourMeter)||0,
        meterAfter:Number(item.operatingHourMeter||0) + hours,
        fuelOrEnergy:usage.fuelOrEnergy||'n/a',
        notes:usage.notes||'',
        reportedProblems:usage.reportedProblems||[]
      };
      item.usageHistory=item.usageHistory||[]; item.usageHistory.unshift(record);
      item.operatingHourMeter=Number(item.operatingHourMeter||0)+hours;
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
      save(`Inspection added: ${equipmentId}`);
      return clone(rec);
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
      save(`Equipment safety requirements updated: ${equipmentId}`);
      return clone(item);
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
      save(`Maintenance added: ${equipmentId}`);
      return clone(rec);
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
      save(`Certification added: ${equipmentId}`);
      return clone(rec);
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
      save(`Calibration added: ${equipmentId}`);
      return clone(rec);
    },
    addNote:(equipmentId,note)=>{
      const item=state.equipment.find(x=>x.equipmentId===equipmentId||x.id===equipmentId);
      if(!item) return {error:'Equipment not found'};
      const rec={...clone(note), timestamp:now()};
      item.notesLog=item.notesLog||[]; item.notesLog.unshift(rec); item.activity=item.activity||[]; item.activity.unshift({timestamp:now(),action:'Note added',user:note.author||'Aleksandar C.',reference:equipmentId,details:note.text||''});
      item.lastActivity=now();
      save(`Equipment note added: ${equipmentId}`);
      return clone(rec);
    },
    addActivity:(equipmentId,entry)=>{
      const item=state.equipment.find(x=>x.equipmentId===equipmentId||x.id===equipmentId);
      if(!item) return {error:'Equipment not found'};
      const rec={timestamp:now(),action:entry.action||'Activity',user:entry.user||'Aleksandar C.',reference:equipmentId,details:entry.details||''};
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
      state.breakdowns=state.breakdowns||[]; state.breakdowns.unshift(rec); save(`Breakdown reported: ${equipmentId}`); return clone(rec);
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
      const EG=global.EquipmentGates;
      const raw=clone(payload||{});
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
      save(`Pre-use check recorded: ${equipmentId}`);
      return clone(rec);
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
      const retiredBy=meta&&meta.retiredBy!=null?String(meta.retiredBy).trim():'Aleksandar C.';
      item.isRetired=true; item.retirementReason=cleanReason; item.status='Retired'; item.activity=item.activity||[];
      item.activity.unshift({timestamp:now(),action:'Equipment retired',user:retiredBy,reference:equipmentId,details:cleanReason});
      item.lastActivity=now();
      save(`Equipment retired: ${equipmentId}`); return clone(item);
    },

    // ══════════════ QUALITY MODULE ══════════════
    // Thin persistence layer only: blocking-condition logic (holds, release readiness,
    // dossier completeness) is computed by the Quality page from this shared data,
    // consistent with how Reports computes its KPIs from WorkshopData.get().
    listQualityInspections:()=>clone(state.qualityInspections),
    findQualityInspection:idOrNo=>clone(qFind(state.qualityInspections,idOrNo)),
    createInspection(payload){
      const rec=Object.assign({id:state.counters.inspection=(state.counters.inspection||0)+1,checklist:[],notes:[],documents:[],activity:[],createdBy:payload.createdBy||'Aleksandar C.',created:now().slice(0,10),modified:now().slice(0,10)},clone(payload));
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
        hold=api.applyQualityHold({scope:resultData.holdScope||'jobcard',reference:resultData.holdReference||rec.jobcard||rec.projectNo,relatedRef:rec.no,reason:`Critical failed inspection ${rec.no} — ${rec.findings||'see inspection record'}`,severity:'critical',requiredAction:'Corrective action and reinspection required.',appliedBy:resultData.inspector||'Aleksandar C.'});
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
        hold=api.applyQualityHold({scope:rec.jobcard?'jobcard':(rec.projectNo?'project':'other'),reference:rec.jobcard||rec.projectNo||rec.no,relatedRef:rec.no,reason:`Critical NCR ${rec.no} — ${rec.title||rec.description||''}`,severity:'critical',requiredAction:'Resolve NCR and verify corrective action before release.',appliedBy:rec.detectedBy||'Aleksandar C.'});
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
      qActivity(rec,'Verification completed',from,rec.status,rec.no,`Verified by ${verifiedBy||'Aleksandar C.'}`);
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
      rec.verifiedBy=verifiedBy||'Aleksandar C.'; rec.verificationDate=now().slice(0,10); rec.effectivenessCheck=effectivenessCheck;
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
      rec.revisionHistory.push({revision:rec.revision,date:now().slice(0,10),author:rec.preparedBy||'Aleksandar C.',reason:'Initial issue'});
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
      const result=api.createNcr({title:'Customer complaint: '+(complaint.description||'').slice(0,80),projectNo:complaint.projectNo,customer:complaint.customer,description:complaint.description,category:'customer-requirement',severity:complaint.severity==='critical'?'critical':'major',detectedBy:'Aleksandar C.',responsiblePerson:complaint.responsiblePerson,dueDate:complaint.dueDate});
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

    // ── Documents: metadata-only records (no real file storage). ──
    getDocuments:()=>clone(state.documents),
    findDocument:id=>clone(state.documents.find(x=>x.id===id)),
    upsertDocument(payload){
      if(!payload||!payload.name)return{error:'A document name is required'};
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
