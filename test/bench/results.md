# Layout benchmark results

Measured 2026-10-31 with `test/bench/run.mjs`, Node 22, headless Chrome on macOS
(arm64). Median of three render runs per diagram after one warm-up; times are
milliseconds. `W×H` is the outer SVG viewBox.

| diagram | v11 dagre | v12 dagre | v12 ELK |
|---|---|---|---|
| `small` (5) | 11 ms · 630×164 | 11 ms · 774×152 | 17 ms · 744×142 |
| `medium20` | 42 ms · 825×758 | 42 ms · 930×710 | 50 ms · 830×740 |
| `wide40` | 40 ms · 247×1946 | 39 ms · 370×1826 | 48 ms · 360×1636 |
| `large60` | 125 ms · 2136×2144 | 122 ms · 2035×2012 | 117 ms · 1696×2282 |
| `simforge` (20, real) | 44 ms · 2392×1440 | 47 ms · 1956×1624 | 53 ms · **1249×1833** |
| `sequence` (10 msgs) | 8 ms · 1050×603 | 8 ms · 1050×653 | 7 ms · 1050×653 |
| `er` (6) | 15 ms · 871×459 | 15 ms · 871×459 | 27 ms · **549×459** |
| `huge150` | 340 ms · 6075×6104 | 337 ms · 5748×5732 | 297 ms · **3970×6242** |
| `dense40` (~130 edges) | 139 ms · 4399×3926 | 143 ms · 5059×3686 | 154 ms · **1038×4936** |

Runtime load, measured once per configuration:

| runtime | bytes | `import` | `initialize` |
|---|---|---|---|
| Mermaid 11.17 (shipped) | 3.53 MB | 57 ms | 2 ms |
| Mermaid 12.2 + ELK | 5.45 MB | 79 ms | 2 ms |

## What the numbers say

**ELK is not slow where it matters.** Against Mermaid 12 dagre the per-diagram
difference is +5 to +20 ms on ordinary diagrams. On `huge150` ELK is *faster*
(297 vs 337 ms); on `dense40` it is 11 ms slower (154 vs 143). The reputation for
slowness comes from much larger graphs than these.

**The compactness gain is the headline.** Wide diagrams are exactly where reading
breaks down in a chat column, and there ELK cuts width sharply:

- `simforge` 1956 → 1249 px (−36%), matching the community fork's screenshots
- `er` 871 → 549 px (−37%)
- `dense40` 5059 → 1038 px (−79%)
- `huge150` 5748 → 3970 px (−31%)

Height grows in exchange (`simforge` 1624 → 1833, `dense40` 3686 → 4936). A
narrower, taller diagram scrolls naturally with the page; a wide one forces
horizontal panning, which is the worse failure for a card in a conversation.

**The upgrade costs one load-time hit.** +22 ms of module import and +1.92 MB on
disk. Because rendering is on-demand, that is paid on the first diagram a reader
asks for, not on page load. For a first render that is roughly +30 ms total
(`simforge`: 47+57 → 53+79).

**Layout-independent diagram types are unaffected.** `sequence` is identical in
both engines; only flowcharts, ER and similar graph diagrams move.

## Recommendation

- Upgrade to a pinned Mermaid 12.2.0 and make **ELK the default layout**; keep
  dagre selectable as "standard" for readers who prefer it or hit a pathological
  input.
- Keep the plugin's own theme tokens; the benchmark used Mermaid's default theme,
  and the fork's Neovim/Redux palettes are a separate visual decision.
- The EPL-2.0 obligation for bundled ELK becomes live: ship
  `vendor/elkjs.LICENSE`, a third-party notice with the version and source, and
  keep the package's own license as MIT.
- Re-check the default when the runtime or the corpus changes; this file is meant
  to be updated, not archived.
