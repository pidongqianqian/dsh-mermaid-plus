# Credits

This plugin exists because people read its output, reported what broke, and built
alternatives worth learning from. Two contributions shaped the current design;
neither author is a maintainer, and both should be visible here rather than only
in a comment thread.

## Dunianggg — pull request #1

<https://github.com/pidongqianqian/dsh-mermaid-plus/pull/1> · merged for **0.3.0**

- **Coexistence with another Mermaid renderer.** A block another renderer claimed
  (`data-mermaid-processed`) or echoed back as a source `<pre>` inside its own card
  was adopted again, producing two cards for one fence. The skip rules came from
  this PR.
- **The code-block frame problem.** A Mermaid fence sits inside the application's
  `.md-code-block` frame, so the card nested inside a second frame. The PR replaced
  the frame; we refined it to adopt the frame instead of deleting it, which kept the
  syntax highlighting and the copy affordance.
- **`suppressErrorRendering: true`.** Mermaid leaves its own "Syntax error" graphic
  in the page when a parse fails; this PR found it.
- **The composer status row wrapping** one character per line in a narrow dock.
- Its tests became the basis for the frame and coexistence cases in this repository.

## Songyanglin-curious — the Mermaid 12 / ELK fork

<https://github.com/Songyanglin-curious/dsh-mermaid-plus> · informed **0.3.1** and **0.4.0**

- **The ELK direction.** The fork was the first to run Mermaid 12's ELK layout
  against real diagrams and to document the improvement with before/after
  screenshots (SimForge architecture: ~2386×1487 → ~1263×1585). That evidence is
  what started the benchmark here, and its result is why ELK is the default layout.
- **Render-validity guards.** Two checks in the fork — a card released or re-adopted
  mid-render, and a source that changed while a render was queued — are bugs we had
  not covered. They shipped in 0.3.1 with tests.
- **Cache-key versioning.** Including the renderer configuration in the cache key
  (the fork used `mermaid-12.2.0-elk-neo-redux-v1`) became `RENDER_SIGNATURE` here.
- **The Windows build fix.** Replacing the `node_modules/.bin/esbuild` spawn with
  the esbuild JS API; shipped in 0.3.1 with a `windows-latest` CI job.
- **The EPL-2.0 handling.** The fork shipped `vendor/elkjs.LICENSE` and recorded the
  license decision in its notes; that is the shape of `THIRD-PARTY-NOTICES.md` here.
- **In-card toolbar prototype** (zoom, fit, 1:1, fullscreen, SVG/PNG export) — not
  shipped yet, and still open for a pull request (issue #2).

Not adopted, deliberately, with the reasons recorded in issue #2:

- `DEFAULT_MODE = 'always'` and the `mode.v2` preference that bypasses the previous
  choice — this plugin keeps on-demand rendering as its default.
- Replacing the theme variables with Neovim/Redux palettes — the plugin follows the
  application's `--dsw-*` design tokens; the layout engine is independent of that.

## Reporting

Bug reports with a minimal diagram source are contributions too. If you reported a
problem and it is not named here, that is an omission rather than a decision — open
an issue or a pull request and it will be added.
