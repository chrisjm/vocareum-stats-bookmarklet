/*
 * table-count-manual.js
 *
 * Manual tally for a paginated submissions table: totals rows and counts how
 * many have a literal "Y" in the Started column and how many have a literal
 * "Y" in the Finished column. "Currently taking" is Started Y, not Finished Y.
 *
 * No percentage is tracked: we never see every page, so a percentage would be
 * meaningless.
 *
 * You do all the paging and all the clicking. This only reads the rows that are
 * on screen when you press "Add this page".
 *
 * Usage:
 *   - Run once on the submissions page (DevTools snippet, or the javascript:
 *     bookmarklet in table-count-manual.txt).
 *   - Page through however you like and press "Add this page" on each page.
 *   - Press "End of Page" to jump to the bottom of the page (where the
 *     pagination controls usually sit) before choosing the next page.
 *   - Pressing "Add this page" twice on the same page adds nothing (rows are
 *     de-duplicated).
 *
 * Privacy:
 *   - No name is ever stored, printed, or copied.
 *   - The de-duplication key is a numeric user id when one can be found (an id
 *     column, a number inside the User cell's link, or a numeric User cell).
 *     Only when there is no id at all is the User cell text read, and then only
 *     far enough to reduce it to a short non-cryptographic hash. The name itself
 *     is never assigned to a variable that outlives that expression, never
 *     written anywhere, and never printed. Either way what is stored is an
 *     opaque key like "id:1234" or "h:9f3a1c".
 *   - Only the three fields { key, started, finished } are ever persisted.
 *   - Any v1 state written by the previous version of this script is deleted.
 *
 * State: sessionStorage key "rowcounts.v2:<pathname>"
 * Console: window.__rowcounts = { summary, startedValues, finishedValues, rows }
 */
(function () {
  'use strict';

  var PANEL_ID = 'rowcounts-panel';
  var STORE_PREFIX = 'rowcounts.v2:';
  var LEGACY_PREFIX = 'rowcounts.v1:';
  var SKU = STORE_PREFIX + location.pathname;
  var CFG = { started: 'Started', finished: 'Finished', user: 'User' };

  var clean = function (s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); };
  var textOf = function (el) { return el ? clean(el.innerText || el.textContent) : ''; };

  var scrubLegacy = function () {
    try { sessionStorage.removeItem(LEGACY_PREFIX + location.pathname); } catch (e) {}
  };

  /* ---------------- storage ---------------- */
  var load = function () {
    try {
      var raw = sessionStorage.getItem(SKU);
      var parsed = raw ? JSON.parse(raw) : null;
      if (parsed && Array.isArray(parsed.rows)) {
        return {
          rows: parsed.rows.filter(function (r) {
            return r && typeof r.key === 'string' && typeof r.started === 'string' && typeof r.finished === 'string';
          }).map(function (r) {
            return { key: r.key, started: r.started, finished: r.finished };
          })
        };
      }
    } catch (e) {}
    return { rows: [] };
  };
  var save = function (state) {
    try { sessionStorage.setItem(SKU, JSON.stringify({ rows: state.rows })); } catch (e) {}
  };

  /* ---------------- table + columns ---------------- */
  var pickTable = function () {
    var tables = Array.prototype.slice.call(document.querySelectorAll('table'));
    if (!tables.length) return null;
    var size = function (t) { return t.tBodies[0] ? t.tBodies[0].rows.length : 0; };
    tables.sort(function (a, b) { return size(b) - size(a); });
    return tables[0];
  };

  var findCol = function (headers, name) {
    var lower = name.toLowerCase();
    var exact = -1;
    var loose = -1;
    for (var i = 0; i < headers.length; i++) {
      var h = headers[i].toLowerCase();
      if (h === lower && exact < 0) exact = i;
      if (loose < 0 && h.indexOf(lower) !== -1) loose = i;
    }
    return exact >= 0 ? exact : loose;
  };

  var findIdCol = function (headers) {
    for (var i = 0; i < headers.length; i++) {
      if (/(^|[^a-z])id([^a-z]|$)/i.test(headers[i])) return i;
    }
    return -1;
  };

  /* ---------------- opaque de-duplication key ---------------- */
  var hash = function (s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  };

  var idFromUserCell = function (td) {
    if (!td) return '';
    var link = td.querySelector('a[href]');
    if (link) {
      var href = link.getAttribute('href') || '';
      var nums = href.match(/\d{2,}/g);
      if (nums && nums.length) return 'id:' + nums[nums.length - 1];
    }
    var holder = td.querySelector('[data-user-id],[data-student-id],[data-id]');
    if (holder) {
      var v = holder.getAttribute('data-user-id') || holder.getAttribute('data-student-id') || holder.getAttribute('data-id');
      if (v && /^\d+$/.test(clean(v))) return 'id:' + clean(v);
    }
    var text = textOf(td);
    if (/^\d+$/.test(text)) return 'id:' + text;
    return '';
  };

  /* ---------------- scrape the visible page ---------------- */
  var scrape = function () {
    var table = pickTable();
    if (!table) return { error: 'No <table> found on this page.' };
    var tbody = table.tBodies[0];
    if (!tbody) return { error: 'That table has no <tbody>.' };

    var headerRow = table.tHead ? table.tHead.rows[0] : null;
    var headers = headerRow ? Array.prototype.map.call(headerRow.cells, function (c) { return textOf(c); }) : [];
    var iS = findCol(headers, CFG.started);
    var iF = findCol(headers, CFG.finished);
    if (iS < 0 && iF < 0) {
      return { error: 'Could not find Started/Finished columns. Headers: ' + headers.join(' | ') };
    }

    var iId = findIdCol(headers);
    var iU = findCol(headers, CFG.user);
    var minCells = Math.max(iS, iF, 1);

    var trs = Array.prototype.filter.call(tbody.rows, function (tr) {
      if (tr.classList.contains('child') || tr.classList.contains('dt-hasChild')) return false;
      if (tr.classList.contains('dt-empty') || tr.classList.contains('empty')) return false;
      return tr.cells.length >= minCells;
    });

    var rows = trs.map(function (tr) {
      var key = '';
      if (iId >= 0 && /^\d+$/.test(textOf(tr.cells[iId]))) key = 'id:' + textOf(tr.cells[iId]);
      if (!key && iU >= 0) key = idFromUserCell(tr.cells[iU]);
      if (!key && iU >= 0) key = 'h:' + hash(textOf(tr.cells[iU]));
      if (!key) {
        var parts = [];
        for (var c = 0; c < tr.cells.length; c++) {
          if (c === iU) continue;
          parts.push(textOf(tr.cells[c]));
        }
        key = 'h:' + hash(parts.join('|'));
      }
      return {
        key: key,
        started: iS >= 0 ? textOf(tr.cells[iS]) : '',
        finished: iF >= 0 ? textOf(tr.cells[iF]) : ''
      };
    });

    return { rows: rows };
  };

  /* ---------------- classify: literal Y only ---------------- */
  var isY = function (v) { return clean(v).toUpperCase() === 'Y'; };
  var isN = function (v) { return clean(v).toUpperCase() === 'N'; };
  var isOther = function (v) { return !isY(v) && !isN(v); };

  var summarise = function (rows) {
    var total = rows.length;
    var count = function (fn) { return rows.filter(fn).length; };
    var started = count(function (r) { return isY(r.started); });
    var finished = count(function (r) { return isY(r.finished); });
    return {
      rows: total,
      startedY: started,
      finishedY: finished,
      startedNotFinished: count(function (r) { return isY(r.started) && !isY(r.finished); }),
      startedN: count(function (r) { return isN(r.started); }),
      finishedN: count(function (r) { return isN(r.finished); }),
      startedOther: count(function (r) { return isOther(r.started); }),
      finishedOther: count(function (r) { return isOther(r.finished); })
    };
  };

  var frequency = function (rows, key) {
    var map = new Map();
    for (var i = 0; i < rows.length; i++) {
      var k = rows[i][key] === '' ? '(blank)' : rows[i][key];
      map.set(k, (map.get(k) || 0) + 1);
    }
    return Array.from(map.entries())
      .sort(function (a, b) { return b[1] - a[1]; })
      .map(function (e) { return { value: e[0], rows: e[1] }; });
  };

  var scrollToEnd = function () {
    var doc = document.documentElement;
    var y = Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0);
    window.scrollTo({ top: y, behavior: 'smooth' });
    status = 'Jumped to the end of the page.';
    render();
  };

  /* ---------------- actions ---------------- */
  var state = load();
  var status = '';

  var addCurrentPage = function () {
    var page = scrape();
    if (page.error) { status = page.error; render(); return; }
    if (!page.rows.length) { status = 'That page had no data rows.'; render(); return; }

    var seen = new Set(state.rows.map(function (r) { return r.key; }));
    var batchSeen = new Set();
    var fresh = 0;
    var dupes = 0;
    page.rows.forEach(function (row) {
      if (seen.has(row.key) || batchSeen.has(row.key)) { dupes += 1; return; }
      batchSeen.add(row.key);
      state.rows.push(row);
      fresh += 1;
    });

    save(state);
    status = fresh
      ? '+' + fresh + ' row' + (fresh === 1 ? '' : 's') + ' added' + (dupes ? ' (' + dupes + ' already counted)' : '')
      : 'Nothing new on this page (' + dupes + ' already counted)';

    report();
    render();
  };

  var reset = function () {
    state = { rows: [] };
    save(state);
    status = 'Counters cleared.';
    report();
    render();
  };

  var buildSnapshot = function () {
    return {
      summary: summarise(state.rows),
      startedValues: frequency(state.rows, 'started'),
      finishedValues: frequency(state.rows, 'finished'),
      rows: state.rows
    };
  };

  var report = function () {
    var snap = buildSnapshot();
    window.__rowcounts = snap;
    console.log('%c[rowcounts]', 'font-weight:bold', snap.summary.rows + ' rows accumulated');
    console.table(snap.summary);
    console.log('Started column values', snap.startedValues);
    console.log('Finished column values', snap.finishedValues);
  };

  /* ---------------- panel ---------------- */
  var el = {};

  var buildPanel = function () {
    var panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.setAttribute('style', [
      'position:fixed', 'top:16px', 'right:16px', 'z-index:2147483647',
      'width:264px', 'box-sizing:border-box', 'padding:10px 12px',
      'font:12px/1.45 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
      'color:#111', 'background:#fff', 'border:1px solid #d0d0d0', 'border-radius:10px',
      'box-shadow:0 6px 24px rgba(0,0,0,.18)', 'text-align:left'
    ].join(';'));

    panel.innerHTML = [
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">',
      '<strong style="font-size:12px;letter-spacing:.02em">Row counts</strong>',
      '<span style="flex:1"></span>',
      '<button data-role="collapse" title="Collapse" style="cursor:pointer;border:1px solid #d0d0d0;background:#f7f7f7;border-radius:6px;width:22px;height:22px;line-height:1;font-size:12px;padding:0">&#8211;</button>',
      '<button data-role="close" title="Hide panel" style="cursor:pointer;border:1px solid #d0d0d0;background:#f7f7f7;border-radius:6px;width:22px;height:22px;line-height:1;font-size:12px;padding:0">&times;</button>',
      '</div>',
      '<div data-role="body">',
      '<div data-role="totals" style="margin-bottom:6px"></div>',
      '<div data-role="notice" style="color:#a15c00;margin-bottom:6px"></div>',
      '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">',
      '<button data-role="add" style="cursor:pointer;border:1px solid #111;background:#111;color:#fff;border-radius:6px;padding:5px 9px;font:inherit">Add this page</button>',
      '<button data-role="end" style="cursor:pointer;border:1px solid #d0d0d0;background:#f7f7f7;border-radius:6px;padding:5px 9px;font:inherit">End of Page</button>',
      '<button data-role="reset" style="cursor:pointer;border:1px solid #d0d0d0;background:#f7f7f7;border-radius:6px;padding:5px 9px;font:inherit">Reset</button>',
      '</div>',
      '<div data-role="status" style="color:#555;min-height:1.3em"></div>',
      '</div>'
    ].join('');

    document.body.appendChild(panel);

    var q = function (role) { return panel.querySelector('[data-role="' + role + '"]'); };
    el.totals = q('totals');
    el.status = q('status');
    el.notice = q('notice');
    el.body = q('body');
    el.panel = panel;

    q('add').addEventListener('click', addCurrentPage);
    q('end').addEventListener('click', scrollToEnd);
    q('reset').addEventListener('click', function () {
      if (window.confirm('Clear the ' + state.rows.length + ' rows you have counted?')) reset();
    });
    q('close').addEventListener('click', function () { panel.remove(); });
    q('collapse').addEventListener('click', function () {
      var hidden = el.body.style.display === 'none';
      el.body.style.display = hidden ? '' : 'none';
      this.innerHTML = hidden ? '&#8211;' : '+';
    });
  };

  var render = function () {
    var s = summarise(state.rows);
    var line = function (label, value) {
      return '<div style="display:flex;justify-content:space-between;gap:8px"><span style="color:#555">' + label + '</span><strong>' + value + '</strong></div>';
    };
    el.totals.innerHTML = [
      line('Total', s.rows),
      line('Started', s.startedY),
      line('Finished', s.finishedY),
      line('Currently taking', s.startedNotFinished)
    ].join('');
    var odd = s.startedOther + s.finishedOther;
    el.notice.textContent = odd
      ? odd + ' cell' + (odd === 1 ? '' : 's') + ' not Y/N - see console'
      : '';
    el.status.textContent = status;
    window.__rowcounts = buildSnapshot();
  };

  /* ---------------- go ---------------- */
  scrubLegacy();

  if (document.getElementById(PANEL_ID)) {
    status = 'Already running here. Click "Add this page" after each page change.';
    render();
    return;
  }

  if (!document.body) {
    console.warn('[rowcounts] no <body> yet, try again once the page has loaded');
    return;
  }

  buildPanel();
  render();
  if (state.rows.length) {
    status = 'Restored ' + state.rows.length + ' rows from this session.';
    render();
  }
  return window.__rowcounts;
})();
