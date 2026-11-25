# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/tdlu1972/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/tdlu1972/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar ranks the DefiLlama protocols that record no token by what a launch would be worth, and gives each one a costed farm plan.

**The value model** (`dashboard/model.js`, run by both the page and `main.ts`) is fitted on the snapshot's own traded tokens, one row per ticker (Aave V2, V3, V4 and Horizon share AAVE, so AAVE's cap is set against all of their TVL). A ridge regression of ln(market cap) on ln(TVL) gives the size curve: cap grows as TVL^0.53, so a small protocol is worth a larger multiple of its TVL than a large one. Every other snapshot term (family level, 7-day TVL growth, years tracked, a missing listing date) is a candidate, kept only if it cuts the leave-one-out median miss by 1% or more: family level (3.42x to 3.21x) and years tracked (3.21x to 2.97x) are kept; 7-day growth (2.97x to 3.10x) and the missing-date flag are dropped, and the Model tab shows every trial. Every traded token is priced by a fit that never saw it: the median miss is 2.97x, against 5.0x for a flat multiple and 3.42x for the size curve alone. A second blind test runs forward in time: the whole procedure, selection included, is re-run on the 71 oldest dated tokens and scored on the 24 listed since April 2025, which it never saw: 3.16x, against 4.44x for a flat multiple.

**Launch odds** come from the peers' record: the share of comparable protocols that already record a token, combined on the log-odds scale. Which comparisons count is chosen held-out too, on leave-one-out log loss over all 758 protocols: category and years tracked are kept (0.690 to 0.588), and family, TVL size, chain count and 7-day growth are dropped. Grouped by their held-out odds (the Model tab charts it), protocols record a token at close to the rate predicted (14%, 37%, 61%, 83% predicted against 16%, 36%, 64%, 79% seen). **Farm verdicts** set the stake's expected drop (value x 7.5% airdrop x the stake's share of TVL x odds) against every fee its plan costs on the protocol's cheapest chain: farm, thin or skip, with the stake at which fees are covered.

**The board** covers the 40-protocol watchlist and holds the protocols below the $50M floor to the house's own rule: no wrapped, staked, bridged, versioned or exchange products, no sibling of a token that trades (GMX Solana beside GMX), and no venue of its own chain (Stellar AMM on Stellar), whose reward is likelier the chain's token. Watchlist protocols caught by those two rules stay on the board, tagged (Bittensor dTAO on Bittensor). The board opens on the four best farms: the expected drop most times its fees. The page re-runs the model and checks itself on screen: watchlist coverage, all 758 protocols accounted for, rank order, and every row recomputed to the dollar of board.json.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
open out/dashboard/index.html   # the page reads ../data.js, no network
./shoot.sh screenshots          # headless Chrome captures of the four views
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=psm22q7h&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
