(function(global){
  'use strict';
  const KEY='varmak.workshop.frontend.v4';
  const VERSION=4;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const now=()=>new Date().toISOString();
  const seed=()=>({
    version:VERSION,
    counters:{customer:40,estimation:25,project:15,movement:6,offcut:3,jobcard:2},
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
    }
  };
  global.WorkshopData=api;
})(window);
