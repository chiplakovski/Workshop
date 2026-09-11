// Shared UI behaviour for every module page: delayed tooltips on anything that
// carries a title, and one Help button per module explaining what it is for.
// Loaded by each page alongside workshop-data.js; it attaches itself and needs
// no call from the page.
(function(){
  'use strict';

  // ── Tooltips ──────────────────────────────────────────────────────────
  // The app already labels most of its icon buttons with `title`, but the
  // browser's own tooltip is slow, unstyled and clipped to the window. These
  // reuse exactly those labels: the title is taken off the element on first
  // hover (so the native one never fires) and kept as data-tip from then on.
  var DELAY=550, tipEl=null, timer=null, current=null;

  function ensureTip(){
    if(!tipEl){tipEl=document.createElement('div');tipEl.className='wtip';document.body.appendChild(tipEl);}
    return tipEl;
  }
  function place(el){
    var t=ensureTip(), r=el.getBoundingClientRect();
    t.style.left='0px';t.style.top='0px';
    var w=t.offsetWidth,h=t.offsetHeight;
    // Prefer below the control; flip above when there is no room, and keep the
    // whole tooltip on screen either way.
    var left=Math.min(Math.max(8,r.left+r.width/2-w/2),window.innerWidth-w-8);
    var top=r.bottom+8;
    if(top+h>window.innerHeight-8)top=Math.max(8,r.top-h-8);
    t.style.left=Math.round(left)+'px';t.style.top=Math.round(top)+'px';
  }
  function hide(){
    clearTimeout(timer);current=null;
    if(tipEl)tipEl.classList.remove('show');
  }
  function textFor(el){
    if(el.hasAttribute('title')){
      var v=el.getAttribute('title');
      if(v&&v.trim()){el.setAttribute('data-tip',v);}
      el.removeAttribute('title');   // before the browser's own delay elapses
    }
    var d=el.getAttribute('data-tip');
    return d&&d.trim()?d.trim():'';
  }
  document.addEventListener('mouseover',function(ev){
    var el=ev.target&&ev.target.closest?ev.target.closest('[title],[data-tip]'):null;
    if(!el||el===current)return;
    hide();
    var text=textFor(el);
    if(!text)return;
    current=el;
    timer=setTimeout(function(){
      if(current!==el||!el.isConnected)return;
      var t=ensureTip();t.textContent=text;t.classList.add('show');place(el);
    },DELAY);
  },true);
  document.addEventListener('mouseout',function(ev){
    if(!current)return;
    var to=ev.relatedTarget;
    if(to&&current.contains&&current.contains(to))return;
    hide();
  },true);
  // A tooltip must never outlive what it describes. Scrolling only takes down a
  // tooltip that is already on screen - it must not cancel one that is still
  // counting down, or a control reached by scrolling to it would never explain
  // itself. Pressing or typing cancels outright.
  function hideShown(){if(tipEl)tipEl.classList.remove('show');}
  ['scroll','wheel'].forEach(function(e){window.addEventListener(e,hideShown,true);});
  ['mousedown','keydown'].forEach(function(e){window.addEventListener(e,hide,true);});

  // ── Help ──────────────────────────────────────────────────────────────
  // What each module is for, and the few rules worth knowing before using it.
  // Keyed by page, so a module's own page is the only thing that decides which
  // entry it shows.
  var HELP={
    'estimations':{title:'Project / Estimator',sub:'Jobs, pricing and workflow',
      what:'Every job lives here. A project is created as the quotation it is being priced for, its items are priced line by line, and its status is driven from the same place.',
      points:['Pick a project from the list; the estimate on it opens beside it.',
        'The items being priced are the project’s own items — add or rename them on the project, not here.',
        'An item’s reference is read off the project: P-26-0008-02 is that project’s second item.',
        'Lock an item once its price is agreed. Unlocking asks for a reason and records who did it.',
        'The workflow strip moves the project: Quotation → Approved → Planned → Active, with hold, complete, close and cancel behind More.',
        'The estimate total becomes the project’s quoted value automatically.']},
    'customers':{title:'Customers',sub:'Contacts and accounts',
      what:'The customer register. Everything quoted, invoiced or delivered points back to a record here.',
      points:['A new customer can be looked up by organisation number.','Contacts, notes and documents stay with the customer.','Quotes and invoices raised here appear in Estimating and in the commercial records.']},
    'suppliers':{title:'Suppliers',sub:'Vendor directory',
      what:'Who the workshop buys from, and how they have performed.',
      points:['Purchase orders raised in Purchasing appear in a supplier’s history.','Quality issues on a delivery are recorded against the supplier.']},
    'jobcard':{title:'Jobcard',sub:'Work orders',
      what:'The shop-floor instruction for one piece of work: what to make, from what, on which machine, by when.',
      points:['A jobcard belongs to a project and is one of its items.','Operations are started and paused here; hours booked against them land in Hours.','A Quality Hold stops a jobcard from being completed until it is cleared.']},
    'hours':{title:'Hours',sub:'Log time and materials',
      what:'Time booked against jobcards, and the materials used doing it.',
      points:['Hours are booked against a jobcard, never against a project directly.','What is booked here drives the actual cost shown on the project.']},
    'planning':{title:'Planning',sub:'Schedule and capacity',
      what:'When the work happens and who does it.',
      points:['Projects appear once they are scheduled.','A phase change here writes back to the project itself.']},
    'purchasing':{title:'Purchasing',sub:'Purchase orders',
      what:'Buying what a job needs, and tracking it until it arrives.',
      points:['An order can be raised from a shortage in Store or directly against a project.','Receiving is recorded in Store; the order status follows it.','A project cannot be completed while it has undelivered orders.']},
    'store':{title:'Store',sub:'Inventory and parts',
      what:'What is on the shelf, what is reserved, and what has run short.',
      points:['Stock is reserved, issued and returned against a jobcard.','A low-stock line can raise a purchase order without leaving the page.','Receiving against an order updates both the stock and the order.']},
    'equipment-machines':{title:'Equipment / Machines',sub:'Machines and maintenance',
      what:'The machines and tools, their condition, and what is due.',
      points:['An operation cannot start on a machine that is out of service.','Maintenance due dates and service history stay with the machine.']},
    'marketing':{title:'Marketing',sub:'Leads, campaigns and growth',
      what:'Where work comes from before it becomes a job.',
      points:['A lead is qualified into an opportunity, then converted into a customer.','Opening an estimation from an opportunity links the two.']},
    'quality':{title:'Quality',sub:'Inspections and defects',
      what:'Inspections, non-conformance reports, and the holds that stop unsafe work continuing.',
      points:['An active Quality Hold blocks completing or closing the project or jobcard it names.','A hold is cleared here, never overridden elsewhere.']},
    'documents':{title:'Documents',sub:'Files and templates',
      what:'Drawings, certificates and templates, linked to the record they belong to.',
      points:['A document can be linked to a project, jobcard, customer or supplier.','Files are held in this browser for the prototype.']},
    'reports':{title:'Reports',sub:'Inspection and test',
      what:'Saved report definitions and the reports generated from them.',
      points:['A generated report is saved as a real record and can be found in Documents.']},
    'hub':{title:'Hub',sub:'All workshop tools',
      what:'The way into every module. Project / Estimator comes first because that is where a job starts.',
      points:[]}
  };

  function moduleKey(){
    // In the single-file demo every page runs inside an iframe, where location
    // names the bundle rather than the module, so the bundler states the page
    // and that wins when present.
    var f=window.__module||(location.pathname.split('/').pop()||'');
    f=f.replace('.html','');
    return f.replace('-desktop','').replace('-mobile','');
  }
  function openHelp(){
    var h=HELP[moduleKey()];if(!h)return;
    var ov=document.querySelector('.whelp');
    if(!ov){
      ov=document.createElement('div');ov.className='whelp';
      ov.addEventListener('click',function(e){if(e.target===ov)ov.classList.remove('show');});
      document.body.appendChild(ov);
    }
    ov.innerHTML='<div class="whelpcard"><h2></h2><div class="whsub"></div>'+
      '<h3>What it is for</h3><p class="whwhat"></p>'+
      (h.points.length?'<h3>Worth knowing</h3><ul class="whpts"></ul>':'')+
      '<div class="whelpfoot"><button class="tbtn" type="button">Close</button></div></div>';
    ov.querySelector('h2').textContent=h.title;
    ov.querySelector('.whsub').textContent=h.sub;
    ov.querySelector('.whwhat').textContent=h.what;
    var ul=ov.querySelector('.whpts');
    if(ul)h.points.forEach(function(p){var li=document.createElement('li');li.textContent=p;ul.appendChild(li);});
    ov.querySelector('.whelpfoot button').addEventListener('click',function(){ov.classList.remove('show');});
    ov.classList.add('show');
  }
  document.addEventListener('keydown',function(e){
    if(e.key!=='Escape')return;
    var ov=document.querySelector('.whelp.show');if(ov)ov.classList.remove('show');
  });

  // The button goes in the module's own header, beside its title.
  function mountHelp(){
    if(!HELP[moduleKey()])return;
    if(document.querySelector('.helpbtn'))return;
    // Every module names itself in an h1, but each page wraps that in its own
    // header markup, so the h1 is the hook rather than any one container class.
    var h1=document.querySelector('h1');
    if(!h1)return;
    var head=h1.closest('.modhead,.hubtitle,header,.pheader,.main-head,.brand,.title,.heading,.ttl')||h1.parentElement;
    if(!head)return;
    var b=document.createElement('button');
    b.type='button';b.className='helpbtn';b.textContent='?';
    b.setAttribute('aria-label','Help');
    b.setAttribute('data-tip','What this module is for, and how it works');
    b.addEventListener('click',openHelp);
    var actions=head.querySelector('.headactions');
    if(actions)actions.parentNode.insertBefore(b,actions);
    else head.appendChild(b);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountHelp);
  else mountHelp();
  // Module pages rewrite their header as they render, so the button is put back
  // if a re-render removes it.
  new MutationObserver(function(){mountHelp();}).observe(document.documentElement,{childList:true,subtree:true});

  window.WorkshopUI={openHelp:openHelp,hideTip:hide};
})();
