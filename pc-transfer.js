// Moving what was entered on the one-computer copy into the online workshop.
//
// The copy on a PC keeps everything in that browser, and "Save a copy" writes it all to one file. This
// reads that file and sends its records to the server through the same workflows the screens use — the
// database checks every one exactly as it would if somebody typed it in — in the order the records point
// at each other: the letterhead, customers and suppliers, store items and what is on their shelves,
// projects, their jobcards and steps, the machines, the documents with their files, the crew plan, and
// what each supplier charges for each store item.
//
// What it does not move, and says so in its report rather than leaving anybody to find out:
//   * hours and stock movements. Every hour online is booked by the person signed in, and every
//     movement is signed by whoever made it; moving them would sign years of work in the name of
//     whoever happened to run the transfer. What is ON the shelves arrives as one opening receipt per
//     item — per heat, for traced steel, so the heats stay traceable.
//   * quotations, the sales pipeline and the quality registers, which have their own records online
//     and are entered there.
//
// Safe to run twice: a record already online (the same customer or supplier name, the same item code,
// the same project name, the same jobcard title on that project, the same machine, the same document
// title) is left as it is and counted as already there.
//
// Loaded by admin.html after the record modules, and by the tests through require(): one file both ways.
(function (root) {
  'use strict';

  const need = (name, file) => root[name] || (typeof require === 'function' ? require(file) : null);
  const R = {
    customer: need('CustomerRecord', './customer-record.js'),
    supplier: need('SupplierRecord', './supplier-record.js'),
    stock: need('StockRecord', './stock-record.js'),
    project: need('ProjectRecord', './project-record.js'),
    jobcard: need('JobcardRecord', './jobcard-record.js'),
    equipment: need('EquipmentRecord', './equipment-record.js'),
    document: need('DocumentRecord', './document-record.js')
  };

  const MATERIAL_STATUSES = ['not-ordered', 'ordered', 'part-arrived', 'arrived', 'issued'];
  const list = (v) => (Array.isArray(v) ? v : []);
  const key = (v) => String(v == null ? '' : v).trim().toLowerCase();
  const fresh = (record, extra) => Object.assign({}, record, { id: null, sharedId: null, sharedNo: null, _server: null }, extra || {});

  // A file that is not a "Save a copy" from this system is turned away before anything is sent.
  function check(backup) {
    if (!backup || typeof backup !== 'object' || Array.isArray(backup)) return 'that file is not a saved copy of the workshop';
    const known = ['customers', 'projects', 'jobcards', 'inventory', 'suppliers', 'equipment', 'documents'];
    if (!known.some((k) => Array.isArray(backup[k]))) return 'that file is not a saved copy of the workshop';
    return null;
  }

  // What the file holds, counted, before anything is sent — so the person sees what will happen first.
  function plan(backup) {
    const counts = {
      company: backup.company && backup.company.name ? 1 : 0,
      customers: list(backup.customers).length,
      suppliers: list(backup.suppliers).length,
      stock: list(backup.inventory).length,
      projects: list(backup.projects).length,
      jobcards: list(backup.jobcards).length,
      equipment: list(backup.equipment).length,
      documents: list(backup.documents).length,
      crewPlan: list(backup.crewPlan).length,
      supplierPrices: list(backup.supplierItems).length
    };
    const leftBehind = {
      hours: list(backup.hours).length,
      movements: list(backup.movements).length,
      estimations: list(backup.estimations).length,
      quality: ['qualityInspections', 'qualityNcrs', 'qualityHolds', 'qualityWelds', 'qualityNdt']
        .reduce((n, k) => n + list(backup[k]).length, 0),
      marketing: ['marketingLeads', 'marketingOpportunities', 'marketingTenders']
        .reduce((n, k) => n + list(backup[k]).length, 0)
    };
    return { counts, leftBehind };
  }

  // What is left of each heat of an item in the copy, oldest first — the same reckoning the copy's own
  // store makes: what arrived with a heat, less what went out from it.
  function heatsOf(backup, code) {
    const by = new Map();
    list(backup.movements).slice().reverse().forEach((m) => {
      if (m.code !== code || !m.heat) return;
      const h = by.get(m.heat) || { heat: m.heat, certificate: null, remaining: 0 };
      const q = Number(m.qty) || 0;
      if (m.action === 'RECEIVED') { h.remaining += q; if (m.certificate) h.certificate = m.certificate; }
      else if (m.action === 'RETURN') h.remaining += q;
      else if (m.action === 'ISSUED' || m.action === 'SCRAP') h.remaining -= q;
      by.set(m.heat, h);
    });
    return [...by.values()].filter((h) => h.remaining > 0);
  }

  // `io` is how this talks to the server: call(name, args) → { ok, result, refused }, snapshot() → the
  // workshop as the server holds it, upload(documentId, dataUrl, filename, mimeType) → { ok, refused }.
  // `progress(kind, done, total)` is told as it goes.
  async function run(backup, io, progress) {
    const wrong = check(backup);
    if (wrong) return { error: wrong };
    const tell = typeof progress === 'function' ? progress : () => {};
    const report = {};
    const tally = (kind) => (report[kind] = report[kind] || { moved: 0, alreadyThere: 0, refused: [] });
    const refused = (kind, name, why) => tally(kind).refused.push({ name: String(name || '—'), why: String(why || '') });

    const online = (await io.snapshot()) || {};
    const has = (records, field) => new Map(list(records).map((r) => [key(r[field]), r]));

    // ── The letterhead ──────────────────────────────────────────────────────────────────────
    if (backup.company && backup.company.name) {
      tally('company');
      const c = backup.company;
      const answer = await io.call('save_company', {
        name: c.name, address: c.address || null, postcode: c.postcode || null, city: c.city || null,
        country: c.country || null, email: c.email || null, phone: c.phone || null, website: c.website || null,
        org_no: c.orgNo || null, vat_no: c.vat || null, f_skatt: !!c.fSkatt, bankgiro: c.bankgiro || null,
        iban: c.iban || null, bic: c.bic || null
      });
      if (answer.ok) report.company.moved += 1; else refused('company', c.name, answer.refused);
      tell('company', 1, 1);
    }

    // ── Customers ───────────────────────────────────────────────────────────────────────────
    const customerIds = new Map();
    const onlineCustomers = has(online.customers, 'name');
    const customers = list(backup.customers);
    for (const [i, c] of customers.entries()) {
      tally('customers');
      const there = onlineCustomers.get(key(c.name));
      if (there) {
        report.customers.alreadyThere += 1;
        customerIds.set(String(c.id), Number(there.id)); customerIds.set(key(c.name), Number(there.id));
      } else {
        const answer = await io.call('save_customer', R.customer.toServer(fresh(c, { pricelist: c.priceList, ctype: c.type })));
        if (!answer.ok) refused('customers', c.name, answer.refused);
        else {
          report.customers.moved += 1;
          customerIds.set(String(c.id), Number(answer.result)); customerIds.set(key(c.name), Number(answer.result));
          const contacts = R.customer.contactsToServer(c);
          if (contacts.length) {
            const people = await io.call('set_customer_contacts', { customer_id: Number(answer.result), contacts });
            if (!people.ok) refused('customers', `${c.name} — contacts`, people.refused);
          }
        }
      }
      tell('customers', i + 1, customers.length);
    }

    // ── Suppliers ───────────────────────────────────────────────────────────────────────────
    const onlineSuppliers = has(online.suppliers, 'name');
    const suppliers = list(backup.suppliers);
    for (const [i, s] of suppliers.entries()) {
      tally('suppliers');
      if (onlineSuppliers.has(key(s.name))) report.suppliers.alreadyThere += 1;
      else {
        const answer = await io.call('save_supplier', R.supplier.toServer(fresh(s)));
        if (!answer.ok) refused('suppliers', s.name, answer.refused);
        else {
          report.suppliers.moved += 1;
          const contacts = R.supplier.contactsToServer(s.contacts || []);
          if (contacts.length) {
            const people = await io.call('set_supplier_contacts', { supplier_id: Number(answer.result), contacts });
            if (!people.ok) refused('suppliers', `${s.name} — contacts`, people.refused);
          }
        }
      }
      tell('suppliers', i + 1, suppliers.length);
    }

    // ── The store, and what is on its shelves ─────────────────────────────────────────────────
    const onlineItems = has(online.inventory, 'code');
    const items = list(backup.inventory);
    for (const [i, item] of items.entries()) {
      tally('stock');
      if (onlineItems.has(key(item.code))) { report.stock.alreadyThere += 1; tell('stock', i + 1, items.length); continue; }
      // A reorder quantity of nothing is the copy's way of saying none was set; the database keeps that as
      // no value rather than as zero.
      const answer = await io.call('save_stock_item', R.stock.toServer(fresh(item,
        { reorderQty: Number(item.reorderQty) > 0 ? item.reorderQty : undefined })));
      if (!answer.ok) { refused('stock', item.code, answer.refused); tell('stock', i + 1, items.length); continue; }
      report.stock.moved += 1;
      const id = Number(answer.result);
      const price = Number(item.avgCost) > 0 ? Number(item.avgCost) : null;
      const onShelf = Math.max(0, Number(item.stock) || 0);
      // Per heat for traced steel, so a heat on the PC is still a heat online; the rest in one line.
      const heats = heatsOf(backup, item.code);
      let traced = 0;
      for (const h of heats) {
        const q = Math.min(h.remaining, onShelf - traced);
        if (q <= 0) break;
        const r = await io.call('receive_stock', { item_id: id, quantity: q, unit_price: price, supplier: null,
          delivery_note: 'Opening balance from the PC copy', heat_no: h.heat, material_cert_ref: h.certificate || null,
          bin_code: item.location || null, note: null });
        if (r.ok) traced += q; else refused('stock', `${item.code} — heat ${h.heat}`, r.refused);
      }
      const untraced = onShelf - traced;
      if (untraced > 0) {
        const r = await io.call('receive_stock', { item_id: id, quantity: untraced, unit_price: price, supplier: null,
          delivery_note: 'Opening balance from the PC copy', heat_no: null, material_cert_ref: null,
          bin_code: item.location || null, note: null });
        if (!r.ok) refused('stock', `${item.code} — opening balance`, r.refused);
      }
      tell('stock', i + 1, items.length);
    }

    // ── Projects ────────────────────────────────────────────────────────────────────────────
    const projectIds = new Map();
    const projectRefs = new Map();
    const onlineProjects = has(online.projects, 'name');
    const projects = list(backup.projects);
    for (const [i, p] of projects.entries()) {
      tally('projects');
      const there = onlineProjects.get(key(p.name));
      if (there) {
        report.projects.alreadyThere += 1;
        projectIds.set(String(p.no), Number(there.id)); projectRefs.set(String(p.no), there.no);
      } else {
        const customerId = customerIds.get(String(p.customerId)) || customerIds.get(key(p.customer)) || null;
        // The copy writes "unchecked" for a material status nobody has set; online that is no value.
        const materialStatus = MATERIAL_STATUSES.includes(p.materialStatus) ? p.materialStatus : undefined;
        let answer = await io.call('save_project', R.project.toServer(fresh(p, { customerId, materialStatus })));
        // A status the database will not create a project in is not a reason to leave the project behind.
        if (!answer.ok && p.status && p.status !== 'quotation') {
          answer = await io.call('save_project', R.project.toServer(fresh(p, { customerId, materialStatus, status: 'quotation' })));
          if (answer.ok) refused('projects', `${p.name} — status`, `arrived as a quotation; it was "${p.status}" on the PC`);
        }
        if (!answer.ok) refused('projects', p.name, answer.refused);
        else { report.projects.moved += 1; projectIds.set(String(p.no), Number(answer.result)); }
      }
      tell('projects', i + 1, projects.length);
    }
    if (projectIds.size) {
      const now = (await io.snapshot()) || {};
      list(now.projects).forEach((p) => {
        for (const [no, id] of projectIds) if (Number(p.id) === id) projectRefs.set(no, p.no);
      });
    }

    // ── Jobcards and their steps ────────────────────────────────────────────────────────────
    const jobcardIds = new Map();
    const jobcardRefs = new Map();
    const onlineJobs = new Set(list(online.jobcards).map((j) => `${j.projectId}|${key(j.title)}`));
    const jobcards = list(backup.jobcards);
    for (const [i, j] of jobcards.entries()) {
      tally('jobcards');
      const projectId = projectIds.get(String(j.projectNo));
      if (!projectId) { refused('jobcards', j.title || j.no, `its project ${j.projectNo || '—'} did not come across`); tell('jobcards', i + 1, jobcards.length); continue; }
      if (onlineJobs.has(`${projectId}|${key(j.title)}`)) { report.jobcards.alreadyThere += 1; tell('jobcards', i + 1, jobcards.length); continue; }
      let answer = await io.call('save_jobcard', R.jobcard.toServer(fresh(j, { projectId })));
      if (!answer.ok && j.status && j.status !== 'draft') {
        answer = await io.call('save_jobcard', R.jobcard.toServer(fresh(j, { projectId, status: 'draft' })));
        if (answer.ok) refused('jobcards', `${j.title} — status`, `arrived as a draft; it was "${j.status}" on the PC`);
      }
      if (!answer.ok) { refused('jobcards', j.title || j.no, answer.refused); tell('jobcards', i + 1, jobcards.length); continue; }
      report.jobcards.moved += 1;
      jobcardIds.set(String(j.no), Number(answer.result));
      const steps = list(j.operations).map((o) => Object.assign({}, o, { id: null }));
      if (steps.length) {
        const s = await io.call('set_jobcard_operations', { jobcard_id: Number(answer.result),
          operations: R.jobcard.operationsToServer({ operations: steps }) });
        if (!s.ok) refused('jobcards', `${j.title} — steps`, s.refused);
      }
      tell('jobcards', i + 1, jobcards.length);
    }

    if (jobcardIds.size) {
      const now = (await io.snapshot()) || {};
      list(now.jobcards).forEach((j) => {
        for (const [no, id] of jobcardIds) if (Number(j.id) === id) jobcardRefs.set(no, j.no);
      });
    }

    // ── Machines ────────────────────────────────────────────────────────────────────────────
    const onlineMachines = has(online.equipment, 'equipmentId');
    const machines = list(backup.equipment);
    for (const [i, e] of machines.entries()) {
      tally('equipment');
      if (onlineMachines.has(key(e.equipmentId))) report.equipment.alreadyThere += 1;
      else {
        const answer = await io.call('save_equipment', R.equipment.toServer(fresh(e)));
        if (answer.ok) report.equipment.moved += 1; else refused('equipment', e.equipmentId || e.name, answer.refused);
      }
      tell('equipment', i + 1, machines.length);
    }

    // ── Documents, with their files ─────────────────────────────────────────────────────────
    const onlineDocs = has(online.documents, 'name');
    const docs = list(backup.documents).filter((d) => !d.folder);
    for (const [i, d] of docs.entries()) {
      tally('documents');
      if (onlineDocs.has(key(d.name))) { report.documents.alreadyThere += 1; tell('documents', i + 1, docs.length); continue; }
      // A link to a project follows the project to its new number online. Anything else that cannot be
      // found online arrives unlinked rather than not at all, and the report says so.
      // A project or jobcard number from the PC is followed to its new number online, whichever section
      // the document was filed under there — a certificate kept under Quality against a project is still
      // that project's certificate.
      const was = String(d.record || '');
      const link = projectRefs.has(was) ? { module: 'Projects', record: projectRefs.get(was) }
        : jobcardRefs.has(was) ? { module: 'Workshop', record: jobcardRefs.get(was) }
        : { module: d.module, record: d.record };
      let answer = await io.call('save_document', R.document.toServer(fresh(d, link), null));
      if (!answer.ok && d.record && d.record !== 'Unlinked') {
        answer = await io.call('save_document', R.document.toServer(fresh(d, { module: null, record: 'Unlinked' }), null));
        if (answer.ok) refused('documents', `${d.name} — link`, `arrived unlinked; "${d.record}" is not online`);
      }
      if (!answer.ok) { refused('documents', d.name, answer.refused); tell('documents', i + 1, docs.length); continue; }
      report.documents.moved += 1;
      if (typeof d.fileData === 'string' && d.fileData.startsWith('data:')) {
        const up = await io.upload(Number(answer.result), d.fileData, d.fileName || d.name, d.mimeType || null);
        if (!up.ok) refused('documents', `${d.name} — file`, up.refused);
      }
      tell('documents', i + 1, docs.length);
    }

    // ── The crew plan ───────────────────────────────────────────────────────────────────────
    // Who was planned on what, day by day. A day on a job follows its jobcard to the number it has online
    // — moved just now or found there already, by project and title as above; a day away needs nothing.
    // The same day already online is counted as there, which is what makes a second run harmless.
    const crew = list(backup.crewPlan);
    if (crew.length) {
      const now = (await io.snapshot()) || {};
      const jobIdOf = new Map();
      list(backup.jobcards).forEach((j) => {
        const projectId = projectIds.get(String(j.projectNo));
        const there = list(now.jobcards).find((x) => String(x.projectId) === String(projectId) && key(x.title) === key(j.title));
        if (there) jobIdOf.set(String(j.no), { id: Number(there.id), ref: there.no });
      });
      const already = new Set(list(now.crewPlan).map((e) => `${key(e.worker)}|${e.day}|${e.jobcard || ''}|${e.absence || ''}`));
      for (const [i, e] of crew.entries()) {
        tally('crewPlan');
        const job = e.jobcard ? jobIdOf.get(String(e.jobcard)) : null;
        const label = `${e.worker} ${e.day}`;
        if (e.jobcard && !job) { refused('crewPlan', label, `its jobcard ${e.jobcard} did not come across`); tell('crewPlan', i + 1, crew.length); continue; }
        if (already.has(`${key(e.worker)}|${e.day}|${job ? job.ref : ''}|${e.absence || ''}`)) { report.crewPlan.alreadyThere += 1; tell('crewPlan', i + 1, crew.length); continue; }
        const answer = await io.call('save_crew_plan', { id: null, worker: e.worker, day: e.day,
          jobcard_id: job ? job.id : null, absence: e.absence || null, hours: Number(e.hours), note: e.note || null });
        if (answer.ok) report.crewPlan.moved += 1;
        else if (/already planned|already marked away/.test(String(answer.refused))) report.crewPlan.alreadyThere += 1;
        else refused('crewPlan', label, answer.refused);
        tell('crewPlan', i + 1, crew.length);
      }
    }

    // ── Supplier prices ─────────────────────────────────────────────────────────────────────
    // Each line joins a merchant and an item by name and code, so both are looked up online after the
    // suppliers and the store have come across. Saving the same pair again changes that line rather than
    // adding one, which is what makes a second run harmless.
    const priceLines = list(backup.supplierItems);
    if (priceLines.length) {
      const now = (await io.snapshot()) || {};
      const supplierId = new Map(list(now.suppliers).map((x) => [key(x.name), Number(x.id)]));
      const itemId = new Map(list(now.inventory).map((x) => [String(x.code), Number(x.id)]));
      const already = new Set(list(now.suppliers).flatMap((x) => list(x.priceList).map((l) => `${x.id}|${l.itemId}|${Number(l.price)}`)));
      for (const [i, l] of priceLines.entries()) {
        tally('supplierPrices');
        const sid = supplierId.get(key(l.supplier)), iid = itemId.get(String(l.code));
        const label = `${l.supplier} — ${l.code}`;
        if (!sid) { refused('supplierPrices', label, `the supplier ${l.supplier} did not come across`); tell('supplierPrices', i + 1, priceLines.length); continue; }
        if (!iid) { refused('supplierPrices', label, `the item ${l.code} did not come across`); tell('supplierPrices', i + 1, priceLines.length); continue; }
        if (already.has(`${sid}|${iid}|${Number(l.price)}`)) { report.supplierPrices.alreadyThere += 1; tell('supplierPrices', i + 1, priceLines.length); continue; }
        const answer = await io.call('save_supplier_item', { supplier_id: sid, stock_item_id: iid, price: Number(l.price),
          article_no: l.articleNo || null, currency: l.currency || 'SEK', pack_size: Number(l.packSize) || 1,
          lead_time_days: l.leadTime == null || l.leadTime === '' ? null : Number(l.leadTime), is_preferred: !!l.preferred });
        if (answer.ok) report.supplierPrices.moved += 1; else refused('supplierPrices', label, answer.refused);
        tell('supplierPrices', i + 1, priceLines.length);
      }
    }

    return { report, leftBehind: plan(backup).leftBehind };
  }

  const api = { check, plan, run, heatsOf };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PcTransfer = api;
})(typeof window !== 'undefined' ? window : globalThis);
