# Changelog

Notable changes, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.4.1] — 2026-10-31

### Changed

- README: current screenshots (card with Copy, viewer in both themes) and a
  dagre/ELK comparison of the same diagram with the measured delta; a Settings
  table for both preference rows; a Benchmarks section.
- `CREDITS.md` ships with the package and records both external contributions
  (pull request #1 and the Mermaid 12 / ELK fork), including what was not adopted
  and why.

## [0.4.0] — 2026-10-31

### Added

- **ELK layout by default.** Diagrams are layered with Mermaid's compact engine.
  Measured on the corpus in `test/bench/` it costs 5–20 ms per diagram (and is
  faster on the 150-node case) while cutting the width of wide diagrams by 31–79%
  — the difference between reading a diagram and panning it.
- **Settings → General → Diagram layout**: *Compact* (ELK, default) or *Standard*
  (dagre). Switching re-draws the diagrams already on screen.
- A layout the engine cannot handle falls back to dagre once and reports
  `render-fallback`, instead of showing a failed card.
- `test/bench/`: a reproducible benchmark (corpus, CDP runner, results) used to
  choose the default and to re-check it on every runtime upgrade.

### Changed

- Mermaid **12.2.0** (was 11.17.0). The vendored runtime grows from 3.5 MB to
  5.4 MB; because rendering is on demand, that is paid on the first diagram a
  reader asks for, not at page load (+22 ms of module load, +1.92 MB).
- The SVG cache key includes the layout engine and a renderer signature, so
  switching layouts or upgrading the runtime never serves a stale diagram.

### Credits

- The ELK direction, its before/after evidence, the license handling and the
  in-card toolbar prototype came from
  [Songyanglin-curious's fork](https://github.com/Songyanglin-curious/dsh-mermaid-plus);
  the default-always mode and the Redux palettes were not adopted, for the reasons
  in issue #2. See [`CREDITS.md`](CREDITS.md).

### Licensing

- The bundle now inlines ELK (EPL-2.0, unmodified). `vendor/elkjs.LICENSE` and
  `THIRD-PARTY-NOTICES.md` ship with the package; the plugin's own code stays MIT.

## [0.3.2] — 2026-10-31

### Fixed

- **The settings row and the composer status row never appeared.** Each waited on
  an ancestor slot (`settings.section`, `conversation.composer.bar`) and then
  registered into a child slot that did not exist yet, so the registration was
  attempted too early. Both now wait on the slot they actually register into.
  A registration that fails now reports `slot-ok` / `slot-throw` with its entry id,
  so a missing row is visible in the support log instead of silently absent.
- The test suite asserts that every registration waits on its own slot, which is
  the invariant that would have caught this.

## [0.3.1] — 2026-10-30

### Fixed

- A render queued for one diagram source could land after the source had changed
  (streaming edit a fence faster than Mermaid lays it out) and be shown as if it
  were current. Stale results are now dropped and the card renders again. The same
  guard covers a card released or re-adopted while its render was in flight.
- The SVG cache key now includes the renderer configuration, so changing layout,
  themes or the Mermaid version cannot serve a diagram produced by the previous
  configuration within one session.

### Credits

- The render-validity guards, the cache-versioning idea and the Windows build fix
  came from [Songyanglin-curious's Mermaid 12 / ELK fork](https://github.com/Songyanglin-curious/dsh-mermaid-plus);
  see [`CREDITS.md`](CREDITS.md).

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
