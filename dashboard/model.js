// Launch Radar model: one function scores every protocol, in the page and in main.ts alike.
// Classic script: the page reads it as window.RadarModel, main.ts requires it as CommonJS.
(function (root) {
  'use strict';

  var DAY = 86400000;

  // Category -> family. The value fit gives each family its own level; a category is too thin to.
  var FAMILY = {
    vaults: ['Risk Curators', 'Onchain Capital Allocator', 'Yield Aggregator', 'Yield', 'Liquidity Manager', 'Leveraged Farming', 'Farm', 'Options Vault', 'Indexes', 'Token Locker'],
    credit: ['Lending', 'CDP', 'CDP Manager', 'Uncollateralized Lending', 'Collateral Markets', 'Collateral Management', 'Dual-Token Stablecoin', 'Stablecoin Wrapper', 'Basis Trading'],
    trading: ['Dexs', 'Derivatives', 'Options', 'Interest Rate Derivatives', 'Prediction Market', 'OTC Marketplace', 'Launchpad', 'NFT Marketplace', 'DOR'],
    realworld: ['RWA', 'CeDeFi', 'Payments', 'Crypto Card Issuer', 'Insurance'],
    network: ['Chain', 'Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Restaking', 'Liquid Staking', 'Liquid Restaking', 'Staking Pool', 'Restaked BTC', 'Anchor BTC', 'Decentralized BTC', 'Privacy', 'Governance Incentives', 'AI Agents', 'Decentralized AI']
  };
  var FAMILY_OF = {};
  Object.keys(FAMILY).forEach(function (f) { FAMILY[f].forEach(function (c) { FAMILY_OF[c] = f; }); });
  function familyOf(cat) { return FAMILY_OF[cat] || 'other'; }

  // The house's derivative rule, applied below the floor too, so early rows are held to the same bar.
  var DERIVATIVE_CATS = ['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX'];
  var VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  var WRAPPED = /\b(wrapped|staked|staking)\b/i;
  var EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/;

  var CONST = {
    ridge_lambda: 3,        // ridge penalty on the fitted terms (not the intercept), chosen on held-out error
    size_center: 18,        // ln TVL is centred here (about $66M) so the intercept reads as a mid-size cap
    growth_floor: -50,      // the growth term reads tanh(clamped 7d % / 30)
    growth_cap: 100,
    age_center_years: 3,    // the age term reads years tracked (capped at 6) minus 3
    keep_gain: 0.01,        // a candidate term is kept only if it cuts the held-out median miss by 1% or more
    odds_k: 5,              // pseudo-protocols pulling a thin category or age band toward the whole field
    airdrop_share: 0.075,   // share of a launch's value a points campaign typically hands out
    capital_usd: 500,       // the stake every farm plan is costed at
    farm_ratio: 3,          // expected drop at least 3x the plan's fees: farm
    thin_ratio: 1           // at least 1x: thin; below: skip
  };
  var FAMS = ['vaults', 'credit', 'trading', 'realworld', 'network'];

  function median(a) {
    if (!a.length) return NaN;
    var s = a.slice().sort(function (x, y) { return x - y; });
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
    if (DERIVATIVE_CATS.indexOf(p.category) >= 0) return p.category === 'CEX' ? 'exchange' : 'wrapped, staked or bridged product';
    if (VERSIONED.test(p.name)) return 'versioned pool of another protocol';
    if (WRAPPED.test(p.name)) return 'wrapped or staked product';
    if (EXCHANGE.test(p.name)) return 'exchange product';
    return null;
  }

  // A protocol whose first word names a protocol that already records a token is that token's sibling:
  // GMX Solana beside GMX, Kava Mint beside Kava Lend. Found from the snapshot's names, no list.
  function brandOf(name) { return name.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ')[0]; }
  function siblings(protocols) {
    var map = {};
    protocols.forEach(function (p) {
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

  // One row per traded token: protocols that carry the same ticker (Aave V2, V3, V4 and Horizon all
  // record AAVE) share one market cap, so the token's multiple is its cap over all of their TVL.
  function liveTokens(protocols, asOf) {
    var by = {};
    protocols.forEach(function (p) {
      var key = (p.symbol || p.gecko_id || '').toUpperCase();
      if (key) (by[key] = by[key] || []).push(p);
    });
    var out = [];
    Object.keys(by).forEach(function (key) {
      var group = by[key];
      var lead = null;
      group.forEach(function (p) { if (p.mcap_usd > 0 && (!lead || p.mcap_usd > lead.mcap_usd)) lead = p; });
      if (!lead) return;
      var tvl = group.reduce(function (s, p) { return s + p.tvl_usd; }, 0);
      if (tvl <= 0) return;
      out.push({ slug: lead.slug, name: lead.name, symbol: lead.symbol || key, category: lead.category, chains: lead.chains, change_7d: lead.change_7d, listed_at: lead.listed_at, age_days: asOf ? ageDays(asOf, lead.listed_at) : null,
        mcap_usd: lead.mcap_usd, tvl_usd: tvl, products: group.length, multiple: lead.mcap_usd / tvl });
    });
    return out.sort(function (a, b) { return b.mcap_usd - a.mcap_usd; });
  }

  // ---------------------------------------------------------------- the value fit

  // The fitted core: ln(market cap) = a + b ln(TVL) + whichever candidate terms earn their place, by
  // ridge least squares over the snapshot's traded tokens. b < 1 is the size curve: a small protocol's
  // cap is a larger multiple of its TVL than a large one's.
  var TERMS = {
    family: { label: 'family level', cols: FAMS.slice(), x: function (t) { var f = familyOf(t.category); return FAMS.map(function (n) { return f === n ? 1 : 0; }); } },
    growth: { label: '7-day TVL growth', cols: ['growth'], x: function (t) { return [Math.tanh(clamp(t.change_7d === null ? 0 : t.change_7d, CONST.growth_floor, CONST.growth_cap) / 30)]; } },
    age: { label: 'years tracked', cols: ['age'], x: function (t) { return [t.age_days === null ? 0 : Math.min(6, t.age_days / 365) - CONST.age_center_years]; } },
    undated: { label: 'no listing date', cols: ['undated'], x: function (t) { return [t.age_days === null ? 1 : 0]; } }
  };
  var CANDIDATES = ['family', 'growth', 'age', 'undated'];
  function features(t, terms) {
    var x = [1, Math.log(t.tvl_usd) - CONST.size_center];
    terms.forEach(function (name) { x.push.apply(x, TERMS[name].x(t)); });
    return x;
  }
  function dot(w, x) { var s = 0; for (var i = 0; i < x.length; i++) s += w[i] * x[i]; return s; }

  // Solve (X'X + lambda I') w = X'y by Gaussian elimination with partial pivoting.
  function ridge(X, y, lambda) {
    var k = X[0].length, A = [], i, j, r;
    for (i = 0; i < k; i++) {
      A.push([]);
      for (j = 0; j <= k; j++) {
        var v = 0;
        for (r = 0; r < X.length; r++) v += X[r][i] * (j < k ? X[r][j] : y[r]);
        A[i].push(v + (i === j && i > 0 ? lambda : 0));
      }
    }
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
    return A.map(function (row, n) { return row[k] / row[n]; });
  }

  // Held-out error of a predictor: each traded token is predicted by a fit that never saw it.
  function heldOut(live, predictWithout) {
    var err = live.map(function (t, i) {
      var rest = live.filter(function (_, j) { return j !== i; });
      return Math.abs(predictWithout(rest, t) - Math.log(t.mcap_usd));
    });
    var mean = err.reduce(function (a, b) { return a + b; }, 0) / err.length;
    return { factor: Math.exp(median(err)), mean: mean, within3: err.filter(function (e) { return e < Math.log(3); }).length / err.length, errors: err };
  }

  function fitOn(set, terms) {
    return ridge(set.map(function (t) { return features(t, terms); }), set.map(function (t) { return Math.log(t.mcap_usd); }), CONST.ridge_lambda);
  }
  function heldOutTerms(live, terms) {
    return heldOut(live, function (rest, t) { return dot(fitOn(rest, terms), features(t, terms)); });
  }

  // Forward selection on held-out error: start from the size curve, try each candidate term, keep the
  // one that cuts the leave-one-out median miss most (by keep_gain or more), and repeat until none does.
  // Every trial is recorded, so the page shows what each term was worth, kept or dropped.
  function fitValue(live) {
    var terms = [], best = heldOutTerms(live, terms), trials = [], step = 0;
    for (;;) {
      var pick = null, pickRes = null;
      step++;
      CANDIDATES.forEach(function (c) {
        if (terms.indexOf(c) >= 0) return;
        var r = heldOutTerms(live, terms.concat([c]));
        trials.push({ step: step, term: c, label: TERMS[c].label, base: best.factor, with: r.factor, mean_base: best.mean, mean_with: r.mean });
        if (r.factor < best.factor * (1 - CONST.keep_gain) && (!pickRes || r.factor < pickRes.factor)) { pick = c; pickRes = r; }
      });
      if (!pick) break;
      terms.push(pick); best = pickRes;
    }
    var verdicts = CANDIDATES.map(function (c) {
      var last = trials.filter(function (t) { return t.term === c; }).pop();
      return { term: c, label: TERMS[c].label, kept: terms.indexOf(c) >= 0, without: last.base, with: last.with, mean_without: last.mean_base, mean_with: last.mean_with };
    });
    var w = fitOn(live, terms);
    var flat = heldOut(live, function (rest, t) { return Math.log(t.tvl_usd) + median(rest.map(function (u) { return Math.log(u.multiple); })); });
    var sizeOnly = heldOutTerms(live, []);
    var points = live.map(function (t, i) { return { name: t.name, family: familyOf(t.category), actual: t.mcap_usd, fitted: Math.exp(dot(w, features(t, terms))), held_out_error: best.errors[i] }; });
    // Named coefficients: family levels (other = 0), and the kept scalar terms.
    var coef = {}, at = 2;
    terms.forEach(function (name) { TERMS[name].cols.forEach(function (col) { coef[col] = w[at++]; }); });
    var levels = { other: 0 };
    FAMS.forEach(function (f) { levels[f] = coef[f] || 0; });
    return {
      weights: w, terms: terms, coef: coef, intercept: w[0], size_elasticity: w[1], family_levels: levels, tokens: live.length,
      selection: verdicts,
      held_out: { model: best.factor, model_within3: best.within3, model_mean: best.mean, flat: flat.factor, flat_within3: flat.within3, flat_mean: flat.mean, size_only: sizeOnly.factor, size_only_within3: sizeOnly.within3, size_only_mean: sizeOnly.mean },
      points: points,
      predict: function (t) { return Math.exp(dot(w, features(t, terms))); },
      // The multiplier each kept term contributes for this protocol (1 when dropped).
      parts: function (t) {
        var out = {};
        CANDIDATES.forEach(function (name) {
          var i = terms.indexOf(name);
          if (i < 0) { out[name] = 1; return; }
          var x = TERMS[name].x(t), s = 0;
          TERMS[name].cols.forEach(function (col, j) { s += coef[col] * x[j]; });
          out[name] = Math.exp(s);
        });
        return out;
      }
    };
  }

  // ---------------------------------------------------------------- launch odds

  // The share of comparable protocols that already record a token: by category and by how long
  // DefiLlama has tracked them, each smoothed toward the whole snapshot, combined on the log-odds scale.
  var AGE_BANDS = [[0, 365, 'under 1 year'], [365, 730, '1 to 2 years'], [730, 1460, '2 to 4 years'], [1460, 1e9, '4 years or more']];
  function ageBand(age) {
    if (age === null) return 'unlisted';
    for (var i = 0; i < AGE_BANDS.length; i++) if (age < AGE_BANDS[i][1]) return AGE_BANDS[i][2];
    return AGE_BANDS[AGE_BANDS.length - 1][2];
  }
  function logit(p) { return Math.log(p / (1 - p)); }
  function launchOdds(protocols, asOf) {
    var all = { t: 0, n: 0 }, cat = {}, band = {};
    protocols.forEach(function (p) {
      var has = tokenStatus(p) !== 'pre' ? 1 : 0;
      var b = ageBand(ageDays(asOf, p.listed_at));
      all.t += has; all.n++;
      cat[p.category] = cat[p.category] || { t: 0, n: 0 }; cat[p.category].t += has; cat[p.category].n++;
      band[b] = band[b] || { t: 0, n: 0 }; band[b].t += has; band[b].n++;
    });
    var base = all.t / all.n, k = CONST.odds_k;
    function shrunk(c) { return c ? (c.t + k * base) / (c.n + k) : base; }
    return {
      base: base,
      bands: AGE_BANDS.map(function (b) { return { band: b[2], share: shrunk(band[b[2]]), n: band[b[2]] ? band[b[2]].n : 0 }; }),
      of: function (category, age) {
        var c = shrunk(cat[category]), a = shrunk(band[ageBand(age)]);
        var z = logit(c) + logit(a) - logit(base);
        return { odds: 1 / (1 + Math.exp(-z)), category: c, age: a, band: ageBand(age) };
      }
    };
  }

  // ---------------------------------------------------------------- farm plans

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
    chains.forEach(function (c) { if (gasOf(c) < gasOf(best)) best = c; });
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
    var fill = function (s) { return s.replace(/\{name\}/g, p.name).replace(/\{chain\}/g, chain); };
    var steps = [];
    steps.push({ text: 'Make a fresh wallet on ' + chain + ' that holds only the farming stake, and save its recovery phrase offline', cost: 'free', time: '10 minutes' });
    steps.push({ text: 'Move ' + usd(capital) + ' of USDC to ' + chain + (chain === 'Ethereum' ? '' : ' with a bridge or a direct exchange withdrawal'), cost: 'about ' + usd(Math.max(1, capital * 0.001) + gas * 2) + ' in fees', time: '15 minutes' });
    steps.push({ text: fill(book.act), cost: usd(capital) + ' of capital stays at work, plus ' + usd(gas * 3) + ' of gas', time: '20 minutes' });
    steps.push({ text: fill(book.weekly), cost: 'about ' + usd(gas * 2 * 4) + ' of gas a month', time: '10 minutes a week' });
    if (p.chains.length > 1) {
      var second = p.chains.filter(function (c) { return c !== chain; }).sort(function (a, b) { return gasOf(a) - gasOf(b); })[0];
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

  // Farm, thin or skip: the drop the stake can expect (value x airdrop share x stake's share of TVL x
  // launch odds) against everything the plan costs over its hold.
  function verdict(plan, implied, tvl, odds) {
    var perDollar = implied * CONST.airdrop_share / tvl * odds;
    var expected = plan.capital * perDollar;
    var fees = plan.setup_cost + plan.monthly_cost * plan.hold_days / 30;
    var ratio = expected / fees;
    return {
      expected_usd: expected, fees_usd: fees, ratio: ratio,
      call: ratio >= CONST.farm_ratio ? 'farm' : ratio >= CONST.thin_ratio ? 'thin' : 'skip',
      breakeven_stake_usd: perDollar > 0 ? fees / perDollar : null
    };
  }

  // ---------------------------------------------------------------- the radar

  function build(snapshot) {
    var protocols = snapshot.protocols;
    var live = liveTokens(protocols, snapshot.as_of);
    var fit = fitValue(live);
    var odds = launchOdds(protocols, snapshot.as_of);
    var sib = siblings(protocols);
    var watch = {};
    snapshot.watchlist.forEach(function (s) { watch[s] = true; });
    var rows = [], aside = [];
    protocols.forEach(function (p) {
      var status = tokenStatus(p);
      if (status === 'live') return;
      if (status === 'recorded') { aside.push({ slug: p.slug, name: p.name, reason: 'token on record, no market cap' }); return; }
      var sibling = sib[brandOf(p.name)] || null;
      var why = watch[p.slug] ? null : setAsideReason(p) || (sibling ? 'sibling of a token that trades' : null);
      if (why) { aside.push({ slug: p.slug, name: p.name, reason: why }); return; }
      var age = ageDays(snapshot.as_of, p.listed_at);
      var subject = { tvl_usd: p.tvl_usd, category: p.category, change_7d: p.change_7d, age_days: age };
      var core = fit.predict(subject);
      var parts = fit.parts(subject);
      var implied = Math.max(1, Math.round(core));
      var od = odds.of(p.category, age);
      var plan = farmPlan(p);
      rows.push({
        slug: p.slug, name: p.name, category: p.category, family: familyOf(p.category), chains: p.chains,
        tvl_usd: p.tvl_usd, change_7d: p.change_7d, listed_at: p.listed_at, age_days: age,
        tier: watch[p.slug] ? 'watchlist' : 'early',
        token_status: 'pre-token',
        sibling: sibling,
        implied_value_usd: implied,
        range_usd: [Math.round(implied / fit.held_out.model), Math.round(implied * fit.held_out.model)],
        model: { fitted_core: core, implied_multiple: core / p.tvl_usd, family_level: fit.family_levels[familyOf(p.category)], size_curve: core / parts.family / parts.growth / parts.age / parts.undated, parts: parts },
        launch_odds: od.odds,
        odds_parts: od,
        airdrop_per_1k: implied * CONST.airdrop_share * 1000 / p.tvl_usd,
        plan: plan,
        verdict: verdict(plan, implied, p.tvl_usd, od.odds),
        farm_steps: null
      });
      var row = rows[rows.length - 1];
      plan.steps.push(verdictStep(row.verdict, plan));
      row.farm_steps = plan.steps.map(stepText);
    });
    rows.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1); });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    return { rows: rows, live: live, aside: aside, fit: fit, odds: odds, constants: CONST, protocols: protocols.length };
  }

  var api = { build: build, liveTokens: liveTokens, fitValue: fitValue, farmPlan: farmPlan, verdict: verdict, stepText: stepText, tokenStatus: tokenStatus, familyOf: familyOf, CONST: CONST, VERSION: 'radar-fit-3' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RadarModel = api;
})(this);
