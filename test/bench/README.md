# Layout benchmark

A small, offline benchmark used to decide between Mermaid's layout engines and to
measure what a Mermaid upgrade costs. It answers two questions with numbers
instead of reputation:

1. **How much slower is ELK than dagre** on diagrams people actually render?
2. **What does Mermaid 12 cost** at load time and per diagram, compared with the
   Mermaid 11 runtime this repository ships?

The benchmark is deliberately not a UX test: it measures time and SVG geometry,
not legibility. Widths and heights are a proxy for "does this diagram force
horizontal panning", which is the complaint ELK addresses.

## Prepare the runtimes

```sh
node test/bench/build-runtimes.mjs
```

This copies the shipped Mermaid 11 runtime to `.runtimes/mermaid11.esm.min.mjs`,
installs `mermaid@12.2.0` under `.runtimes/` and bundles it exactly as
`build.mjs` does. `.runtimes/` is ignored by git; nothing here is published.

## Run

```sh
node test/bench/run.mjs                            # v11 dagre, v12 dagre, v12 elk
node test/bench/run.mjs mermaid12.esm.min.mjs:elk  # one configuration
```

Needs a Chrome/Chromium binary (`CHROME_BIN` overrides the search). The runner
drives a real browser over CDP with the **real clock**: a `--virtual-time-budget`
harness is easier but makes the numbers meaningless, because virtual time
advances timers without waiting for CPU work.

Each diagram is rendered once as a warm-up, then three times; the reported number
is the median. `import` is the cost of loading the runtime, `init` the cost of
`mermaid.initialize`, both measured once per configuration.

## Corpus

| id | shape |
|---|---|
| `small` | 5-node flowchart |
| `medium20` | 20-node layered flowchart |
| `wide40` | long left-to-right chain (dagre spreads it) |
| `large60` | 60-node flowchart |
| `simforge` | a real 20-node architecture diagram (`test/e2e/simforge.mmd`) |
| `sequence` | sequence diagram (layout-independent) |
| `er` | 6-entity ER diagram |
| `huge150` | 150-node flowchart |
| `dense40` | 40 nodes, ~150 edges (edge-heavy) |

## Limits

- One machine, warm module cache, localhost HTTP. A cold start adds disk time.
- Fonts are whatever the browser has; different metrics change layout time.
- Three runs is enough to see a 10% difference, not enough for a publication.
- The card's own rendering (CSS, scrolling) is out of scope.

The measurements taken on 2026-10-31 are in [results.md](results.md).
