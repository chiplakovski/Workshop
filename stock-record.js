'use strict';

// A store item, in the two shapes it has to exist in.
//
// The rule that keeps coming back applies here in its sharpest form yet:
//
//   A page that shows a subset of a record must not save a subset of it.
//
// The store screen shows an item's group, subgroup, warehouse and rack as NAMES, in dropdowns filled
// from collections that are not on the server yet. So the names are for reading and the ids ride along
// in `_server` — because save_stock_item takes foreign keys, and a screen that sent the name it was
// showing would move every item it saved out of its own group.
//
// The other half is what is deliberately absent. `stock` is not in either direction: steel arrives
// through receive_stock, leaves through issue_material and is corrected through record_stocktake, each
// of which writes the movement that explains the change. A figure typed into the stock column is a
// shelf that disagrees with the record of why.
(function (root) {
  const amount = (v, fallback) => {
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const said = (v, fallback) => {
    if (v === undefined || v === null || v === '' || v === '—') {
      return fallback === undefined ? null : fallback;
    }
    return v;
  };
  const id = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : null;
  };

  function fromServer(i) {
    return {
      _server: i,
      id: i.id,
      code: i.code,
      itemNo: i.code,
      description: i.description,
      unit: i.unit,
      baseUnit: i.baseUnit || '',
      sizePerUnit: amount(i.sizePerUnit, 1),
      weightPerBase: amount(i.weightPerBase, 0),
      stock: amount(i.stock, 0),
      reserved: amount(i.reserved, 0),
      minStock: amount(i.minStock, 0),
      reorderQty: amount(i.reorderQty, 0),
      category: i.category || '',
      grade: i.grade || '',
      dimensions: i.dimensions || '',
      heat: i.heat || '',
      certificate: i.certificate || '',
      status: i.status || '',
      // The bin, and the two names above it. Names, because that is what the screen shows.
      location: i.location || '',
      group: i.group || '',
      subgroup: i.subgroup || '',
      locationGroup: i.locationGroup || '',
      locationSub: i.locationSub || '',
      // Money only for a session that was given it; zero for everybody else, and the screen shows
      // nothing rather than something invented.
      avgCost: amount(i.avgCost, 0),
      lastPrice: amount(i.lastPrice, 0)
    };
  }

  function toServer(i) {
    const kept = i._server || {};
    return {
      id: i.id ? Number(i.id) : null,
      code: i.code,
      description: i.description,
      unit: i.unit,
      // The ids, never the names on screen. The dropdowns that would change these are filled from
      // collections the server does not serve yet, so what came in is what goes back.
      group_id: id(kept.groupId),
      subgroup_id: id(kept.subgroupId),
      location_id: id(kept.locationId),
      sublocation_id: id(kept.sublocationId),
      bin_code: said(i.location, said(kept.location)),
      category: said(i.category, said(kept.category)),
      grade: said(i.grade, said(kept.grade)),
      dimensions: said(i.dimensions, said(kept.dimensions)),
      base_unit: said(i.baseUnit, said(kept.baseUnit)),
      size_per_unit: amount(i.sizePerUnit, amount(kept.sizePerUnit, null)),
      weight_per_base: amount(i.weightPerBase, amount(kept.weightPerBase, null)),
      unit_weight: amount(i.unitWeight, amount(kept.unitWeight, null)),
      min_stock: amount(i.minStock, 0),
      reorder_quantity: amount(i.reorderQty, amount(kept.reorderQty, null)),
      heat_no: said(i.heat, said(kept.heat)),
      material_cert_ref: said(i.certificate, said(kept.certificate)),
      // Money is only sent by a session that was given it. A welder's copy has no cost at all, and
      // sending the zero the screen shows would wipe what the store paid.
      avg_cost: amount(i.avgCost, 0) > 0 ? amount(i.avgCost, 0) : amount(kept.avgCost, null),
      last_price: amount(i.lastPrice, 0) > 0 ? amount(i.lastPrice, 0) : amount(kept.lastPrice, null)
    };
  }

  const api = { fromServer, toServer, amount, said };
  root.StockRecord = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
