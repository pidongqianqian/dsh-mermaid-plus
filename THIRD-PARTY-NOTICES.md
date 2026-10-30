# Third-party notices

The published package bundles the following third-party code into a single file,
`vendor/mermaid.esm.min.mjs`, which the plugin's Host half serves locally. Nothing
is fetched from a CDN.

## Mermaid

- Version: 12.2.0
- License: MIT — see [`vendor/mermaid.LICENSE`](vendor/mermaid.LICENSE)
- Source: <https://github.com/mermaid-js/mermaid>

## ELK (elkjs)

- Version: 0.9.3, a dependency of Mermaid that our bundling step inlines
- License: Eclipse Public License 2.0 — see [`vendor/elkjs.LICENSE`](vendor/elkjs.LICENSE)
- Source: <https://github.com/kieler/elkjs>
- Modifications: **none**. The code is bundled unmodified; the plugin only selects
  it through Mermaid's `initialize({ layout: 'elk' })` and falls back to Mermaid's
  own dagre layout when ELK cannot lay a diagram out.

## What this means for redistribution

This plugin's own code is MIT (see [`LICENSE`](LICENSE)); Mermaid is MIT as well.
The vendored bundle is a combined work, and the ELK portions in it remain under
EPL-2.0:

- The EPL text ships with the package and is served at the same local route as the
  runtime.
- The ELK source corresponding to the bundled version is available at the URL
  above; the bundled copy is unmodified.
- If you modify ELK, you must make that modified source available under EPL-2.0.
- Do not describe the whole package as MIT-only when redistributing the bundled
  runtime; this file is the notice to carry with it.
