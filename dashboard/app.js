// Launch Radar page: runs RadarModel on the snapshot in ../data.js and renders three views.
// State lives in the hash (#board?cat=Lending&sort=tvl, #p/<slug>, #model) so every view links.
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
rows.forEach(r => { bySlug[r.slug] = r; });
var maxValue = rows[0].implied_value_usd;

// --- formatting

function esc(s) { return String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';'); }
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
function num(x) { return '<td class="num">' + x + '</td>'; }
function share(x) { return Math.round(x * 100) + '%'; }
function chainsLine(c) { return c.length <= 2 ? c.join(', ') : c.slice(0, 2).join(', ') + ' +' + (c.length - 2); }
function pill(v) { return '<i class="pill ' + v.call + '">' + v.call + '</i>'; }
var VERDICT_NOTE = { farm: 'drop ≥ 3× fees', thin: 'covers fees, barely', skip: 'fees beat the drop' };

// --- integrity strip: checks the page runs itself

function integrity() {
  var watched = snap.watchlist.filter(s => bySlug[s]).length;
  var ordered = rows.every((r, i) => r.rank === i + 1 && (i === 0 || r.implied_value_usd <= rows[i - 1].implied_value_usd));
  var board = window.RADAR_BOARD || [];
  var same = board.filter(b => bySlug[b[0]] && bySlug[b[0]].implied_value_usd === b[1] && bySlug[b[0]].rank === b[2]).length;
  var product = rows.every(r => r.implied_value_usd === Math.max(1, Math.round(r.model.fitted_core * r.launch_odds)));
  var control = [F.selection, R.odds.selection].every(s => s.some(v => v.term === 'control' && !v.kept));
  var checks = [
    [board.length > 0 && same === board.length && board.length === rows.length, 'table = board.json, ' + same + '/' + board.length + ' rows recomputed'],
    [ordered, 'ranks 1–' + rows.length + ' in order, values never rise'],
    [product, 'every row: implied = if it launches × odds'],
    [watched === snap.watchlist.length, 'watchlist ' + watched + ' of ' + snap.watchlist.length + ' ranked'],
    [ledgerParts().reduce((s, q) => s + q[1], 0) === snap.protocols.length, 'ledger ' + snap.protocols.length + ' of ' + snap.protocols.length + ' protocols'],
    [control, 'random control rejected twice']
  ];
  return '<ul class="strip">' + checks.map(c => '<li class="' + (c[0] ? 'ok' : 'bad') + '">' + (c[0] ? '✓ ' : '✗ ') + esc(c[1]) + '</li>').join('') + '</ul>';
}

// Every protocol of the snapshot in exactly one group: ranked, already trading, or set aside and why.
function ledgerParts() {
  var g = {}, watch = rows.filter(r => r.tier === 'watchlist').length;
  R.aside.forEach(a => { g[a.reason] = (g[a.reason] || 0) + 1; });
  return [['Ranked: watchlist', watch], ['Ranked: early, under the floor', rows.length - watch], ['Token trades: ' + F.tokens + ' tickers priced', snap.protocols.filter(p => M.tokenStatus(p) === 'live').length]]
    .concat(Object.keys(g).sort((a, b) => g[b] - g[a]).map(k => ['Out: ' + k, g[k]]));
}
function ledger() {
  var parts = ledgerParts();
  return '<section class="ledger"><p><b>' + snap.protocols.length + ' protocols read</b> = ' + parts.map(q => q[1]).join(' + ') + ', each in one group</p><div class="lbar">' +
    parts.map((q, i) => '<i class="c' + i + '" style="flex:' + q[1] + '" title="' + esc(q[0]) + '"></i>').join('') + '</div><ul>' +
    parts.map((q, i) => '<li><i class="c' + i + '"></i>' + esc(q[0]) + ' <b>' + q[1] + '</b></li>').join('') + '</ul></section>';
}

// --- state

var DEFAULT = { q: '', cat: '', chain: '', tier: 'all', call: 'all', sort: 'rank', dir: 'asc' };
function parse() {
  var h = location.hash.slice(1);
  var view = h.split('?')[0] || 'board';
  var st = Object.assign({}, DEFAULT);
  var qs = h.split('?')[1];
  if (qs) qs.split('&').forEach(kv => { var p = kv.split('='); if (p[0] in st) st[p[0]] = decodeURIComponent(p[1] || ''); });
  return { view: view, st: st };
}
function hashOf(st) {
  var parts = Object.keys(DEFAULT).filter(k => st[k] !== DEFAULT[k]).map(k => k + '=' + encodeURIComponent(st[k]));
  return '#board' + (parts.length ? '?' + parts.join('&') : '');
}
var state = Object.assign({}, DEFAULT);

// --- board

var COLS = [
  { key: 'rank', label: 'Rank', num: true, get: r => r.rank },
  { key: 'name', label: 'Protocol', get: r => r.name.toLowerCase() },
  { key: 'tvl', label: 'TVL', num: true, get: r => r.tvl_usd },
  { key: 'd7', label: '7d', num: true, get: r => r.change_7d === null ? -1e9 : r.change_7d },
  { key: 'age', label: 'No token for', num: true, get: r => r.age_days === null ? -1 : r.age_days },
  { key: 'launch', label: 'If it launches', num: true, get: r => r.launch_value_usd },
  { key: 'odds', label: 'Launch odds', num: true, get: r => r.launch_odds },
  { key: 'value', label: 'Implied value', num: true, get: r => r.implied_value_usd },
  { key: 'ratio', label: 'Farm verdict', num: true, get: r => r.verdict.ratio }
];

function filtered(st) {
  var q = st.q.trim().toLowerCase();
  var list = rows.filter(r => {
    if (q && (r.name + ' ' + r.slug + ' ' + r.category + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) < 0) return false;
    if (st.cat && r.category !== st.cat) return false;
    if (st.chain && r.chains.indexOf(st.chain) < 0) return false;
    if (st.tier !== 'all' && r.tier !== st.tier) return false;
    return st.call === 'all' || r.verdict.call === st.call;
  });
  var col = COLS.filter(c => c.key === st.sort)[0] || COLS[0];
  var sign = st.dir === 'desc' ? -1 : 1;
  return list.sort((a, b) => { var x = col.get(a), y = col.get(b); return (x < y ? -1 : x > y ? 1 : a.rank - b.rank) * sign; });
}

function options(values, selected, all) {
  return '<option value="">' + all + '</option>' + values.map(v => '<option' + (v === selected ? ' selected' : '') + '>' + esc(v) + '</option>').join('');
}
function countBy(key) {
  var n = {};
  rows.forEach(r => { [].concat(r[key]).forEach(v => { n[v] = (n[v] || 0) + 1; }); });
  return Object.keys(n).sort((a, b) => n[b] - n[a] || (a < b ? -1 : 1));
}
function seg(name, value, opts) {
  return '<div class="seg" data-name="' + name + '">' + opts.map(o => '<button type="button" data-v="' + o[0] + '"' + (o[0] === value ? ' class="on"' : '') + '>' + o[1] + '</button>').join('') + '</div>';
}
function tally(call) { return rows.filter(r => r.verdict.call === call).length; }

function renderBoard(st) {
  var list = filtered(st);
  var watch = rows.filter(r => r.tier === 'watchlist').length;
  var total = list.reduce((s, r) => s + r.implied_value_usd, 0);
  var active = Object.keys(DEFAULT).some(k => k !== 'sort' && k !== 'dir' && st[k] !== DEFAULT[k]);
  var h = F.held_out, fw = h.forward, O = R.odds;
  var html = '<section class="hero"><div><h1>' + rows.length + ' protocols with no token, ranked by implied value</h1>' +
    '<p class="lede"><b>Implied value = value if it launches × launch odds.</b> If it launches: the cap ' + F.tokens + ' traded tokens put on this TVL, cap ∝ TVL<sup>' + F.size_elasticity.toFixed(2) + '</sup>' + (F.terms.length ? ' × ' + F.terms.map(t => verdictOf(t).label).join(' × ') : '') + '. Launch odds: logistic fit on all ' + snap.protocols.length + ' protocols\' record, from ' + O.terms.map(t => O.selection.filter(v => v.term === t)[0].label).join(', ') + '. Each term won two blind tests; a random control lost. Verdict: whether a ' + money(M.CONST.capital_usd) + ' farm pays its fees.</p></div></section>' +
    '<dl class="kpis row"><div><dt>Watchlist ranked</dt><dd>' + watch + ' / ' + snap.watchlist.length + '</dd><small>+ ' + (rows.length - watch) + ' early, under $50M</small></div>' +
    '<div><dt>Blind pricing miss</dt><dd>' + mult(fw.model) + '</dd><small>newest ' + fw.test + ' tokens, walk-forward · flat ' + mult(fw.flat) + '</small></div>' +
    '<div><dt>Is the range honest?</dt><dd>' + share(fw.in50) + ' · ' + share(fw.in80) + '</dd><small>newest caps in P25–P75 · P10–P90 (stated 50 · 80)</small></div>' +
    '<div><dt>Launch odds, log loss</dt><dd>' + O.wf.toFixed(3) + '</dd><small>walk-forward vs ' + O.base_wf.toFixed(3) + ' base rate · 10-fold ' + O.loss.toFixed(3) + '</small></div>' +
    '<div><dt>Farm · thin · skip</dt><dd>' + tally('farm') + ' · ' + tally('thin') + ' · ' + tally('skip') + '</dd><small>' + money(M.CONST.capital_usd) + ' stake · farm = drop ≥ ' + M.CONST.farm_ratio + '× fees</small></div></dl>' + ledger() + integrity();
  html += '<form class="filters" id="filters" onsubmit="return false">' +
    '<label class="grow">Search<input name="q" type="search" placeholder="Name, category or chain" value="' + esc(st.q) + '"></label>' +
    '<label>Category<select name="cat">' + options(countBy('category'), st.cat, 'All categories') + '</select></label>' +
    '<label>Chain<select name="chain">' + options(countBy('chains'), st.chain, 'All chains') + '</select></label>' +
    '<div class="field"><span>Tier</span>' + seg('tier', st.tier, [['all', 'All'], ['watchlist', 'Watchlist'], ['early', 'Early']]) + '</div>' +
    '<div class="field"><span>Farm verdict</span>' + seg('call', st.call, [['all', 'All'], ['farm', 'Farm'], ['thin', 'Thin'], ['skip', 'Skip']]) + '</div></form>';
  html += '<div class="summary"><span><b>' + list.length + '</b> of ' + rows.length + ' rows' + (active ? ' match the filters' : '') + ' · combined implied value <b>' + money(total) + '</b></span>' +
    (active ? '<a href="#board" class="reset">Clear filters</a>' : '<span class="dim">Click a row for its build-up and farm plan, a column to sort</span>') + '</div>';
  html += '<div class="table-wrap"><table class="board"><thead><tr>' + COLS.map(c => {
    var on = st.sort === c.key;
    return '<th class="' + (c.num ? 'num ' : '') + (on ? 'sorted' : '') + '" data-sort="' + c.key + '">' + c.label + (on ? (st.dir === 'asc' ? ' ▲' : ' ▼') : '') + '</th>';
  }).join('') + '</tr></thead><tbody>';
  html += list.map(r => {
    var w = Math.max(2, Math.round(100 * Math.sqrt(r.implied_value_usd / maxValue)));
    return '<tr data-slug="' + esc(r.slug) + '">' +
      '<td class="num rank">' + r.rank + '</td>' +
      '<td><div class="name">' + esc(r.name) + (r.tier === 'watchlist' ? ' <i class="tag w">watchlist</i>' : ' <i class="tag e">early</i>') + (r.sibling ? ' <i class="tag s" title="' + esc(r.sibling.name) + ' records ' + esc(r.sibling.symbol) + '">sibling ' + esc(r.sibling.symbol) + '</i>' : '') + (r.native_chain ? ' <i class="tag s">' + esc(r.native_chain) + ' venue</i>' : '') + '</div><div class="sub">' + esc(r.category) + ' · ' + esc(chainsLine(r.chains)) + '</div></td>' +
      num(money(r.tvl_usd)) +
      num(pct(r.change_7d)) +
      num(age(r.age_days)) +
      '<td class="num">' + money(r.launch_value_usd) + '<div class="sub">' + money(r.launch_range_usd[1]) + '–' + money(r.launch_range_usd[2]) + '</div></td>' +
      '<td class="num">' + share(r.launch_odds) + '<span class="ob"><i style="width:' + share(r.launch_odds) + '"></i></span></td>' +
      '<td class="num value"><span class="bar"><i style="width:' + w + '%"></i></span>' + money(r.implied_value_usd) + '<div class="sub">' + money(r.range_usd[0]) + '–' + money(r.range_usd[1]) + '</div></td>' +
      '<td class="num">' + pill(r.verdict) + '<div class="sub">' + money(r.verdict.expected_usd) + ' vs ' + money(r.verdict.fees_usd) + '</div></td></tr>';
  }).join('') + '</tbody></table>' + (list.length ? '' : '<p class="empty">No protocol matches these filters.</p>') + '</div>';
  app.innerHTML = html;

  var form = document.getElementById('filters');
  form.addEventListener('input', e => {
    var t = e.target;
    if (!t.name) return;
    state[t.name] = t.value;
    history.replaceState(null, '', hashOf(state));
    if (t.name === 'q') { var pos = t.selectionStart; renderBoard(state); var i = document.querySelector('input[name=q]'); i.focus(); i.setSelectionRange(pos, pos); } else renderBoard(state);
  });
  form.querySelectorAll('.seg button').forEach(b => {
    b.addEventListener('click', () => { state[b.parentNode.dataset.name] = b.dataset.v; location.hash = hashOf(state); });
  });
  app.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      var k = th.dataset.sort;
      state.dir = state.sort === k ? (state.dir === 'asc' ? 'desc' : 'asc') : (k === 'rank' || k === 'name' ? 'asc' : 'desc');
      state.sort = k;
      location.hash = hashOf(state);
    });
  });
  app.querySelectorAll('tbody tr').forEach(tr => {
    tr.addEventListener('click', () => { location.hash = '#p/' + tr.dataset.slug; });
  });
}

// --- detail

function verdictOf(term) { return F.selection.filter(v => v.term === term)[0]; }
function tests(v) { return 'leave-one-out ' + mult(v.without) + ' → ' + mult(v.with) + ', walk-forward ' + mult(v.wf_without) + ' → ' + mult(v.wf_with); }
// What this protocol's figure is, for each odds term.
var ODDS_SHOWN = { age: r => r.age_days === null ? 'no listing date' : age(r.age_days), family: r => r.family, growth: r => r.change_7d === null ? 'not reported' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1) + '%', size: r => money(r.tvl_usd), chains: r => r.chains.length + ' chain' + (r.chains.length > 1 ? 's' : '') };

function renderDetail(slug) {
  var r = bySlug[slug];
  if (!r) { app.innerHTML = '<p class="empty">No protocol ' + esc(slug) + ' on the board. <a href="#board">Back</a></p>'; return; }
  var m = r.model, lr = r.launch_range_usd;
  var size = Math.exp(F.intercept + F.size_elasticity * (Math.log(r.tvl_usd) - M.CONST.size_center)), run = size;
  var build = [['TVL', r.tvl_usd, 'Snapshot, ' + pct(r.change_7d) + ' in 7 days'], ['Size curve', size, 'Cap of ' + F.tokens + ' traded tokens at this TVL, ∝ TVL<sup>' + F.size_elasticity.toFixed(3) + '</sup>']]
    .concat(F.terms.map(t => { run *= m.parts[t]; return ['× ' + esc(verdictOf(t).label) + ' ' + mult(m.parts[t]), run, 'Kept: ' + tests(verdictOf(t))]; }))
    .concat([['= If it launches', r.launch_value_usd, 'P25–P75 ' + money(lr[1]) + '–' + money(lr[2]) + ' · P10–P90 ' + money(lr[0]) + '–' + money(lr[3])], ['× launch odds ' + share(r.launch_odds), r.implied_value_usd, '= implied value, ' + mult(m.implied_multiple) + ' TVL']]);
  var top = Math.max.apply(null, build.map(b => b[1]));
  var dropped = F.selection.filter(v => !v.kept && v.term !== 'control').map(v => v.label);
  // Comparables: the traded tokens nearest this TVL.
  var comps = R.live.slice().sort((a, b) => Math.abs(Math.log(a.tvl_usd / r.tvl_usd)) - Math.abs(Math.log(b.tvl_usd / r.tvl_usd))).slice(0, 5);
  var o = r.odds_parts, p = r.plan, v = r.verdict;
  var prev = rows[r.rank - 2], next = rows[r.rank];
  var html = '<nav class="crumbs"><a href="' + hashOf(state) + '">← Board</a>' + (prev ? '<a href="#p/' + esc(prev.slug) + '">↑ #' + prev.rank + ' ' + esc(prev.name) + '</a>' : '') + (next ? '<a href="#p/' + esc(next.slug) + '">↓ #' + next.rank + ' ' + esc(next.name) + '</a>' : '') + '</nav>';
  html += '<section class="dhead"><div><p class="eyebrow">Rank ' + r.rank + ' of ' + rows.length + ' · ' + (r.tier === 'watchlist' ? 'watchlist' : 'early, below the $50M floor') + ' · no token on record</p><h1>' + esc(r.name) + '</h1>' +
    '<p class="lede">' + esc(r.category) + ' on ' + esc(r.chains.join(', ')) + ' · TVL ' + money(r.tvl_usd) + (r.listed_at ? ' · tracked since ' + esc(r.listed_at) : '') + '</p>' +
    (r.sibling ? '<p class="warn">' + esc(r.sibling.name) + ' already records ' + esc(r.sibling.symbol) + ': a launch here may reuse it.</p>' : '') + (r.native_chain ? '<p class="warn">Venue of its own chain, ' + esc(r.native_chain) + ': a reward is likelier paid in the chain\'s token than in a new one.</p>' : '') + '</div>' +
    '<dl class="kpis four"><div><dt>Implied value</dt><dd>' + money(r.implied_value_usd) + '</dd><small>P25–P75 ' + money(r.range_usd[0]) + '–' + money(r.range_usd[1]) + '</small></div><div><dt>If it launches</dt><dd>' + money(r.launch_value_usd) + '</dd><small>' + mult(r.launch_value_usd / r.tvl_usd) + ' TVL</small></div><div><dt>Launch odds</dt><dd>' + share(r.launch_odds) + '</dd><small>logistic, ' + snap.protocols.length + ' protocols</small></div><div><dt>Farm verdict</dt><dd class="v ' + v.call + '">' + v.call + '</dd><small>' + VERDICT_NOTE[v.call] + '</small></div></dl></section>';
  html += '<div class="detail"><div>';
  html += '<section class="card"><h3>How the value is built</h3><ol class="build">' + build.map(b => {
    return '<li><div class="row"><span>' + b[0] + '</span><b>' + money(b[1]) + '</b></div><span class="bar"><i style="width:' + Math.max(1, 100 * b[1] / top).toFixed(1) + '%"></i></span><small>' + b[2] + '</small></li>';
  }).join('') + '</ol><p class="note">Failed the blind tests, left out: ' + esc(dropped.join(', ') || 'none') + '. Ranges are held-out miss quantiles; on the newest ' + F.held_out.forward.test + ' tokens they held ' + share(F.held_out.forward.in50) + ' and ' + share(F.held_out.forward.in80) + '.</p></section>';
  html += '<section class="card"><h3>Launch odds ' + share(r.launch_odds) + '</h3><table class="mini"><thead><tr><th>Term</th><th>This protocol</th><th class="num">Log-odds push</th></tr></thead><tbody><tr><td>Fitted base</td><td class="dim">all at centre</td>' + num(o.intercept.toFixed(2)) + '</tr>' +
    o.parts.map(q => '<tr><td>' + esc(q.label) + '</td><td>' + ODDS_SHOWN[q.term](r) + '</td>' + num((q.logit > -0.005 ? '+' : '−') + Math.abs(q.logit).toFixed(2)) + '</tr>').join('') +
    '<tr class="used"><td>Sum → odds</td><td></td>' + num(share(r.launch_odds)) + '</tr></tbody></table>' +
    '<h3>Nearest traded tokens by TVL</h3><table class="mini"><tbody>' + comps.map(l => {
      return '<tr><td>' + esc(l.name) + ' <span class="dim">' + esc(l.symbol) + '</span></td>' + num(money(l.tvl_usd) + ' TVL</td><td class="num">' + money(l.mcap_usd)) + num(mult(l.multiple)) + '</tr>';
    }).join('') + '</tbody></table></section></div>';
  html += '<section class="card plan"><h3>Farm plan</h3><div class="plan-sum"><span>Stake <b>' + money(p.capital) + '</b> on ' + esc(p.chain) + '</span><span>Setup <b>' + money(p.setup_cost) + '</b></span><span>Running <b>' + money(p.monthly_cost) + '/mo</b></span><span>Hold <b>' + p.hold_days + ' days</b></span></div>' +
    '<div class="verdict ' + v.call + '"><b>' + v.call.toUpperCase() + '</b> Expected drop <b>' + money(v.expected_usd) + '</b> (' + money(r.implied_value_usd) + ' implied × ' + (M.CONST.airdrop_share * 100).toFixed(1) + '% to users × the stake\'s share of TVL) against <b>' + money(v.fees_usd) + '</b> of fees: ' + v.ratio.toFixed(1) + '×. Fees are covered from a ' + money(v.breakeven_stake_usd) + ' stake.</div>';
  html += '<ol class="steps">' + p.steps.map(s => '<li><p>' + esc(s.text) + '.</p><span class="chip">' + esc(s.cost) + '</span><span class="chip t">' + esc(s.time) + '</span></li>').join('') + '</ol></section></div>';
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

// --- model

function logAxes(W, H, P, lo, hi) {
  var span = hi - lo;
  var X = v => P + (Math.log10(v) - lo) / span * (W - 2 * P);
  var Y = v => H - P - (Math.min(Math.max(Math.log10(v), lo), hi) - lo) / span * (H - 2 * P);
  var s = '';
  for (var e = Math.ceil(lo); e <= hi; e++) {
    var v = Math.pow(10, e);
    s += '<line class="grid" x1="' + X(v) + '" y1="' + P + '" x2="' + X(v) + '" y2="' + (H - P) + '"/><text x="' + X(v) + '" y="' + (H - 12) + '">' + money(v) + '</text>';
    s += '<line class="grid" x1="' + P + '" y1="' + Y(v) + '" x2="' + (W - P) + '" y2="' + Y(v) + '"/><text class="l" x="2" y="' + (Y(v) + 4) + '">' + money(v) + '</text>';
  }
  return { X: X, Y: Y, grid: s };
}

function validationChart() {
  // Fitted against actual cap per traded token; the diagonal is a perfect call.
  var W = 560, H = 320, P = 40, A = logAxes(W, H, P, 5, 11);
  var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Fitted against actual market cap">' + A.grid;
  var lo = Math.pow(10, 5), hi = Math.pow(10, 11), f = F.held_out.model;
  s += '<polygon class="band" points="' + [[lo, lo * f], [hi / f, hi], [hi, hi], [hi, hi / f], [lo * f, lo], [lo, lo]].map(q => A.X(q[0]).toFixed(1) + ',' + A.Y(q[1]).toFixed(1)).join(' ') + '"/>';
  s += '<line class="fit" x1="' + A.X(lo) + '" y1="' + A.Y(lo) + '" x2="' + A.X(hi) + '" y2="' + A.Y(hi) + '"/>';
  F.points.forEach(pt => { s += '<circle class="dot ' + pt.family + '" cx="' + A.X(pt.fitted).toFixed(1) + '" cy="' + A.Y(pt.actual).toFixed(1) + '" r="3.5"><title>' + esc(pt.name) + '</title></circle>'; });
  return s + '<text class="axis" x="' + (W - P) + '" y="' + (H - 26) + '" style="text-anchor:end">model fit →</text><text class="axis l" x="' + (P + 4) + '" y="' + (P - 10) + '">↑ actual market cap</text></svg>';
}

function call(v) { return '<td>' + (v.kept ? 'kept' : v.term === 'control' ? 'control, never kept' : 'dropped') + '</td>'; }
function arrow(a, b, f) { return num(f(a) + ' → <b class="' + (b < a ? 'up' : 'down') + '">' + f(b) + '</b>'); }
function fixed3(x) { return x.toFixed(3); }

function renderModel() {
  var C = M.CONST, h = F.held_out, fw = h.forward, O = R.odds, ctl = verdictOf('control');
  var html = '<section class="hero"><div><h1>The model: ' + esc(M.VERSION) + '</h1><p class="lede">model.js fits and scores everything from the snapshot\'s own figures (TVL, 7-day growth, years with no token, category, chains), no list of names. main.ts runs it for board.json; this page re-runs it and checks every row.</p></div></section>';
  html += '<div class="grid2"><section class="card"><h3>Value if it launches: every term on two blind tests</h3><p class="note">Leave-one-out prices each of ' + F.tokens + ' traded tokens unseen; walk-forward fits the ' + fw.train + ' listed first and prices the ' + fw.test + ' listed since ' + esc(fw.from) + '. A term stays if it cuts the leave-one-out median miss by ' + share(C.keep_gain) + ' and walk-forward does not rise:</p><table class="mini"><thead><tr><th>Term</th><th class="num">Leave-one-out</th><th class="num">Walk-forward</th><th>Call</th></tr></thead><tbody>' +
    '<tr><td>flat multiple, median cap ÷ TVL</td>' + num(mult(h.flat)) + num(mult(fw.flat)) + '<td>baseline</td></tr>' +
    F.selection.map(v => '<tr' + (v.kept ? ' class="used"' : '') + '><td>' + esc(v.label) + '</td>' + arrow(v.without, v.with, mult) + arrow(v.wf_without, v.wf_with, mult) + call(v) + '</tr>').join('') + '<tr class="used"><td>size curve' + F.terms.map(t => ' + ' + verdictOf(t).label).join('') + ', used</td>' + num(mult(h.model) + ', ' + share(h.model_within3) + ' within 3×') + num(mult(fw.model)) + '<td></td></tr></tbody></table>' +
    '<p class="note">The random control ' + (ctl.with < ctl.without ? 'passes leave-one-out and' : '') + ' fails walk-forward: one test alone lets noise in, so a term needs both. Family and age fail forward in time; they reach the board through the odds.</p>' +
    '<h3>Is the printed range honest?</h3><table class="mini"><thead><tr><th>Real caps inside</th><th class="num">Stated</th><th class="num">Leave-one-out</th><th class="num">Walk-forward</th></tr></thead><tbody>' +
    '<tr><td>P25–P75, ' + mult(Math.exp(F.q[1])) + ' to ' + mult(Math.exp(F.q[2])) + '</td>' + num('50%') + num(share(h.in50)) + num(share(fw.in50)) + '</tr>' +
    '<tr><td>P10–P90, ' + mult(Math.exp(F.q[0])) + ' to ' + mult(Math.exp(F.q[3])) + '</td>' + num('80%') + num(share(h.in80)) + num(share(fw.in80)) + '</tr></tbody></table>' +
    '<p class="note">Ranges: quantiles of the signed held-out misses. Walk-forward re-runs the whole procedure, ranges included, on the older tokens.</p><h3>Formula</h3><pre>if it launches = e^' + F.intercept.toFixed(3) + ' × (TVL ÷ e^' + M.CONST.size_center + ')^' + F.size_elasticity.toFixed(3) + F.terms.map(t => ' × ' + verdictOf(t).label).join('') + '\nlaunch odds    = 1 ÷ (1 + e^−(w · x)), w:\n  ' + O.cols.map((c, i) => c + ' ' + O.weights[i].toFixed(3)).join(', ').replace(/(([^,]*,){4})/g, '$1\n ') + '\nimplied value  = if it launches × launch odds</pre></section>' +
    '<section class="card"><h3>Fit against the market</h3>' + validationChart() + '<p class="legend">' + ['vaults', 'credit', 'trading', 'realworld', 'network', 'other'].map(f => '<span><i class="dot-key ' + f + '"></i>' + f + '</span>').join('') + '</p><p class="note">Shaded: within ' + mult(h.model) + ' of the diagonal.</p>' +
    '<h3>Launch odds: every term on two blind tests</h3><p class="note">Logistic fit on whether each of ' + snap.protocols.length + ' protocols records a token (' + share(O.base) + ' do). A term stays if it lowers held-out log loss on both tests:</p><table class="mini"><thead><tr><th>Term</th><th class="num">10-fold</th><th class="num">Walk-forward</th><th>Call</th></tr></thead><tbody>' +
    O.selection.map(v => '<tr' + (v.kept ? ' class="used"' : '') + '><td>' + esc(v.label) + '</td>' + arrow(v.without, v.with, fixed3) + arrow(v.wf_without, v.wf_with, fixed3) + call(v) + '</tr>').join('') + '</tbody></table>' +
    '<p class="note">Brier score ' + O.base_brier.toFixed(3) + ' → ' + O.brier.toFixed(3) + ' on 10-fold, ' + O.base_wf_brier.toFixed(3) + ' → ' + O.wf_brier.toFixed(3) + ' walk-forward. Odds are not a date.</p></section>' +
    '<section class="card"><h3>Launch odds, calibrated held-out</h3><table class="mini"><thead><tr><th>Held-out odds</th><th class="num">Protocols</th><th class="num">Mean odds</th><th class="num">Record a token</th></tr></thead><tbody>' +
    O.calibration.map((c, i) => '<tr><td>' + share(i / 4) + '–' + share(c.hi) + '</td>' + num(c.n) + num(share(c.odds)) + num(share(c.share)) + '</tr>').join('') + '</tbody></table>' +
    '<p class="note">Farm at ≥' + C.farm_ratio + '× fees, thin at ≥' + C.thin_ratio + '×, else skip.</p></section></div>';
  app.innerHTML = html;
}

// --- routing

document.getElementById('meta').textContent = 'Snapshot ' + snap.as_of + ' · DefiLlama protocol index · ' + snap.protocols.length + ' protocols · model ' + M.VERSION;

function route() {
  var r = parse();
  var view = r.view;
  if (view.indexOf('p/') === 0) { renderDetail(decodeURIComponent(view.slice(2))); view = 'board'; }
  else if (view === 'model') renderModel();
  else { view = 'board'; state = r.st; renderBoard(state); }
  document.querySelectorAll('#tabs a').forEach(a => { a.classList.toggle('on', a.dataset.tab === view); });
}
window.addEventListener('hashchange', route);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && location.hash.indexOf('#p/') === 0) location.hash = hashOf(state); });
route();
})();
