# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/tdlu1972/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/tdlu1972/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar ranks the DefiLlama protocols that record no token by what a launch would be worth, and gives each one a costed farm plan.

**Implied value = value if it launches x launch odds**, both from `dashboard/model.js`, which the page and `main.ts` both run.

**Value if it launches** is fitted on the snapshot's own traded tokens, one row per ticker (Aave V2, V3 and Horizon share AAVE, so AAVE's cap is set against all of their TVL). A ridge regression of ln(market cap) on ln(TVL) gives the size curve: cap grows as TVL^0.53. Every other term (family level, 7-day TVL growth, years tracked, and a control that is a fixed random number per protocol) goes through two blind tests: leave-one-out over all 127 tokens, and walk-forward, fit on the 71 listed first and scored on the 24 listed since April 2025. A term stays only if it cuts the leave-one-out median miss by 1% and walk-forward does not rise. None does: family (walk-forward 3.16x to 3.98x) and age (to 3.72x) win leave-one-out and lose forward in time, and the random control wins leave-one-out too (3.42x to 3.33x) before walk-forward rejects it (to 3.54x). That is the reason for two tests. The size curve misses by 3.16x on the newest tokens against 4.44x for a flat multiple. The printed ranges are quantiles of the signed held-out misses; on the newest tokens, 46% of real caps land inside P25-P75 and 71% inside P10-P90 (stated 50% and 80%).

**Launch odds** are a ridge logistic regression on whether each of the 758 protocols records a token today, with terms chosen the same way: kept only if they lower the held-out log loss on 10-fold and on walk-forward. Years tracked, family, 7-day TVL growth and chain count are kept; TVL size and the control are not. Log loss falls from 0.690 to 0.584 (10-fold) and 0.751 to 0.612 (walk-forward), and protocols grouped by held-out odds record a token at close to the predicted rate (20%, 39%, 63%, 84% predicted against 24%, 37%, 61%, 86% seen). So the brief's three figures all reach the value: TVL through the size curve, growth and time with no token through the odds. **Farm verdicts** set the stake's expected drop (implied value x 7.5% airdrop x the stake's share of TVL) against every fee its plan costs on the protocol's cheapest chain: farm, thin or skip, with the stake at which fees are covered.

**The board** covers the 40-protocol watchlist and holds the protocols below the $50M floor to the house's own rule: no wrapped, staked, bridged, versioned or exchange products, no sibling of a token that trades (GMX Solana beside GMX), and no venue of its own chain (Stellar AMM on Stellar). Watchlist protocols caught by those rules stay on the board, tagged. A ledger puts every one of the 758 protocols in one group, and the page re-runs the model and checks itself on screen: every row recomputed to the dollar of board.json, rank order, implied = if it launches x odds, watchlist coverage, and the control rejected by both models.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
open out/dashboard/index.html   # the page reads ../data.js, no network
./shoot.sh screenshots          # headless Chrome captures of the four views (then quantized to 256 colours)
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=psm22q7h&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
