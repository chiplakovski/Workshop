// Standard material data for suggesting an item's weight while it is being entered.
//
// A static prototype cannot look this up online, and the published demo blocks
// outbound requests, so the reference lives here instead. The numbers are the
// ordinary engineering ones: densities in kg/m3 and EN/ASME pipe dimensions in
// mm. Every suggestion is a starting point the user can overwrite - nothing
// here overwrites a figure somebody typed.
(function(global){
  'use strict';

  // kg/m3
  const DENSITY={
    's235jr':7850,'s355j2':7850,'mildsteel':7850,'carbonsteel':7850,
    'aisi304':7900,'aisi316':8000,'stainless':7900,
    'aluminium':2700,'copper':8960,'brass':8500,'bronze':8800,
    'castiron':7200,'titanium':4510,'pvc':1400,'hdpe':960
  };
  const MATERIALS=[
    {id:'s235jr',name:'S235JR mild steel',density:7850},
    {id:'s355j2',name:'S355J2 mild steel',density:7850},
    {id:'aisi304',name:'AISI 304 stainless',density:7900},
    {id:'aisi316',name:'AISI 316 stainless',density:8000},
    {id:'aluminium',name:'Aluminium',density:2700},
    {id:'copper',name:'Copper',density:8960},
    {id:'brass',name:'Brass',density:8500},
    {id:'cast-iron',name:'Cast iron',density:7200},
    {id:'pvc',name:'PVC',density:1400},
    {id:'hdpe',name:'HDPE',density:960}
  ];

  // Outside diameter in mm by nominal bore.
  const PIPE_OD={15:21.3,20:26.9,25:33.7,32:42.4,40:48.3,50:60.3,65:76.1,80:88.9,
    100:114.3,125:139.7,150:168.3,200:219.1,250:273.0,300:323.9,350:355.6,400:406.4};
  // Wall thickness in mm by nominal bore, per schedule.
  const PIPE_WALL={
    '10':{15:2.11,20:2.11,25:2.77,32:2.77,40:2.77,50:2.77,65:3.05,80:3.05,100:3.05,
      125:3.40,150:3.40,200:3.76,250:4.19,300:4.57,350:4.78,400:4.78},
    '40':{15:2.77,20:2.87,25:3.38,32:3.56,40:3.68,50:3.91,65:5.16,80:5.49,100:6.02,
      125:6.55,150:7.11,200:8.18,250:9.27,300:10.31,350:11.13,400:12.70},
    '80':{15:3.73,20:3.91,25:4.55,32:4.85,40:5.08,50:5.54,65:7.01,80:7.62,100:8.56,
      125:9.53,150:10.97,200:12.70,250:15.09,300:17.45,350:19.05,400:21.44}
  };

  const SHAPES=[
    {id:'round-pipe',name:'Round pipe / tube',dims:['od','wall'],base:'m'},
    {id:'square-tube',name:'Square tube',dims:['a','wall'],base:'m'},
    {id:'rect-tube',name:'Rectangular tube',dims:['a','b','wall'],base:'m'},
    {id:'round-bar',name:'Round bar',dims:['d'],base:'m'},
    {id:'flat-bar',name:'Flat bar',dims:['a','b'],base:'m'},
    {id:'angle',name:'Equal / unequal angle',dims:['a','b','wall'],base:'m'},
    {id:'sheet',name:'Sheet / plate',dims:['wall'],base:'m2'}
  ];

  const num=v=>{const n=Number(v);return Number.isFinite(n)&&n>0?n:0;};
  const round=(n,p)=>{const f=Math.pow(10,p==null?3:p);return Math.round(n*f)/f;};

  function density(material){
    if(material==null)return 0;
    if(typeof material==='number')return num(material);
    // Everything is compared with separators stripped, so "AISI 304",
    // "aisi-304" and "AISI 304 2B" all reach the same entry.
    const key=String(material).trim().toLowerCase().replace(/[^a-z0-9]+/g,'');
    if(DENSITY[key])return DENSITY[key];
    // "AISI 304 2B" and "304" should both find stainless; take the longest
    // matching name rather than the first, so 316 never resolves to 3.
    let best=0,bestLen=0;
    for(const id of Object.keys(DENSITY)){
      const flat=id.replace(/-/g,'');
      if(key.indexOf(flat)>=0&&flat.length>bestLen){best=DENSITY[id];bestLen=flat.length;}
    }
    return best;
  }

  // A hollow section is not square at the corners: EN 10219 rolls them to an
  // outer radius of about 2t over an inner radius of t. Squaring them off
  // overstates the steel by roughly 3%, which is the difference between a
  // suggestion that matches the supplier's table and one that does not.
  const cornerLoss=t=>(4-Math.PI)*3*t*t;

  // Cross-sectional area in mm2, or for sheet the area of one m2 slice.
  function crossSection(shape,dims){
    const d=dims||{};
    const a=num(d.a),b=num(d.b),w=num(d.wall),od=num(d.od),dia=num(d.d);
    switch(shape){
      case 'round-pipe':{
        if(!od||!w||w*2>=od)return 0;
        const id=od-2*w;
        return Math.PI/4*(od*od-id*id);
      }
      case 'square-tube':{
        if(!a||!w||w*2>=a)return 0;
        return a*a-(a-2*w)*(a-2*w)-cornerLoss(w);
      }
      case 'rect-tube':{
        if(!a||!b||!w||w*2>=a||w*2>=b)return 0;
        return a*b-(a-2*w)*(b-2*w)-cornerLoss(w);
      }
      case 'round-bar':return dia?Math.PI/4*dia*dia:0;
      case 'flat-bar':return a&&b?a*b:0;
      case 'angle':{
        if(!a||!b||!w)return 0;
        return (a+b-w)*w;
      }
      case 'sheet':return w?w*1000:0;   // 1 m of width, thickness in mm
      default:return 0;
    }
  }

  // Weight of one base unit: kg per metre for anything linear, kg per square
  // metre for sheet. Returns null when there is not enough to work from, so a
  // caller can leave the field alone instead of writing a zero into it.
  function weightPerBase(shape,dims,material){
    const rho=density(material);
    const area=crossSection(shape,dims);
    if(!rho||!area)return null;
    const spec=SHAPES.find(s=>s.id===shape);
    const base=spec?spec.base:'m';
    // area is mm2 for a 1 m length, or mm2 per 1 m width for sheet
    return {weightPerBase:round(area/1e6*rho,3),baseUnit:base};
  }

  // "DN100 SCH40", "dn 100 sch 40", "100 sch40" -> the pipe's own dimensions.
  function parsePipe(text){
    const t=String(text||'').toLowerCase();
    const dn=/(?:dn|nb)\s*(\d{2,3})/.exec(t)||/\b(\d{2,3})\s*mm\b/.exec(t);
    const sch=/(?:sch|schedule)\s*\.?\s*(10|40|80)\b/.exec(t);
    if(!dn)return null;
    const bore=Number(dn[1]);
    const od=PIPE_OD[bore];
    if(!od)return null;
    const schedule=sch?sch[1]:'40';
    const wall=(PIPE_WALL[schedule]||{})[bore];
    if(!wall)return null;
    return {shape:'round-pipe',bore,schedule,od,wall,
      label:`DN${bore} SCH${schedule} · ⌀${od} × ${wall} mm`};
  }

  // Everything a create form needs from a description and a material: the
  // shape it recognised, the dimensions it read, and the weight that follows.
  function suggest(description,material,fallbackShape){
    const pipe=parsePipe(description);
    if(pipe){
      const w=weightPerBase('round-pipe',{od:pipe.od,wall:pipe.wall},material);
      return w?Object.assign({source:'pipe-schedule'},pipe,w):null;
    }
    if(fallbackShape){
      const dims=readDimensions(description);
      const w=dims?weightPerBase(fallbackShape,dims,material):null;
      return w?Object.assign({source:'dimensions',shape:fallbackShape},dims,w):null;
    }
    return null;
  }

  // "25×25×1.6 mm" or "40 x 40 x 2.0" -> {a,b,wall}; "2.0 × 1250 × 2500" is a
  // sheet, where the first figure is the thickness.
  function readDimensions(text){
    const nums=(String(text||'').match(/\d+(?:[.,]\d+)?/g)||[]).map(n=>Number(String(n).replace(',','.')));
    if(nums.length>=3)return{a:nums[0],b:nums[1],wall:nums[2]};
    if(nums.length===2)return{a:nums[0],wall:nums[1]};
    if(nums.length===1)return{wall:nums[0]};
    return null;
  }

  // ==========================================================================
  // Catalogue of standard workshop products
  // ==========================================================================
  // What a store actually buys, as templates a create form can pull in whole.
  // Weights are computed from the section wherever that is honest - plate, bar,
  // hollow section, pipe, elbows, discs all follow from their geometry and the
  // density. Manufactured items whose weight depends on the maker - valves,
  // flanges, fasteners, filled gas bottles - come from a table and are marked
  // `indicative`, so the form can say the figure is a starting point.

  const SHEET_SIZES=[[1000,2000],[1250,2500],[1500,3000],[2000,6000],[1500,6000]];
  const PLATE_THICKNESS=[0.8,1,1.2,1.5,2,2.5,3,4,5,6,8,10,12,15,20,25,30];
  const PLATE_GRADES=['s235jr','s355j2','aisi304','aisi316','aluminium'];

  const SHS_SIZES=[[20,2],[25,1.5],[25,2],[30,2],[40,2],[40,3],[50,2],[50,3],[60,3],[80,3],[80,4],[100,4],[120,5],[150,5]];
  const RHS_SIZES=[[40,20,2],[50,30,2],[60,40,3],[80,40,3],[100,50,3],[120,60,4],[150,100,5]];
  const ROUND_BAR=[8,10,12,16,20,25,30,40,50,60,80,100];
  const FLAT_BAR=[[20,3],[25,4],[30,5],[40,5],[50,6],[50,8],[60,8],[80,10],[100,10]];
  const ANGLE_SIZES=[[25,25,3],[30,30,3],[40,40,4],[50,50,5],[60,60,6],[80,80,8],[100,100,10]];

  const PIPE_BORES=[15,20,25,32,40,50,65,80,100,125,150,200,250,300];
  const PIPE_LENGTH=6;              // a stock length, metres

  // EN 1092-1 type 11 weld-neck flange, kg each. Indicative: pattern and face
  // finish move these by a few per cent.
  const FLANGE_KG={
    '10':{15:0.7,20:0.9,25:1.1,32:1.6,40:1.9,50:2.4,65:3.4,80:4.1,100:5.3,125:7.4,150:8.9,200:13.5,250:19.5,300:26.5},
    '16':{15:0.8,20:1.0,25:1.2,32:1.8,40:2.1,50:2.7,65:3.8,80:4.6,100:6.2,125:8.9,150:11.0,200:17.0,250:25.0,300:35.0},
    '40':{15:0.9,20:1.2,25:1.5,32:2.2,40:2.7,50:3.4,65:5.0,80:6.3,100:9.0,125:13.5,150:17.5,200:29.0,250:45.0,300:64.0}
  };
  const FLANGE_TYPES=[['wn','Weld neck'],['so','Slip-on'],['bl','Blind']];
  // Slip-on runs lighter than weld neck, blind heavier.
  const FLANGE_FACTOR={wn:1,so:0.82,bl:1.35};

  // Valve mass, kg each, flanged body. Indicative - a maker's own figure wins.
  const VALVE_KG={
    ball:{15:1.2,20:1.6,25:2.3,32:3.6,40:4.6,50:6.5,65:11,80:14,100:22,125:34,150:45,200:82,250:135,300:200},
    gate:{15:2.4,20:3.0,25:4.2,32:6.0,40:7.5,50:10,65:15,80:20,100:31,125:47,150:63,200:110,250:175,300:260},
    globe:{15:2.8,20:3.5,25:4.8,32:7.0,40:9.0,50:12,65:18,80:24,100:38,125:57,150:76,200:135,250:215,300:320},
    check:{15:1.4,20:1.8,25:2.5,32:3.8,40:4.8,50:6.8,65:10,80:13,100:20,125:30,150:40,200:72,250:118,300:175},
    butterfly:{50:3.0,65:3.6,80:4.2,100:5.5,125:7.2,150:9.0,200:14,250:21,300:30}
  };
  const VALVE_TYPES=[['ball','Ball valve'],['gate','Gate valve'],['globe','Globe valve'],
    ['check','Check valve'],['butterfly','Butterfly valve']];
  const VALVE_PN=['16','25','40'];
  // Higher pressure class means a heavier body.
  const VALVE_PN_FACTOR={'16':1,'25':1.15,'40':1.35};

  const WELD_WIRE=[
    {id:'er70s6',name:'MIG wire ER70S-6',dias:[0.8,1.0,1.2],packs:[5,15],material:'s235jr'},
    {id:'er308l',name:'MIG wire ER308LSi',dias:[0.8,1.0,1.2],packs:[5,15],material:'aisi304'},
    {id:'er5356',name:'MIG wire ER5356 aluminium',dias:[1.0,1.2],packs:[2,7],material:'aluminium'},
    {id:'e7018',name:'Electrode E7018',dias:[2.5,3.2,4.0],packs:[4.5,15],material:'s235jr'},
    {id:'e308l',name:'Electrode E308L-16',dias:[2.5,3.2],packs:[2,4.5],material:'aisi304'},
    {id:'tig308',name:'TIG rod ER308L',dias:[1.6,2.4,3.2],packs:[5],material:'aisi304'}
  ];

  const DISC_KINDS=[
    {id:'cut',name:'Cutting disc',thick:[1.0,1.6,2.5,3.0]},
    {id:'grind',name:'Grinding disc',thick:[6.0,7.0]},
    {id:'flap',name:'Flap disc',thick:[6.0]}
  ];
  const DISC_DIA=[[115,22.23],[125,22.23],[180,22.23],[230,22.23]];
  const ABRASIVE_DENSITY=2400;      // bonded abrasive, kg/m3

  const GASES=[
    {id:'argon',name:'Argon 4.6',bottles:[[20,200],[50,200]]},
    {id:'co2',name:'Carbon dioxide',bottles:[[10,50],[20,50]]},
    {id:'mix82',name:'Mix 82/18 Ar/CO2',bottles:[[20,200],[50,200]]},
    {id:'oxygen',name:'Oxygen',bottles:[[20,200],[50,200]]},
    {id:'acetylene',name:'Acetylene',bottles:[[20,19],[40,19]]}
  ];

  // Mass of one bolt in kg, hex head DIN 933 in steel, by thread and length.
  // Interpolated from the shank plus a head allowance, which is how supplier
  // tables are built.
  const THREAD_D={m5:5,m6:6,m8:8,m10:10,m12:12,m16:16,m20:20,m24:24};
  const BOLT_LENGTHS=[16,20,25,30,40,50,60,80,100];
  const NUT_KG={m5:0.0009,m6:0.0026,m8:0.0055,m10:0.0107,m12:0.0169,m16:0.0347,m20:0.0668,m24:0.1188};
  const WASHER_KG={m5:0.0007,m6:0.0011,m8:0.0022,m10:0.0037,m12:0.0058,m16:0.0113,m20:0.0187,m24:0.0304};
  const FASTENER_GRADES=[['8.8','8.8 zinc plated'],['a2','A2 stainless'],['a4','A4 stainless']];
  const FASTENER_DENSITY={'8.8':7850,a2:7900,a4:8000};

  const mm=n=>Number(n).toString().replace(/\.0$/,'');
  // A plate is filed by what it is made of, not by whichever subgroup the
  // family happens to default to.
  const GRADE_SUBGROUP={s235jr:'mild-steel',s355j2:'mild-steel',aisi304:'stainless-steel',
    aisi316:'stainless-steel',aluminium:'aluminium',copper:'copper'};
  const subFor=g=>GRADE_SUBGROUP[g]||null;
  const grade=id=>(MATERIALS.find(m=>m.id===id)||{}).name||id;

  // ---- Per-family product builders -----------------------------------------
  // Each returns entries shaped like the item form's own fields, so pulling one
  // in is a straight copy rather than a translation.
  const FAMILY_BUILDERS={
    plate(){
      const out=[];
      for(const g of PLATE_GRADES)for(const t of PLATE_THICKNESS)for(const [w,l] of SHEET_SIZES){
        const perM2=weightPerBase('sheet',{wall:t},g);
        if(!perM2)continue;
        const area=round(w*l/1e6,3);
        out.push({id:`plate-${g}-${t}-${w}x${l}`,
          name:`Plate ${mm(t)} mm ${grade(g)} ${w}×${l}`,
          description:`Plate ${mm(t)} mm ${grade(g)} ${w}×${l} mm`,
          grade:grade(g),dimensions:`${mm(t)} × ${w} × ${l} mm`,
          unit:'EA',baseUnit:'m2',sizePerUnit:area,weightPerBase:perM2.weightPerBase,
          shape:'sheet',subgroup:subFor(g)});
      }
      return out;
    },
    pipe(){
      const out=[];
      for(const g of ['s235jr','aisi304','aisi316'])for(const sch of ['10','40','80'])for(const dn of PIPE_BORES){
        const od=PIPE_OD[dn],wall=(PIPE_WALL[sch]||{})[dn];
        if(!od||!wall)continue;
        const w=weightPerBase('round-pipe',{od,wall},g);
        if(!w)continue;
        out.push({id:`pipe-${g}-${sch}-${dn}`,
          name:`Pipe DN${dn} SCH${sch} ${grade(g)}`,
          description:`Pipe DN${dn} SCH${sch} ${grade(g)} ${PIPE_LENGTH} m`,
          grade:grade(g),dimensions:`⌀${od} × ${wall} mm · ${PIPE_LENGTH} m`,
          unit:'EA',baseUnit:'m',sizePerUnit:PIPE_LENGTH,weightPerBase:w.weightPerBase,
          shape:'round-pipe'});
      }
      return out;
    },
    section(){
      const out=[];
      for(const g of ['s235jr','s355j2','aisi304']){
        for(const [a,t] of SHS_SIZES){
          const w=weightPerBase('square-tube',{a,wall:t},g);
          if(!w)continue;
          out.push({id:`shs-${g}-${a}-${t}`,name:`SHS ${a}×${a}×${mm(t)} ${grade(g)}`,
            description:`Square tube ${a}×${a}×${mm(t)} mm ${PIPE_LENGTH} m`,
            grade:grade(g),dimensions:`${a} × ${a} × ${mm(t)} mm · ${PIPE_LENGTH} m`,
            unit:'EA',baseUnit:'m',sizePerUnit:PIPE_LENGTH,weightPerBase:w.weightPerBase,shape:'square-tube',subgroup:subFor(g)});
        }
        for(const [a,b,t] of RHS_SIZES){
          const w=weightPerBase('rect-tube',{a,b,wall:t},g);
          if(!w)continue;
          out.push({id:`rhs-${g}-${a}x${b}-${t}`,name:`RHS ${a}×${b}×${mm(t)} ${grade(g)}`,
            description:`Rectangular tube ${a}×${b}×${mm(t)} mm ${PIPE_LENGTH} m`,
            grade:grade(g),dimensions:`${a} × ${b} × ${mm(t)} mm · ${PIPE_LENGTH} m`,
            unit:'EA',baseUnit:'m',sizePerUnit:PIPE_LENGTH,weightPerBase:w.weightPerBase,shape:'rect-tube',subgroup:subFor(g)});
        }
        for(const [a,b,t] of ANGLE_SIZES){
          const w=weightPerBase('angle',{a,b,wall:t},g);
          if(!w)continue;
          out.push({id:`ang-${g}-${a}x${b}-${t}`,name:`Angle ${a}×${b}×${mm(t)} ${grade(g)}`,
            description:`Angle ${a}×${b}×${mm(t)} mm ${PIPE_LENGTH} m`,
            grade:grade(g),dimensions:`${a} × ${b} × ${mm(t)} mm · ${PIPE_LENGTH} m`,
            unit:'EA',baseUnit:'m',sizePerUnit:PIPE_LENGTH,weightPerBase:w.weightPerBase,shape:'angle',subgroup:subFor(g)});
        }
      }
      return out;
    },
    bar(){
      const out=[];
      for(const g of ['s235jr','aisi304','aluminium','copper','brass']){
        for(const d of ROUND_BAR){
          const w=weightPerBase('round-bar',{d},g);
          if(!w)continue;
          out.push({id:`rb-${g}-${d}`,name:`Round bar ⌀${d} ${grade(g)}`,
            description:`Round bar ⌀${d} mm ${grade(g)} ${PIPE_LENGTH} m`,
            grade:grade(g),dimensions:`⌀${d} mm · ${PIPE_LENGTH} m`,
            unit:'EA',baseUnit:'m',sizePerUnit:PIPE_LENGTH,weightPerBase:w.weightPerBase,shape:'round-bar',subgroup:subFor(g)});
        }
        for(const [a,b] of FLAT_BAR){
          const w=weightPerBase('flat-bar',{a,b},g);
          if(!w)continue;
          out.push({id:`fb-${g}-${a}x${b}`,name:`Flat bar ${a}×${b} ${grade(g)}`,
            description:`Flat bar ${a}×${b} mm ${grade(g)} ${PIPE_LENGTH} m`,
            grade:grade(g),dimensions:`${a} × ${b} mm · ${PIPE_LENGTH} m`,
            unit:'EA',baseUnit:'m',sizePerUnit:PIPE_LENGTH,weightPerBase:w.weightPerBase,shape:'flat-bar',subgroup:subFor(g)});
        }
      }
      return out;
    },
    fitting(){
      // A long-radius 90° elbow is 1.5 bore of centreline, so its weight
      // follows from the pipe it is made of rather than from a table.
      const out=[];
      const kinds=[['elb90','Elbow 90° LR',d=>Math.PI/2*1.5*d/1000],
                   ['elb45','Elbow 45° LR',d=>Math.PI/4*1.5*d/1000],
                   ['tee','Equal tee',d=>2.2*d/1000],
                   ['red','Concentric reducer',d=>1.6*d/1000],
                   ['cap','Cap',d=>0.7*d/1000]];
      for(const g of ['s235jr','aisi304','aisi316'])for(const sch of ['40','80'])for(const dn of PIPE_BORES){
        const od=PIPE_OD[dn],wall=(PIPE_WALL[sch]||{})[dn];
        if(!od||!wall)continue;
        const perM=weightPerBase('round-pipe',{od,wall},g);
        if(!perM)continue;
        for(const [kid,kname,len] of kinds){
          out.push({id:`fit-${kid}-${g}-${sch}-${dn}`,
            name:`${kname} DN${dn} SCH${sch} ${grade(g)}`,
            description:`${kname} DN${dn} SCH${sch} ${grade(g)}`,
            grade:grade(g),dimensions:`DN${dn} · ⌀${od} × ${wall} mm`,
            unit:'EA',baseUnit:'pcs',sizePerUnit:1,
            weightPerBase:round(perM.weightPerBase*len(dn),3),shape:'round-pipe'});
        }
      }
      return out;
    },
    flange(){
      const out=[];
      for(const g of ['s235jr','aisi304'])for(const pn of Object.keys(FLANGE_KG))
        for(const [tid,tname] of FLANGE_TYPES)for(const dn of Object.keys(FLANGE_KG[pn])){
          const base=FLANGE_KG[pn][dn];
          const rho=density(g)/7850;   // the table is steel; scale by density
          out.push({id:`flg-${tid}-${g}-${pn}-${dn}`,
            name:`${tname} flange DN${dn} PN${pn} ${grade(g)}`,
            description:`${tname} flange DN${dn} PN${pn} ${grade(g)}`,
            grade:grade(g),dimensions:`DN${dn} · PN${pn}`,
            unit:'EA',baseUnit:'pcs',sizePerUnit:1,
            weightPerBase:round(base*FLANGE_FACTOR[tid]*rho,3),indicative:true});
        }
      return out;
    },
    valve(){
      const out=[];
      for(const [tid,tname] of VALVE_TYPES)for(const pn of VALVE_PN)
        for(const dn of Object.keys(VALVE_KG[tid])){
          out.push({id:`vlv-${tid}-${pn}-${dn}`,
            name:`${tname} DN${dn} PN${pn}`,
            description:`${tname} DN${dn} PN${pn} flanged`,
            grade:'',dimensions:`DN${dn} · PN${pn}`,
            unit:'EA',baseUnit:'pcs',sizePerUnit:1,
            weightPerBase:round(VALVE_KG[tid][dn]*VALVE_PN_FACTOR[pn],2),indicative:true});
        }
      return out;
    },
    welding(){
      const out=[];
      for(const w of WELD_WIRE)for(const d of w.dias)for(const pack of w.packs){
        const spool=w.id.startsWith('e')&&!w.id.startsWith('er')?'pack':'spool';
        const dia=Number(d).toFixed(1);
        out.push({id:`wld-${w.id}-${d}-${pack}`,
          name:`${w.name} ⌀${dia} — ${mm(pack)} kg`,
          description:`${w.name} ⌀${dia} mm ${mm(pack)} kg ${spool}`,
          grade:grade(w.material),dimensions:`⌀${dia} mm`,
          unit:'EA',baseUnit:'kg',sizePerUnit:pack,weightPerBase:1});
      }
      return out;
    },
    abrasive(){
      const out=[];
      for(const k of DISC_KINDS)for(const [dia,bore] of DISC_DIA)for(const t of k.thick){
        const vol=Math.PI/4*(dia*dia-bore*bore)*t/1e9;   // m3
        out.push({id:`abr-${k.id}-${dia}-${mm(t)}`,
          name:`${k.name} ${dia}×${mm(t)}×${bore}`,
          description:`${k.name} ${dia}×${mm(t)}×${bore} mm`,
          grade:'',dimensions:`${dia} × ${mm(t)} × ${bore} mm`,
          unit:'EA',baseUnit:'pcs',sizePerUnit:1,
          weightPerBase:round(vol*ABRASIVE_DENSITY,3)});
      }
      return out;
    },
    gas(){
      const out=[];
      for(const g of GASES)for(const [litres,bar] of g.bottles){
        // Free gas in the bottle: water volume times pressure.
        const m3=round(litres*bar/1000,2);
        out.push({id:`gas-${g.id}-${litres}-${bar}`,
          name:`${g.name} ${litres} l / ${bar} bar`,
          description:`${g.name} ${litres} l bottle, ${bar} bar (~${m3} m³)`,
          grade:'',dimensions:`${litres} l · ${bar} bar`,
          unit:'EA',baseUnit:'m3',sizePerUnit:m3,weightPerBase:0,indicative:true});
      }
      return out;
    },
    fastener(){
      const out=[];
      for(const [gid,gname] of FASTENER_GRADES){
        const rho=FASTENER_DENSITY[gid];
        for(const [tid,d] of Object.entries(THREAD_D)){
          for(const L of BOLT_LENGTHS){
            if(L<d*1.5)continue;
            // Shank plus a head of about 0.7d thick across 1.7d, the usual
            // proportions for a DIN 933 hex head.
            const shank=Math.PI/4*d*d*L;
            const head=Math.PI/4*Math.pow(1.7*d,2)*0.7*d;
            out.push({id:`bolt-${gid}-${tid}-${L}`,
              name:`Hex bolt M${d}×${L} ${gname}`,
              description:`Hex bolt M${d}×${L} DIN 933 ${gname}`,
              grade:gname,dimensions:`M${d} × ${L} mm`,
              unit:'EA',baseUnit:'pcs',sizePerUnit:1,
              weightPerBase:round((shank+head)/1e9*rho,4)});
          }
          out.push({id:`nut-${gid}-${tid}`,name:`Hex nut M${d} ${gname}`,
            description:`Hex nut M${d} DIN 934 ${gname}`,grade:gname,dimensions:`M${d}`,
            unit:'EA',baseUnit:'pcs',sizePerUnit:1,
            weightPerBase:round(NUT_KG[tid]*rho/7850,4)});
          out.push({id:`wsh-${gid}-${tid}`,name:`Washer M${d} ${gname}`,
            description:`Flat washer M${d} DIN 125 ${gname}`,grade:gname,dimensions:`M${d}`,
            unit:'EA',baseUnit:'pcs',sizePerUnit:1,
            weightPerBase:round(WASHER_KG[tid]*rho/7850,4)});
        }
      }
      return out;
    }
  };

  // Which item group and subgroup a family belongs under, so pulling a product
  // in can file it as well as describe it.
  const FAMILIES=[
    {id:'plate',name:'Plate & sheet',group:'materials',subgroup:'stainless-steel'},
    {id:'pipe',name:'Pipe',group:'materials',subgroup:'pipe-fittings'},
    {id:'section',name:'Hollow section & angle',group:'materials',subgroup:'mild-steel'},
    {id:'bar',name:'Bar',group:'materials',subgroup:'mild-steel'},
    {id:'fitting',name:'Butt-weld fittings',group:'materials',subgroup:'pipe-fittings'},
    {id:'flange',name:'Flanges',group:'materials',subgroup:'pipe-fittings'},
    {id:'valve',name:'Valves',group:'materials',subgroup:'pipe-fittings'},
    {id:'welding',name:'Welding consumables',group:'consumables',subgroup:'welding'},
    {id:'abrasive',name:'Cutting & grinding discs',group:'consumables',subgroup:'abrasives'},
    {id:'gas',name:'Industrial gases',group:'consumables',subgroup:'gases'},
    {id:'fastener',name:'Fasteners',group:'hardware',subgroup:'fasteners'}
  ];

  const productCache={};
  function catalogueFamilies(){return FAMILIES.map(f=>Object.assign({},f));}
  function catalogueProducts(familyId,query){
    const build=FAMILY_BUILDERS[familyId];
    if(!build)return[];
    if(!productCache[familyId])productCache[familyId]=build();
    const all=productCache[familyId];
    const norm=v=>String(v||'').toLowerCase().replace(/[×✕⨯]/g,'x');
    const q=norm(query).trim();
    if(!q)return all.map(p=>Object.assign({},p));
    // Every word has to appear somewhere, so "304 dn50 sch40" narrows rather
    // than matching anything containing any of them.
    const words=q.split(/\s+/);
    const scored=[];
    for(const p of all){
      const name=norm(p.name);
      const hay=norm(`${p.name} ${p.description} ${p.grade} ${p.dimensions}`);
      // "aisi304" and "AISI 304" are the same search, so match the separator-free
      // spelling too.
      const flat=hay.replace(/[^a-z0-9]+/g,'');
      if(!words.every(w=>hay.indexOf(w)>=0||flat.indexOf(w.replace(/[^a-z0-9]+/g,''))>=0))continue;
      // A word standing on its own beats the same digits buried in 3000.
      const whole=words.filter(w=>new RegExp(`(^|[^0-9a-z])${w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}([^0-9a-z]|$)`).test(name)).length;
      scored.push({p,score:(name.indexOf(q)>=0?1000:0)+whole*10-p.name.length/100});
    }
    scored.sort((a,b)=>b.score-a.score||a.p.name.localeCompare(b.p.name));
    return scored.map(x=>Object.assign({},x.p));
  }
  function catalogueProduct(familyId,productId){
    const family=FAMILIES.find(f=>f.id===familyId);
    const hit=catalogueProducts(familyId).find(p=>p.id===productId);
    if(!hit)return null;
    return Object.assign({},hit,{family:familyId,group:family.group,subgroup:hit.subgroup||family.subgroup});
  }
  function catalogueSize(){
    return FAMILIES.reduce((n,f)=>n+catalogueProducts(f.id).length,0);
  }

  const MaterialReference={
    MATERIALS,SHAPES,PIPE_OD,PIPE_WALL,
    density,crossSection,weightPerBase,parsePipe,readDimensions,suggest,
    catalogueFamilies,catalogueProducts,catalogueProduct,catalogueSize
  };
  if(typeof module!=='undefined'&&module.exports)module.exports=MaterialReference;
  if(global)global.MaterialReference=MaterialReference;
})(typeof window!=='undefined'?window:(typeof globalThis!=='undefined'?globalThis:this));
