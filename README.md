# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/tdlu1972/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/tdlu1972/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar ranks the DefiLlama protocols that record no token by what a launch would be worth, and gives each one a costed farm plan.

**The value model** (`dashboard/model.js`, run by both the page and `main.ts`) is fitted on the snapshot's own traded tokens, one row per ticker (Aave V2, V3, V4 and Horizon share AAVE, so AAVE's cap is set against all of their TVL). A ridge regression of ln(market cap) on ln(TVL) and a family level (vaults, credit, trading, real world, network) gives the size curve: cap grows as TVL^0.53, so a small protocol is worth a larger multiple of its TVL than a large one. Every traded token is priced by a fit that never saw it: the median miss is 3.2x, against 5.0x for a flat multiple. Seven-day momentum and time run with no token adjust the fitted core by bounded rule, since fitted on traded tokens they do not cut the held-out miss.

**Launch odds** combine the share of a protocol's category and of its age band that already record a token. **Farm verdicts** set the stake's expected drop (value x 7.5% airdrop x the stake's share of TVL x odds) against every fee its plan costs on the protocol's cheapest chain: farm, thin or skip, with the stake at which fees are covered.

**The board** covers the 40-protocol watchlist and holds the protocols below the $50M floor to the house's own rule: no wrapped, staked, bridged, versioned or exchange products, and no sibling of a token that trades (GMX Solana beside GMX). The page re-runs the model and checks itself on screen: watchlist coverage, all 758 protocols accounted for, rank order, and every row recomputed to the dollar of board.json.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
open out/dashboard/index.html   # the page reads ../data.js, no network
./shoot.sh screenshots          # headless Chrome captures of the four views
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=psm22q7h&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
