# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/tdlu1972/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/tdlu1972/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar ranks the DefiLlama protocols that record no token by what a launch would be worth, and gives each one a costed farm plan.

**The value model** (`dashboard/model.js`, run by both the page and `main.ts`) prices each pre-token protocol against the tokens that already trade in the same snapshot. Every live token gets one market-cap-to-TVL multiple, its cap over the TVL of every product that carries its ticker (Aave V2, V3, V4 and Horizon share AAVE). The median multiple of a category is shrunk in log space toward its family's (vaults, credit, trading, real world, network), and the family's toward the whole market, so a category with one priced peer cannot carry its rows. Implied value is TVL × that multiple × seven-day momentum × a maturity curve over the months run with no token × chain reach. Launch odds (the share of a category's protocols that already record a token) and the airdrop a $1,000 stake would earn sit beside the value, never inside it.

**The board** covers the 40-protocol watchlist and holds the protocols below the $50M floor to the house's own rule: no wrapped, staked, bridged, versioned or exchange products, and no sibling of a token that trades (GMX Solana beside GMX). Live tokens are listed on their own tab at the market's value.

**Farm plans** pick the protocol's cheapest chain, size the stake, and cost every step in gas, capital and time.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
open out/dashboard/index.html   # the page reads ../data.js, no network
./shoot.sh screenshots          # headless Chrome captures of the four views
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=psm22q7h&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
