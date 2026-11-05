## 2026-11-05 · Refetch the transcript when a live event lands past its end

The PWA crashed with `undefined is not an object (evaluating 'e.k')`. A `transcript` event whose index was beyond the loaded transcript left holes in the array, and the transcript view read `.k` of `undefined`. The renderer store now refetches the transcript when the index is past the end (or the event is empty), and drops empty entries when loading.
