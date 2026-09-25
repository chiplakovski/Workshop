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
    // A page can name the place itself; otherwise every module names itself in an h1, and since
    // each page wraps that in its own header markup the h1 is the hook, not a container class.
    var head=document.querySelector('[data-help-slot]');
    if(!head){
      var h1=document.querySelector('h1');
      if(!h1)return;
      head=h1.closest('.modhead,.hubtitle,header,.pheader,.main-head,.brand,.title,.heading,.ttl')||h1.parentElement;
    }
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

  // ── Ask and tell ─────────────────────────────────────────────────────────
  // window.confirm() and window.alert() do not exist inside a sandboxed frame without allow-modals:
  // confirm() returns false without showing anything, so every guarded action silently does nothing.
  // The packaged demo runs exactly like that, so the app asks and tells in its own markup instead.
  function closeAsk(box){
    if(!box)return;
    document.removeEventListener('keydown',box.__key,true);
    box.remove();
  }
  function ask(message,opts,onYes,onNo){
    opts=opts||{};
    var box=document.createElement('div');
    box.className='waskwrap';
    var msg=String(message==null?'':message);
    box.innerHTML='<div class="wask'+(opts.danger?' danger':'')+'" role="alertdialog" aria-modal="true">'
      +'<p class="waskmsg"></p><div class="waskbtns">'
      +(onYes?'<button type="button" class="waskno"></button>':'')
      +'<button type="button" class="waskyes"></button></div></div>';
    box.querySelector('.waskmsg').textContent=msg;   // never markup: the text is data
    var yes=box.querySelector('.waskyes'),no=box.querySelector('.waskno');
    yes.textContent=opts.yes||(onYes?'OK':'Close');
    if(no)no.textContent=opts.no||'Cancel';
    function done(ok){closeAsk(box);if(ok&&onYes)onYes();else if(!onYes&&onNo)onNo();else if(!ok&&onNo)onNo();}
    yes.addEventListener('click',function(){done(true);});
    if(no)no.addEventListener('click',function(){done(false);});
    box.addEventListener('mousedown',function(ev){if(ev.target===box)done(false);});
    box.__key=function(ev){
      if(ev.key==='Escape'){ev.preventDefault();ev.stopPropagation();done(false);}
      else if(ev.key==='Enter'){ev.preventDefault();ev.stopPropagation();done(true);}
    };
    document.addEventListener('keydown',box.__key,true);
    document.body.appendChild(box);
    yes.focus();
    return box;
  }
  // A question: onYes runs only when the answer is yes, so a caller reads like the guard it replaces.
  window.wConfirm=function(message,onYes,opts){return ask(message,opts||{},onYes||function(){},null);};
  // A statement: one button, nothing to decide.
  window.wAlert=function(message,onClose){return ask(message,{yes:'OK'},null,onClose||null);};
  // A question that wants words back. onOk runs with the text only when something was typed.
  window.wPrompt=function(message,initial,onOk,opts){
    opts=opts||{};
    var box=document.createElement('div');
    box.className='waskwrap';
    box.innerHTML='<div class="wask" role="dialog" aria-modal="true"><p class="waskmsg"></p>'
      +'<input type="text" class="waskinput"><div class="waskbtns">'
      +'<button type="button" class="waskno"></button><button type="button" class="waskyes"></button></div></div>';
    box.querySelector('.waskmsg').textContent=String(message==null?'':message);
    var input=box.querySelector('.waskinput'),yes=box.querySelector('.waskyes'),no=box.querySelector('.waskno');
    input.value=initial==null?'':String(initial);
    yes.textContent=opts.yes||'OK';no.textContent=opts.no||'Cancel';
    function done(ok){
      var v=input.value;
      closeAsk(box);
      if(ok&&onOk&&v!=null&&String(v).trim()!=='')onOk(v);
    }
    yes.addEventListener('click',function(){done(true);});
    no.addEventListener('click',function(){done(false);});
    box.addEventListener('mousedown',function(ev){if(ev.target===box)done(false);});
    box.__key=function(ev){
      if(ev.key==='Escape'){ev.preventDefault();ev.stopPropagation();done(false);}
      else if(ev.key==='Enter'&&ev.target===input){ev.preventDefault();ev.stopPropagation();done(true);}
    };
    document.addEventListener('keydown',box.__key,true);
    document.body.appendChild(box);
    input.focus();input.select();
    return box;
  };

  // ── Whose session this is ─────────────────────────────────────────────
  //
  // Every screen has a badge saying whose session it is: an avatar, a name, sometimes a role. On every one
  // of them the name was **Aleksandar** and the avatar **AK**, written into the page — and on six of them
  // the role beside it said **Admin**. That badge is the only thing on a screen that says who the reader
  // is, and every write the page makes is attributed by the server to the real session. So the screen said
  // one person and the database recorded another. A welder opening Quality read "Aleksandar · Admin".
  //
  // It is the bug that was found on the phone hub, where a welder signing in on their own phone read that
  // line. It was fixed there, on the desktop hub and on the desk hours screen, one page at a time — and
  // eleven pages still had it, which is what a per-page fix gets you.
  //
  // So it is done here instead, once, for every page that loads this file. The markup says which elements
  // hold it — `data-session-name`, `data-session-initials`, `data-session-role` — rather than this code
  // guessing from the sidebar's shape, which got three badges wrong on the first attempt. Each one ships
  // holding an em dash, the app's word for "nobody has said", so a page with no session shows no name
  // instead of somebody else's. `takenBy`, `takenRole` and `takenById` are all answered by the database
  // from the session rather than being sent to it, which is what makes them worth painting from.
  function initialsOf(name){
    return String(name||'').split(/\s+/).filter(Boolean)
      .map(function(part){return part[0];}).slice(0,2).join('').toUpperCase();
  }

  function paintWhoIsSignedIn(){
    var data=window.WorkshopData;
    var state=data&&data.get?data.get():null;
    var who=state&&state.takenBy, role=state&&state.takenRole;
    // No session, or a page reading browser storage: the em dash stays. Painting a name here from
    // anything other than a snapshot the server took would be inventing the one fact this badge states.
    if(!who||!data.isServerBacked||!data.isServerBacked())return;
    each('[data-session-name]',function(el){say(el,who);});
    each('[data-session-initials]',function(el){say(el,initialsOf(who));});
    // The role only where the markup says the element holds the reader's role. Several sidebars say what
    // the page is for rather than who is reading it — "Store supervisor", "Estimator" — and overwriting
    // one of those with a database role would lose a label somebody wrote on purpose.
    if(role)each('[data-session-role]',function(el){say(el,role);});
  }

  // One of them is a form field — Store's "Issued by" — and a read-only input showing a name has to
  // carry it as a value, not as text between the tags, or it submits an empty string.
  function say(el,words){
    if('value' in el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))el.value=words;
    else el.textContent=words;
  }

  function each(selector,paint){
    var found=document.querySelectorAll(selector);
    for(var i=0;i<found.length;i++)paint(found[i]);
  }

  window.addEventListener('workshop:data',paintWhoIsSignedIn);
  // And once at load, for the snapshot a page adopts before this file is listening. Also after a language
  // switch, because the dictionary sweep walks every [data-i] on the page: an entry reading "Admin" over a
  // welder's role is exactly how this came back on the phone hub after being fixed once. None of the three
  // elements carries a data-i any more, but a page that gains one should not be able to reintroduce it.
  window.addEventListener('workshop:lang',paintWhoIsSignedIn);
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',paintWhoIsSignedIn);
  }else{
    paintWhoIsSignedIn();
  }

  window.WorkshopUI={openHelp:openHelp,hideTip:hide,confirm:window.wConfirm,alert:window.wAlert,
    prompt:window.wPrompt,paintWhoIsSignedIn:paintWhoIsSignedIn,initialsOf:initialsOf};
})();
