# Changelog

Notable changes, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.1] — 2026-10-30

### Fixed

- A render queued for one diagram source could land after the source had changed
  (streaming edit a fence faster than Mermaid lays it out) and be shown as if it
  were current. Stale results are now dropped and the card renders again. The same
  guard covers a card released or re-adopted while its render was in flight.
- The SVG cache key now includes the renderer configuration, so changing layout,
  themes or the Mermaid version cannot serve a diagram produced by the previous
  configuration within one session.

### Changed

- `build.mjs` uses the esbuild JavaScript API instead of spawning
  `node_modules/.bin/esbuild`, which is a shell script plus a `.cmd` wrapper on
  Windows. Rebuilding `vendor/` on Windows now works and produces byte-identical
  output. CI builds it on `windows-latest` and verifies reproducibility on Linux.

## [0.3.0] — 2026-10-30

### Added

- A Copy action on the diagram card, replacing the code-block frame's toolbar
  (see below).
- `data-dsh-mermaid-action` on the card's buttons (`view`, `copy`, `expand`).

### Changed

- The application's own code-block frame (`div.md-code-block`) is adopted, not
  deleted: the card takes the frame's place, keeps its syntax-highlighted body and
  hides only its duplicate label/toolbar. The frame is restored whole on unmount.
  This applies to the chat transcript and the document preview, which share the
  same renderer component.
- Blocks already claimed by another Mermaid renderer (`data-mermaid-processed`)
  and source echoes inside someone else's card are left alone, so two renderers no
  longer produce two cards for one fence.
- Mermaid runs with `suppressErrorRendering: true`: a parse error no longer leaves
  Mermaid's own error graphic in the page.
- Tests use the renderer's real DOM shape; the browser suite is 41 cases.

### Fixed

- The card nested inside the preview's code-block frame, showing two headers.
- The composer status row wrapped one character per line in a narrow dock.

## [0.2.6] — 2026-10-17

### Changed

- The support log records event names and counts only; it no longer samples
  document text. Removed the temporary diagnostics used to find the document
  preview's block shape.

## [0.2.2] — 2026-10-17

### Fixed

- A Mermaid fence in the right-side document preview showed no card: decorations
  were keyed on `pre > code`, but that renderer emits the source directly in a
  `<pre>`. Detection now keys on the `<pre>` itself.

## [0.2.0] — 2026-10-16

### Changed

- The repository root is the installable package (the marketplace crawler reads
  `<repo>/package.json`; the manifest used to live under `bundle/`).

## [0.1.0] — 2026-10-15

### Added

- First published release: on-demand rendering, three render modes, theme-aware
  palette, fullscreen zoom viewer, `zh` locale.
