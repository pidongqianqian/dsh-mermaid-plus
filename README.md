# dsh-mermaid-plus

[![npm version](https://img.shields.io/npm/v/dsh-mermaid-plus.svg)](https://www.npmjs.com/package/dsh-mermaid-plus)
[![license](https://img.shields.io/npm/l/dsh-mermaid-plus.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.0--rc.2-4b5563)](https://github.com/deepseek-ai/DeepSeek-Harness)
[![install](https://img.shields.io/badge/dsh%20plugin%20add-dsh--mermaid--plus-5b8def)](#install)

Mermaid diagrams for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) — rendered **on demand** by default, so a transcript full of diagrams costs nothing until you ask for one.

[中文说明](#中文说明)

---

## Screenshots

On demand, in a light theme — the source stays until you press **Diagram**:

![A mermaid card showing its source and a Diagram button](https://raw.githubusercontent.com/pidongqianqian/dsh-mermaid-plus/main/docs/card.png)

Fullscreen viewer, light and dark. The sheet takes the palette the diagram was rendered for, so labels stay readable in both themes:

![Fullscreen mermaid viewer on a light sheet](https://raw.githubusercontent.com/pidongqianqian/dsh-mermaid-plus/main/docs/viewer-light.png)

![Fullscreen mermaid viewer on a dark sheet](https://raw.githubusercontent.com/pidongqianqian/dsh-mermaid-plus/main/docs/viewer-dark.png)

## What it does

A fenced ` ```mermaid ` block in the conversation (or in a Markdown file preview) becomes a card:

- **On demand (default)** — the source stays visible and a `Diagram` button waits in the card header. The 3.5 MB Mermaid runtime is **not downloaded** and no layout work happens until you press it.
- **When visible** — a diagram renders the first time its card scrolls into view.
- **Always** — renders as soon as the block appears (the classic behaviour).

Every rendered diagram can be opened **fullscreen** with zoom and pan, which is the point: a wide flowchart squeezed into the message column is unreadable, while the same diagram at natural size is fine.

## Features

- Renders `mermaid`, `mermaidjs`, `mmd` and unlabelled blocks that start with a diagram keyword.
- Supports the diagram types the bundled Mermaid build ships: `flowchart`/`graph`, `sequenceDiagram`, `classDiagram`, `stateDiagram`, `erDiagram`, `gantt`, `pie`, `mindmap`, `journey`, `timeline`, `quadrantChart`, `xychart`, `gitGraph`, `requirementDiagram`, `C4`, `block-beta`, `packet-beta`, `sankey-beta`, `kanban`, `architecture-beta`, and more.
- **Theme-aware**: diagram colours are derived from the app's live design tokens, and a palette change re-renders only the diagrams you are looking at.
- **Streaming-safe**: a block is handed to Mermaid only after its source settles, so a half-written fence never flashes a parse error.
- **Cached**: a rendered diagram is kept by source + palette, so switching between Code and Diagram, or reopening the viewer, costs nothing.
- **Fullscreen viewer**: wheel zoom, drag to pan, double-click to fit, `Esc` to close, focus-trapped dialog, restores focus and page scrolling.
- Falls back to the visible source with a short error line when a diagram does not parse.
- Unmounting restores every code block to its original place in the transcript.

## Install

```sh
dsh plugin --profile <profile> add dsh-mermaid-plus
```

Or install it from a catalog in **Settings → Plugins → Marketplace** (see the [DSH 1024Store](https://github.com/imsai-sh/awesome-deepseek-harness-plugins) listing). Restart the app or reload the page afterwards.

The Mermaid runtime is **bundled** with the package (`vendor/mermaid.esm.min.mjs`, Mermaid 11.17.0) and served from the plugin's own Host route, so rendering works offline and no CDN is contacted. The fullscreen viewer and card never send diagram source anywhere.

## Settings

**Settings → General → Mermaid diagrams** offers the three modes. The choice is stored per page origin and is namespaced by package name, so it never collides with another diagram plugin.

## Compatibility

- Built and verified against DSH `0.2.0-rc.2`; last checked on Desktop `2.0.21-next` (code-block DOM `div.md-code-block > [data-code-block-content] > pre`).
- DSH is a developer preview: client plugin contracts, slot keys, and rendered Markdown can change between releases. This plugin decorates the rendered `<pre><code>` output, which is the part most likely to shift; if a release breaks it, the cards simply stop appearing and the code blocks stay intact.
- Requires a browser or Electron renderer with `IntersectionObserver` (used only in "when visible" mode) and `DOMParser`.

## How it works

- **Host half** (`index.js`) mounts one prefix route that serves the vendored Mermaid ES module. The route is derived from the package name (`/x-dsh-mermaid-plus`), so two diagram plugins can coexist.
- **Browser half** (`client.js`) is a normal DSH client bundle: it registers a root-scoped occupant on `shell.overlay` (which exists before any session), plus a status row and the settings row. It never imports Harness client packages and never touches the model's context.
- Because the shipped Markdown renderer exposes no code-block extension point, the browser half decorates the rendered output: it moves a mermaid `<pre>` into a card it owns, and puts it back on unmount. The original DOM node is preserved, so the transcript, copy, and select all keep working.

## Troubleshooting

The browser half reports lifecycle events to its Host half, which appends them to a bounded log:

```
<os tmp>/dsh-mermaid-plus/report.json
```

It records lifecycle events only — `start`, `apply-ok`, `apply-throw`, `adopted`, `render-ok`, `render-error`, `blocks-unmatched` — with counts, not document text: no diagram source, no file contents, no paths beyond the plugin's own. If diagrams stop appearing, that file plus the browser console (a failed import) usually identifies the cause.

## Development

The plugin has no build step for its own code: `index.js` and `client.js` run as they are. Only `vendor/mermaid.esm.min.mjs` is generated, and only when the bundled Mermaid version changes.

```sh
npm install                 # mermaid 11.17.0, esbuild, jsdom
node build.mjs              # rebuild vendor/mermaid.esm.min.mjs
node test/run.mjs           # host route, real cordis mount, jsdom browser-half behaviour
node test/serve-e2e.mjs     # then open http://127.0.0.1:8732/ for 35 real-browser cases
node tools/doctor.mjs       # activation, install mode, last browser events
node tools/dev-sync.mjs     # copy this checkout over an npm-installed copy
```

[`docs/development.md`](docs/development.md) covers the debug loop, what each symptom means, and the release flow.

## License

MIT. Bundled Mermaid is MIT; see `vendor/mermaid.LICENSE`.

---

## 中文说明

把对话（以及 Markdown 预览）里的 ` ```mermaid ` 代码块渲染成图表卡片。

**默认按需渲染**：代码块保持源码可见，卡片右上角有一个「图形」按钮；在你点它之前，Mermaid 那个约 3.5 MB 的运行时不会被下载，也不做任何布局计算。另外两种模式是「滚动可见」（卡片进入视口才渲染）和「立即」（出现即渲染）。

渲染后的图表可以**全屏放大**：滚轮缩放、拖动平移、双击适应窗口、`Esc` 关闭；全屏只克隆已有 SVG，不会重新渲染。

其他特性：

- 配色取自应用当前的 `--dsw-*` 设计令牌，明暗主题各自适配；主题切换只重绘你正在看的图。
- 流式输出期间不会渲染半截源码。
- 渲染结果按「配色 + 源码」缓存，切换「代码/图形」或重开全屏都是零成本。
- 解析失败时保留源码并给一行错误提示。
- 卸载时把每个代码块放回原位，不破坏对话内容。

模式开关在 **设置 → 通用 → Mermaid 图表**。Mermaid 运行时随包内置（11.17.0），由插件自己的 Host 路由提供，**不访问 CDN、离线可用**，图表源码不会发往任何地方。

兼容 DSH `0.2.0-rc.2`。DSH 处于开发者预览阶段，客户端插件契约可能变化；本插件装饰渲染后的 `<pre><code>`，是最容易受影响的一层——若某次升级后卡片不再出现，代码块本身仍然完好。

排障：浏览器半侧会把生命周期事件报告给 Host，写入 `<系统临时目录>/dsh-mermaid-plus/report.json`（`start` / `adopted` / `render-ok` / `render-error` / `apply-ok` / `apply-throw`）。
