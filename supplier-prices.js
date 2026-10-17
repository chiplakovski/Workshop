// A merchant's price for a store item — the one form Store and Suppliers share.
//
// The two screens are the two ends of the same fact: Store asks "who sells this, and at what", Suppliers
// asks "what does this merchant sell us, and at what". Each used to know only half — the store kept a
// typed supplier name on the item, and the supplier's price list was empty on a copy with no server — so
// the same form opens from either end and writes the same line. It writes through WorkshopData, which
// each page's own bridge sends to the server when the page is signed in.
//
// Drawn in the shared dialog style (workshop-ui.css .wask), and in the page's language.
(function (root) {
  'use strict';

  const W = {
    en: {
      titleNew: 'Supplier price', titleEdit: 'Change the price', supplier: 'Supplier', item: 'Store item',
      chooseSupplier: 'Choose a supplier', chooseItem: 'Choose an item', articleNo: 'Their article no.',
      price: 'Price', currency: 'Currency', packSize: 'Pack size', leadTime: 'Lead time (days)',
      preferred: 'We buy this item from this supplier', save: 'Save', cancel: 'Cancel', remove: 'Remove',
      saved: 'Price saved.', removed: 'Price removed.', noSuppliers: 'There are no suppliers in the register yet. Add one on the Suppliers page first.',
      noItems: 'There are no items in the store yet. Create one in the Store first.',
      err_SUPPLIER_UNKNOWN: 'That supplier is not in the supplier register.', err_ITEM_UNKNOWN: 'That item is not in the store.',
      err_PRICE_NEEDED: 'A price is needed, zero or more.', err_PACK_INVALID: 'A pack holds more than nothing.',
      err_LEAD_INVALID: 'Lead time is a whole number of days.', err_ARTICLE_TOO_LONG: 'That article number is too long.',
      err_CURRENCY_INVALID: 'A currency is three letters, like SEK.', err_NOT_FOUND: 'That price is not there any more.'
    },
    sv: {
      titleNew: 'Leverantörspris', titleEdit: 'Ändra priset', supplier: 'Leverantör', item: 'Lagerartikel',
      chooseSupplier: 'Välj en leverantör', chooseItem: 'Välj en artikel', articleNo: 'Deras artikelnr',
      price: 'Pris', currency: 'Valuta', packSize: 'Förpackning', leadTime: 'Ledtid (dagar)',
      preferred: 'Vi köper den här artikeln från den här leverantören', save: 'Spara', cancel: 'Avbryt', remove: 'Ta bort',
      saved: 'Priset sparat.', removed: 'Priset borttaget.', noSuppliers: 'Det finns inga leverantörer i registret än. Lägg till en på sidan Leverantörer först.',
      noItems: 'Det finns inga artiklar i lagret än. Skapa en i Lager först.',
      err_SUPPLIER_UNKNOWN: 'Den leverantören finns inte i leverantörsregistret.', err_ITEM_UNKNOWN: 'Den artikeln finns inte i lagret.',
      err_PRICE_NEEDED: 'Ett pris behövs, noll eller mer.', err_PACK_INVALID: 'En förpackning innehåller mer än ingenting.',
      err_LEAD_INVALID: 'Ledtiden är ett helt antal dagar.', err_ARTICLE_TOO_LONG: 'Artikelnumret är för långt.',
      err_CURRENCY_INVALID: 'En valuta är tre bokstäver, som SEK.', err_NOT_FOUND: 'Det priset finns inte längre.'
    },
    mk: {
      titleNew: 'Цена од добавувач', titleEdit: 'Смени ја цената', supplier: 'Добавувач', item: 'Артикл од магацин',
      chooseSupplier: 'Изберете добавувач', chooseItem: 'Изберете артикл', articleNo: 'Нивен број на артикл',
      price: 'Цена', currency: 'Валута', packSize: 'Пакување', leadTime: 'Рок на испорака (денови)',
      preferred: 'Овој артикл го купуваме од овој добавувач', save: 'Зачувај', cancel: 'Откажи', remove: 'Отстрани',
      saved: 'Цената е зачувана.', removed: 'Цената е отстранета.', noSuppliers: 'Сè уште нема добавувачи во регистарот. Прво додајте еден на страницата Добавувачи.',
      noItems: 'Сè уште нема артикли во магацинот. Прво направете еден во Магацин.',
      err_SUPPLIER_UNKNOWN: 'Тој добавувач го нема во регистарот.', err_ITEM_UNKNOWN: 'Тој артикл го нема во магацинот.',
      err_PRICE_NEEDED: 'Потребна е цена, нула или повеќе.', err_PACK_INVALID: 'Пакувањето мора да содржи нешто.',
      err_LEAD_INVALID: 'Рокот е цел број денови.', err_ARTICLE_TOO_LONG: 'Бројот на артиклот е предолг.',
      err_CURRENCY_INVALID: 'Валутата е три букви, на пример SEK.', err_NOT_FOUND: 'Таа цена повеќе ја нема.'
    }
  };
  const words = () => W[(document.documentElement.lang || 'en').slice(0, 2)] || W.en;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const errorText = (r) => (r && (words()['err_' + r.code] || r.error)) || '';

  function close(box) {
    if (!box) return;
    document.removeEventListener('keydown', box.__key, true);
    box.remove();
  }

  // opts: { id } to change a line, or { supplier, code } to start one (either may be fixed in advance),
  // and onDone(message) once something was saved or removed.
  function open(opts) {
    opts = opts || {};
    const D = root.WorkshopData, t = words();
    const line = opts.id != null ? D.supplierPrices().find((l) => String(l.id) === String(opts.id)) : null;
    const suppliers = (D.get().suppliers || []).map((s) => s.name).filter(Boolean).sort((a, b) => a.localeCompare(b, 'sv'));
    const items = (D.get().inventory || []).slice().sort((a, b) => String(a.code).localeCompare(String(b.code)));
    if (!suppliers.length) return root.wAlert(t.noSuppliers);
    if (!items.length) return root.wAlert(t.noItems);
    const src = line || { supplier: opts.supplier || '', code: opts.code || '', price: '', currency: 'SEK', packSize: 1, leadTime: '', articleNo: '', preferred: false };
    // An item nobody buys elsewhere yet becomes this merchant's by default; one with a preferred merchant
    // already keeps it unless somebody ticks the box.
    if (!line && src.code && !D.supplierPrices({ code: src.code }).some((l) => l.preferred)) src.preferred = true;
    const fixedSupplier = !!(line || opts.supplier), fixedItem = !!(line || opts.code);
    const field = (label, inner) => `<label class="spf"><span>${esc(label)}</span>${inner}</label>`;
    const box = document.createElement('div');
    box.className = 'waskwrap';
    box.innerHTML = `<form class="wask spform" role="dialog" aria-modal="true" novalidate>
      <p class="waskmsg"><b>${esc(line ? t.titleEdit : t.titleNew)}</b></p>
      ${field(t.supplier, `<select class="waskinput" name="supplier" ${fixedSupplier ? 'disabled' : ''}><option value="">${esc(t.chooseSupplier)}</option>${suppliers.map((n) => `<option ${n === src.supplier ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`)}
      ${field(t.item, `<select class="waskinput" name="code" ${fixedItem ? 'disabled' : ''}><option value="">${esc(t.chooseItem)}</option>${items.map((i) => `<option value="${esc(i.code)}" ${i.code === src.code ? 'selected' : ''}>${esc(i.code + ' — ' + (i.description || ''))}</option>`).join('')}</select>`)}
      <div class="sprow">${field(t.price, `<input class="waskinput" name="price" type="number" min="0" step="0.01" value="${esc(src.price)}">`)}
        ${field(t.currency, `<input class="waskinput" name="currency" maxlength="3" value="${esc(src.currency || 'SEK')}">`)}</div>
      <div class="sprow">${field(t.articleNo, `<input class="waskinput" name="articleNo" maxlength="80" value="${esc(src.articleNo || '')}">`)}
        ${field(t.packSize, `<input class="waskinput" name="packSize" type="number" min="0" step="any" value="${esc(src.packSize == null ? 1 : src.packSize)}">`)}
        ${field(t.leadTime, `<input class="waskinput" name="leadTime" type="number" min="0" step="1" value="${esc(src.leadTime == null ? '' : src.leadTime)}">`)}</div>
      <label class="spcheck"><input type="checkbox" name="preferred" ${src.preferred ? 'checked' : ''}> ${esc(t.preferred)}</label>
      <div class="sperr" aria-live="assertive"></div>
      <div class="waskbtns">${line ? `<button type="button" class="spremove">${esc(t.remove)}</button>` : ''}<button type="button" class="waskno">${esc(t.cancel)}</button><button type="submit" class="waskyes">${esc(t.save)}</button></div>
    </form>`;
    const form = box.querySelector('form');
    const err = box.querySelector('.sperr');
    const done = (message) => { close(box); if (typeof opts.onDone === 'function') opts.onDone(message); };
    const settle = (answer, message) => Promise.resolve(answer).then((r) => {
      if (r && r.error) { err.textContent = errorText(r); return; }
      done(message);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = (n) => form.elements[n].value;
      const entry = { supplier: fixedSupplier ? src.supplier : v('supplier'), code: fixedItem ? src.code : v('code'),
        price: v('price'), currency: v('currency'), articleNo: v('articleNo'), packSize: v('packSize'),
        leadTime: v('leadTime'), preferred: form.elements.preferred.checked };
      if (line) entry.id = line.id;
      if (entry.leadTime !== '') entry.leadTime = Number(entry.leadTime);
      if (entry.price !== '') entry.price = Number(entry.price);
      settle(D.saveSupplierPrice(entry), t.saved);
    });
    box.querySelector('.waskno').addEventListener('click', () => close(box));
    const rm = box.querySelector('.spremove');
    if (rm) rm.addEventListener('click', () => settle(D.removeSupplierPrice(line.id), t.removed));
    box.addEventListener('mousedown', (e) => { if (e.target === box) close(box); });
    box.__key = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(box); } };
    document.addEventListener('keydown', box.__key, true);
    if (!document.getElementById('supplier-prices-style')) {
      const st = document.createElement('style');
      st.id = 'supplier-prices-style';
      st.textContent = '.spform{max-width:520px}.spf{display:block;flex:1}.spf span{display:block;font-size:11px;margin:0 0 4px;opacity:.75}'
        + '.spf .waskinput{margin-bottom:12px}.sprow{display:flex;gap:10px}.spcheck{display:flex;gap:8px;align-items:center;font-size:12.5px;margin:2px 0 10px}'
        + '.sperr{color:var(--danger,#ff6b6b);font-size:12.5px;min-height:1.2em;margin-bottom:8px}.spremove{margin-right:auto}';
      document.head.appendChild(st);
    }
    document.body.appendChild(box);
    const first = form.querySelector('select:not([disabled])') || form.elements.price;
    if (first) first.focus();
    return box;
  }

  root.SupplierPrices = { open, words, errorText };
})(window);
