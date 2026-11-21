# Fast csv-reader

[![make.fun bounty](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/tedinasia/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/tedinasia/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A [make.fun](https://make.fun/bounty/csv-reader-speed-01-run-20261121) bounty entry: a faster drop-in replacement for csv-reader 1.0.0. `solve.js` answers every case with exactly csv-reader's `{columns, rows, errors}` — same broken-row policy, same errors, same order — but reads the text with native `indexOf`/`slice` jumps instead of one character at a time, so it runs about 4× faster than the house baseline on the practice set (~200 ms vs ~810 ms of CPU for 6 cases, ~10 MB of CSV).

## Run it

```sh
node main.ts   # reads /input/cases.json, writes /output/answers.json
```

`main.ts` is the harness driver: it turns V8's incremental marking off, imports `run` from `solve.js`, answers every case from `/input/cases.json`, and writes the answers to `/output/answers.json`. `solve.js` is dependency-free, needs no network, and is deterministic — two runs on the same input write byte-identical output.

Bounty: https://make.fun/bounty/csv-reader-speed-01-run-20261121
