# Read broken CSV files faster — a faster csv-reader 1.0.0

[![bounty](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/haoye2023/makefun-csv-entry/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/haoye2023/makefun-csv-entry/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

Entry for the make.fun bounty [Read broken CSV files faster, 21 November
2026](https://make.fun/bounty/csv-reader-speed-01-run-20261121).

`solve.js` is a dependency-free ES module whose `run(input)` returns, for every input
`{text, header}`, exactly the answer csv-reader 1.0.0 returns — `{columns, rows,
errors}` under the same broken-row policy (BOM handling, quoted fields with `""`
escapes, `quote_junk`, `unterminated_quote`, `stray_cr`, `short_row` / `long_row`, and
error records `{code, line, row}` in the order met). `main.ts` is the harness driver:
it reads every case from `/input/cases.json`, answers each with `run`, and writes
`/output/answers.json`.

Where the reference reader walks one character at a time and builds each field a
character at a time, this reader scans the text once and moves whole runs of plain
text with `indexOf` / `charCodeAt` and `slice`, so a plain field costs one pass and
one slice instead of one step per character. On the kit's practice set (6 cases,
≈10.2M characters) it answers every case identically to the reference and runs the
parse about **7.8× faster** in CPU time (measured in-process with
`process.cpuUsage`, Node 24).

Run it the way the harness does:

    MAKEFUN_INPUT_DIR=/input MAKEFUN_OUTPUT_DIR=/output node main.ts
