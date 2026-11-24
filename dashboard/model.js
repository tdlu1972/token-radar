// Launch Radar model: one function scores every protocol, in the page and in main.ts alike.
// Classic script: the page reads it as window.RadarModel, main.ts requires it as CommonJS.
(function (root) {
  'use strict';

  var DAY = 86400000;

  // Category -> family. A category with few priced peers borrows its family's multiple.
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
    shrink_k: 5,            // pseudo-peers pulling a thin category toward its family, a family toward all
    peer_min: 0.01,
    peer_max: 5,
    multiple_min: 0.03,
    multiple_max: 3,
    growth_floor: -50,
    growth_cap: 100,
    growth_weight: 0.35,    // momentum = exp(weight * tanh(growth / 30))
    ramp_days: 540,         // maturity climbs to its peak over the first 18 months
    peak_until: 1095,       // and holds it to 3 years
    fade_until: 2190,       // then fades to its floor by 6 years with no token
    maturity_start: 0.7,
    maturity_peak: 1.15,
    maturity_old: 0.85,
    reach_step: 0.03,       // +3% for each chain past the first, at most ten
    airdrop_share: 0.075,   // share of a launch's value a points campaign typically hands out
    capital_usd: 500        // the stake every farm plan is costed at
  };

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
  function liveTokens(protocols) {
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
      out.push({ slug: lead.slug, name: lead.name, symbol: lead.symbol || key, category: lead.category, chains: lead.chains, change_7d: lead.change_7d,
        mcap_usd: lead.mcap_usd, tvl_usd: tvl, products: group.length, multiple: lead.mcap_usd / tvl });
    });
    return out.sort(function (a, b) { return b.mcap_usd - a.mcap_usd; });
  }

  // Peer multiples (market cap / TVL) from the snapshot's own live tokens, shrunk in log space:
  // category -> family -> every live token.
  function calibrate(protocols, live) {
    // Each peer's multiple is held to [peer_min, peer_max] first, so one outlier cannot carry a category.
    var logs = live.map(function (t) { return Math.log(clamp(t.multiple, CONST.peer_min, CONST.peer_max)); });
    var all = median(logs);
    var byFam = {}, byCat = {}, rawCat = {};
    live.forEach(function (t, i) {
      (byFam[familyOf(t.category)] = byFam[familyOf(t.category)] || []).push(logs[i]);
      (byCat[t.category] = byCat[t.category] || []).push(logs[i]);
      (rawCat[t.category] = rawCat[t.category] || []).push(t.multiple);
    });
    var k = CONST.shrink_k;
    function shrink(xs, prior) { return xs && xs.length ? (xs.length * median(xs) + k * prior) / (xs.length + k) : prior; }
    var fam = {};
    Object.keys(FAMILY).concat(['other']).forEach(function (f) { fam[f] = shrink(byFam[f], all); });
    var cats = {};
    protocols.forEach(function (p) {
      var c = p.category;
      if (c in cats) return;
      var xs = byCat[c] || [];
      cats[c] = {
        category: c,
        family: familyOf(c),
        peers: xs.length,
        raw: xs.length ? median(rawCat[c]) : null,
        family_multiple: Math.exp(fam[familyOf(c)]),
        multiple: clamp(Math.exp(shrink(xs, fam[familyOf(c)])), CONST.multiple_min, CONST.multiple_max)
      };
    });
    return { global: Math.exp(all), live: live.length, families: Object.keys(fam).reduce(function (o, f) { o[f] = Math.exp(fam[f]); return o; }, {}), categories: cats };
  }

  // Launch odds: the share of a category's protocols in the snapshot that already record a token
  // (Laplace-smoothed). Shown beside the value, never folded into it.
  function launchOdds(protocols) {
    var t = {}, n = {};
    protocols.forEach(function (p) {
      n[p.category] = (n[p.category] || 0) + 1;
      if (tokenStatus(p) !== 'pre') t[p.category] = (t[p.category] || 0) + 1;
    });
    var odds = {};
    Object.keys(n).forEach(function (c) { odds[c] = ((t[c] || 0) + 1) / (n[c] + 2); });
    return odds;
  }

  function momentum(change) {
    var g = clamp(change === null ? 0 : change, CONST.growth_floor, CONST.growth_cap);
    return { growth: g, mult: Math.exp(CONST.growth_weight * Math.tanh(g / 30)) };
  }

  function maturity(age) {
    var C = CONST;
    if (age === null) return 1;
    if (age <= C.ramp_days) return C.maturity_start + (C.maturity_peak - C.maturity_start) * age / C.ramp_days;
    if (age <= C.peak_until) return C.maturity_peak;
    if (age <= C.fade_until) return C.maturity_peak - (C.maturity_peak - C.maturity_old) * (age - C.peak_until) / (C.fade_until - C.peak_until);
    return C.maturity_old;
  }

  function reach(chains) { return 1 + CONST.reach_step * Math.min(Math.max(chains - 1, 0), 10); }

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

  function stepText(s) { return s.text + '. Cost: ' + s.cost + '. Time: ' + s.time + '.'; }

  // ---------------------------------------------------------------- the radar

  function build(snapshot) {
    var protocols = snapshot.protocols;
    var live = liveTokens(protocols);
    var cal = calibrate(protocols, live);
    var odds = launchOdds(protocols);
    var sib = siblings(protocols);
    var watch = {};
    snapshot.watchlist.forEach(function (s) { watch[s] = true; });
    var rows = [], aside = [];
    protocols.forEach(function (p) {
      var status = tokenStatus(p);
      if (status === 'live') return;
      if (status === 'recorded') { aside.push({ slug: p.slug, name: p.name, reason: 'token on record (' + (p.symbol || p.gecko_id) + '), no market cap' }); return; }
      var sibling = sib[brandOf(p.name)] || null;
      var why = watch[p.slug] ? null : setAsideReason(p) || (sibling ? 'sibling of a token that trades' : null);
      if (why) { aside.push({ slug: p.slug, name: p.name, reason: why }); return; }
      var cat = cal.categories[p.category];
      var age = ageDays(snapshot.as_of, p.listed_at);
      var mo = momentum(p.change_7d);
      var ma = maturity(age);
      var re = reach(p.chains.length);
      var implied = Math.max(1, Math.round(p.tvl_usd * cat.multiple * mo.mult * ma * re));
      var plan = farmPlan(p);
      rows.push({
        slug: p.slug, name: p.name, category: p.category, family: cat.family, chains: p.chains,
        tvl_usd: p.tvl_usd, change_7d: p.change_7d, listed_at: p.listed_at, age_days: age,
        tier: watch[p.slug] ? 'watchlist' : 'early',
        token_status: 'pre-token',
        sibling: sibling,
        implied_value_usd: implied,
        model: { peer_multiple: cat.multiple, peers: cat.peers, growth_pct: mo.growth, momentum: mo.mult, maturity: ma, reach: re },
        launch_odds: odds[p.category],
        airdrop_per_1k: implied * CONST.airdrop_share * 1000 / p.tvl_usd,
        plan: plan,
        farm_steps: plan.steps.map(stepText)
      });
    });
    rows.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1); });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    return { rows: rows, live: live, aside: aside, calibration: cal, constants: CONST };
  }

  var api = { build: build, liveTokens: liveTokens, calibrate: calibrate, farmPlan: farmPlan, stepText: stepText, momentum: momentum, maturity: maturity, reach: reach, tokenStatus: tokenStatus, familyOf: familyOf, CONST: CONST, VERSION: 'radar-peer-1' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RadarModel = api;
})(this);
