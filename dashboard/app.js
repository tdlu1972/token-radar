// Launch Radar page: runs RadarModel on the snapshot in ../data.js and renders four views.
// State lives in the hash (#board?cat=Lending&sort=tvl, #p/<slug>, #live, #model) so every view links.
(function () {
  'use strict';
  var snap = window.RADAR_SNAPSHOT;
  var M = window.RadarModel;
  var app = document.getElementById('app');
  if (!snap || !M) { app.innerHTML = '<p class="empty">No snapshot: run main.ts to write ../data.js.</p>'; return; }

  var R = M.build(snap);
  var rows = R.rows;
  var F = R.fit;
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
  function mult(x) { return '×' + (x >= 1 ? x.toFixed(2) : x >= 0.01 ? x.toFixed(3) : x.toFixed(4)); }
  function share(x) { return Math.round(x * 100) + '%'; }
  function chainsLine(c) { return c.length <= 2 ? c.join(', ') : c.slice(0, 2).join(', ') + ' +' + (c.length - 2); }
  function pill(v) { return '<i class="pill ' + v.call + '">' + v.call + '</i>'; }
  var VERDICT_NOTE = { farm: 'expected drop ≥ 3× fees', thin: 'covers fees, not by much', skip: 'fees outrun the drop at this stake' };

  // ------------------------------------------------------------ integrity strip: checks the page runs itself

  function integrity() {
    var watched = snap.watchlist.filter(function (s) { return bySlug[s]; }).length;
    var liveProducts = snap.protocols.filter(function (p) { return M.tokenStatus(p) === 'live'; }).length;
    var accounted = rows.length + liveProducts + R.aside.length;
    var ordered = rows.every(function (r, i) { return r.rank === i + 1 && (i === 0 || r.implied_value_usd <= rows[i - 1].implied_value_usd); });
    var board = window.RADAR_BOARD || [];
    var same = board.filter(function (b) { return bySlug[b[0]] && bySlug[b[0]].implied_value_usd === b[1] && bySlug[b[0]].rank === b[2]; }).length;
    var checks = [
      [watched === snap.watchlist.length, 'Watchlist ' + watched + '/' + snap.watchlist.length + ' on the board'],
      [accounted === snap.protocols.length, 'All ' + snap.protocols.length + ' protocols accounted: ' + rows.length + ' ranked, ' + liveProducts + ' trade, ' + R.aside.length + ' set aside'],
      [ordered, 'Ranks 1–' + rows.length + ', value never rises'],
      [board.length > 0 && same === board.length && board.length === rows.length, 'Page recomputed ' + same + '/' + board.length + ' board.json rows exactly'],
      [F.held_out.model < F.held_out.flat && F.held_out.model < F.held_out.size_only, 'Held-out miss ' + mult(F.held_out.model) + ' beats a flat multiple (' + mult(F.held_out.flat) + ') and the size curve alone (' + mult(F.held_out.size_only) + ')'],
      [F.selection.every(function (v) { return v.kept === (F.terms.indexOf(v.term) >= 0) && (!v.kept || v.with < v.without); }), F.selection.length + ' snapshot terms tested held-out: ' + F.terms.length + ' kept, ' + (F.selection.length - F.terms.length) + ' dropped']
    ];
    return '<ul class="strip">' + checks.map(function (c) { return '<li class="' + (c[0] ? 'ok' : 'bad') + '">' + (c[0] ? '✓ ' : '✗ ') + esc(c[1]) + '</li>'; }).join('') + '</ul>';
  }

  // ------------------------------------------------------------ state

  var DEFAULT = { q: '', cat: '', chain: '', tier: 'all', call: 'all', tvl: '0', sort: 'rank', dir: 'asc' };
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
    { key: 'multiple', label: 'Value ÷ TVL', num: true, get: function (r) { return r.implied_value_usd / r.tvl_usd; } },
    { key: 'value', label: 'Implied value', num: true, get: function (r) { return r.implied_value_usd; } },
    { key: 'odds', label: 'Launch odds', num: true, get: function (r) { return r.launch_odds; } },
    { key: 'ratio', label: 'Farm verdict', num: true, get: function (r) { return r.verdict.ratio; } }
  ];

  function filtered(st) {
    var q = st.q.trim().toLowerCase();
    var minTvl = Number(st.tvl) || 0;
    var list = rows.filter(function (r) {
      if (q && (r.name + ' ' + r.slug + ' ' + r.category + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) < 0) return false;
      if (st.cat && r.category !== st.cat) return false;
      if (st.chain && r.chains.indexOf(st.chain) < 0) return false;
      if (st.tier !== 'all' && r.tier !== st.tier) return false;
      if (st.call !== 'all' && r.verdict.call !== st.call) return false;
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
  function tally(call) { return rows.filter(function (r) { return r.verdict.call === call; }).length; }

  function renderBoard(st) {
    var list = filtered(st);
    var watch = rows.filter(function (r) { return r.tier === 'watchlist'; }).length;
    var total = list.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var active = Object.keys(DEFAULT).some(function (k) { return k !== 'sort' && k !== 'dir' && st[k] !== DEFAULT[k]; });
    var html = '<section class="hero"><div><h1>' + rows.length + ' protocols with no token on record, ranked by what a launch would be worth</h1>' +
      '<p class="lede">Implied value is the market cap the snapshot\'s ' + F.tokens + ' traded tokens put on a protocol of this TVL (a fitted size curve: cap grows as TVL<sup>' + F.size_elasticity.toFixed(2) + '</sup>), plus every snapshot term that earned its place on held-out tokens: ' + keptText() + '. Every watchlist protocol is here, with ' + (rows.length - watch) + ' early ones below the $50M floor held to the same rule. A model\'s estimate, not a price.</p></div>' +
      '<dl class="kpis"><div><dt>Watchlist covered</dt><dd>' + watch + ' / ' + snap.watchlist.length + '</dd></div>' +
      '<div><dt>Held-out miss, median</dt><dd>' + mult(F.held_out.model) + '</dd></div>' +
      '<div><dt>Farm · thin · skip</dt><dd>' + tally('farm') + ' · ' + tally('thin') + ' · ' + tally('skip') + '</dd></div>' +
      '<div><dt>Traded tokens fitted</dt><dd>' + F.tokens + '</dd></div></dl></section>' + integrity();
    html += '<form class="filters" id="filters" onsubmit="return false">' +
      '<label class="grow">Search<input name="q" type="search" placeholder="Name, category or chain" value="' + esc(st.q) + '"></label>' +
      '<label>Category<select name="cat">' + options(countBy('category'), st.cat, 'All categories') + '</select></label>' +
      '<label>Chain<select name="chain">' + options(countBy('chains'), st.chain, 'All chains') + '</select></label>' +
      '<label>Min TVL<select name="tvl">' + [['0', 'Any'], ['10000000', '$10M+'], ['50000000', '$50M+'], ['100000000', '$100M+'], ['500000000', '$500M+']].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === st.tvl ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
      '<div class="field"><span>Tier</span>' + seg('tier', st.tier, [['all', 'All'], ['watchlist', 'Watchlist'], ['early', 'Early']]) + '</div>' +
      '<div class="field"><span>Farm verdict</span>' + seg('call', st.call, [['all', 'All'], ['farm', 'Farm'], ['thin', 'Thin'], ['skip', 'Skip']]) + '</div></form>';
    html += '<div class="summary"><span><b>' + list.length + '</b> of ' + rows.length + ' rows' + (active ? ' match the filters' : '') + ' · combined implied value <b>' + money(total) + '</b></span>' +
      (active ? '<a href="#board" class="reset">Clear filters</a>' : '<span class="dim">Select a row for its value build-up, odds and farm plan · click a column to sort</span>') + '</div>';
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
        '<td class="num">' + mult(r.implied_value_usd / r.tvl_usd) + '</td>' +
        '<td class="num value"><span class="bar"><i style="width:' + w + '%"></i></span>' + money(r.implied_value_usd) + '<div class="sub">' + money(r.range_usd[0]) + '–' + money(r.range_usd[1]) + '</div></td>' +
        '<td class="num">' + share(r.launch_odds) + '</td>' +
        '<td class="num">' + pill(r.verdict) + '<div class="sub">' + money(r.verdict.expected_usd) + ' vs ' + money(r.verdict.fees_usd) + '</div></td></tr>';
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

  function verdictOf(term) { return F.selection.filter(function (v) { return v.term === term; })[0]; }
  function termNote(term, what) {
    var v = verdictOf(term);
    return what + (v.kept ? '; kept: held-out miss ' + mult(v.without) + ' → ' + mult(v.with) : '; tested and dropped (held-out ' + mult(v.without) + ' → ' + mult(v.with) + '), so ×1');
  }
  function keptText() {
    var k = F.selection.filter(function (v) { return v.kept; }).map(function (v) { return v.label; });
    var d = F.selection.filter(function (v) { return !v.kept; }).map(function (v) { return v.label; });
    return (k.length ? k.join(' and ') : 'none') + (d.length ? ' (' + d.join(' and ') + ' tested and dropped)' : '');
  }

  function renderDetail(slug) {
    var r = bySlug[slug];
    if (!r) { app.innerHTML = '<p class="empty">No protocol ' + esc(slug) + ' on the board. <a href="#board">Back to the board</a></p>'; return; }
    var m = r.model;
    var size = Math.exp(F.intercept + F.size_elasticity * (Math.log(r.tvl_usd) - M.CONST.size_center));
    var build = [
      ['TVL', r.tvl_usd, 'Snapshot figure'],
      ['Size curve', size, 'What ' + F.tokens + ' traded tokens put on this TVL: cap grows as TVL<sup>' + F.size_elasticity.toFixed(3) + '</sup>'],
      ['× ' + esc(r.family) + ' level ' + mult(m.parts.family), size * m.parts.family, termNote('family', 'Fitted family offset')],
      ['× 7d growth ' + mult(m.parts.growth), size * m.parts.family * m.parts.growth, termNote('growth', 'Seven-day TVL ' + (r.change_7d === null ? 'not reported' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(2) + '%'))],
      ['× years tracked ' + mult(m.parts.age), r.implied_value_usd, termNote('age', r.age_days === null ? 'No listing date: neutral' : age(r.age_days) + ' tracked with no token') + ' → implied value, ' + mult(m.implied_multiple) + ' TVL']
    ];
    var top = Math.max.apply(null, build.map(function (b) { return b[1]; }));
    // Comparables: the traded tokens of the same family nearest this TVL.
    var comps = R.live.filter(function (l) { return M.familyOf(l.category) === r.family; })
      .sort(function (a, b) { return Math.abs(Math.log(a.tvl_usd / r.tvl_usd)) - Math.abs(Math.log(b.tvl_usd / r.tvl_usd)); }).slice(0, 5);
    var o = r.odds_parts, p = r.plan, v = r.verdict;
    var prev = rows[r.rank - 2], next = rows[r.rank];
    var html = '<nav class="crumbs"><a href="' + hashOf(state) + '">← Board</a>' + (prev ? '<a href="#p/' + esc(prev.slug) + '">↑ #' + prev.rank + ' ' + esc(prev.name) + '</a>' : '') + (next ? '<a href="#p/' + esc(next.slug) + '">↓ #' + next.rank + ' ' + esc(next.name) + '</a>' : '') + '</nav>';
    html += '<section class="dhead"><div><p class="eyebrow">Rank ' + r.rank + ' of ' + rows.length + ' · ' + (r.tier === 'watchlist' ? 'watchlist' : 'early, below the $50M floor') + ' · no token on record</p><h1>' + esc(r.name) + '</h1>' +
      '<p class="lede">' + esc(r.category) + ' on ' + esc(r.chains.join(', ')) + (r.listed_at ? ' · tracked since ' + esc(r.listed_at) : '') + '</p>' +
      (r.sibling ? '<p class="warn">Sibling token: ' + esc(r.sibling.name) + ' already records ' + esc(r.sibling.symbol) + '. A launch here may reuse it rather than issue a new one.</p>' : '') + '</div>' +
      '<dl class="kpis four"><div><dt>Implied value</dt><dd>' + money(r.implied_value_usd) + '</dd><small>' + money(r.range_usd[0]) + '–' + money(r.range_usd[1]) + '</small></div><div><dt>TVL</dt><dd>' + money(r.tvl_usd) + '</dd><small>' + pct(r.change_7d) + ' in 7 days</small></div><div><dt>Launch odds</dt><dd>' + share(r.launch_odds) + '</dd><small>from peers\' record</small></div><div><dt>Farm verdict</dt><dd class="v ' + v.call + '">' + v.call + '</dd><small>' + VERDICT_NOTE[v.call] + '</small></div></dl></section>';
    html += '<div class="detail"><div>';
    html += '<section class="card"><h3>How the value is built</h3><ol class="build">' + build.map(function (b) {
      return '<li><div class="row"><span>' + b[0] + '</span><b>' + money(b[1]) + '</b></div><span class="bar"><i style="width:' + Math.max(1, 100 * b[1] / top).toFixed(1) + '%"></i></span><small>' + b[2] + '</small></li>';
    }).join('') + '</ol><p class="note">Range ' + money(r.range_usd[0]) + '–' + money(r.range_usd[1]) + ': ÷ and × the model\'s median held-out miss, ' + mult(F.held_out.model) + '.</p></section>';
    html += '<section class="card"><h3>Launch odds ' + share(r.launch_odds) + '</h3><table class="mini"><tbody>' +
      '<tr><td>' + esc(r.category) + ' protocols that record a token</td><td class="num">' + share(o.category) + '</td></tr>' +
      '<tr><td>Protocols tracked ' + esc(o.band) + ' that do</td><td class="num">' + share(o.age) + '</td></tr>' +
      '<tr><td>Whole snapshot</td><td class="num">' + share(R.odds.base) + '</td></tr></tbody></table>' +
      '<h3>Nearest traded ' + esc(r.family) + ' tokens</h3><table class="mini"><tbody>' + comps.map(function (l) {
        return '<tr><td>' + esc(l.name) + ' <span class="dim">' + esc(l.symbol) + '</span></td><td class="num">' + money(l.tvl_usd) + ' TVL</td><td class="num">' + money(l.mcap_usd) + '</td><td class="num">' + mult(l.multiple) + '</td></tr>';
      }).join('') + '</tbody></table></section></div>';
    html += '<section class="card plan"><h3>Farm plan</h3><div class="plan-sum"><span>Stake <b>' + money(p.capital) + '</b> on ' + esc(p.chain) + '</span><span>Setup <b>' + money(p.setup_cost) + '</b></span><span>Running <b>' + money(p.monthly_cost) + '/mo</b></span><span>Hold <b>' + p.hold_days + ' days</b></span></div>' +
      '<div class="verdict ' + v.call + '"><b>' + v.call.toUpperCase() + '</b> Expected drop <b>' + money(v.expected_usd) + '</b> (' + money(r.implied_value_usd) + ' × ' + (M.CONST.airdrop_share * 100).toFixed(1) + '% × the stake\'s share of TVL × ' + share(r.launch_odds) + ' odds) against <b>' + money(v.fees_usd) + '</b> of fees: ' + v.ratio.toFixed(1) + '×. Fees are covered from a ' + money(v.breakeven_stake_usd) + ' stake.</div>';
    html += '<ol class="steps">' + p.steps.map(function (s) { return '<li><p>' + esc(s.text) + '.</p><span class="chip">' + esc(s.cost) + '</span><span class="chip t">' + esc(s.time) + '</span></li>'; }).join('') + '</ol></section></div>';
    app.innerHTML = html;
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------ live tokens

  function renderLive() {
    var html = '<section class="hero slim"><div><h1>' + R.live.length + ' tokens that already trade</h1><p class="lede">Kept off the board and shown at the market\'s own value, one row per ticker: where several products carry one token, its TVL is theirs summed. These are what the value model is fitted on; the last column is each token\'s held-out miss, from a fit that never saw it.</p></div></section>';
    html += '<div class="table-wrap"><table class="board live"><thead><tr><th>Token</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Cap ÷ TVL</th><th class="num">Model fit</th><th class="num">Held-out miss</th></tr></thead><tbody>' +
      R.live.map(function (l, i) {
        var pt = F.points[i];
        return '<tr class="static"><td><div class="name">' + esc(l.name) + ' <i class="tag l">' + esc(l.symbol) + '</i></div><div class="sub">' + esc(chainsLine(l.chains)) + (l.products > 1 ? ' · ' + l.products + ' products' : '') + '</div></td><td>' + esc(l.category) + '</td><td class="num">' + money(l.tvl_usd) + '</td><td class="num">' + money(l.mcap_usd) + '</td><td class="num">' + mult(l.multiple) + '</td><td class="num">' + money(pt.fitted) + '</td><td class="num">' + mult(Math.exp(pt.held_out_error)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    app.innerHTML = html;
  }

  // ------------------------------------------------------------ model

  function logAxes(W, H, P, lo, hi) {
    var span = hi - lo;
    var X = function (v) { return P + (Math.log10(v) - lo) / span * (W - 2 * P); };
    var Y = function (v) { return H - P - (Math.min(Math.max(Math.log10(v), lo), hi) - lo) / span * (H - 2 * P); };
    var s = '';
    for (var e = Math.ceil(lo); e <= hi; e++) {
      var v = Math.pow(10, e);
      s += '<line class="grid" x1="' + X(v) + '" y1="' + P + '" x2="' + X(v) + '" y2="' + (H - P) + '"/><text x="' + X(v) + '" y="' + (H - 12) + '">' + money(v) + '</text>';
      s += '<line class="grid" x1="' + P + '" y1="' + Y(v) + '" x2="' + (W - P) + '" y2="' + Y(v) + '"/><text class="l" x="2" y="' + (Y(v) + 4) + '">' + money(v) + '</text>';
    }
    return { X: X, Y: Y, grid: s };
  }

  function validationChart() {
    // Fitted against actual market cap for every traded token: on the diagonal is a perfect call.
    var W = 560, H = 320, P = 40, A = logAxes(W, H, P, 5, 11);
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Fitted against actual market cap">' + A.grid;
    var lo = Math.pow(10, 5), hi = Math.pow(10, 11), f = F.held_out.model;
    s += '<polygon class="band" points="' + [[lo, lo * f], [hi / f, hi], [hi, hi], [hi, hi / f], [lo * f, lo], [lo, lo]].map(function (q) { return A.X(q[0]).toFixed(1) + ',' + A.Y(q[1]).toFixed(1); }).join(' ') + '"/>';
    s += '<line class="fit" x1="' + A.X(lo) + '" y1="' + A.Y(lo) + '" x2="' + A.X(hi) + '" y2="' + A.Y(hi) + '"/>';
    F.points.forEach(function (pt) { s += '<circle class="dot ' + pt.family + '" cx="' + A.X(pt.fitted).toFixed(1) + '" cy="' + A.Y(pt.actual).toFixed(1) + '" r="3.5"><title>' + esc(pt.name) + '</title></circle>'; });
    return s + '<text class="axis" x="' + (W - P) + '" y="' + (H - 26) + '" style="text-anchor:end">model fit →</text><text class="axis l" x="' + (P + 4) + '" y="' + (P - 10) + '">↑ actual market cap</text></svg>';
  }

  function oddsChart() {
    var bands = R.odds.bands, W = 560, H = 150, P = 28, bw = (W - 2 * P) / bands.length;
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Share recording a token by age">';
    bands.forEach(function (b, i) {
      var h = b.share * (H - 2 * P), x = P + i * bw + 10;
      s += '<rect class="barv" x="' + x + '" y="' + (H - P - h) + '" width="' + (bw - 20) + '" height="' + h + '"/><text x="' + (x + (bw - 20) / 2) + '" y="' + (H - P - h - 6) + '">' + share(b.share) + '</text><text x="' + (x + (bw - 20) / 2) + '" y="' + (H - 10) + '">' + esc(b.band) + ' (' + b.n + ')</text>';
    });
    return s + '</svg>';
  }

  function formula() {
    var C = M.CONST, c = F.coef, pad = function (t) { return (t + '                                ').slice(0, 34); };
    var lines = ['ln cap = ' + F.intercept.toFixed(3), '       ' + pad('+ ' + F.size_elasticity.toFixed(3) + ' × (ln TVL − ' + C.size_center + ')') + 'size curve'];
    if (F.terms.indexOf('family') >= 0) lines.push('       ' + pad('+ family level') + 'fitted, see below');
    if (F.terms.indexOf('growth') >= 0) lines.push('       ' + pad('+ ' + c.growth.toFixed(3) + ' × tanh(7d % ÷ 30)') + '7-day growth');
    if (F.terms.indexOf('age') >= 0) lines.push('       ' + pad('+ ' + c.age.toFixed(3) + ' × (years tracked − ' + C.age_center_years + ')') + 'capped at 6 years');
    if (F.terms.indexOf('undated') >= 0) lines.push('       ' + pad('+ ' + c.undated.toFixed(3) + ' if no listing date') + '');
    lines.push('  (ridge λ=' + C.ridge_lambda + ' on ' + F.tokens + ' traded tokens, one per ticker)', '', 'implied value = e^(ln cap)');
    F.selection.forEach(function (v) { if (!v.kept) lines.push('dropped: ' + v.label + ', no held-out gain'); });
    return lines.join('\n');
  }

  function renderModel() {
    var C = M.CONST, h = F.held_out;
    var aside = {};
    R.aside.forEach(function (a) { aside[a.reason] = (aside[a.reason] || 0) + 1; });
    var fams = Object.keys(F.family_levels).sort(function (a, b) { return F.family_levels[b] - F.family_levels[a]; });
    var html = '<section class="hero slim"><div><h1>The model: ' + esc(M.VERSION) + '</h1><p class="lede">One file, model.js, fits and scores everything from the snapshot\'s own figures; no protocol name is special-cased. main.ts runs the same file to write board.json, and this page re-runs it and checks every row against that board.</p></div></section>';
    html += '<div class="grid2"><section class="card"><h3>Formula</h3><pre>' + formula() + '</pre>' +
      '<h3>Held-out test</h3><p class="note">Each traded token is priced by a fit that never saw it. Median miss, and the share priced within 3×:</p><table class="mini"><thead><tr><th>Rule</th><th class="num">Median miss</th><th class="num">Within 3×</th></tr></thead><tbody>' +
      '<tr><td>Flat multiple (median cap ÷ TVL)</td><td class="num">' + mult(h.flat) + '</td><td class="num">' + share(h.flat_within3) + '</td></tr>' +
      '<tr><td>Size curve alone</td><td class="num">' + mult(h.size_only) + '</td><td class="num">' + share(h.size_only_within3) + '</td></tr>' +
      '<tr class="used"><td>Size curve + ' + F.terms.map(function (t) { return verdictOf(t).label; }).join(' + ') + ' (used)</td><td class="num">' + mult(h.model) + '</td><td class="num">' + share(h.model_within3) + '</td></tr></tbody></table>' +
      '<h3>Every candidate term, kept or dropped</h3><p class="note">Forward selection on the same held-out test: a term stays only if it cuts the median miss by ' + share(C.keep_gain) + ' or more over the terms already in. Mean log miss shown beside it, so a term that helps the median but not the tail is visible.</p><table class="mini"><thead><tr><th>Term</th><th class="num">Without</th><th class="num">With</th><th class="num">Mean ln miss</th><th>Call</th></tr></thead><tbody>' +
      F.selection.map(function (v) { return '<tr' + (v.kept ? ' class="used"' : '') + '><td>' + esc(v.label) + '</td><td class="num">' + mult(v.without) + '</td><td class="num">' + mult(v.with) + '</td><td class="num">' + v.mean_without.toFixed(3) + ' → ' + v.mean_with.toFixed(3) + '</td><td>' + (v.kept ? 'kept' : 'dropped') + '</td></tr>'; }).join('') + '</tbody></table></section>' +
      '<section class="card"><h3>Fit against the market</h3>' + validationChart() + '<p class="legend">' + ['vaults', 'credit', 'trading', 'realworld', 'network', 'other'].map(function (f) { return '<span><i class="dot-key ' + f + '"></i>' + f + '</span>'; }).join('') + '</p><p class="note">Shaded: within the median miss, ' + mult(h.model) + ', of the diagonal.</p></section>' +
      '<section class="card"><h3>Family levels</h3><table class="mini"><thead><tr><th>Family</th><th class="num">Level</th><th class="num">Traded tokens</th><th class="num">Board rows</th></tr></thead><tbody>' +
      fams.map(function (f) { return '<tr><td>' + esc(f) + '</td><td class="num">' + mult(Math.exp(F.family_levels[f])) + '</td><td class="num">' + R.live.filter(function (l) { return M.familyOf(l.category) === f; }).length + '</td><td class="num">' + rows.filter(function (r) { return r.family === f; }).length + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<h3>Set aside, not ranked</h3><table class="mini"><tbody>' + Object.keys(aside).sort(function (a, b) { return aside[b] - aside[a]; }).map(function (k) { return '<tr><td>' + esc(k) + '</td><td class="num">' + aside[k] + '</td></tr>'; }).join('') + '</tbody></table></section>' +
      '<section class="card"><h3>Launch odds: who already records a token, by age</h3>' + oddsChart() + '<p class="note">A protocol\'s odds combine its category\'s share and its age band\'s share on the log-odds scale, each smoothed toward the snapshot\'s ' + share(R.odds.base) + '. Odds sit beside the value and drive the farm verdict: farm at ≥' + C.farm_ratio + '× fees, thin at ≥' + C.thin_ratio + '×, else skip.</p></section></div>';
    app.innerHTML = html;
  }

  // ------------------------------------------------------------ routing

  document.getElementById('meta').textContent = 'Snapshot ' + snap.as_of + ' · DefiLlama protocol index · ' + snap.protocols.length + ' protocols · model ' + M.VERSION;

  function route() {
    var r = parse();
    var view = r.view;
    if (view.indexOf('p/') === 0) { renderDetail(decodeURIComponent(view.slice(2))); view = 'board'; }
    else if (view === 'live') renderLive();
    else if (view === 'model') renderModel();
    else { view = 'board'; state = r.st; renderBoard(state); }
    Array.prototype.forEach.call(document.querySelectorAll('#tabs a'), function (a) { a.classList.toggle('on', a.dataset.tab === view); });
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && location.hash.indexOf('#p/') === 0) location.hash = hashOf(state); });
  route();
})();
