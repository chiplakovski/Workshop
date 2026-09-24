'use strict';

// A machine, in the two shapes it has to exist in.
//
// The equipment register is the widest record in the app and the schema turned out to be nearly as
// wide: of the sixteen fields the coverage meter said had no column, nine had had one since the
// equipment pass under the longer names an insurer or an auditor uses — serial_no, asset_no,
// operating_hours, service_interval_hours and the three "last done" dates among them. So this file is
// mostly a rename, and the interesting part is the three fields that are NOT a rename.
//
// **The register form types in the date a machine was last serviced, inspected and calibrated, and
// save_equipment deliberately refuses to take them.** A form that can type in a service date is a form
// that can claim a service nobody performed, which is the one claim a maintenance record exists to make
// impossible. But the office typing them is not lying: registering a press that has been in the shop
// for six years, "last serviced in June" is a fact they know. What they mean is that there was a
// service, in June. So that is what this records — an event of that kind, on that date, noted as having
// come from the register rather than from an engineer's report. The date then arrives through the only
// door that can set it, and the record says where it came from.
(function (root) {
  const amount = (v, fallback) => {
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const whole = (v, fallback) => {
    const parsed = Number(v);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  };
  const said = (v, fallback) => {
    if (v === undefined || v === null || v === '' || v === '—') {
      return fallback === undefined ? null : fallback;
    }
    return v;
  };
  // One text column, one list on screen. Split on semicolons and newlines, which is how somebody writes
  // two warnings in a text box, and joined back with '; ' so a round trip is stable.
  function warnings(text) {
    if (Array.isArray(text)) return text.filter(Boolean);
    if (!text) return [];
    return String(text).split(/[;\n]+/).map((line) => line.trim()).filter(Boolean);
  }

  const day = (v) => {
    const text = said(v);
    if (!text) return null;
    const stamp = String(text).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(stamp) ? stamp : null;
  };

  // The statuses the register may set, in the words the register offers — which are the words the column
  // holds, since one spelling per state was settled. Getting this list wrong is not cosmetic: it is the
  // fallback below, so a status the list does not recognise is replaced, and a list written in the wrong
  // spelling replaced every status with the fallback.
  //
  // 'In Use' is deliberately not among them. Where a machine is, is the assignment; a status answering
  // "on a bench" would make the safety gates read the wrong question — they ask whether it may be run at
  // all, and a machine on a bench is perfectly runnable.
  const SETTABLE = ['Available', 'Maintenance Due', 'Under Maintenance', 'Inspection Required',
    'Out of Service', 'Quarantined', 'Retired'];

  function fromServer(e) {
    return {
      _server: e,
      id: e.id,
      equipmentId: e.equipmentId,
      name: e.name,
      category: e.category,
      status: e.status,
      manufacturer: e.manufacturer || '',
      model: e.model || '',
      serial: e.serial || '',
      assetNumber: e.assetNumber || '',
      yearOfManufacture: whole(e.yearOfManufacture, null),
      description: e.description || '',
      currentLocation: e.currentLocation || '',
      homeLocation: e.homeLocation || '',
      department: e.department || '',
      responsiblePerson: e.responsiblePerson || '',
      operator: e.operator || '',
      condition: e.condition || '',
      criticality: e.criticality || '',
      // A list, because the screen treats it as one: it renders `item.safetyWarnings[0]` on the risk pill
      // and calls `.join` on it in the detail panel. The column is one text field, so this is the same
      // translation the customer's billing address needed — and the same bug, found the same way: the
      // page threw "item.safetyWarnings.join is not a function" the first time a machine from the
      // database reached the screen that shows its warnings.
      safetyWarnings: warnings(e.safetyWarnings),
      certificationExpiry: e.certificationExpiry || '',
      purchaseDate: e.purchaseDate || '',
      purchaseSupplier: e.purchaseSupplier || '',
      warrantyExpiry: e.warrantyExpiry || '',
      operatingHourMeter: amount(e.operatingHourMeter, 0),
      serviceInterval: whole(e.serviceInterval, 0),
      maintenanceDate: e.maintenanceDate || '',
      inspectionDate: e.inspectionDate || '',
      calibrationDate: e.calibrationDate || '',
      qrCode: e.qrCode || '',
      assignedProject: e.assignedProject || '',
      assignedJobcard: e.assignedJobcard || '',
      notes: e.notes || '',
      // Only for a session that may see money; for everybody else it stays zero and the screen shows
      // nothing rather than something invented.
      purchasePrice: amount(e.purchasePrice, 0),
      // What the safety gate reads before it may require anything of anybody.
      requirements: e.requirements || { preUseCheckRequired: false },
      // The six logs, which are one table with a kind per row. Empty lists rather than absent ones,
      // because equipment-gates.js reads them with Array.isArray and a missing list reads as "nothing
      // has ever been checked" — which is the same answer as "no check passed", and only one is true.
      preUseChecks: e.preUseChecks || [],
      maintenance: e.maintenance || [],
      calibrations: e.calibrations || [],
      inspections: e.inspections || [],
      downtimeRecords: e.downtimeRecords || [],
      activity: e.activity || [],
      // The newest thing that happened to it, derived rather than stored: a column would have to be kept
      // in step with the rows it is computed from, which is how a figure goes stale.
      lastActivity: (e.activity && e.activity.length) ? e.activity[0].date : null,
      // Lists the screen holds and the database has nowhere for. Empty, never invented.
      notesLog: [],
      usageHistory: [],
      certifications: []
    };
  }

  function toServer(e) {
    const kept = e._server || {};
    const status = SETTABLE.indexOf(e.status) === -1 ? said(kept.status, 'Available') : e.status;
    return {
      id: e.id ? Number(e.id) : null,
      ref: e.equipmentId,
      name: e.name,
      category: e.category,
      status: status,
      manufacturer: said(e.manufacturer, said(kept.manufacturer)),
      model: said(e.model, said(kept.model)),
      serial_no: said(e.serial, said(kept.serial)),
      asset_no: said(e.assetNumber, said(kept.assetNumber)),
      year_of_manufacture: whole(e.yearOfManufacture, whole(kept.yearOfManufacture, null)),
      description: said(e.description, said(kept.description)),
      current_location: said(e.currentLocation, said(kept.currentLocation)),
      home_location: said(e.homeLocation, said(kept.homeLocation)),
      department: said(e.department, said(kept.department)),
      responsible_person: said(e.responsiblePerson, said(kept.responsiblePerson)),
      operator: said(e.operator, said(kept.operator)),
      condition: said(e.condition, said(kept.condition)),
      criticality: said(e.criticality, said(kept.criticality)),
      safety_warnings: said(warnings(e.safetyWarnings).join('; '), said(warnings(kept.safetyWarnings).join('; '))),
      certification_expiry: day(e.certificationExpiry) || day(kept.certificationExpiry),
      purchase_date: day(e.purchaseDate) || day(kept.purchaseDate),
      purchase_supplier: said(e.purchaseSupplier, said(kept.purchaseSupplier)),
      // Zero is not the same answer as "nobody wrote down what it cost", and the column allows NULL for
      // exactly that difference.
      purchase_price: amount(e.purchasePrice, 0) > 0 ? amount(e.purchasePrice, 0)
        : (amount(kept.purchasePrice, 0) > 0 && !('purchasePrice' in e) ? amount(kept.purchasePrice, 0) : null),
      warranty_expiry: day(e.warrantyExpiry) || day(kept.warrantyExpiry),
      operating_hours: amount(e.operatingHourMeter, amount(kept.operatingHourMeter, 0)),
      // The interval is hours between services, and zero is not an interval — it is nobody having said.
      service_interval_hours: whole(e.serviceInterval, 0) > 0 ? whole(e.serviceInterval, 0)
        : (whole(kept.serviceInterval, 0) > 0 ? whole(kept.serviceInterval, 0) : null),
      qr_code: said(e.qrCode, said(kept.qrCode)),
      pre_use_check_required: (e.requirements && e.requirements.preUseCheckRequired === true)
        || (!e.requirements && !!(kept.requirements && kept.requirements.preUseCheckRequired)),
      notes: said(e.notes, said(kept.notes))
    };
  }

  // The three dates the form types in, as the events they actually are.
  //
  // Only the ones that changed: re-saving a machine whose service date is already what the register says
  // must not record a second service. And only a date in the past — `record_equipment_event` refuses a
  // future one, and a form that offers a date picker will meet one.
  const AS_EVENTS = [
    ['maintenanceDate', 'service', 'done'],
    ['inspectionDate', 'inspection', 'pass'],
    ['calibrationDate', 'calibration', 'pass']
  ];

  function datesAsEvents(e, today) {
    const kept = e._server || {};
    const now = day(today) || new Date().toISOString().slice(0, 10);
    const out = [];
    AS_EVENTS.forEach(([field, kind, result]) => {
      const when = day(e[field]);
      if (!when) return;
      if (when === day(kept[field])) return;
      if (when > now) return;
      out.push({
        kind: kind,
        result: result,
        happened_on: when,
        note: 'Recorded with the machine\'s details rather than from a report'
      });
    });
    return out;
  }

  const api = { fromServer, toServer, datesAsEvents, warnings, day, whole, amount, SETTABLE };
  root.EquipmentRecord = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
