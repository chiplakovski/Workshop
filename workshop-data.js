(function(global){
  'use strict';
  const KEY='varmak.workshop.frontend.v4';
  const VERSION=4;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const now=()=>new Date().toISOString();
  const seed=()=>({
    version:VERSION,
    counters:{customer:40,estimation:25,project:15,movement:6,offcut:3,jobcard:2,
      inspection:6,ncr:3,capa:2,weld:2,ndt:2,itp:1,hold:1,complaint:1,release:0,dossier:1,wps:1,welderqual:2},
    customers:[
      {id:1,no:'C-001',name:'MarineVent AB',status:'active',city:'Malmö',country:'Sweden',org:'556789-1234',vat:'SE556789123401',email:'info@marinevent.se',phone:'+46 40 123 45 67',website:'www.marinevent.se',since:'2023-03-15',terms:'30 days',credit:250000,currency:'SEK',industry:'Marine / Ventilation Systems',type:'Company',preferred:'Email',priceList:'Standard Price List 2026',deliveryTerms:'EXW Marieholm',discountAgreement:'0%',billing:['MarineVent AB','Att: Purchasing','Östra Varvsgatan 12','211 19 Malmö','Sweden'],shipping:['MarineVent AB','Östra Varvsgatan 12','211 19 Malmö','Sweden'],contacts:[{name:'Per Bengtsson',role:'CEO',department:'Management',primary:true,email:'per.bengtsson@marinevent.se',phone:'+46 70 555 66 77'},{name:'Lena Mårtensson',role:'Purchasing Manager',department:'Purchasing',primary:false,email:'lena.martensson@marinevent.se',phone:'+46 70 888 99 00'}],notes:[{date:'2026-08-22',author:'Aleksandar C.',text:'Discussed new ventilation unit project. Waiting for drawings.'}],documents:[{name:'Company Profile.pdf',type:'pdf',date:'2026-03-15'}]},
      {id:2,no:'C-002',name:'Sanus Glutenfri AB',status:'active',city:'Landskrona',country:'Sweden',org:'559812-4471',vat:'SE559812447101',email:'info@sanusglutenfri.se',phone:'+46 42 123 45 67',terms:'30 days',credit:150000,currency:'SEK',industry:'Food Production',type:'Company',contacts:[],notes:[],documents:[]},
      {id:3,no:'C-003',name:'Schröder Nordic',status:'active',city:'Helsingborg',country:'Sweden',org:'556234-9012',vat:'SE556234901201',email:'info@schroder.se',phone:'+46 42 987 65 43',terms:'30 days',credit:300000,currency:'SEK',industry:'Industrial Machinery',type:'Company',contacts:[],notes:[],documents:[]}
    ],
    estimations:[
      {id:18,no:'EST-2026-018',customerId:1,customer:'MarineVent AB',title:'Ventilation Duct System',status:'accepted',revision:1,created:'2026-08-14',validUntil:'2026-09-14',currency:'SEK',estimatedMaterial:72450,estimatedLabour:48600,estimatedMachine:12600,estimatedOther:8400,totalCost:142050,sellingPrice:198000,plannedHours:184,machines:['Laser','Press Brake','TIG Station 1'],deliveryTarget:'2026-11-12',projectId:14,bom:[{code:'SS-SHT-304-2.0',description:'AISI 304 sheet 2 mm',qty:8,unit:'EA'},{code:'MS-TUBE-40SQ-2.0',description:'Square tube 40x40x2 mm',qty:36,unit:'EA'},{code:'ER70S-6-1.0',description:'Welding wire ER70S-6',qty:45,unit:'KG'},{code:'BOLT-HEX-M10X25',description:'Hex bolts M10x25',qty:40,unit:'EA'}],revisions:[{rev:0,date:'2026-08-14',author:'Aleksandar C.',reason:'Initial quotation'},{rev:1,date:'2026-08-18',author:'Aleksandar C.',reason:'Updated material grade and delivery'}]},
      {id:23,no:'EST-2026-023',customerId:1,customer:'MarineVent AB',title:'Ventilation Upgrade Package',status:'draft',revision:0,created:'2026-08-22',validUntil:'2026-09-22',currency:'SEK',estimatedMaterial:9800,estimatedLabour:7200,estimatedMachine:3200,estimatedOther:1920,totalCost:22120,sellingPrice:28503,plannedHours:30,machines:['Laser','TIG Station 1'],deliveryTarget:'2026-10-15',projectId:null,bom:[],revisions:[{rev:0,date:'2026-08-22',author:'Aleksandar C.',reason:'Initial quotation'}]}
      ,{id:24,no:'EST-2026-024',customerId:2,customer:'Sanus Glutenfri AB',title:'Stainless Platform Extension',status:'accepted',revision:0,created:'2026-08-24',validUntil:'2026-09-24',currency:'SEK',estimatedMaterial:48500,estimatedLabour:36200,estimatedMachine:9800,estimatedOther:5500,totalCost:100000,sellingPrice:138000,plannedHours:126,machines:['Laser','Press Brake','TIG Station 1'],deliveryTarget:'2026-11-28',projectId:null,bom:[{code:'SS-SHT-304-2.0',description:'AISI 304 sheet 2 mm',qty:12,unit:'EA'},{code:'MS-TUBE-40SQ-2.0',description:'Square tube 40x40x2 mm',qty:24,unit:'EA'},{code:'ER70S-6-1.0',description:'Welding wire ER70S-6',qty:18,unit:'KG'}],revisions:[{rev:0,date:'2026-08-24',author:'Aleksandar C.',reason:'Accepted quotation'}]}
    ],
    projects:[
      {id:14,no:'P-2026-014',customerId:1,customer:'MarineVent AB',name:'Ventilation Duct System',estimationId:18,status:'production',phase:'production',start:'2026-08-15',deadline:'2026-09-12',expectedCompletion:'2026-09-12',progress:62,plannedHours:184,usedHours:96,responsible:'Aleksandar C.',workers:['Marko K.','Elena N.'],machines:['Laser','Press Brake','TIG Station 1'],materialStatus:'shortage',bom:[{code:'SS-SHT-304-2.0',description:'AISI 304 sheet 2 mm',required:8,reserved:8,issued:4,unit:'EA'},{code:'MS-TUBE-40SQ-2.0',description:'Square tube 40x40x2 mm',required:36,reserved:30,issued:12,unit:'EA'},{code:'ER70S-6-1.0',description:'Welding wire ER70S-6',required:45,reserved:12,issued:10,unit:'KG'},{code:'BOLT-HEX-M10X25',description:'Hex bolts M10x25',required:40,reserved:40,issued:40,unit:'EA'}],tasks:[],milestones:[]}
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
    ]
  });
  function load(){
    try{
      const raw=global.localStorage&&global.localStorage.getItem(KEY);
      if(raw){
        const parsed=JSON.parse(raw);
        if(parsed&&parsed.version===VERSION){ return normalize(parsed); }
        if(parsed){ return normalize(Object.assign(seed(), parsed)); }
      }
    }catch(e){}
    return normalize(seed());
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
      if(!Array.isArray(item.currentAssignment))item.currentAssignment=[];
      if(item.status==null)item.status='Available';
      if(!item.equipmentId)item.equipmentId=item.id||`E-${String((s.counters.equipment||0)+1).padStart(4,'0')}`;
      if(!item.id)item.id=item.equipmentId;
    });
    return s;
  }
  let state=load();
  function save(reason){if(reason)state.activity.unshift({time:now(),reason});try{global.localStorage&&global.localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}try{global.dispatchEvent(new CustomEvent('workshop:data',{detail:{reason,state:clone(state)}}))}catch(e){}return state}
  function quantity(value){const parsed=Number(value);return Number.isFinite(parsed)&&parsed>0?parsed:null}
  function next(type,prefix){state.counters[type]=(state.counters[type]||0)+1;return prefix+String(state.counters[type]).padStart(3,'0')}
  function inventory(code){return state.inventory.find(x=>x.code===code)}
  function project(no){return state.projects.find(x=>x.no===no)}
  function estimation(idOrNo){return state.estimations.find(x=>x.id===idOrNo||x.no===idOrNo)}
  function jobcard(idOrNo){return state.jobcards.find(x=>x.id===idOrNo||x.no===idOrNo)}
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
    ensureDemoEquipment:()=>{
      if(!Array.isArray(state.equipment)||state.equipment.length===0){
        state.equipment=clone(seed().equipment);
        state.counters.equipment=state.equipment.length;
        save('Demo equipment initialised');
      }
      return clone(state.equipment);
    },
    findCustomer:id=>clone(state.customers.find(x=>x.id===id)),
    upsertCustomer(customer){const existing=state.customers.find(x=>x.id===customer.id||x.name===customer.name);if(existing)Object.assign(existing,clone(customer));else{customer=clone(customer);customer.id=state.counters.customer++;customer.no=next('customer','C-');state.customers.push(customer)}save(`Customer updated: ${customer.name}`);return clone(existing||customer)},
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
    createProjectFromEstimation(idOrNo){const e=estimation(idOrNo);if(!e)return{error:'Estimation not found'};if(e.projectId){const p=state.projects.find(x=>x.id===e.projectId);return{project:clone(p),existing:true}}const id=state.counters.project++,no=`P-2026-${String(id).padStart(3,'0')}`;const p={id,no,customerId:e.customerId,customer:e.customer,name:e.title,estimationId:e.id,status:'planned',phase:'design',start:now().slice(0,10),deadline:e.deliveryTarget,expectedCompletion:e.deliveryTarget,progress:0,plannedHours:e.plannedHours||0,usedHours:0,responsible:'Aleksandar C.',workers:[],machines:clone(e.machines||[]),materialStatus:'unchecked',bom:(e.bom||[]).map(x=>({code:x.code,description:x.description,required:x.qty,reserved:0,issued:0,unit:x.unit})),tasks:[],milestones:[]};state.projects.push(p);e.projectId=id;e.status='accepted';save(`Project ${no} created from ${e.no}`);return{project:clone(p),existing:false}},
    listProjects:()=>clone(state.projects),
    logHours(entry){const hours=Number(entry.hours);if(!Number.isFinite(hours)||hours<=0)return{error:'Hours must be greater than zero'};const record=Object.assign({id:`H-${Date.now()}`,date:now().slice(0,10),user:'Aleksandar C.'},clone(entry),{hours});state.hours=state.hours||[];state.hours.unshift(record);save(`Hours logged: ${hours} h`);return clone(record)},
    upsertProject(payload){let p=state.projects.find(x=>x.id===payload.id||x.no===payload.no);if(p)Object.assign(p,clone(payload));else{p=clone(payload);p.id=p.id||state.counters.project++;p.no=p.no||`P-2026-${String(p.id).padStart(3,'0')}`;state.projects.push(p)}save(`Project saved: ${p.no}`);return clone(p)},
    updateProject(no,patch){const p=project(no);if(!p)return null;Object.assign(p,clone(patch));save(`Project updated: ${no}`);return clone(p)},
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
      if(j){Object.assign(j,clone(payload))}
      else{j=Object.assign({operations:[],materials:[],machines:[],inspections:[],notes:[],documents:[],activity:[],workers:[],archived:false,status:'draft'},clone(payload));
        j.id=state.counters.jobcard=(state.counters.jobcard||0)+1;
        j.no=j.no||('JC-'+new Date().getFullYear()+'-'+String(j.id).padStart(4,'0'));
        state.jobcards.push(j)}
      save(`Jobcard saved: ${j.no}`);return clone(j)},
    updateJobcard(idOrNo,patch){const j=jobcard(idOrNo);if(!j)return null;Object.assign(j,clone(patch));save(`Jobcard updated: ${j.no}`);return clone(j)},
    archiveJobcard(idOrNo){const j=jobcard(idOrNo);if(!j)return null;j.archived=true;j.archivedAt=now();save(`Jobcard archived: ${j.no}`);return clone(j)},
    addJobcardOperation(idOrNo,operation){const j=jobcard(idOrNo);if(!j)return null;operation=clone(operation);j._opSeq=(j._opSeq||j.operations.reduce((a,o)=>Math.max(a,o.id||0),0))+1;operation.id=j._opSeq;j.operations.push(operation);save(`Operation added: ${j.no}`);return clone(operation)},
    updateJobcardOperation(idOrNo,opId,patch){const j=jobcard(idOrNo);if(!j)return null;const op=j.operations.find(o=>o.id===opId);if(!op)return null;Object.assign(op,clone(patch));save(`Operation updated: ${j.no}`);return clone(op)},
    assignJobcardWorker(idOrNo,worker){const j=jobcard(idOrNo);if(!j||!worker)return null;j.workers=j.workers||[];if(!j.workers.includes(worker))j.workers.push(worker);save(`Worker assigned to ${j.no}: ${worker}`);return clone(j)},
    addJobcardNote(idOrNo,note){const j=jobcard(idOrNo);if(!j)return null;note=Object.assign({id:Date.now(),date:now().slice(0,10),time:new Date().toTimeString().slice(0,5)},clone(note));j.notes=j.notes||[];j.notes.unshift(note);save(`Note added: ${j.no}`);return clone(note)},
    addJobcardInspection(idOrNo,inspection){const j=jobcard(idOrNo);if(!j)return null;inspection=Object.assign({id:Date.now()},clone(inspection));j.inspections=j.inspections||[];j.inspections.push(inspection);save(`Inspection added: ${j.no}`);return clone(inspection)},
    updateJobcardInspection(idOrNo,inspId,patch){const j=jobcard(idOrNo);if(!j)return null;const insp=(j.inspections||[]).find(i=>i.id===inspId);if(!insp)return null;Object.assign(insp,clone(patch));save(`Inspection updated: ${j.no}`);return clone(insp)},
    recordJobcardActivity(idOrNo,entry){const j=jobcard(idOrNo);if(!j)return null;entry=Object.assign({date:now().slice(0,10),time:new Date().toTimeString().slice(0,5),by:'Aleksandar C.'},clone(entry));j.activity=j.activity||[];j.activity.unshift(entry);save(`Jobcard activity: ${j.no}`);return clone(entry)},
    getEquipment:()=>{ if(!Array.isArray(state.equipment)||state.equipment.length===0){ state.equipment=clone(seed().equipment); state.counters.equipment=state.equipment.length; save('Demo equipment initialised'); } return clone(state.equipment); },
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
      const next=Object.assign({}, clone(state.equipment[index]), clone(patch||{}));
      next.lastActivity=now();
      state.equipment[index]=next;
      save(`Equipment updated: ${equipmentId}`);
      return clone(next);
    },
    changeEquipmentStatus:(equipmentId,status,meta={})=>{
      const item=state.equipment.find(x=>x.equipmentId===equipmentId||x.id===equipmentId);
      if(!item) return {error:'Equipment not found'};
      const nextStatus=status||item.status;
      item.status=nextStatus;
      item.lastActivity=now();
      item.activity=item.activity||[];
      item.activity.unshift({timestamp:now(),action:`Status changed to ${nextStatus}`,user:meta.user||'Aleksandar C.',reference:equipmentId,details:meta.reason||''});
      save(`Equipment status changed: ${equipmentId}`);
      return clone(item);
    },
    assignEquipment:(equipmentId, assignment={})=>{
      const item=state.equipment.find(x=>x.equipmentId===equipmentId||x.id===equipmentId);
      if(!item) return {error:'Equipment not found'};
      const blocked=['Out of Service','Quarantined','Under Maintenance','Retired'];
      if(blocked.includes(item.status)) return {error:'Unavailable equipment cannot be assigned'};
      item.assignedProject=assignment.project||item.assignedProject||null;
      item.assignedJobcard=assignment.jobcard||item.assignedJobcard||null;
      item.currentLocation=assignment.location||item.currentLocation;
      item.operator=assignment.worker||item.operator||null;
      item.status=assignment.status||item.status||'Reserved';
      item.currentAssignment={...assignment, equipmentId:item.equipmentId, assignedBy:assignment.assignedBy||'Aleksandar C.', assignedDate:new Date().toISOString().slice(0,10)};
      item.activity=item.activity||[];
      item.activity.unshift({timestamp:now(),action:'Equipment assigned',user:assignment.assignedBy||'Aleksandar C.',reference:item.equipmentId,details:`${assignment.project||'—'} / ${assignment.jobcard||'—'}`});
      item.lastActivity=now();
      save(`Equipment assigned: ${equipmentId}`);
      return clone(item);
    },
    returnEquipment:(equipmentId, meta={})=>{
      const item=state.equipment.find(x=>x.equipmentId===equipmentId||x.id===equipmentId);
      if(!item) return {error:'Equipment not found'};
      item.assignedProject=null; item.assignedJobcard=null; item.currentLocation=meta.location||item.homeLocation||item.currentLocation; item.operator=null; item.status='Available';
      item.activity=item.activity||[]; item.activity.unshift({timestamp:now(),action:'Equipment returned',user:meta.user||'Aleksandar C.',reference:item.equipmentId,details:meta.note||''});
      item.lastActivity=now();
      save(`Equipment returned: ${equipmentId}`);
      return clone(item);
    },
    logEquipmentUsage:(equipmentId,usage={})=>{
      const item=state.equipment.find(x=>x.equipmentId===equipmentId||x.id===equipmentId);
      if(!item) return {error:'Equipment not found'};
      const record={
        id:Date.now().toString(),
        startTime:usage.startTime||now(),
        stopTime:usage.stopTime||now(),
        project:usage.project||item.assignedProject||null,
        jobcard:usage.jobcard||item.assignedJobcard||null,
        worker:usage.worker||item.operator||'Unassigned',
        duration:usage.duration||0,
        meterBefore:Number(item.operatingHourMeter)||0,
        meterAfter:Number(item.operatingHourMeter||0) + Number(usage.hours||0),
        fuelOrEnergy:usage.fuelOrEnergy||'n/a',
        notes:usage.notes||'',
        reportedProblems:usage.reportedProblems||[]
      };
      item.usageHistory=item.usageHistory||[]; item.usageHistory.unshift(record);
      item.operatingHourMeter=Number(item.operatingHourMeter||0)+Number(usage.hours||0);
      item.lastActivity=now();
      save(`Equipment usage logged: ${equipmentId}`);
      return clone(item);
    },
    addInspection:(equipmentId,inspection)=>{
      const item=state.equipment.find(x=>x.equipmentId===equipmentId||x.id===equipmentId);
      if(!item) return {error:'Equipment not found'};
      const rec={...clone(inspection), id:`INS-${Date.now()}`};
      item.inspections=item.inspections||[]; item.inspections.unshift(rec); item.activity=item.activity||[]; item.activity.unshift({timestamp:now(),action:'Inspection completed',user:inspection.inspector||'Aleksandar C.',reference:equipmentId,details:inspection.result||'Pending'}); item.lastActivity=now();
      save(`Inspection added: ${equipmentId}`);
      return clone(rec);
    },
    addMaintenanceRecord:(equipmentId,maintenance)=>{
      const item=state.equipment.find(x=>x.equipmentId===equipmentId||x.id===equipmentId);
      if(!item) return {error:'Equipment not found'};
      const rec={...clone(maintenance), id:`MAINT-${Date.now()}`};
      item.maintenance=item.maintenance||[]; item.maintenance.unshift(rec);
      item.lastActivity=now();
      save(`Maintenance added: ${equipmentId}`);
      return clone(rec);
    },
    addCertification:(equipmentId,cert)=>{
      const item=state.equipment.find(x=>x.equipmentId===equipmentId||x.id===equipmentId);
      if(!item) return {error:'Equipment not found'};
      const rec={...clone(cert), id:`CERT-${Date.now()}`};
      item.certifications=item.certifications||[]; item.certifications.unshift(rec); item.lastActivity=now();
      save(`Certification added: ${equipmentId}`);
      return clone(rec);
    },
    addCalibration:(equipmentId,calibration)=>{
      const item=state.equipment.find(x=>x.equipmentId===equipmentId||x.id===equipmentId);
      if(!item) return {error:'Equipment not found'};
      const rec={...clone(calibration), id:`CAL-${Date.now()}`};
      item.calibrations=item.calibrations||[]; item.calibrations.unshift(rec); item.lastActivity=now();
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
    reportBreakdown:(equipmentId,record)=>{
      const item=state.equipment.find(x=>x.equipmentId===equipmentId||x.id===equipmentId);
      if(!item) return {error:'Equipment not found'};
      const rec={...clone(record), id:`BR-${Date.now()}`, timestamp:now(), status:'Reported'};
      item.downtimeRecords=item.downtimeRecords||[]; item.downtimeRecords.unshift(rec); item.activity=item.activity||[]; item.activity.unshift({timestamp:now(),action:'Breakdown reported',user:record.responsiblePerson||'Aleksandar C.',reference:equipmentId,details:record.reason||''});
      item.lastActivity=now();
      state.breakdowns=state.breakdowns||[]; state.breakdowns.unshift(rec); save(`Breakdown reported: ${equipmentId}`); return clone(rec);
    },
    retireEquipment:(equipmentId,reason)=>{
      const item=state.equipment.find(x=>x.equipmentId===equipmentId||x.id===equipmentId);
      if(!item) return {error:'Equipment not found'};
      item.isRetired=true; item.retirementReason=reason||'Retired by operational decision'; item.status='Retired'; item.activity=item.activity||[]; item.activity.unshift({timestamp:now(),action:'Equipment retired',user:'Aleksandar C.',reference:equipmentId,details:reason||''}); item.lastActivity=now();
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
    applyQualityHold(payload){
      const rec=Object.assign({id:state.counters.hold=(state.counters.hold||0)+1,activity:[]},clone(payload));
      rec.no=rec.no||('HOLD-'+new Date().getFullYear()+'-'+String(rec.id).padStart(3,'0'));
      rec.appliedDate=rec.appliedDate||now();
      rec.status='active';
      qActivity(rec,'Quality Hold applied',null,'active',rec.no,rec.reason||'');
      state.qualityHolds.unshift(rec);
      save(`Quality Hold applied: ${rec.no}`); return clone(rec);
    },
    releaseQualityHold(idOrNo,{releaseAuthority,releaseReason}={}){
      const rec=qFind(state.qualityHolds,idOrNo); if(!rec)return{error:'Hold not found'};
      if(!releaseAuthority||!releaseReason)return{error:'Releasing a hold requires resolution evidence and an authorised approval reference'};
      const from=rec.status; rec.status='released'; rec.releaseAuthority=releaseAuthority; rec.releaseReason=releaseReason; rec.releaseDate=now();
      qActivity(rec,'Quality Hold released',from,'released',rec.no,releaseReason);
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
    }
  };
  global.WorkshopData=api;
})(window);
