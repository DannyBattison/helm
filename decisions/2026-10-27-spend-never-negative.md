## 2026-10-27 · Spend is never negative

A resumed session's SDK `total_cost_usd` counts from the start of that run (and is 0 when nothing is reported, as on a subscription), but it was compared with the session's whole running cost, so the correction came out hugely negative and was written to the daily usage. Corrections now add the cost at the start of the run, a zero total leaves the estimate alone, and the spend report treats any negative stored day as zero.
