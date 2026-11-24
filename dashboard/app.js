// Launch Radar page: runs RadarModel on the snapshot in ../data.js and renders three views.
// State lives in the hash (#board?cat=Lending&sort=tvl, #p/<slug>, #live, #model) so every view links.
(function () {
  'use strict';
  var snap = window.RADAR_SNAPSHOT;
  var M = window.RadarModel;
  var app = document.getElementById('app');
  if (!snap || !M) { app.innerHTML = '<p class="empty">No snapshot: run main.ts to write ../data.js.</p>'; return; }

  var R = M.build(snap);
  var rows = R.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });
  var maxValue = rows[0].implied_value_usd;

  // ------------------------------------------------------------ formatting

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function money(x) {
    if (x === null || x === undefined) return '–';
    var a = Math.abs(x);
    if (a >= 1e12) return '$' + (x / 1e12).toFixed(1) + 'T';
    if (a >= 1e9) return '$' + (x / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (x / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (x / 1e3).toFixed(0) + 'K';
    return '$' + x.toFixed(x < 10 ? 2 : 0);
  }
  function pct(x) { return x === null ? '<span class="dim">n/a</span>' : '<span class="' + (x >= 0 ? 'up' : 'down') + '">' + (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(1) + '%</span>'; }
  function age(d) { return d === null ? '<span class="dim">unlisted</span>' : d >= 365 ? (d / 365).toFixed(1) + 'y' : d + 'd'; }
  function mult(x) { return '×' + (x >= 1 ? x.toFixed(2) : x.toFixed(3)); }
  function chainsLine(c) { return c.length <= 2 ? c.join(', ') : c.slice(0, 2).join(', ') + ' +' + (c.length - 2); }

  // ------------------------------------------------------------ state

  var DEFAULT = { q: '', cat: '', chain: '', tier: 'all', trend: 'any', tvl: '0', sort: 'rank', dir: 'asc' };
  function parse() {
    var h = location.hash.slice(1);
    var view = h.split('?')[0] || 'board';
    var st = Object.assign({}, DEFAULT);
    var qs = h.split('?')[1];
    if (qs) qs.split('&').forEach(function (kv) { var p = kv.split('='); if (p[0] in st) st[p[0]] = decodeURIComponent(p[1] || ''); });
    return { view: view, st: st };
  }
  function hashOf(st) {
    var parts = Object.keys(DEFAULT).filter(function (k) { return st[k] !== DEFAULT[k]; }).map(function (k) { return k + '=' + encodeURIComponent(st[k]); });
    return '#board' + (parts.length ? '?' + parts.join('&') : '');
  }
  var state = Object.assign({}, DEFAULT);

  // ------------------------------------------------------------ board

  var COLS = [
    { key: 'rank', label: 'Rank', num: true, get: function (r) { return r.rank; } },
    { key: 'name', label: 'Protocol', get: function (r) { return r.name.toLowerCase(); } },
    { key: 'tvl', label: 'TVL', num: true, get: function (r) { return r.tvl_usd; } },
    { key: 'd7', label: '7d', num: true, get: function (r) { return r.change_7d === null ? -1e9 : r.change_7d; } },
    { key: 'age', label: 'No token for', num: true, get: function (r) { return r.age_days === null ? -1 : r.age_days; } },
    { key: 'peer', label: 'Peer ×', num: true, get: function (r) { return r.model.peer_multiple; } },
    { key: 'value', label: 'Implied value', num: true, get: function (r) { return r.implied_value_usd; } },
    { key: 'odds', label: 'Launch odds', num: true, get: function (r) { return r.launch_odds; } },
    { key: 'per1k', label: 'Drop / $1k', num: true, get: function (r) { return r.airdrop_per_1k; } }
  ];

  function filtered(st) {
    var q = st.q.trim().toLowerCase();
    var minTvl = Number(st.tvl) || 0;
    var list = rows.filter(function (r) {
      if (q && (r.name + ' ' + r.slug + ' ' + r.category + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) < 0) return false;
      if (st.cat && r.category !== st.cat) return false;
      if (st.chain && r.chains.indexOf(st.chain) < 0) return false;
      if (st.tier !== 'all' && r.tier !== st.tier) return false;
      if (st.trend === 'up' && !(r.change_7d > 0)) return false;
      if (st.trend === 'down' && !(r.change_7d < 0)) return false;
      return r.tvl_usd >= minTvl;
    });
    var col = COLS.filter(function (c) { return c.key === st.sort; })[0] || COLS[0];
    var sign = st.dir === 'desc' ? -1 : 1;
    return list.sort(function (a, b) { var x = col.get(a), y = col.get(b); return (x < y ? -1 : x > y ? 1 : a.rank - b.rank) * sign; });
  }

  function options(values, selected, all) {
    return '<option value="">' + all + '</option>' + values.map(function (v) { return '<option' + (v === selected ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
  }
  function countBy(key) {
    var n = {};
    rows.forEach(function (r) { [].concat(r[key]).forEach(function (v) { n[v] = (n[v] || 0) + 1; }); });
    return Object.keys(n).sort(function (a, b) { return n[b] - n[a] || (a < b ? -1 : 1); });
  }

  function seg(name, value, opts) {
    return '<div class="seg" data-name="' + name + '">' + opts.map(function (o) { return '<button type="button" data-v="' + o[0] + '"' + (o[0] === value ? ' class="on"' : '') + '>' + o[1] + '</button>'; }).join('') + '</div>';
  }

  function renderBoard(st) {
    var list = filtered(st);
    var watch = rows.filter(function (r) { return r.tier === 'watchlist'; }).length;
    var total = list.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var active = Object.keys(DEFAULT).some(function (k) { return k !== 'sort' && k !== 'dir' && st[k] !== DEFAULT[k]; });
    var html = '';
    html += '<section class="hero"><div><h1>' + rows.length + ' protocols with no token on record, ranked by what a launch would be worth</h1>' +
      '<p class="lede">Implied value = TVL × the market-cap-to-TVL multiple the snapshot\'s ' + R.calibration.live + ' live tokens price in the same category, adjusted for seven-day momentum, months run with no token and chain reach. All ' + watch + ' watchlist protocols are covered; ' + (rows.length - watch) + ' early rows below the $50M floor are held to the same rule. A model\'s estimate, not a price.</p></div>' +
      '<dl class="kpis">' +
      '<div><dt>Watchlist covered</dt><dd>' + watch + ' / ' + snap.watchlist.length + '</dd></div>' +
      '<div><dt>Early rows below floor</dt><dd>' + (rows.length - watch) + '</dd></div>' +
      '<div><dt>Live tokens priced as peers</dt><dd>' + R.calibration.live + '</dd></div>' +
      '<div><dt>Median peer multiple</dt><dd>' + mult(R.calibration.global) + '</dd></div>' +
      '</dl></section>';
    html += '<form class="filters" id="filters" onsubmit="return false">' +
      '<label class="grow">Search<input name="q" type="search" placeholder="Name, category or chain" value="' + esc(st.q) + '"></label>' +
      '<label>Category<select name="cat">' + options(countBy('category'), st.cat, 'All categories') + '</select></label>' +
      '<label>Chain<select name="chain">' + options(countBy('chains'), st.chain, 'All chains') + '</select></label>' +
      '<label>Min TVL<select name="tvl">' + [['0', 'Any'], ['10000000', '$10M+'], ['50000000', '$50M+'], ['100000000', '$100M+'], ['500000000', '$500M+']].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === st.tvl ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
      '<div class="field"><span>Tier</span>' + seg('tier', st.tier, [['all', 'All'], ['watchlist', 'Watchlist'], ['early', 'Early']]) + '</div>' +
      '<div class="field"><span>7-day TVL</span>' + seg('trend', st.trend, [['any', 'Any'], ['up', 'Growing'], ['down', 'Falling']]) + '</div>' +
      '</form>';
    html += '<div class="summary"><span><b>' + list.length + '</b> of ' + rows.length + ' rows' + (active ? ' match the filters' : '') + ' · combined implied value <b>' + money(total) + '</b></span>' +
      (active ? '<a href="#board" class="reset">Clear filters</a>' : '<span class="dim">Select a row for its value build-up, peers and farm plan · click a column to sort</span>') + '</div>';
    html += '<div class="table-wrap"><table class="board"><thead><tr>' + COLS.map(function (c) {
      var on = st.sort === c.key;
      return '<th class="' + (c.num ? 'num ' : '') + (on ? 'sorted' : '') + '" data-sort="' + c.key + '">' + c.label + (on ? (st.dir === 'asc' ? ' ▲' : ' ▼') : '') + '</th>';
    }).join('') + '</tr></thead><tbody>';
    html += list.map(function (r) {
      var w = Math.max(2, Math.round(100 * Math.sqrt(r.implied_value_usd / maxValue)));
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num rank">' + r.rank + '</td>' +
        '<td><div class="name">' + esc(r.name) + (r.tier === 'watchlist' ? ' <i class="tag w">watchlist</i>' : ' <i class="tag e">early</i>') + (r.sibling ? ' <i class="tag s" title="' + esc(r.sibling.name) + ' records ' + esc(r.sibling.symbol) + '">sibling ' + esc(r.sibling.symbol) + '</i>' : '') + '</div><div class="sub">' + esc(r.category) + ' · ' + esc(chainsLine(r.chains)) + '</div></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td>' +
        '<td class="num">' + mult(r.model.peer_multiple) + '</td>' +
        '<td class="num value"><span class="bar"><i style="width:' + w + '%"></i></span>' + money(r.implied_value_usd) + '</td>' +
        '<td class="num">' + Math.round(r.launch_odds * 100) + '%</td>' +
        '<td class="num">' + money(r.airdrop_per_1k) + '</td></tr>';
    }).join('') + '</tbody></table>' + (list.length ? '' : '<p class="empty">No protocol matches these filters.</p>') + '</div>';
    app.innerHTML = html;

    var form = document.getElementById('filters');
    form.addEventListener('input', function (e) {
      var t = e.target;
      if (!t.name) return;
      state[t.name] = t.value;
      history.replaceState(null, '', hashOf(state));
      if (t.name === 'q') { var pos = t.selectionStart; renderBoard(state); var i = document.querySelector('input[name=q]'); i.focus(); i.setSelectionRange(pos, pos); } else renderBoard(state);
    });
    Array.prototype.forEach.call(form.querySelectorAll('.seg button'), function (b) {
      b.addEventListener('click', function () { state[b.parentNode.dataset.name] = b.dataset.v; location.hash = hashOf(state); });
    });
    Array.prototype.forEach.call(app.querySelectorAll('th[data-sort]'), function (th) {
      th.addEventListener('click', function () {
        var k = th.dataset.sort;
        state.dir = state.sort === k ? (state.dir === 'asc' ? 'desc' : 'asc') : (k === 'rank' || k === 'name' ? 'asc' : 'desc');
        state.sort = k;
        location.hash = hashOf(state);
      });
    });
    Array.prototype.forEach.call(app.querySelectorAll('tbody tr'), function (tr) {
      tr.addEventListener('click', function () { location.hash = '#p/' + tr.dataset.slug; });
    });
  }

  // ------------------------------------------------------------ detail

  function renderDetail(slug) {
    var r = bySlug[slug];
    if (!r) { app.innerHTML = '<p class="empty">No protocol ' + esc(slug) + ' on the board. <a href="#board">Back to the board</a></p>'; return; }
    var m = r.model;
    var base = r.tvl_usd * m.peer_multiple;
    var build = [
      ['TVL', r.tvl_usd, 'Snapshot figure, ' + esc(r.chains.length) + ' chain' + (r.chains.length === 1 ? '' : 's')],
      ['× peer multiple ' + mult(m.peer_multiple), base, m.peers + ' live ' + esc(r.category) + ' peer' + (m.peers === 1 ? '' : 's') + ', shrunk toward the ' + esc(r.family) + ' family'],
      ['× momentum ' + mult(m.momentum), base * m.momentum, 'Seven-day TVL change ' + (r.change_7d === null ? 'not reported' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(2) + '%')],
      ['× maturity ' + mult(m.maturity), base * m.momentum * m.maturity, r.age_days === null ? 'No listing date: neutral' : age(r.age_days) + ' tracked with no token'],
      ['× reach ' + mult(m.reach), r.implied_value_usd, r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ' → implied value']
    ];
    var top = Math.max.apply(null, build.map(function (b) { return b[1]; }));
    var same = R.live.filter(function (l) { return l.category === r.category; });
    var fam = R.live.filter(function (l) { return l.category !== r.category && M.familyOf(l.category) === r.family; });
    var peers = same.slice(0, 4).concat(fam.slice(0, 6 - Math.min(same.length, 4)));
    var p = r.plan;
    var stake = p.capital * r.airdrop_per_1k / 1000;
    var prev = rows[r.rank - 2], next = rows[r.rank];
    var html = '<nav class="crumbs"><a href="' + hashOf(state) + '">← Board</a>' + (prev ? '<a href="#p/' + esc(prev.slug) + '">↑ #' + prev.rank + ' ' + esc(prev.name) + '</a>' : '') + (next ? '<a href="#p/' + esc(next.slug) + '">↓ #' + next.rank + ' ' + esc(next.name) + '</a>' : '') + '</nav>';
    html += '<section class="dhead"><div><p class="eyebrow">Rank ' + r.rank + ' of ' + rows.length + ' · ' + (r.tier === 'watchlist' ? 'watchlist' : 'early, below the $50M floor') + ' · no token on record</p><h1>' + esc(r.name) + '</h1>' +
      '<p class="lede">' + esc(r.category) + ' on ' + esc(r.chains.join(', ')) + (r.listed_at ? ' · tracked since ' + esc(r.listed_at) : '') + '</p>' +
      (r.sibling ? '<p class="warn">Sibling token: ' + esc(r.sibling.name) + ' already records ' + esc(r.sibling.symbol) + '. A launch here may reuse it rather than issue a new one.</p>' : '') + '</div>' +
      '<dl class="kpis four"><div><dt>Implied value</dt><dd>' + money(r.implied_value_usd) + '</dd></div><div><dt>TVL</dt><dd>' + money(r.tvl_usd) + '</dd></div><div><dt>Launch odds</dt><dd>' + Math.round(r.launch_odds * 100) + '%</dd></div><div><dt>Drop per $1k</dt><dd>' + money(r.airdrop_per_1k) + '</dd></div></dl></section>';
    html += '<div class="detail"><div>';
    html += '<section class="card"><h3>How the value is built</h3><ol class="build">' + build.map(function (b) {
      return '<li><div class="row"><span>' + b[0] + '</span><b>' + money(b[1]) + '</b></div><span class="bar"><i style="width:' + Math.max(1, 100 * b[1] / top).toFixed(1) + '%"></i></span><small>' + b[2] + '</small></li>';
    }).join('') + '</ol></section>';
    html += '<section class="card"><h3>Peers whose token trades</h3><p class="note">Market cap ÷ TVL, the multiple the peer multiple is drawn from' + (same.length ? '' : '; no live ' + esc(r.category) + ' token, so the family stands in') + '.</p><table class="mini"><tbody>' + peers.map(function (l) {
      return '<tr><td>' + esc(l.name) + ' <span class="dim">' + esc(l.symbol || '') + '</span></td><td class="dim">' + esc(l.category) + '</td><td class="num">' + money(l.mcap_usd) + '</td><td class="num">' + mult(l.multiple) + '</td></tr>';
    }).join('') + '</tbody></table></section></div>';
    html += '<section class="card plan"><h3>Farm plan</h3><div class="plan-sum"><span>Stake <b>' + money(p.capital) + '</b> on ' + esc(p.chain) + '</span><span>Setup <b>' + money(p.setup_cost) + '</b></span><span>Running <b>' + money(p.monthly_cost) + '/mo</b></span><span>Hold <b>' + p.hold_days + ' days</b></span></div>' +
      '<p class="note">At this value, a ' + (M.CONST.airdrop_share * 100).toFixed(1) + '% airdrop pro rata to TVL pays a ' + money(p.capital) + ' stake about <b>' + money(stake) + '</b>; weighted by the category\'s ' + Math.round(r.launch_odds * 100) + '% launch odds, <b>' + money(stake * r.launch_odds) + '</b>, against <b>' + money(p.setup_cost + p.monthly_cost * p.hold_days / 30) + '</b> of fees over the hold.</p>';
    html += '<ol class="steps">' + p.steps.map(function (s) { return '<li><p>' + esc(s.text) + '.</p><span class="chip">' + esc(s.cost) + '</span><span class="chip t">' + esc(s.time) + '</span></li>'; }).join('') + '</ol></section></div>';
    app.innerHTML = html;
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------ live tokens

  function renderLive() {
    var html = '<section class="hero slim"><div><h1>' + R.live.length + ' protocols whose token already trades</h1><p class="lede">Kept off the board and shown at the market\'s own value, one row per token: where several products carry one ticker, the token\'s TVL is theirs summed. Their market-cap-to-TVL multiples are what the model prices pre-token protocols against. A further ' + R.aside.filter(function (a) { return /^token on record/.test(a.reason); }).length + ' protocols record a token with no market cap (products of a token that trades) and are set aside.</p></div></section>';
    html += '<div class="table-wrap"><table class="board live"><thead><tr><th>Protocol</th><th>Token</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Cap ÷ TVL</th><th class="num">7d</th></tr></thead><tbody>' +
      R.live.map(function (l) {
        return '<tr class="static"><td><div class="name">' + esc(l.name) + '</div><div class="sub">' + esc(chainsLine(l.chains)) + (l.products > 1 ? ' · TVL of ' + l.products + ' products carrying ' + esc(l.symbol) : '') + '</div></td><td><i class="tag l">' + esc(l.symbol || '–') + '</i></td><td>' + esc(l.category) + '</td><td class="num">' + money(l.tvl_usd) + '</td><td class="num">' + money(l.mcap_usd) + '</td><td class="num">' + mult(l.multiple) + '</td><td class="num">' + pct(l.change_7d) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    app.innerHTML = html;
  }

  // ------------------------------------------------------------ model

  function scatter() {
    // Live tokens on log axes: TVL across, market cap up; the dashed line is the median multiple.
    var W = 560, H = 300, P = 36;
    var lx = function (v) { return Math.log10(v); };
    var x0 = 6.5, x1 = 11.5, y0 = 5, y1 = 12;
    var X = function (v) { return P + (lx(v) - x0) / (x1 - x0) * (W - 2 * P); };
    var Y = function (v) { return H - P - (Math.min(Math.max(lx(v), y0), y1) - y0) / (y1 - y0) * (H - 2 * P); };
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Market cap against TVL for live tokens">';
    for (var e = 7; e <= 11; e++) s += '<line class="grid" x1="' + X(Math.pow(10, e)) + '" y1="' + P + '" x2="' + X(Math.pow(10, e)) + '" y2="' + (H - P) + '"/><text x="' + X(Math.pow(10, e)) + '" y="' + (H - 12) + '">' + money(Math.pow(10, e)) + '</text>';
    for (var f = 6; f <= 12; f += 2) s += '<line class="grid" x1="' + P + '" y1="' + Y(Math.pow(10, f)) + '" x2="' + (W - P) + '" y2="' + Y(Math.pow(10, f)) + '"/><text class="l" x="4" y="' + (Y(Math.pow(10, f)) + 4) + '">' + money(Math.pow(10, f)) + '</text>';
    var g = R.calibration.global;
    s += '<line class="fit" x1="' + X(Math.pow(10, x0)) + '" y1="' + Y(Math.pow(10, x0) * g) + '" x2="' + X(Math.pow(10, x1)) + '" y2="' + Y(Math.pow(10, x1) * g) + '"/>';
    s += '<text class="axis" x="' + (W - P) + '" y="' + (H - 24) + '" style="text-anchor:end">TVL →</text><text class="axis l" x="' + (P + 4) + '" y="' + (P - 8) + '">↑ market cap</text>';
    R.live.forEach(function (l) { if (l.tvl_usd > 0) s += '<circle class="dot ' + M.familyOf(l.category) + '" cx="' + X(l.tvl_usd).toFixed(1) + '" cy="' + Y(l.mcap_usd).toFixed(1) + '" r="3.5"><title>' + esc(l.name) + ' ' + mult(l.multiple) + '</title></circle>'; });
    return s + '</svg>';
  }

  function curve() {
    // The maturity multiplier against days tracked with no token.
    var W = 560, H = 170, P = 30, D = 2600;
    var X = function (d) { return P + d / D * (W - 2 * P); };
    var Y = function (v) { return H - P - (v - 0.6) / 0.6 * (H - 2 * P); };
    var pts = [];
    for (var d = 0; d <= D; d += 20) pts.push(X(d).toFixed(1) + ',' + Y(M.maturity(d)).toFixed(1));
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Maturity multiplier by age">';
    [0, 365, 730, 1095, 1460, 1825, 2190, 2555].forEach(function (d) { s += '<line class="grid" x1="' + X(d) + '" y1="' + P + '" x2="' + X(d) + '" y2="' + (H - P) + '"/><text x="' + X(d) + '" y="' + (H - 10) + '">' + d / 365 + 'y</text>'; });
    [0.7, 1, 1.15].forEach(function (v) { s += '<text class="l" x="2" y="' + (Y(v) + 4) + '">×' + v + '</text>'; });
    rows.forEach(function (r) { if (r.age_days !== null) s += '<circle class="dot ' + r.family + '" cx="' + X(Math.min(r.age_days, D)).toFixed(1) + '" cy="' + Y(r.model.maturity).toFixed(1) + '" r="2.5"/>'; });
    return s + '<polyline class="fit solid" points="' + pts.join(' ') + '"/></svg>';
  }

  function renderModel() {
    var C = M.CONST;
    var cats = Object.keys(R.calibration.categories).map(function (k) { return R.calibration.categories[k]; })
      .filter(function (c) { return rows.some(function (r) { return r.category === c.category; }); })
      .sort(function (a, b) { return b.multiple - a.multiple; });
    var aside = {};
    R.aside.forEach(function (a) { var k = /^token on record/.test(a.reason) ? 'token on record, no market cap' : a.reason; aside[k] = (aside[k] || 0) + 1; });
    var html = '<section class="hero slim"><div><h1>The model: ' + esc(M.VERSION) + '</h1><p class="lede">One function, <code>build</code> in model.js, scores every row from the snapshot\'s own figures. No protocol name is special-cased. main.ts runs the same file to write board.json, so these screens and the board agree.</p></div></section>';
    html += '<div class="grid2"><section class="card"><h3>Formula</h3><pre>implied = TVL\n        × peer multiple   (category median cap÷TVL of live tokens,\n                           shrunk toward its family with k=' + C.shrink_k + ')\n        × momentum        exp(' + C.growth_weight + ' × tanh(7d % ÷ 30))\n        × maturity        ×' + C.maturity_start + ' at listing → ×' + C.maturity_peak + ' at 18 months,\n                          held to 3 years, fading to ×' + C.maturity_old + ' by 6\n        × reach           +' + C.reach_step * 100 + '% per extra chain, up to 10</pre>' +
      '<p class="note">Launch odds: the share of the category\'s protocols in the snapshot that already record a token, smoothed. Drop per $1k: implied value × ' + C.airdrop_share * 100 + '% airdrop ÷ TVL × $1,000. Both are shown beside the value, never folded into it.</p>' +
      '<h3>Set aside, not ranked</h3><table class="mini"><tbody>' + Object.keys(aside).sort(function (a, b) { return aside[b] - aside[a]; }).map(function (k) { return '<tr><td>' + esc(k) + '</td><td class="num">' + aside[k] + '</td></tr>'; }).join('') + '<tr><td>token trades (Live tokens tab)</td><td class="num">' + R.live.length + '</td></tr></tbody></table></section>' +
      '<section class="card"><h3>Live tokens: market cap against TVL</h3>' + scatter() + '<p class="legend">' + ['vaults', 'credit', 'trading', 'realworld', 'network', 'other'].map(function (f) { return '<span><i class="dot-key ' + f + '"></i>' + f + '</span>'; }).join('') + '</p><p class="note">Dashed: the median multiple, ' + mult(R.calibration.global) + ', across all ' + R.calibration.live + '. Each family\'s own median is the prior a thin category shrinks toward.</p></section>' +
      '<section class="card"><h3>Peer multiple by category</h3><table class="mini"><thead><tr><th>Category</th><th class="num">Live peers</th><th class="num">Raw median</th><th class="num">Used</th><th class="num">Rows</th></tr></thead><tbody>' +
      cats.map(function (c) { return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.peers + '</td><td class="num">' + (c.raw === null ? '–' : mult(c.raw)) + '</td><td class="num"><b>' + mult(c.multiple) + '</b></td><td class="num">' + rows.filter(function (r) { return r.category === c.category; }).length + '</td></tr>'; }).join('') + '</tbody></table></section>' +
      '<section class="card"><h3>Maturity: months run with no token</h3>' + curve() + '<p class="note">Young protocols have not proved they keep TVL; past three years with no token, a launch looks less likely to come. Each dot is a board row.</p></section></div>';
    app.innerHTML = html;
  }

  // ------------------------------------------------------------ routing

  document.getElementById('meta').textContent = 'Snapshot ' + snap.as_of + ' · DefiLlama protocol index · ' + snap.protocols.length + ' protocols · model ' + M.VERSION;

  function route() {
    var r = parse();
    var view = r.view;
    if (view.indexOf('p/') === 0) {
      renderDetail(decodeURIComponent(view.slice(2)));
      view = 'board';
    } else {
      if (view === 'live') renderLive();
      else if (view === 'model') renderModel();
      else { view = 'board'; state = r.st; renderBoard(state); }
    }
    Array.prototype.forEach.call(document.querySelectorAll('#tabs a'), function (a) { a.classList.toggle('on', a.dataset.tab === view); });
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && location.hash.indexOf('#p/') === 0) location.hash = hashOf(state); });
  route();
})();
