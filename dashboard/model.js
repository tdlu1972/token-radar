// Launch Radar model: one function scores every protocol, in the page and in main.ts alike.
// Classic script: the page reads it as window.RadarModel, main.ts requires it as CommonJS.
(function (root) {
'use strict';

var DAY = 86400000;

// Category -> family: a level the fits can afford, where one category is too thin.
var FAMILY = {
  vaults: ['Risk Curators', 'Onchain Capital Allocator', 'Yield Aggregator', 'Yield', 'Liquidity Manager', 'Leveraged Farming', 'Farm', 'Options Vault', 'Indexes', 'Token Locker'],
  credit: ['Lending', 'CDP', 'CDP Manager', 'Uncollateralized Lending', 'Collateral Markets', 'Collateral Management', 'Dual-Token Stablecoin', 'Stablecoin Wrapper', 'Basis Trading'],
  trading: ['Dexs', 'Derivatives', 'Options', 'Interest Rate Derivatives', 'Prediction Market', 'OTC Marketplace', 'Launchpad', 'NFT Marketplace', 'DOR'],
  realworld: ['RWA', 'CeDeFi', 'Payments', 'Crypto Card Issuer', 'Insurance'],
  network: ['Chain', 'Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Restaking', 'Liquid Staking', 'Liquid Restaking', 'Staking Pool', 'Restaked BTC', 'Anchor BTC', 'Decentralized BTC', 'Privacy', 'Governance Incentives', 'AI Agents', 'Decentralized AI']
};
var FAMILY_OF = {};
Object.keys(FAMILY).forEach(f => { FAMILY[f].forEach(c => { FAMILY_OF[c] = f; }); });
function familyOf(cat) { return FAMILY_OF[cat] || 'other'; }

// The house's derivative rule, applied below the floor too, so early rows are held to the same bar.
var DERIVATIVE_CATS = ['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX'];
var VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
var WRAPPED = /\b(wrapped|staked|staking)\b/i;
var EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/;

var CONST = {
  ridge_lambda: 3,        // ridge penalty on the value terms (not the intercept)
  size_center: 18,        // ln TVL is centred here (about $66M)
  growth_floor: -50,      // growth reads tanh(clamped 7d % / 30)
  growth_cap: 100,
  age_center_years: 3,    // age reads years tracked (capped at 6) minus 3
  keep_gain: 0.01,        // a value term must cut the leave-one-out median miss by 1%
  odds_lambda: 1,         // ridge penalty on the launch-odds weights
  airdrop_share: 0.075,   // share of a launch's value a points campaign hands out
  capital_usd: 500,       // the stake every farm plan is costed at
  farm_ratio: 3,          // expected drop at least 3x the plan's fees: farm
  thin_ratio: 1           // at least 1x: thin; below: skip
};
var FAMS = ['vaults', 'credit', 'trading', 'realworld', 'network'];

function median(a) {
  if (!a.length) return NaN;
  var s = a.slice().sort((x, y) => x - y);
  var m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

function tokenStatus(p) {
  if (p.mcap_usd !== null && p.mcap_usd > 0) return 'live';
  if (p.gecko_id !== null || p.symbol !== null) return 'recorded';
  return 'pre';
}

// Why a pre-token protocol is kept off the board; null when it is a launch candidate.
function setAsideReason(p) {
  if (DERIVATIVE_CATS.includes(p.category)) return p.category === 'CEX' ? 'exchange' : 'wrapped, staked or bridged product';
  if (VERSIONED.test(p.name)) return 'versioned pool of another protocol';
  if (WRAPPED.test(p.name)) return 'wrapped or staked product';
  if (EXCHANGE.test(p.name)) return 'exchange product';
  return null;
}

// Sibling: the first word names a protocol that records a token (GMX Solana beside GMX). No list.
function brandOf(name) { return name.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ')[0]; }
// Venue: named after a chain it runs on (Stellar AMM on Stellar), so the chain's token is the likely
// reward. DefiLlama names the XRP Ledger's chain Ripple.
var CHAIN_ALIAS = { xrpl: 'ripple' };
function nativeChain(p) { var b = brandOf(p.name); return p.chains.filter(c => brandOf(c) === b || brandOf(c) === CHAIN_ALIAS[b])[0] || null; }
function siblings(protocols) {
  var map = {};
  protocols.forEach(p => {
    var b = brandOf(p.name);
    if (b.length >= 3 && tokenStatus(p) !== 'pre' && !map[b]) map[b] = { name: p.name, symbol: p.symbol || p.gecko_id };
  });
  return map;
}

function ageDays(asOf, listed) {
  if (!listed) return null;
  var d = Math.floor((Date.parse(asOf + 'T00:00:00Z') - Date.parse(listed + 'T00:00:00Z')) / DAY);
  return isFinite(d) ? Math.max(0, d) : null;
}

// One row per traded ticker: Aave V2, V3 and Horizon share AAVE's cap, over all of their TVL.
function liveTokens(protocols, asOf) {
  var by = {};
  protocols.forEach(p => {
    var key = (p.symbol || p.gecko_id || '').toUpperCase();
    if (key) (by[key] = by[key] || []).push(p);
  });
  var out = [];
  Object.keys(by).forEach(key => {
    var group = by[key];
    var lead = null;
    group.forEach(p => { if (p.mcap_usd > 0 && (!lead || p.mcap_usd > lead.mcap_usd)) lead = p; });
    if (!lead) return;
    var tvl = group.reduce((s, p) => s + p.tvl_usd, 0);
    if (tvl <= 0) return;
    out.push({ slug: lead.slug, name: lead.name, symbol: lead.symbol || key, category: lead.category, chains: lead.chains, change_7d: lead.change_7d, listed_at: lead.listed_at, age_days: asOf ? ageDays(asOf, lead.listed_at) : null,
      mcap_usd: lead.mcap_usd, tvl_usd: tvl, multiple: lead.mcap_usd / tvl });
  });
  return out.sort((a, b) => b.mcap_usd - a.mcap_usd);
}

// --- the value fit

// Value if it launches: ln(market cap) = a + b ln(TVL) + whichever candidate terms earn their place, by
// ridge least squares over the snapshot's traded tokens. b < 1 is the size curve: a small protocol's
// cap is a larger multiple of its TVL than a large one's.
var TERMS = {
  family: { label: 'family level', cols: FAMS.slice(), x: t => { var f = familyOf(t.category); return FAMS.map(n => f === n ? 1 : 0); } },
  growth: { label: '7-day TVL growth', cols: ['growth'], x: t => [growthX(t.change_7d)] },
  age: { label: 'years tracked', cols: ['age'], x: t => [t.age_days === null ? 0 : Math.min(6, t.age_days / 365) - CONST.age_center_years] },
  control: { label: 'control: a random number', cols: ['control'], x: t => [noise(t.slug)] }
};
var CANDIDATES = ['family', 'growth', 'age', 'control'];
function growthX(g) { return Math.tanh(clamp(g === null ? 0 : g, CONST.growth_floor, CONST.growth_cap) / 30); }
// A fixed pseudo-random number in [-1, 1] per slug: a control term with no signal.
function noise(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 2147483648 - 1; }
function features(t, terms) {
  var x = [1, Math.log(t.tvl_usd) - CONST.size_center];
  terms.forEach(name => { x.push.apply(x, TERMS[name].x(t)); });
  return x;
}
function dot(w, x) { var s = 0; for (var i = 0; i < x.length; i++) s += w[i] * x[i]; return s; }
function quantile(a, q) { var s = a.slice().sort((x, y) => x - y), i = q * (s.length - 1), f = Math.floor(i); return s[f] + (s[Math.min(f + 1, s.length - 1)] - s[f]) * (i - f); }

// Solve the augmented system A = [M | v] by Gaussian elimination with partial pivoting.
function gauss(A) {
  var k = A.length, i, j, r;
  for (i = 0; i < k; i++) {
    var piv = i;
    for (r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    var t = A[i]; A[i] = A[piv]; A[piv] = t;
    for (r = 0; r < k; r++) {
      if (r === i) continue;
      var m = A[r][i] / A[i][i];
      for (j = i; j <= k; j++) A[r][j] -= m * A[i][j];
    }
  }
  return A.map((row, n) => row[k] / row[n]);
}
// Ridge least squares: (X'X + lambda I') w = X'y, the intercept unpenalised.
function ridge(X, y, lambda) {
  var k = X[0].length, A = [];
  for (var i = 0; i < k; i++) {
    A.push([]);
    for (var j = 0; j <= k; j++) {
      var v = 0;
      for (var r = 0; r < X.length; r++) v += X[r][i] * (j < k ? X[r][j] : y[r]);
      A[i].push(v + (i === j && i > 0 ? lambda : 0));
    }
  }
  return gauss(A);
}

// Held-out error of a predictor: each traded token is predicted by a fit that never saw it.
function heldOut(live, predictWithout) {
  var res = live.map((t, i) => Math.log(t.mcap_usd) - predictWithout(live.filter((_, j) => j !== i), t));
  var err = res.map(Math.abs);
  return { factor: Math.exp(median(err)), within3: err.filter(e => e < Math.log(3)).length / err.length, errors: err, res: res };
}

function fitOn(set, terms) {
  return ridge(set.map(t => features(t, terms)), set.map(t => Math.log(t.mcap_usd)), CONST.ridge_lambda);
}
function heldOutTerms(live, terms) {
  return heldOut(live, (rest, t) => dot(fitOn(rest, terms), features(t, terms)));
}

// Two blind tests per term: leave-one-out, and walk-forward (fit on the older 3/4 of dated tokens,
// priced on the newest 1/4). Forward selection keeps the term that cuts the leave-one-out median miss
// most (by keep_gain) while walk-forward does not rise. The control is tried, shown, never kept.
function fitValue(live, inner) {
  var dated = live.filter(t => t.listed_at).sort((a, b) => a.listed_at < b.listed_at ? -1 : a.listed_at > b.listed_at ? 1 : a.slug < b.slug ? -1 : 1);
  var cut = Math.round(dated.length * 0.75), past = dated.slice(0, cut), next = dated.slice(cut);
  var wfMiss = terms => { var w = fitOn(past, terms); return Math.exp(median(next.map(t => Math.abs(dot(w, features(t, terms)) - Math.log(t.mcap_usd))))); };
  var terms = [], best = heldOutTerms(live, terms), bestWf = inner ? 0 : wfMiss(terms), last = {};
  for (;;) {
    var pick = null, pickRes = null, pickWf = 0;
    CANDIDATES.forEach(c => {
      if (terms.includes(c)) return;
      var r = heldOutTerms(live, terms.concat([c])), wf = inner ? 0 : wfMiss(terms.concat([c]));
      last[c] = { without: best.factor, with: r.factor, wf_without: bestWf, wf_with: wf };
      if (c !== 'control' && r.factor < best.factor * (1 - CONST.keep_gain) && wf <= bestWf && (!pickRes || r.factor < pickRes.factor)) { pick = c; pickRes = r; pickWf = wf; }
    });
    if (!pick) break;
    terms.push(pick); best = pickRes; bestWf = pickWf;
  }
  var verdicts = CANDIDATES.map(c => Object.assign({ term: c, label: TERMS[c].label, kept: terms.includes(c) }, last[c]));
  var w = fitOn(live, terms);
  var flat = heldOut(live, (rest, t) => Math.log(t.tvl_usd) + median(rest.map(u => Math.log(u.multiple))));
  // The printed ranges: quantiles of the signed held-out misses, P25-P75 and P10-P90.
  var q = [0.1, 0.25, 0.75, 0.9].map(p => quantile(best.res, p));
  // The whole procedure re-run on the older tokens, scored on the newest: miss and range coverage.
  var forward = null;
  if (!inner) {
    var f = fitValue(past, true), fm = median(past.map(u => Math.log(u.multiple)));
    var fr = next.map(t => Math.log(t.mcap_usd) - Math.log(f.predict(t)));
    var miss = g => Math.exp(median(next.map(t => Math.abs(g(t) - Math.log(t.mcap_usd)))));
    var inside = (a, b) => fr.filter(r => r >= f.q[a] && r <= f.q[b]).length / fr.length;
    forward = { train: past.length, test: next.length, from: next[0].listed_at, terms: f.terms, model: miss(t => Math.log(f.predict(t))), flat: miss(t => Math.log(t.tvl_usd) + fm), in50: inside(1, 2), in80: inside(0, 3) };
  }
  var points = live.map((t, i) => ({ name: t.name, family: familyOf(t.category), actual: t.mcap_usd, fitted: Math.exp(dot(w, features(t, terms))), held_out_error: best.errors[i] }));
  // Named coefficients of the kept terms.
  var coef = {}, at = 2;
  terms.forEach(name => { TERMS[name].cols.forEach(col => { coef[col] = w[at++]; }); });
  return {
    weights: w, terms: terms, coef: coef, intercept: w[0], size_elasticity: w[1], tokens: live.length,
    selection: verdicts, q: q,
    held_out: { model: best.factor, model_within3: best.within3, wf: bestWf, flat: flat.factor, flat_within3: flat.within3, forward: forward,
      in50: best.res.filter(r => r >= q[1] && r <= q[2]).length / best.res.length, in80: best.res.filter(r => r >= q[0] && r <= q[3]).length / best.res.length },
    points: points,
    predict: t => Math.exp(dot(w, features(t, terms))),
    // The multiplier each kept term contributes for this protocol (1 when dropped).
    parts: t => {
      var out = {};
      CANDIDATES.forEach(name => {
        var i = terms.indexOf(name);
        if (i < 0) { out[name] = 1; return; }
        var x = TERMS[name].x(t), s = 0;
        TERMS[name].cols.forEach((col, j) => { s += coef[col] * x[j]; });
        out[name] = Math.exp(s);
      });
      return out;
    }
  };
}

// --- launch odds

// The chance a protocol records a token: ridge logistic regression on every protocol's 0/1 today.
// A term is kept only if it lowers the held-out log loss on both tests: 10-fold (fold = index mod 10)
// and walk-forward (older 3/4 of dated protocols fit, newest 1/4 scored). The control is never kept.
var ODDS_X = {
  age: { label: 'years tracked', cols: ['per year tracked', 'no listing date'], x: (p, a) => [a === null ? 0 : Math.min(6, a / 365) - CONST.age_center_years, a === null ? 1 : 0] },
  family: { label: 'family', cols: FAMS, x: p => { var f = familyOf(p.category); return FAMS.map(n => f === n ? 1 : 0); } },
  growth: { label: '7-day TVL growth', cols: ['tanh(7d % ÷ 30)'], x: p => [growthX(p.change_7d)] },
  size: { label: 'TVL size', cols: ['ln TVL'], x: p => [Math.log(p.tvl_usd) - CONST.size_center] },
  chains: { label: 'chain count', cols: ['ln chains'], x: p => [Math.log(Math.max(1, p.chains.length))] },
  control: { label: 'control: a random number', cols: ['noise'], x: p => [noise(p.slug)] }
};
function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }
function oddsX(q, terms) { var x = [1]; terms.forEach(t => { x.push.apply(x, ODDS_X[t].x(q.p, q.a)); }); return x; }
// Newton steps on the penalised log likelihood (lambda on every weight but the intercept).
function logistic(set, terms) {
  var X = set.map(q => oddsX(q, terms)), k = X[0].length, w = X[0].map(() => 0);
  for (var it = 0; it < 30; it++) {
    var A = [];
    for (var i = 0; i < k; i++) { A.push([]); for (var j = 0; j <= k; j++) A[i].push(i === j && i > 0 ? CONST.odds_lambda : 0); }
    X.forEach((x, n) => {
      var p = sigmoid(dot(w, x)), r = p * (1 - p), g = set[n].y - p;
      for (var i = 0; i < k; i++) { A[i][k] += g * x[i]; for (var j = 0; j < k; j++) A[i][j] += r * x[i] * x[j]; }
    });
    for (i = 1; i < k; i++) A[i][k] -= CONST.odds_lambda * w[i];
    var d = gauss(A), step = 0;
    w = w.map((v, i) => { step = Math.max(step, Math.abs(d[i])); return v + d[i]; });
    if (step < 1e-7) break;
  }
  return w;
}
function launchOdds(protocols, asOf) {
  var ps = protocols.map((p, i) => ({ p: p, a: ageDays(asOf, p.listed_at), y: tokenStatus(p) !== 'pre' ? 1 : 0, i: i }));
  var dated = ps.filter(q => q.a !== null).sort((a, b) => b.a - a.a || (a.p.slug < b.p.slug ? -1 : 1));
  var cut = Math.round(dated.length * 0.75);
  var ll = (o, y) => -Math.log(y ? o : 1 - o);
  // Held-out odds for every protocol from 10 fits that never saw it.
  function cvOdds(terms) {
    var o = [];
    for (var f = 0; f < 10; f++) {
      var w = logistic(ps.filter(q => q.i % 10 !== f), terms);
      ps.forEach(q => { if (q.i % 10 === f) o[q.i] = sigmoid(dot(w, oddsX(q, terms))); });
    }
    return o;
  }
  function test(terms) {
    var o = cvOdds(terms), w = logistic(dated.slice(0, cut), terms), nx = dated.slice(cut);
    var fo = nx.map(q => sigmoid(dot(w, oddsX(q, terms))));
    return { cv: ps.reduce((s, q) => s + ll(o[q.i], q.y), 0) / ps.length, wf: nx.reduce((s, q, n) => s + ll(fo[n], q.y), 0) / nx.length,
      brier: ps.reduce((s, q) => s + (o[q.i] - q.y) * (o[q.i] - q.y), 0) / ps.length, wf_brier: nx.reduce((s, q, n) => s + (fo[n] - q.y) * (fo[n] - q.y), 0) / nx.length, odds: o };
  }
  var names = Object.keys(ODDS_X), terms = [], best = test(terms), base = best, last = {};
  for (;;) {
    var pick = null, pr = null;
    names.forEach(t => {
      if (terms.includes(t)) return;
      var r = test(terms.concat([t]));
      last[t] = { without: best.cv, with: r.cv, wf_without: best.wf, wf_with: r.wf };
      if (t !== 'control' && r.cv < best.cv && r.wf < best.wf && (!pr || r.cv < pr.cv)) { pick = t; pr = r; }
    });
    if (!pick) break;
    terms.push(pick); best = pr;
  }
  // Calibration: protocols grouped by their held-out odds, against the share that do record a token.
  var cal = [0.25, 0.5, 0.75, 1].map(hi => ({ hi: hi, n: 0, odds: 0, share: 0 }));
  ps.forEach(q => { var o = best.odds[q.i], c = cal[Math.min(3, Math.floor(o * 4))]; c.n++; c.odds += o; c.share += q.y; });
  cal.forEach(c => { if (c.n) { c.odds /= c.n; c.share /= c.n; } });
  var w = logistic(ps, terms), T = ps.reduce((s, q) => s + q.y, 0);
  return {
    base: T / ps.length, terms: terms, weights: w, cols: [].concat.apply(['intercept'], terms.map(t => ODDS_X[t].cols)), loss: best.cv, base_loss: base.cv, wf: best.wf, base_wf: base.wf, brier: best.brier, base_brier: base.brier, wf_brier: best.wf_brier, base_wf_brier: base.wf_brier, calibration: cal,
    selection: names.map(t => Object.assign({ term: t, label: ODDS_X[t].label, kept: terms.includes(t) }, last[t])),
    // This protocol's odds, with each kept term's push on the log-odds scale.
    of: (p, age) => {
      var at = 1, parts = terms.map(t => {
        var x = ODDS_X[t].x(p, age), s = 0;
        x.forEach(v => { s += w[at++] * v; });
        return { term: t, label: ODDS_X[t].label, logit: s };
      });
      return { odds: sigmoid(parts.reduce((s, q) => s + q.logit, w[0])), intercept: w[0], parts: parts };
    }
  };
}

// --- farm plans

// Typical cost of one transaction, in dollars, on the chains the snapshot names most.
var GAS = {
  Ethereum: 2.5, Bitcoin: 1.5, Tron: 1, Binance: 0.05, Avalanche: 0.05, Polygon: 0.02, Arbitrum: 0.03, Base: 0.02,
  Optimism: 0.02, Linea: 0.03, Solana: 0.01, Sui: 0.01, Aptos: 0.01, Monad: 0.02, Plasma: 0.01, 'Hyperliquid L1': 0.01,
  Sonic: 0.01, Berachain: 0.02, TON: 0.02, Stellar: 0.01, Cardano: 0.2, Algorand: 0.01, Ripple: 0.01, Flare: 0.02,
  Ink: 0.02, Katana: 0.02, Unichain: 0.02, 'Robinhood Chain': 0.02, Mantle: 0.02, Scroll: 0.03, Bittensor: 0.01,
  Noble: 0.01, Hive: 0, Lightning: 0.01
};
function gasOf(chain) { return chain in GAS ? GAS[chain] : 0.1; }
function cheapestChain(chains) {
  var best = chains[0] || 'Ethereum';
  chains.forEach(c => { if (gasOf(c) < gasOf(best)) best = c; });
  return best;
}
function usd(x) { return x < 1 ? '$' + x.toFixed(2) : '$' + Math.round(x).toLocaleString('en-US'); }

// The core move per category: what to do with the stake, and how long to keep doing it.
var PLAYBOOK = {
  vaults: { act: 'Deposit the USDC into the largest {name} curated vault on {chain} and keep the vault shares in the wallet', hold: 90, weekly: 'Top up or rebalance once a week so the account shows steady, recurring deposits' },
  credit: { act: 'Supply the USDC to {name} on {chain}, then borrow 25% of it against the deposit so the account uses both sides of the market', hold: 90, weekly: 'Repay and re-borrow a small amount once a week, keeping the loan-to-value under 30%' },
  trading: { act: 'Trade on {name} on {chain}: swap or open a 1x position with the USDC, then provide half of it as liquidity in the deepest stable pair', hold: 60, weekly: 'Make 3 to 5 trades a week of at least $50 each; volume is what trading points usually count' },
  realworld: { act: 'Pass {name} onboarding (KYC where it asks), then mint or buy its yield product on {chain} with the USDC', hold: 120, weekly: 'Check the position weekly and roll any matured product into the next issue' },
  network: { act: 'Bridge the USDC to {chain} through {name}\'s own entry point and use it: stake, delegate or deposit into its native pools', hold: 90, weekly: 'Use 2 or 3 native apps on {chain} each week so the wallet shows activity beyond one deposit' },
  other: { act: 'Use {name}\'s core product on {chain} with the USDC, following its own docs for a first deposit', hold: 90, weekly: 'Repeat one qualifying action each week' }
};

// Farm steps: each one says what to do, what it costs and how long it takes.
function farmPlan(p) {
  var fam = familyOf(p.category);
  var book = PLAYBOOK[fam];
  var chain = cheapestChain(p.chains);
  var gas = gasOf(chain);
  var capital = p.tvl_usd < 20e6 ? 250 : CONST.capital_usd;
  var fill = s => s.replace(/\{name\}/g, p.name).replace(/\{chain\}/g, chain);
  var steps = [];
  steps.push({ text: 'Make a fresh wallet on ' + chain + ' that holds only the farming stake, and save its recovery phrase offline', cost: 'free', time: '10 minutes' });
  steps.push({ text: 'Move ' + usd(capital) + ' of USDC to ' + chain + (chain === 'Ethereum' ? '' : ' with a bridge or a direct exchange withdrawal'), cost: 'about ' + usd(Math.max(1, capital * 0.001) + gas * 2) + ' in fees', time: '15 minutes' });
  steps.push({ text: fill(book.act), cost: usd(capital) + ' of capital stays at work, plus ' + usd(gas * 3) + ' of gas', time: '20 minutes' });
  steps.push({ text: fill(book.weekly), cost: 'about ' + usd(gas * 2 * 4) + ' of gas a month', time: '10 minutes a week' });
  if (p.chains.length > 1) {
    var second = p.chains.filter(c => c !== chain).sort((a, b) => gasOf(a) - gasOf(b))[0];
    steps.push({ text: 'Repeat a smaller deposit on ' + second + ', ' + p.name + '\'s next cheapest chain, so the wallet counts on ' + p.chains.length + ' deployments rather than one', cost: usd(capital / 5) + ' of capital and ' + usd(gasOf(second) * 3) + ' of gas', time: '15 minutes' });
  }
  steps.push({ text: 'Hold the position for at least ' + book.hold + ' days so it spans more than one points snapshot; most campaigns weight time held, not size', cost: 'the stake stays deployed', time: book.hold + ' days' });
  if (p.change_7d !== null && p.change_7d <= -10) {
    steps.push({ text: 'TVL fell ' + Math.abs(p.change_7d).toFixed(1) + '% in the last week: check the protocol\'s announcements before adding more, and exit if it falls another 25%', cost: 'free', time: '5 minutes' });
  } else if (p.change_7d !== null && p.change_7d >= 10) {
    steps.push({ text: 'TVL rose ' + p.change_7d.toFixed(1) + '% in the last week: early deposits usually earn more per dollar, so set up this week rather than next month', cost: 'free', time: '5 minutes' });
  }
  steps.push({ text: 'Check ' + p.name + '\'s own points or rewards page each month and claim only through the link the project publishes; never sign a claim from a direct message', cost: 'free to check', time: '5 minutes a month' });
  return { chain: chain, capital: capital, hold_days: book.hold, steps: steps, setup_cost: Math.max(1, capital * 0.001) + gas * 5, monthly_cost: gas * 8 };
}

// The plan's last step states its verdict in dollars, so the board.json row carries it too.
function verdictStep(v, plan) {
  var head = v.call === 'farm' ? 'Verdict: farm' : v.call === 'thin' ? 'Verdict: thin, farm only with spare capital' : 'Verdict: skip at this stake';
  var be = v.breakeven_stake_usd === null ? '' : '; fees are covered from a stake of about ' + usd(v.breakeven_stake_usd);
  return { text: head + '. The ' + usd(plan.capital) + ' stake can expect about ' + usd(v.expected_usd) + ' of drop, odds-weighted, against ' + usd(v.fees_usd) + ' of fees over ' + plan.hold_days + ' days' + be, cost: usd(v.fees_usd) + ' in all', time: plan.hold_days + ' days' };
}

function stepText(s) { return s.text + '. Cost: ' + s.cost + '. Time: ' + s.time + '.'; }

// Farm, thin or skip: the drop the stake can expect (implied value, odds included, x airdrop share x
// the stake's share of TVL) against everything the plan costs over its hold.
function verdict(plan, implied, tvl) {
  var perDollar = implied * CONST.airdrop_share / tvl;
  var expected = plan.capital * perDollar;
  var fees = plan.setup_cost + plan.monthly_cost * plan.hold_days / 30;
  var ratio = expected / fees;
  return {
    expected_usd: expected, fees_usd: fees, ratio: ratio,
    call: ratio >= CONST.farm_ratio ? 'farm' : ratio >= CONST.thin_ratio ? 'thin' : 'skip',
    breakeven_stake_usd: perDollar > 0 ? fees / perDollar : null
  };
}

// --- the radar

function build(snapshot) {
  var protocols = snapshot.protocols;
  var live = liveTokens(protocols, snapshot.as_of);
  var fit = fitValue(live);
  var odds = launchOdds(protocols, snapshot.as_of);
  var sib = siblings(protocols);
  var watch = {};
  snapshot.watchlist.forEach(s => { watch[s] = true; });
  var rows = [], aside = [];
  protocols.forEach(p => {
    var status = tokenStatus(p);
    if (status === 'live') return;
    if (status === 'recorded') { aside.push({ slug: p.slug, name: p.name, reason: 'token on record, no market cap' }); return; }
    var sibling = sib[brandOf(p.name)] || null;
    var native = nativeChain(p);
    var why = watch[p.slug] ? null : setAsideReason(p) || (sibling ? 'sibling of a token that trades' : native ? 'venue of its own chain' : null);
    if (why) { aside.push({ slug: p.slug, name: p.name, reason: why }); return; }
    var age = ageDays(snapshot.as_of, p.listed_at);
    var subject = { tvl_usd: p.tvl_usd, category: p.category, change_7d: p.change_7d, age_days: age };
    var core = fit.predict(subject);
    var parts = fit.parts(subject);
    var od = odds.of(p, age);
    // Implied value = value if it launches x the odds it does.
    var implied = Math.max(1, Math.round(core * od.odds));
    var plan = farmPlan(p);
    rows.push({
      slug: p.slug, name: p.name, category: p.category, family: familyOf(p.category), chains: p.chains,
      tvl_usd: p.tvl_usd, change_7d: p.change_7d, listed_at: p.listed_at, age_days: age,
      tier: watch[p.slug] ? 'watchlist' : 'early',
      token_status: 'pre-token',
      sibling: sibling, native_chain: native,
      launch_value_usd: Math.round(core),
      launch_range_usd: fit.q.map(q => Math.round(core * Math.exp(q))),
      implied_value_usd: implied,
      range_usd: [Math.round(implied * Math.exp(fit.q[1])), Math.round(implied * Math.exp(fit.q[2]))],
      model: { fitted_core: core, implied_multiple: implied / p.tvl_usd, parts: parts },
      launch_odds: od.odds,
      odds_parts: od,
      plan: plan,
      verdict: verdict(plan, implied, p.tvl_usd),
      farm_steps: null
    });
    var row = rows[rows.length - 1];
    plan.steps.push(verdictStep(row.verdict, plan));
    row.farm_steps = plan.steps.map(stepText);
  });
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return { rows: rows, live: live, aside: aside, fit: fit, odds: odds, constants: CONST, protocols: protocols.length };
}

var api = { build: build, liveTokens: liveTokens, fitValue: fitValue, tokenStatus: tokenStatus, familyOf: familyOf, CONST: CONST, VERSION: 'radar-fit-6' };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RadarModel = api;
})(this);
