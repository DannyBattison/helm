## D-11 · 2026-10-23 · Cost tracking and budgets
Cost is the SDK's cumulative `total_cost_usd` from each result message. Between results, an estimate from token usage and list prices is added so a budget can stop a long turn. The session budget and the repository weekly cap both pause the session into "Needs you" with an "Add $5 and resume" action.
Why: results only arrive at the end of a turn, and budgets need to bite during one.
