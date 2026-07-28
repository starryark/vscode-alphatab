# Test fixtures

Recorded output from the real Piano-to-Guitar CLIs. The point of recording rather than
hand-writing them is that the adapter's job is to parse *what those tools actually emit* — I got
the `mapResults` shape wrong the first time by guessing at field names, so these exist to stop
that recurring.

## Re-recording

From a Piano-to-Guitar checkout (`C:\Users\lyang\Code\Music\Piano-to-Guitar`):

```sh
# tool-fixture derived — safe to record verbatim
node tools/playability.mjs tools/fixtures/position-jump-slow.alphatab --json  > playability-warnings-only.json
node tools/playability.mjs tools/fixtures/non-adjacent-dyad.alphatab  --json  > playability-error.json
node tools/validate.mjs    tools/fixtures/broken-syntax.alphatab      --json  > validate-broken.json
node tools/validate.mjs    tools/fixtures/overfull-voice.alphatab     --json  > validate-overfull.json

# project derived — MUST be scrubbed, see below
cd projects/your-love-is-a-drug
node ../../tools/check.mjs cover.alphatab --bars 1-8  --digest source.json --json                        > check-baraligned.json
node ../../tools/check.mjs cover.alphatab --bars 1-59 --map sidecar.json --digest source.json --json     > check-map-fail.json
cd ../liezhijiuba
node ../../tools/check.mjs cover.alphatab --bars 1-108 --map sidecar.json --digest source.json \
     --contract melody-contract.json --json                                                             > check-map-pass.json
```

## Scrubbing

The three `check-*.json` files come from real arrangements of copyrighted pieces. Piano-to-Guitar
gitignores `projects/*` for that reason, so these are scrubbed before being committed here:

- `stats.title` → `Fixture A` / `Fixture B`
- pitch-class sequences inside gate failure messages → `[<N pitch classes elided>]`

Nothing the tests assert on is affected — they check structure (`mode`, `tabBars`, `ok`,
`failures[].gate`, `failures[].entry`, `hardGates.{covered,total,ok}`), never the music. If you
re-record, scrub again before committing.

## What each one pins

| File | Pins |
|---|---|
| `playability-warnings-only.json` | The exit-code trap: this run really exits **1** with **0 errors and 14 warnings**, so pass/fail must come from `errors.length`, not the exit code. |
| `playability-error.json` | A real error carries `bar`/`beat`, so it can be anchored to a source range. |
| `validate-broken.json` | `errors[]` holds **all three** severities (AT400 hint, AT301 warning, AT202/AT206 error) despite the array's name. |
| `validate-overfull.json` | A bar-fill warning is a warning, not a hard failure. |
| `check-map-pass.json` | The `--map` form has **no** `covered`/`total` — inventing `0/0` here marks every span vacuous. |
| `check-map-fail.json` | A map-mode failure anchors to `entry[0]` (bar 9) and carries its `gate` name. |
| `check-baraligned.json` | The bar-aligned form is where `{covered,total,ok}` lives, and where the `0/0` vacuous-gate guard applies. |
