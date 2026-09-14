// Rules for the work the workshop could be doing but has not been asked to do yet: findings from
// an outward sweep of public sources, triaged before anybody looks at them.
//
// The discipline is the same as everywhere else in this workshop. A finding without a source is
// not a finding and is dropped. What the shop can do is read from the equipment register, never
// from a list somebody typed — so a process with no machine behind it is reported as missing
// rather than assumed. And a finding already reported once is not reported again.
(function(global){
  'use strict';

  const DAY=86400000;

  // What a finding can be. The classes are the ones an outward sweep actually produces: a job
  // somebody is asking for now, an idea looking for a maker, a repair, a contractor worth
  // approaching, and the two that are not yet work but are worth keeping an eye on.
  const CLASSES=[
    {id:'hot',name:'Hot lead'},
    {id:'prototype',name:'Prototype / invention'},
    {id:'repair',name:'Repair lead'},
    {id:'subcontract',name:'Subcontract target'},
    {id:'weak',name:'Weak signal'},
    {id:'watch',name:'Watch'}
  ];
  const VERDICTS=['go','maybe','skip'];

  // The processes a metal workshop sells, and the equipment categories that perform each. A
  // machine is what makes a process real; nothing here claims a capability the register does
  // not carry.
  const PROCESSES=[
    {id:'welding',name:'Welding',categories:['Welding Machine'],match:/weld|svets|mig|mag|tig/i},
    {id:'cutting',name:'Cutting',categories:['Cutting Equipment','CNC Machine'],match:/cut|skär|kap|plasma|laser|oxy|gas cut/i},
    {id:'bending',name:'Bending / forming',categories:['Forming Equipment'],match:/bend|fold|kant|press brake|bock/i},
    {id:'finishing',name:'Grinding / finishing',categories:['Power Tool'],match:/grind|slip|deburr|finish/i},
    {id:'lifting',name:'Lifting / handling',categories:['Lifting Equipment','Forklift'],match:/lift|kran|hoist|tung/i}
  ];
  // A machine in one of these states cannot be counted on today. It still proves the shop owns
  // the process — the distinction matters, so both are reported.
  const OUT_OF_ACTION=['out of service','under maintenance','quarantined','retired'];

  const norm=s=>String(s==null?'':s).trim();
  const lower=s=>norm(s).toLowerCase();
  const day=v=>{if(!v)return null;const d=new Date(v);return Number.isNaN(d.getTime())?null:d;};
  const round2=n=>Math.round((Number(n)||0)*100)/100;

  // ── What the workshop can actually do ────────────────────────────────────────────────────
  function capabilities(equipment){
    const fleet=(Array.isArray(equipment)?equipment:[]).filter(e=>e&&!e.isRetired);
    return PROCESSES.map(p=>{
      const machines=fleet.filter(e=>p.categories.includes(norm(e.category)));
      const usable=machines.filter(e=>!OUT_OF_ACTION.includes(lower(e.status)));
      return {
        id:p.id,name:p.name,
        owned:machines.length>0,
        usable:usable.length>0,
        machines:machines.map(e=>({id:e.equipmentId||e.id,name:e.name,status:norm(e.status)}))
      };
    });
  }

  // What a finding needs, taken from what it says it needs and, failing that, from the words it
  // is written in. Reading the words is a fallback, not a guess dressed up as data: a finding
  // that names nothing recognisable comes back with an empty list.
  function processesNeeded(finding){
    if(!finding)return [];
    const stated=Array.isArray(finding.needs)?finding.needs.map(lower):[];
    if(stated.length)return PROCESSES.filter(p=>stated.includes(p.id)).map(p=>p.id);
    const text=[finding.title,finding.summary,finding.need].map(norm).join(' ');
    return PROCESSES.filter(p=>p.match.test(text)).map(p=>p.id);
  }

  // Work the finding asks for that this shop does not sell at all — not a machine it happens to
  // be short of, a trade it is not in. Dropping these silently would turn "they want 100-ton
  // pressing" into "they did not say what they want", which reads to the user as a maybe when
  // the honest answer is no.
  function outsideTrade(finding){
    if(!finding||!Array.isArray(finding.needs))return [];
    return finding.needs.map(lower).filter(id=>id&&!PROCESSES.some(p=>p.id===id));
  }

  // Which of them the shop covers. A process with no machine is `missing` — this is where "do
  // not assume a press we do not own" is enforced, rather than asked for.
  function matchCapabilities(finding,equipment){
    const caps=capabilities(equipment);
    const needed=processesNeeded(finding);
    const outside=outsideTrade(finding);
    const byId=id=>caps.find(c=>c.id===id);
    const covered=[],busy=[],missing=[];
    needed.forEach(id=>{
      const c=byId(id);
      if(!c||!c.owned)missing.push(id);
      else if(!c.usable)busy.push(id);
      else covered.push(id);
    });
    return {
      needed,outside,covered,busy,missing,
      coverage:needed.length?round2((covered.length+busy.length)/needed.length):null,
      machines:covered.concat(busy).flatMap(id=>(byId(id)||{machines:[]}).machines)
    };
  }

  // ── A finding without a source is not a finding ───────────────────────────────────────────
  function isReportable(finding){
    if(!finding)return false;
    if(!norm(finding.title))return false;
    const src=norm(finding.sourceUrl);
    // A bare word is not a source. It has to be somewhere a person can go and look.
    return /^https?:\/\/\S+$/i.test(src)||/^[\w-]+(\.[\w-]+)+\/\S*$/i.test(src);
  }

  // ── Reported once, never reported again ───────────────────────────────────────────────────
  // The source is the identity of a finding. Where there is none the title and place stand in,
  // so a re-worded repost of the same job is still recognised.
  function fingerprint(finding){
    if(!finding)return '';
    const src=norm(finding.sourceUrl).toLowerCase()
      .replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/[?#].*$/,'').replace(/\/+$/,'');
    if(src)return 'u:'+src;
    return 't:'+lower(finding.title).replace(/\s+/g,' ')+'|'+lower(finding.place);
  }
  function isNew(finding,seen){
    const marks=seen instanceof Set?seen:new Set(Array.isArray(seen)?seen:[]);
    return !marks.has(fingerprint(finding));
  }

  // ── What the rules would say, and why ─────────────────────────────────────────────────────
  // A verdict the finding already carries is left alone — it came from whoever did the sweep.
  // This supplies one when there is none, and always says what it rests on.
  //
  // The score weighs a finding up. The ceiling stops it being weighed up past the facts: no
  // amount of "posted this morning, twenty minutes away" turns work the shop cannot do into a
  // job worth chasing. Freshness and distance decide between the findings the shop *can* take.
  const RANK={skip:0,maybe:1,go:2};
  const lowest=(a,b)=>RANK[a]<=RANK[b]?a:b;
  function ceiling(finding,match){
    // A watch is something to keep an eye on and a weak signal is a gap in the market. Neither is
    // somebody to ring today, however fresh and however close.
    const klass=lower(finding&&finding.klass);
    let top=(klass==='watch'||klass==='weak')?'maybe':'go';
    if(!match)return lowest(top,'maybe');
    // Work the shop cannot do: no machine for it, or not its trade at all.
    const beyond=match.missing.length+((match.outside||[]).length);
    if(!match.needed.length)return lowest(top,beyond?'skip':'maybe');
    if(!match.covered.length)return lowest(top,beyond?'skip':'maybe');
    // Part of it is outside the shop, so it can never be a plain yes on its own.
    if(beyond)return lowest(top,'maybe');
    return top;
  }
  function suggestVerdict(finding,match,options){
    const opts=options||{};
    const staleDays=Number(opts.staleDays)>0?Number(opts.staleDays):14;
    const farKm=Number(opts.farKm)>0?Number(opts.farKm):80;
    const reasons=[];
    let score=0;
    if(match&&match.missing.length){
      score-=2;reasons.push({code:'missing-capability',detail:match.missing.join(', ')});
    }
    if(match&&match.covered.length){
      score+=2;reasons.push({code:'covered',detail:match.covered.join(', ')});
    }
    if(match&&match.busy.length){
      reasons.push({code:'machine-busy',detail:match.busy.join(', ')});
    }
    if(match&&(match.outside||[]).length){
      score-=2;reasons.push({code:'outside-trade',detail:match.outside.join(', ')});
    }
    if(match&&!match.needed.length&&!(match.outside||[]).length){
      reasons.push({code:'no-process-named'});
    }
    const d=day(finding&&finding.date);
    if(d){
      const age=Math.floor((Date.now()-d.getTime())/DAY);
      if(age>staleDays){score-=1;reasons.push({code:'stale',detail:age+' d'});}
      else if(age<=3){score+=1;reasons.push({code:'fresh',detail:age+' d'});}
    }else reasons.push({code:'no-date'});
    const km=Number(finding&&finding.distanceKm);
    if(Number.isFinite(km)&&km>0){
      if(km>farKm){score-=1;reasons.push({code:'far',detail:km+' km'});}
      else if(km<=40){score+=1;reasons.push({code:'near',detail:km+' km'});}
    }
    if(lower(finding&&finding.klass)==='weak')score-=1;
    const scored=score>=2?'go':(score<=-1?'skip':'maybe');
    const top=ceiling(finding,match);
    const verdict=RANK[scored]<=RANK[top]?scored:top;
    if(verdict!==scored)reasons.push({code:'held-back',detail:top});
    return {verdict,score,reasons};
  }

  // ── Triage a whole sweep ──────────────────────────────────────────────────────────────────
  // Three outcomes, and the caller is told the size of each: what is ready to look at, what was
  // already reported before, and what was dropped for having nowhere to point.
  function triage(findings,seen,equipment,options){
    const list=Array.isArray(findings)?findings:[];
    const marks=seen instanceof Set?seen:new Set(Array.isArray(seen)?seen:[]);
    const ready=[],known=[],dropped=[];
    list.forEach(f=>{
      if(!isReportable(f)){dropped.push(f);return;}
      if(!isNew(f,marks)){known.push(f);return;}
      const match=matchCapabilities(f,equipment);
      const suggested=suggestVerdict(f,match,options);
      ready.push(Object.assign({},f,{
        fingerprint:fingerprint(f),
        match,
        verdict:VERDICTS.includes(lower(f.verdict))?lower(f.verdict):suggested.verdict,
        verdictFrom:VERDICTS.includes(lower(f.verdict))?'sweep':'rules',
        reasons:suggested.reasons
      }));
      marks.add(fingerprint(f));
    });
    return {
      ready,known,dropped,
      tally:{found:list.length,ready:ready.length,known:known.length,dropped:dropped.length}
    };
  }

  const ProspectRules={
    CLASSES,VERDICTS,PROCESSES,OUT_OF_ACTION,
    capabilities,processesNeeded,outsideTrade,matchCapabilities,
    isReportable,fingerprint,isNew,suggestVerdict,triage
  };
  if(typeof module!=='undefined'&&module.exports)module.exports=ProspectRules;
  if(global)global.ProspectRules=ProspectRules;
})(typeof window!=='undefined'?window:(typeof globalThis!=='undefined'?globalThis:this));
