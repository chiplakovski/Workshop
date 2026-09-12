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

  const MaterialReference={
    MATERIALS,SHAPES,PIPE_OD,PIPE_WALL,
    density,crossSection,weightPerBase,parsePipe,readDimensions,suggest
  };
  if(typeof module!=='undefined'&&module.exports)module.exports=MaterialReference;
  if(global)global.MaterialReference=MaterialReference;
})(typeof window!=='undefined'?window:(typeof globalThis!=='undefined'?globalThis:this));
