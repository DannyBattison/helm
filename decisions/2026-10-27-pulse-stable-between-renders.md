## 2026-10-27 · Pulsing dots keep one animation value between renders

The clock-synced pulse was recomputed on every render, so each re-render gave the dot a new animation delay and restarted it: running dots flickered and drifted out of step. `usePulse` now computes it once per element (while pulsing), still phase-locked to the clock at mount.
