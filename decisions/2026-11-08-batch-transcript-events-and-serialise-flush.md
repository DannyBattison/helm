## 2026-11-08 · Batch transcript events in the window; serialise helm.json writes

The window now collects streamed `transcript` events and applies them once per ~16 ms, instead of copying the whole transcript array for every event (quadratic while an agent streams). An out-of-range index still triggers a refetch.

`Store.flush` now runs one write at a time. Before, the debounce timer and `flushAll` could both write `helm.json.tmp` at once and corrupt each other's output. The companion snapshot looks repository names up in a map rather than scanning the repo list for every session.

Not done, left for later: the full `AppState` is still rebuilt and sent every 120 ms and every record is fingerprinted on each save; fixing either means sending diffs, which is a protocol change.
