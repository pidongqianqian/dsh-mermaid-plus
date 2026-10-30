window.__ModuleLoader__.load({
	id: 'dsh-mermaid-plus',
	factory(require) {
		/** Package name; also the boot-graph entry id and the source of every runtime name. */
		const PKG = 'dsh-mermaid-plus';
		/**
		 * Host route serving the vendored runtime, derived from the package name so two
		 * diagram plugins can be installed side by side. The Host half derives the same
		 * value from its own manifest; the two formulas must stay identical.
		 */
		const RUNTIME_PATH = `/x-${PKG.replace(/^@/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
		/** Bundled Mermaid release; part of the URL so a page reload refetches a new build. */
		const RUNTIME_VERSION = '11.17.0';

		/** Report one browser-half event to the Host's sink; a failure here is never fatal. */
		function report(event, detail) {
			try {
				void fetch(`${RUNTIME_PATH}/__report`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ event, detail, href: String(window.location.href), at: Date.now() }),
					// No `keepalive`: on the desktop app's custom scheme the browser
					// drops keepalive requests, and this report is best-effort anyway.
				}).catch(() => undefined);
			} catch {
				/* the report is best effort only */
			}
		}
		try {
			return buildPlugin(require);
		} catch (error) {
			report('factory-throw', String(error?.stack ?? error));
			throw error;
		}

		/** Build the plugin object; separated so the factory can report its own failures. */
		function buildPlugin(require) {
		const React = require('react');
		const h = React.createElement;

		//#region configuration
		/**
		 * Preference key for the render mode. Namespaced by package name so a second
		 * diagram plugin cannot read or overwrite this one's choice.
		 */
		const MODE_KEY = `${PKG}.mode`;
		/** The key this plugin used before it became a published package. */
		const LEGACY_MODE_KEY = 'dsh-mermaid.mode';
		/** Render modes, in the order the settings row offers them. */
		const MODES = ['manual', 'visible', 'always'];
		/**
		 * Default: render nothing until the reader asks.
		 *
		 * The eager modes cost a 3.5 MB runtime plus one layout pass per diagram, and
		 * a transcript can hold dozens. Reading a conversation must not pay that; the
		 * card shows its source and one button instead.
		 */
		const DEFAULT_MODE = 'manual';
		/** Refuse pathological diagrams before they reach Mermaid. */
		const MAX_SOURCE_CHARS = 50000;
		/**
		 * Settle time before streaming source is handed to Mermaid. A manual render is
		 * a direct answer to a click, so it must not feel delayed.
		 */
		const SETTLE_MS = { manual: 0, visible: 400, always: 400 };
		/** Diagrams remembered by source+palette, so re-opening one is instant. */
		const CACHE_LIMIT = 40;
		/** Namespace for the plugin's own locale dictionary. */
		const NS = 'dsh-mermaid';
		//#endregion

		//#region locale
		/** Plugin copy; both built-in languages are registered, the active locale decides. */
		const DICT = {
			zh: {
				title: 'Mermaid 图表',
				code: '代码',
				diagram: '图形',
				showCode: '显示 Mermaid 源码',
				showDiagram: '渲染并显示 Mermaid 图形',
				rendering: '正在渲染图表…',
				renderFailed: '图表渲染失败，已显示源码',
				renderHint: '按需渲染：需要看图时点右侧「图形」',
				expand: '放大',
				expandLabel: '放大查看这张图表',
				close: '关闭',
				zoomIn: '放大',
				zoomOut: '缩小',
				zoomFit: '适应窗口',
				viewerHint: '拖动平移 · 滚轮缩放 · 双击适应窗口 · Esc 关闭',
				copy: '复制',
				copied: '已复制',
				settingsTitle: 'Mermaid 图表',
				modeManual: '手动',
				modeVisible: '滚动可见',
				modeAlways: '立即',
				hintManual: '默认不渲染，点「图形」才生成图表（最省性能）',
				hintVisible: '图表滚入可视区域时才渲染',
				hintAlways: '加载后立即渲染所有图表',
				statusDiagrams: '图表',
				statusFailed: '个失败',
			},
			en: {
				title: 'Mermaid diagram',
				code: 'Code',
				diagram: 'Diagram',
				showCode: 'Show Mermaid source',
				showDiagram: 'Render and show the Mermaid diagram',
				rendering: 'Rendering diagram…',
				renderFailed: 'Diagram failed to render; showing source instead',
				renderHint: 'Rendered on demand — press Diagram when you want to see it',
				expand: 'Expand',
				expandLabel: 'Open this diagram enlarged',
				close: 'Close',
				zoomIn: 'Zoom in',
				zoomOut: 'Zoom out',
				zoomFit: 'Fit to window',
				viewerHint: 'Drag to pan · scroll to zoom · double-click to fit · Esc to close',
				copy: 'Copy',
				copied: 'Copied',
				settingsTitle: 'Mermaid diagrams',
				modeManual: 'On demand',
				modeVisible: 'When visible',
				modeAlways: 'Always',
				hintManual: 'Nothing renders until you press Diagram — the cheapest option',
				hintVisible: 'A diagram renders when it scrolls into view',
				hintAlways: 'Every diagram renders as soon as it appears',
				statusDiagrams: 'diagrams',
				statusFailed: 'failed',
			},
		};

		/** The host context, captured by apply(); the views read the locale through it. */
		let hostCtx = null;

		/** Translate one key through the active locale, falling back to the dictionary. */
		function t(key) {
			try {
				const translate = hostCtx?.get?.('locale')?.bind?.(NS);
				if (typeof translate === 'function') {
					const value = translate(key);
					if (typeof value === 'string' && value !== '' && value !== key) return value;
				}
			} catch {
				/* an unmounted locale service falls back to the dictionary */
			}
			return DICT.en[key] ?? key;
		}
		//#endregion

		//#region preference
		/** Read the render mode; an unknown or unreadable value falls back to manual. */
		function readMode() {
			try {
				const stored = window.localStorage.getItem(MODE_KEY);
				if (MODES.includes(stored)) return stored;
				// One-time migration from the pre-release key, so an existing choice sticks.
				const legacy = window.localStorage.getItem(LEGACY_MODE_KEY);
				if (MODES.includes(legacy)) {
					window.localStorage.setItem(MODE_KEY, legacy);
					return legacy;
				}
				return DEFAULT_MODE;
			} catch {
				return DEFAULT_MODE;
			}
		}

		/** Persist the render mode and apply it to the decorations already on the page. */
		function writeMode(next) {
			if (!MODES.includes(next) || next === hub.snapshot.mode) return;
			try {
				window.localStorage.setItem(MODE_KEY, next);
			} catch {
				/* a page without storage keeps the in-memory value only */
			}
			hub.emit({ mode: next });
			syncReveal();
			// Switching to an eager mode must not leave the page silent; switching to
			// manual leaves anything already rendered alone (it is a sunk cost).
			for (const entry of entries.values()) pump(entry);
		}
		//#endregion

		//#region shared state
		/** Tiny observable the decorator publishes to and the views subscribe from. */
		const hub = {
			snapshot: { mode: readMode(), rendered: 0, failed: 0, error: null },
			listeners: new Set(),
			emit(next) {
				this.snapshot = { ...this.snapshot, ...next };
				for (const listener of [...this.listeners]) {
					try {
						listener();
					} catch {
						/* one bad subscriber must not stop the others */
					}
				}
			},
			subscribe(listener) {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			},
			getSnapshot() {
				return this.snapshot;
			},
		};

		const subscribeHub = (listener) => hub.subscribe(listener);
		const getHubSnapshot = () => hub.getSnapshot();
		//#endregion

		//#region rendering runtime
		/** Current Mermaid runtime generation: its URL, revision, and in-flight load. */
		let runtime = null;

		/**
		 * The vendored Mermaid module, served by this package's Host half.
		 *
		 * This deliberately does not go through `require.async()`: the client-module
		 * loader addresses a package-local chunk as `/plugins/<id>/<file>`, and a
		 * scoped package id contains a `/`, which the Host's chunk route cannot match.
		 * The Host half owns a dedicated route for exactly this reason.
		 * @returns the absolute URL of the module for this page.
		 */
		function runtimeUrl() {
			return new URL(`${RUNTIME_PATH}/mermaid.esm.min.mjs?v=${RUNTIME_VERSION}`, document.baseURI).href;
		}

		/** Load and validate the bundled Mermaid runtime, once per URL. */
		function loadRuntime() {
			if (runtime !== null) return runtime;
			const url = runtimeUrl();
			// A test seam only: the browser always takes the real dynamic import.
			// `import` is a keyword, so the seam and the real path are separate arms.
			runtime = (typeof globalThis.__dshMermaidImport === 'function' ? globalThis.__dshMermaidImport : (specifier) => import(/* @vite-ignore */ specifier))(url)
				.then((module) => {
					const api = module.default ?? module;
					if (typeof api?.initialize !== 'function' || typeof api?.render !== 'function') {
						throw new Error(`${PKG}: bundled Mermaid runtime exposes no initialize()/render()`);
					}
					return api;
				})
				.catch((error) => {
					runtime = null;
					throw new Error(`${PKG}: could not load the vendored runtime from ${url}: ${String(error?.message ?? error)}`);
				});
			return runtime;
		}

		/** Serial queue: Mermaid renders one diagram at a time, and a failure never blocks the next. */
		let queue = Promise.resolve();
		function enqueue(task) {
			const next = queue.then(task, task);
			queue = next.then(
				() => undefined,
				() => undefined,
			);
			return next;
		}

		/** Palette revision; a theme change bumps it and invalidates renders already in flight. */
		let revision = 0;
		//#endregion

		//#region theme
		/** Fallback palette for pages whose design tokens are not readable. */
		const FALLBACK = {
			light: {
				background: '#ffffff',
				primaryColor: '#eef1f8',
				primaryTextColor: '#1b1c1f',
				primaryBorderColor: '#c6cbd8',
				secondaryColor: '#e6e9f2',
				tertiaryColor: '#f4f6fb',
				lineColor: '#8a90a0',
				textColor: '#1b1c1f',
				noteBkgColor: '#fff6d8',
				noteTextColor: '#3a3320',
				noteBorderColor: '#e3cf92',
				actorBkg: '#eef1f8',
				actorBorder: '#c6cbd8',
				actorTextColor: '#1b1c1f',
				actorLineColor: '#8a90a0',
				signalColor: '#1b1c1f',
				signalTextColor: '#1b1c1f',
				labelBoxBkgColor: '#e6e9f2',
				labelBoxBorderColor: '#c6cbd8',
				labelTextColor: '#1b1c1f',
				loopTextColor: '#1b1c1f',
				activationBorderColor: '#8a90a0',
				activationBkgColor: '#e6e9f2',
				sequenceNumberColor: '#ffffff',
				pie1: '#5b8def',
				pie2: '#f2b53c',
				pie3: '#63c9a8',
				pie4: '#e07a8b',
				cScale0: '#5b8def',
				cScale1: '#f2b53c',
				cScale2: '#63c9a8',
				cScale3: '#e07a8b',
			},
			dark: {
				background: '#1b1c1f',
				primaryColor: '#2b2f3a',
				primaryTextColor: '#e8eaf0',
				primaryBorderColor: '#454b5c',
				secondaryColor: '#333846',
				tertiaryColor: '#23262e',
				lineColor: '#8b93a7',
				textColor: '#e8eaf0',
				noteBkgColor: '#4a421f',
				noteTextColor: '#f4ecd0',
				noteBorderColor: '#6b5f2c',
				actorBkg: '#2b2f3a',
				actorBorder: '#454b5c',
				actorTextColor: '#e8eaf0',
				actorLineColor: '#8b93a7',
				signalColor: '#e8eaf0',
				signalTextColor: '#e8eaf0',
				labelBoxBkgColor: '#333846',
				labelBoxBorderColor: '#454b5c',
				labelTextColor: '#e8eaf0',
				loopTextColor: '#e8eaf0',
				activationBorderColor: '#8b93a7',
				activationBkgColor: '#333846',
				sequenceNumberColor: '#1b1c1f',
				pie1: '#7aa2f7',
				pie2: '#e0af68',
				pie3: '#73daca',
				pie4: '#f7768e',
				cScale0: '#7aa2f7',
				cScale1: '#e0af68',
				cScale2: '#73daca',
				cScale3: '#f7768e',
			},
		};

		/** One resolved design token, or undefined when the page does not define it. */
		function token(styles, name) {
			const value = styles.getPropertyValue(name).trim();
			return value === '' ? undefined : value;
		}

		/** Read the live palette from the app's design tokens; `scheme` is a coarse dark-mode hint. */
		function readPalette(scheme) {
			const fallback = scheme === 'dark' ? FALLBACK.dark : FALLBACK.light;
			let styles;
			try {
				styles = window.getComputedStyle(document.documentElement);
			} catch {
				return { palette: { ...fallback }, dark: scheme === 'dark', signature: `${scheme}|fallback` };
			}
			const pick = (name, key) => token(styles, name) ?? fallback[key];
			const base = pick('--dsw-alias-bg-base', 'background');
			const layer1 = pick('--dsw-alias-bg-layer-1', 'primaryColor');
			const layer2 = pick('--dsw-alias-bg-layer-2', 'secondaryColor');
			const border = pick('--dsw-alias-border-l2', 'primaryBorderColor');
			const label = pick('--dsw-alias-label-primary', 'primaryTextColor');
			const secondary = pick('--dsw-alias-label-secondary', 'lineColor');
			const brand = pick('--dsw-alias-brand-primary', 'pie1');
			const warn = pick('--dsw-alias-state-warn-primary', 'pie2');
			const success = pick('--dsw-alias-state-success-primary', 'pie3');
			const error = pick('--dsw-alias-state-error-primary', 'pie4');
			return {
				dark: scheme === 'dark',
				// The cache key of every rendered diagram: same signature, same colours.
				signature: [scheme, base, label, border, brand, layer1, layer2].join('|'),
				palette: {
					...fallback,
					background: base,
					primaryColor: layer1,
					primaryBorderColor: border,
					primaryTextColor: label,
					secondaryColor: layer2,
					tertiaryColor: base,
					lineColor: secondary,
					textColor: label,
					actorBkg: layer1,
					actorBorder: border,
					actorTextColor: label,
					actorLineColor: secondary,
					signalColor: label,
					signalTextColor: label,
					labelBoxBkgColor: layer2,
					labelBoxBorderColor: border,
					labelTextColor: label,
					loopTextColor: label,
					activationBorderColor: border,
					activationBkgColor: layer2,
					pie1: brand,
					pie2: warn,
					pie3: success,
					pie4: error,
					cScale0: brand,
					cScale1: warn,
					cScale2: success,
					cScale3: error,
				},
			};
		}

		/** The page's color scheme, preferring the app's own signal over the OS media query. */
		function currentScheme() {
			let styles;
			try {
				styles = window.getComputedStyle(document.documentElement);
			} catch {
				return 'light';
			}
			if (styles.colorScheme === 'dark') return 'dark';
			if (styles.colorScheme === 'light') return 'light';
			try {
				return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
			} catch {
				return 'light';
			}
		}
		//#endregion

		//#region diagram detection
		/** Fence languages that mean "this block is Mermaid". */
		const MERMAID_LANGS = new Set(['mermaid', 'mermaidjs', 'mmd', 'mermaid.js']);

		/** First-line diagram keywords: the fallback for blocks the renderer left unlabelled. */
		const DIAGRAM_KEYWORD =
			/^\s*(?:%%\{|flowchart|graph|sequenceDiagram|classDiagram(?:-v2)?|stateDiagram(?:-v2)?|erDiagram|gantt|pie|mindmap|journey|timeline|quadrantChart|xychart(?:-beta)?|gitGraph|requirementDiagram|C4\w*|block-beta|packet-beta|sankey-beta|kanban|architecture-beta|zenuml|radar-beta|treemap)\b/;

		/**
		 * Whether one `<pre>` holds a Mermaid fence.
		 *
		 * Keyed on the `<pre>`, not a `<code>` child: the chat renderer wraps the
		 * source in `<pre><code>`, while other renderers (a document preview's plain
		 * text view, for instance) put it straight into a `<pre>`. Both are the same
		 * thing to a reader.
		 * @param pre - candidate block element.
		 * @returns whether its source looks like a rendered Mermaid diagram.
		 */
		function isMermaidBlock(pre) {
			if (pre.namespaceURI !== 'http://www.w3.org/1999/xhtml') return false;
			if (pre.tagName !== 'PRE') return false;
			const code = pre.querySelector('code');
			for (const element of code === null ? [pre] : [code, pre]) {
				for (const value of [
					element.getAttribute('data-lang'),
					element.getAttribute('data-language'),
					element.getAttribute('lang'),
				]) {
					if (typeof value === 'string' && MERMAID_LANGS.has(value.trim().toLowerCase())) return true;
				}
				for (const name of element.classList) {
					if (!name.startsWith('language-')) continue;
					if (MERMAID_LANGS.has(name.slice('language-'.length).toLowerCase())) return true;
				}
			}
			const source = (code ?? pre).textContent ?? '';
			if (source.length > MAX_SOURCE_CHARS * 4) return false;
			return DIAGRAM_KEYWORD.test(source);
		}
		//#endregion

		//#region decorator
		/** Package-owned stylesheet; inserted while the decoration is active. */
		const CSS = `
.dsh-mdm{--dsh-mdm-border:var(--dsw-alias-border-l1,#0000001a);position:relative;margin:12px 0;border:1px solid var(--dsh-mdm-border);border-radius:10px;background:var(--dsw-alias-bg-base,transparent);overflow:hidden}
.dsh-mdm-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;height:32px;padding:0 8px 0 10px;border-bottom:1px solid var(--dsh-mdm-border)}
.dsh-mdm-ttl{font-size:11px;line-height:1;color:var(--dsw-alias-label-secondary,#6b7280);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-mdm-btn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);font:inherit;font-size:11px;line-height:1;padding:5px 9px;border-radius:6px;cursor:pointer}
.dsh-mdm-btn:hover{background:var(--dsw-alias-bg-layer-2,#0000000d);color:var(--dsw-alias-label-primary,#111827)}
.dsh-mdm-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#247bbf);outline-offset:1px}
.dsh-mdm-btn:disabled{opacity:.55;cursor:default}
.dsh-mdm-btn[hidden]{display:none}
.dsh-mdm-diagram{cursor:zoom-in}
.dsh-mdm-lb{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;background:rgba(8,10,14,.86);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}
.dsh-mdm-lb-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;color:#f2f5fa;flex:none}
.dsh-mdm-lb-title{font-size:12px;line-height:1;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-mdm-lb-tools{display:flex;align-items:center;gap:4px;flex:none}
.dsh-mdm-lb-zoom{min-width:46px;text-align:center;font-size:11px;line-height:1;opacity:.85;font-variant-numeric:tabular-nums}
.dsh-mdm-lb-btn{appearance:none;border:1px solid rgba(255,255,255,.24);background:rgba(255,255,255,.08);color:inherit;font:inherit;font-size:12px;line-height:1;padding:7px 10px;border-radius:8px;cursor:pointer}
.dsh-mdm-lb-btn:hover{background:rgba(255,255,255,.17)}
.dsh-mdm-lb-btn:focus-visible{outline:2px solid #8ab4f8;outline-offset:2px}
.dsh-mdm-lb-stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;touch-action:none;cursor:grab}
.dsh-mdm-lb-stage[data-dragging="true"]{cursor:grabbing}
.dsh-mdm-lb-canvas{transform-origin:center center;will-change:transform;flex:none;padding:24px;border-radius:14px;box-sizing:content-box;box-shadow:0 18px 60px rgba(0,0,0,.5)}
.dsh-mdm-lb-canvas svg{display:block;width:100%;height:100%;max-width:none}
.dsh-mdm-lb-hint{padding:0 14px 12px;font-size:11px;line-height:1.4;color:rgba(242,245,250,.6);text-align:center;flex:none}
@media (prefers-reduced-motion: no-preference){.dsh-mdm-lb{animation:dsh-mdm-in .15s ease-out}}
.dsh-mdm-pill{appearance:none;border:1px solid var(--dsw-alias-border-l1,#d9dde5);background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);font:inherit;font-size:12px;line-height:1;padding:6px 10px;border-radius:999px;cursor:pointer;transition:background .12s ease,color .12s ease}
.dsh-mdm-pill:hover{background:var(--dsw-alias-bg-layer-2,#0000000d);color:var(--dsw-alias-label-primary,#111827)}
.dsh-mdm-pill[aria-checked="true"]{background:var(--dsw-alias-bg-layer-2,#eef1f8);color:var(--dsw-alias-label-primary,#111827);font-weight:600}
.dsh-mdm-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#247bbf);outline-offset:2px}
@media (prefers-reduced-motion: reduce){.dsh-mdm-pill{transition:none}}
.dsh-mdm-body{padding:12px}
.dsh-mdm-diagram[hidden],.dsh-mdm-content[hidden],.dsh-mdm-source[hidden]{display:none}
.dsh-mdm-diagram{display:flex;justify-content:center;overflow-x:auto}
.dsh-mdm-svg{width:100%}
.dsh-mdm-svg svg{display:block;width:100%;height:auto;max-width:100%}
.dsh-mdm-msg{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#6b7280)}
.dsh-mdm-source:not([hidden]) + .dsh-mdm-content:not([hidden]) .dsh-mdm-msg{margin-top:8px}
.dsh-mdm-err{margin:8px 0 0;color:var(--dsw-alias-state-error-primary,#c0392b);white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:18px}
.dsh-mdm-source{margin:0}
.dsh-mdm-source pre{margin:0;padding:0;border:0;background:transparent;overflow:visible}
.dsh-mdm-source code{font-size:12px}
/* The application's own code-block frame is adopted, not deleted: flatten it so
   the card's chrome is the only frame, while its syntax highlighting survives. */
.dsh-mdm-source .md-code-block{background:transparent;border:0;box-shadow:none;border-radius:0;padding:0;margin:0}
`;

		/** Live decorations, keyed by their `<code>` element. */
		const entries = new Map();
		/** Mounted views asking for decoration; decoration stops when the last one unmounts. */
		let watchers = 0;
		let observer = null;
		let paletteTimer = null;
		let paletteKey = '';
		let sweepTimer = null;
		let scanTimer = null;
		let unmatchedReports = 0;
		let lastStraySignature = '';
		let uid = 0;

		/** Live `<pre>` blocks that are not decorated yet. */
		function candidates() {
			const found = [];
			for (const pre of document.querySelectorAll('pre')) {
				if (entries.has(pre)) continue;
				// Never adopt a block that already lives inside a rendered card: a
				// re-render can hand back the moved node, and a second diagram plugin
				// (ours or another one) must not wrap an existing card again.
				if (pre.closest('[data-dsh-mermaid]') !== null) continue;
				// Another renderer may have claimed the block already. Marking the
				// block is the only signal it can give us: without this, a transcript
				// that also runs a second Mermaid renderer gets two cards per fence.
				if (pre.closest('[data-mermaid-processed]') !== null) continue;
				// A failed render elsewhere often echoes the source back as a <pre>
				// inside its own card. That echo is not a fence of its own.
				if (pre.closest('[class*="mermaidCode"], [class*="mermaidError"]') !== null) continue;
				if (isMermaidBlock(pre)) found.push(pre);
			}
			return found;
		}

		/** Rendered diagrams by `${palette}|${source}`, so re-opening one is instant. */
		const svgCache = new Map();
		/** Signature of the design tokens the cached SVGs were rendered with. */
		let paletteSignature = '';
		/** Observes card visibility while the mode is `visible`. */
		let reveal = null;

		/** Remember one rendered diagram, evicting the oldest beyond the limit. */
		function remember(key, svg) {
			if (svgCache.has(key)) svgCache.delete(key);
			svgCache.set(key, svg);
			while (svgCache.size > CACHE_LIMIT) svgCache.delete(svgCache.keys().next().value);
		}

		/** Whether this entry is allowed to render under the current mode. */
		function wanted(entry) {
			const mode = hub.snapshot.mode;
			if (mode === 'always') return true;
			if (mode === 'visible') return entry.revealed;
			return entry.asked;
		}

		/** Render now if the mode allows it and the source settled; never duplicates work. */
		function pump(entry, { immediate = false } = {}) {
			if (!wanted(entry)) return;
			if (entry.promise !== null) return;
			if (entry.state === 'ok') return;
			if (immediate) {
				if (entry.timer !== null) {
					window.clearTimeout(entry.timer);
					entry.timer = null;
				}
				render(entry);
				return;
			}
			schedule(entry);
		}

		/** How many decorations are in one terminal state. */
		function countState(state) {
			let total = 0;
			for (const entry of entries.values()) if (entry.state === state) total += 1;
			return total;
		}

		/**
		 * Apply the visibility contract.
		 *
		 * The source is shown until a diagram exists and the reader asked for it; the
		 * button therefore means "render this" before the first render and
		 * "switch view" afterwards.
		 */
		function paint(entry) {
			const diagram = entry.state === 'ok' && entry.view === 'diagram';
			entry.pre.hidden = diagram;
			entry.source.hidden = diagram;
			entry.diagram.hidden = !diagram;
			entry.content.hidden = entry.source.hidden && entry.diagram.hidden;
			if (entry.state === 'error') entry.msg.textContent = t('renderFailed');
			else if (entry.state === 'rendering') entry.msg.textContent = t('rendering');
			else if (entry.state === 'pending') entry.msg.textContent = '';
			else if (entry.state === 'idle') entry.msg.textContent = t('renderHint');
			else entry.msg.textContent = '';
			entry.msg.hidden = entry.state === 'ok' || entry.state === 'pending';
			if (entry.button !== null) {
				const showingDiagram = entry.state === 'ok' && entry.view === 'diagram';
				entry.button.textContent = showingDiagram ? t('code') : t('diagram');
				entry.button.setAttribute('aria-label', showingDiagram ? t('showCode') : t('showDiagram'));
				entry.button.disabled = entry.state === 'rendering';
			}
			if (entry.expand !== null) entry.expand.hidden = entry.state !== 'ok';
			entry.root?.setAttribute('data-dsh-mermaid-state', entry.state);
		}

		/** Keep a diagram readable when it is wider than the column, without resizing the code block. */
		function applyZoom(entry) {
			if (entry.diagram.hidden || entry.content.clientWidth === 0) {
				entry.canvas.style.width = '';
				entry.canvas.style.transform = '';
				return;
			}
			const available = entry.content.clientWidth;
			const natural = entry.canvas.scrollWidth;
			if (natural > available + 2) entry.canvas.style.transform = `scale(${available / natural})`;
			else entry.canvas.style.transform = '';
			entry.canvas.style.width = '';
		}

		/** Build the toolbar and the diagram card that accompany one code block. */
		function buildCard(entry) {
			const bar = document.createElement('div');
			bar.className = 'dsh-mdm-bar';
			const title = document.createElement('div');
			title.className = 'dsh-mdm-ttl';
			title.textContent = t('title');
			const expand = document.createElement('button');
			expand.type = 'button';
			expand.className = 'dsh-mdm-btn';
			expand.setAttribute('data-dsh-mermaid-action', 'expand');
			expand.hidden = true;
			expand.textContent = t('expand');
			expand.setAttribute('aria-label', t('expandLabel'));
			expand.title = t('expandLabel');
			expand.addEventListener('click', () => openLightbox(entry));

			const copy = document.createElement('button');
			copy.type = 'button';
			copy.className = 'dsh-mdm-btn';
			copy.setAttribute('data-dsh-mermaid-action', 'copy');
			copy.textContent = t('copy');
			copy.setAttribute('aria-label', t('copy'));
			copy.addEventListener('click', () => {
				// The card replaces the frame's toolbar, so it owes the same action.
				void copyText(entry.pre.textContent ?? '');
				copy.textContent = t('copied');
				window.setTimeout(() => {
					copy.textContent = t('copy');
				}, 1200);
			});

			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'dsh-mdm-btn';
			button.setAttribute('data-dsh-mermaid-action', 'view');
			button.addEventListener('click', () => {
				// Already rendered: this is a plain view switch over the cached SVG.
				if (entry.state === 'ok') {
					entry.view = entry.view === 'diagram' ? 'code' : 'diagram';
					paint(entry);
					applyZoom(entry);
					return;
				}
				// Nothing rendered yet: the click is the request itself.
				entry.asked = true;
				entry.view = 'diagram';
				pump(entry, { immediate: true });
			});
			const tools = document.createElement('div');
			tools.className = 'dsh-mdm-tools';
			tools.append(button, copy, expand);
			bar.append(title, tools);

			const body = document.createElement('div');
			body.className = 'dsh-mdm-body';
			const source = document.createElement('div');
			source.className = 'dsh-mdm-source';
			const content = document.createElement('div');
			content.className = 'dsh-mdm-content';
			const message = document.createElement('p');
			message.className = 'dsh-mdm-msg';
			message.setAttribute('role', 'status');
			const diagram = document.createElement('div');
			diagram.className = 'dsh-mdm-diagram';
			const canvas = document.createElement('div');
			canvas.className = 'dsh-mdm-svg';
			diagram.append(canvas);
			// Double-click is the gesture people try first on a small diagram.
			diagram.addEventListener('dblclick', () => openLightbox(entry));
			const error = document.createElement('p');
			error.className = 'dsh-mdm-err';
			content.append(message, diagram, error);
			body.append(source, content);

			const root = document.createElement('div');
			root.className = 'dsh-mdm';
			root.setAttribute('data-dsh-mermaid', PKG);
			root.append(bar, body);

			entry.button = button;
			entry.expand = expand;
			entry.copy = copy;
			entry.body = body;
			entry.source = source;
			entry.content = content;
			entry.canvas = canvas;
			entry.diagram = diagram;
			entry.msg = message;
			entry.error = error;
			return root;
		}

		/** Attach one decoration, moving the code block inside our card. */
		function adopt(pre) {
			if (pre.parentElement == null) return;
			/**
			 * Both the chat renderer and the document preview wrap a fence in the
			 * application's `.md-code-block` frame (a language label plus a copy
			 * toolbar). The card takes the frame's place and adopts the frame itself,
			 * so the source keeps the application's highlighting and copy affordances
			 * instead of the card nesting inside a second frame.
			 */
			const frame = pre.closest('.md-code-block');
			const holder = frame !== null && frame.parentElement !== null ? frame : pre;
			const entry = {
				pre,
				state: 'idle',
				view: 'diagram',
				hash: '',
				promise: null,
				timer: null,
				asked: false,
				revealed: false,
				root: null,
				resize: null,
				frame: null,
				hiddenChrome: [],
			};
			entry.root = buildCard(entry);
			holder.parentElement.insertBefore(entry.root, holder);
			entry.source.append(holder === pre ? pre : frame);
			if (holder !== pre) {
				entry.frame = frame;
				// The frame's own label and toolbar would stack on the card's header.
				// Hide every direct child except the code body; the card owns the chrome
				// and offers the same copy action.
				for (const child of [...frame.children]) {
					if (child.hasAttribute('data-code-block-content')) continue;
					child.hidden = true;
					entry.hiddenChrome.push(child);
				}
			}
			entries.set(pre, entry);
			paint(entry);
			if (typeof ResizeObserver === 'function') {
				entry.resize = new ResizeObserver(() => applyZoom(entry));
				entry.resize.observe(entry.body);
			}
			// Observe the card itself: a diagram below the fold must not render.
			if (reveal !== null) reveal.observe(entry.root);
			pump(entry);
		}

		/** Debounce one block so streaming source settles before Mermaid sees it. */
		function schedule(entry) {
			const delay = SETTLE_MS[hub.snapshot.mode] ?? 0;
			if (entry.timer !== null) window.clearTimeout(entry.timer);
			entry.timer = window.setTimeout(() => {
				entry.timer = null;
				render(entry);
			}, delay);
		}

		/** Render (or re-render) one decoration when its source or the palette changed. */
		function render(entry) {
			if (!entry.pre.isConnected) return;
			const source = entry.pre.textContent ?? '';
			if (source.trim() === '') {
				entry.state = 'pending';
				paint(entry);
				return;
			}
			if (source.length > MAX_SOURCE_CHARS) {
				entry.state = 'error';
				entry.error.textContent = `${source.length} > ${MAX_SOURCE_CHARS} characters`;
				paint(entry);
				return;
			}
			const scheme = currentScheme();
			const palette = readPalette(scheme);
			paletteSignature = palette.signature;
			entry.surface = palette.palette.background;
			entry.surfaceDark = palette.dark;
			const key = `${paletteSignature}\u0000${source}`;
			if (key === entry.hash && entry.state === 'ok') return;
			entry.hash = key;
			// A diagram already produced for this source and palette costs nothing.
			const cached = svgCache.get(key);
			if (cached !== undefined) {
				entry.canvas.replaceChildren(svgFragment(cached));
				entry.state = 'ok';
				paint(entry);
				applyZoom(entry);
				hub.emit({ rendered: countState('ok'), failed: countState('error'), error: null });
				return;
			}
			if (entry.promise !== null) return;
			entry.state = 'rendering';
			entry.error.textContent = '';
			paint(entry);
			const expected = revision;
			entry.promise = enqueue(async () => {
				const mermaid = await loadRuntime();
				mermaid.initialize({
					startOnLoad: false,
					securityLevel: 'strict',
					htmlLabels: false,
					// A parse error makes Mermaid inject its own "Syntax error in text"
					// graphic into a container it appends to <body>; when render() then
					// throws, nothing removes that container and the graphic stays on
					// screen. Our own card already shows the error and the source.
					suppressErrorRendering: true,
					flowchart: { htmlLabels: false },
					theme: palette.dark ? 'dark' : 'default',
					themeVariables: palette.palette,
					fontFamily: 'inherit',
					deterministicIds: false,
					logLevel: 'fatal',
				});
				return await mermaid.render(`dsh-mdm-${++uid}`, source);
			});
			entry.promise.then(
				(result) => {
					entry.promise = null;
					if (!entry.pre.isConnected) return;
					if (expected !== revision) {
						// The palette moved while this render was queued; ask again.
						entry.hash = '';
						entry.state = 'idle';
						paint(entry);
						pump(entry);
						return;
					}
					if (typeof result?.svg !== 'string' || result.svg === '') {
						throw new Error('mermaid produced an empty diagram');
					}
					remember(key, result.svg);
					entry.surface = palette.palette.background;
					entry.surfaceDark = palette.dark;
					entry.canvas.replaceChildren(svgFragment(result.svg));
					entry.state = 'ok';
					paint(entry);
					applyZoom(entry);
					report('render-ok', { chars: source.length, svg: result.svg.length });
					hub.emit({ rendered: countState('ok'), failed: countState('error'), error: null });
				},
				(error) => {
					entry.promise = null;
					if (expected !== revision) return;
					const message = String(error?.message ?? error).slice(0, 400);
					console.error(`${PKG}: diagram failed to render`, error);
					entry.state = 'error';
					entry.error.textContent = message;
					paint(entry);
					report('render-error', { chars: source.length, message: message.slice(0, 300) });
					hub.emit({ rendered: countState('ok'), failed: countState('error'), error: message.slice(0, 200) });
				},
			);
		}

		/**
		 * Copy text, preferring the async clipboard and falling back to a selection.
		 *
		 * The desktop shell may not grant the clipboard API to a custom scheme, so the
		 * fallback is not optional here.
		 * @param text - the source to copy.
		 * @returns a promise that settles when the attempt finished.
		 */
		async function copyText(text) {
			try {
				if (navigator.clipboard?.writeText !== undefined) {
					await navigator.clipboard.writeText(text);
					return;
				}
			} catch {
				/* fall through to the selection path */
			}
			const area = document.createElement('textarea');
			area.value = text;
			area.setAttribute('readonly', '');
			area.style.position = 'fixed';
			area.style.opacity = '0';
			document.body.append(area);
			area.select();
			try {
				document.execCommand('copy');
			} catch {
				/* nothing else to try; the source stays selectable */
			}
			area.remove();
		}

		/** Parse Mermaid's SVG output and hand back one live node with no navigable links. */
		function svgFragment(markup) {
			const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
			const node = parsed.documentElement;
			if (node === null || node.nodeName !== 'svg') throw new Error('mermaid produced invalid SVG');
			const imported = document.importNode(node, true);
			for (const anchor of imported.querySelectorAll('a')) {
				const href = anchor.getAttribute('href') ?? anchor.getAttribute('xlink:href') ?? '';
				if (!/^https?:/i.test(href)) anchor.replaceWith(...anchor.childNodes);
			}
			return imported;
		}

		//#region viewer
		/** The one open fullscreen viewer, or null. */
		let lightbox = null;

		/**
		 * Force a colour to be opaque.
		 *
		 * A translucent surface would let the dark backdrop through and defeat the
		 * point, so an `rgba()` value below full alpha falls back to the theme's solid
		 * base. Hex and named colours are opaque by definition.
		 * @param color - any CSS colour string from the design tokens.
		 * @param dark - whether the dark fallback applies.
		 * @returns an opaque colour string.
		 */
		function opaqueSurface(color, dark) {
			const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i.exec(color);
			if (match === null) return color;
			const raw = match[4];
			const alpha = raw === undefined ? 1 : raw.endsWith('%') ? Number.parseFloat(raw) / 100 : Number.parseFloat(raw);
			if (alpha >= 1) return color;
			return dark ? '#1b1c1f' : '#ffffff';
		}

		/** The surface a diagram should sit on, from its own record or the live tokens. */
		function knownSurface(entry) {
			const dark = typeof entry?.surfaceDark === 'boolean' ? entry.surfaceDark : currentScheme() === 'dark';
			if (typeof entry?.surface === 'string' && entry.surface !== '') {
				return { color: opaqueSurface(entry.surface, dark), dark };
			}
			let color = '';
			try {
				color = window.getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-bg-base').trim();
			} catch {
				color = '';
			}
			return { color: opaqueSurface(color === '' ? '#ffffff' : color, dark), dark };
		}

		/** A diagram's natural size, read from its viewBox with sane fallbacks. */
		function naturalSize(svg) {
			const box = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
			if (box.length === 4 && box.every((value) => Number.isFinite(value)) && box[2] > 0 && box[3] > 0) {
				return { width: box[2], height: box[3] };
			}
			const width = Number.parseFloat(svg.getAttribute('width') ?? '');
			const height = Number.parseFloat(svg.getAttribute('height') ?? '');
			return {
				width: Number.isFinite(width) && width > 0 ? width : 800,
				height: Number.isFinite(height) && height > 0 ? height : 600,
			};
		}

		/** Close the open viewer, restoring focus and page scrolling. */
		function closeLightbox() {
			if (lightbox === null) return;
			const box = lightbox;
			lightbox = null;
			box.root.remove();
			document.removeEventListener('keydown', box.onKey, true);
			window.removeEventListener('resize', box.onResize);
			document.body.style.overflow = box.bodyOverflow;
			box.previous?.focus?.({ preventScroll: true });
		}

		/**
		 * Show one rendered diagram filling the viewport, with zoom and pan.
		 *
		 * The card scales an SVG down to the column width, which is unreadable for
		 * anything wide. This opens a clone at its natural size instead, so a dense
		 * flowchart stays legible without changing the transcript layout.
		 * @param entry - the decoration whose diagram to show.
		 */
		function openLightbox(entry) {
			const source = entry.canvas.querySelector('svg');
			if (entry.state !== 'ok' || source === null) return;
			closeLightbox();
			// Duck-typed on purpose: the viewer must not depend on a global that a
			// test realm (or an older engine) may not expose.
			const active = document.activeElement;
			const previous = active !== null && typeof active?.focus === 'function' ? active : null;
			const bodyOverflow = document.body.style.overflow;
			const size = naturalSize(source);

			const root = document.createElement('div');
			root.className = 'dsh-mdm-lb';
			root.setAttribute('role', 'dialog');
			root.setAttribute('aria-modal', 'true');
			root.setAttribute('aria-label', t('title'));

			const bar = document.createElement('div');
			bar.className = 'dsh-mdm-lb-bar';
			const title = document.createElement('div');
			title.className = 'dsh-mdm-lb-title';
			title.textContent = t('title');
			const tools = document.createElement('div');
			tools.className = 'dsh-mdm-lb-tools';

			const mkButton = (label, text) => {
				const button = document.createElement('button');
				button.type = 'button';
				button.className = 'dsh-mdm-lb-btn';
				button.setAttribute('aria-label', label);
				button.textContent = text;
				button.title = label;
				tools.append(button);
				return button;
			};
			const out = mkButton(t('zoomOut'), '\u2212');
			const level = document.createElement('span');
			level.className = 'dsh-mdm-lb-zoom';
			level.setAttribute('role', 'status');
			tools.append(level);
			const into = mkButton(t('zoomIn'), '+');
			const fitButton = mkButton(t('zoomFit'), t('zoomFit'));
			const closeButton = mkButton(t('close'), '\u00d7');
			closeButton.style.fontSize = '16px';
			closeButton.style.padding = '4px 10px';
			bar.append(title, tools);

			const stage = document.createElement('div');
			stage.className = 'dsh-mdm-lb-stage';
			const canvas = document.createElement('div');
			canvas.className = 'dsh-mdm-lb-canvas';
			canvas.style.width = `${size.width}px`;
			canvas.style.height = `${size.height}px`;
			// Paint the palette this diagram was rendered for. Without it the
			// transparent SVG sits on the dark backdrop and dark labels vanish.
			const surface = knownSurface(entry);
			canvas.style.background = surface.color;
			canvas.style.border = `1px solid ${surface.dark ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.08)'}`;
			canvas.setAttribute('data-dsh-mermaid-surface', surface.dark ? 'dark' : 'light');
			const clone = source.cloneNode(true);
			clone.style.width = '100%';
			clone.style.height = '100%';
			clone.style.maxWidth = 'none';
			canvas.append(clone);
			stage.append(canvas);
			const hint = document.createElement('div');
			hint.className = 'dsh-mdm-lb-hint';
			hint.textContent = t('viewerHint');
			root.append(bar, stage, hint);
			document.body.append(root);
			document.body.style.overflow = 'hidden';

			/** Current scale and translation of the diagram inside the stage. */
			const view = { scale: 1, tx: 0, ty: 0, fit: 1, min: 0.1, max: 8 };

			/** Repaint the transform and the percentage readout. */
			const apply = () => {
				view.scale = Math.min(view.max, Math.max(view.min, view.scale));
				canvas.style.transform = `translate3d(${view.tx}px, ${view.ty}px, 0) scale(${view.scale})`;
				level.textContent = `${Math.round(view.scale * 100)}%`;
			};

			/** Fit the diagram inside the stage, never enlarging past 2x natural size. */
			const fit = () => {
				const availableWidth = Math.max(80, stage.clientWidth - 48);
				const availableHeight = Math.max(80, stage.clientHeight - 48);
				// The sheet's padding scales with the diagram, so fit against the
				// padded box rather than the bare viewBox.
				view.fit = Math.min(availableWidth / (size.width + 48), availableHeight / (size.height + 48));
				// Never blow a small diagram up past 1.5x: filling the window with two
				// giant boxes looks broken, and dense diagrams are already large.
				view.scale = Math.max(view.min, Math.min(view.fit, 1.5));
				view.tx = 0;
				view.ty = 0;
				apply();
			};

			/** Zoom around a point given in stage-centre coordinates. */
			const zoomAt = (factor, originX = 0, originY = 0) => {
				const before = view.scale;
				const next = Math.min(view.max, Math.max(view.min, before * factor));
				if (next === before) return;
				const ratio = next / before;
				view.tx = originX - (originX - view.tx) * ratio;
				view.ty = originY - (originY - view.ty) * ratio;
				view.scale = next;
				apply();
			};

			out.addEventListener('click', () => zoomAt(1 / 1.25));
			into.addEventListener('click', () => zoomAt(1.25));
			fitButton.addEventListener('click', fit);
			closeButton.addEventListener('click', closeLightbox);

			// Wheel zoom anchored at the pointer; the stage owns the wheel while open.
			stage.addEventListener(
				'wheel',
				(event) => {
					event.preventDefault();
					const rect = stage.getBoundingClientRect();
					zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
				},
				{ passive: false },
			);

			// Drag to pan; a drag that moved must not count as a background click.
			let drag = null;
			stage.addEventListener('pointerdown', (event) => {
				if (event.button !== 0) return;
				drag = { x: event.clientX, y: event.clientY, tx: view.tx, ty: view.ty, moved: 0 };
				stage.setAttribute('data-dragging', 'true');
				stage.setPointerCapture?.(event.pointerId);
			});
			stage.addEventListener('pointermove', (event) => {
				if (drag === null) return;
				const dx = event.clientX - drag.x;
				const dy = event.clientY - drag.y;
				drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
				view.tx = drag.tx + dx;
				view.ty = drag.ty + dy;
				apply();
			});
			const endDrag = (event) => {
				if (drag === null) return;
				const moved = drag.moved;
				drag = null;
				stage.removeAttribute('data-dragging');
				stage.releasePointerCapture?.(event.pointerId);
				// A click on the letterboxed backdrop closes; a drag never does.
				if (moved < 4 && (event.target === stage || event.target === canvas)) closeLightbox();
			};
			stage.addEventListener('pointerup', endDrag);
			stage.addEventListener('pointercancel', endDrag);
			stage.addEventListener('dblclick', fit);

			/** Keyboard: Escape closes, +/- zoom, 0 fits, Tab stays inside. */
			const onKey = (event) => {
				if (event.key === 'Escape') {
					event.preventDefault();
					event.stopPropagation();
					closeLightbox();
					return;
				}
				if (event.key === '+' || event.key === '=') {
					event.preventDefault();
					zoomAt(1.25);
					return;
				}
				if (event.key === '-' || event.key === '_') {
					event.preventDefault();
					zoomAt(1 / 1.25);
					return;
				}
				if (event.key === '0') {
					event.preventDefault();
					fit();
					return;
				}
				if (event.key === 'Tab') {
					const focusable = [...root.querySelectorAll('button')];
					if (focusable.length === 0) return;
					const first = focusable[0];
					const last = focusable[focusable.length - 1];
					if (event.shiftKey && document.activeElement === first) {
						event.preventDefault();
						last.focus();
					} else if (!event.shiftKey && document.activeElement === last) {
						event.preventDefault();
						first.focus();
					}
				}
			};
			const onResize = () => {
				// Only re-fit while the reader has not taken manual control.
				if (Math.abs(view.scale - view.fit) < 0.001) fit();
			};
			document.addEventListener('keydown', onKey, true);
			window.addEventListener('resize', onResize);

			lightbox = { root, entry, previous, bodyOverflow, onKey, onResize };
			fit();
			closeButton.focus({ preventScroll: true });
		}
		//#endregion

		/** Re-render every diagram when the page palette changes under us. */
		function watchPalette() {
			const step = () => {
				let styles;
				try {
					styles = window.getComputedStyle(document.documentElement);
				} catch {
					return;
				}
				const next = [
					styles.colorScheme,
					styles.getPropertyValue('--dsw-alias-bg-base').trim(),
					styles.getPropertyValue('--dsw-alias-label-primary').trim(),
				].join('|');
				if (paletteKey === '') {
					paletteKey = next;
					return;
				}
				if (paletteKey === next) return;
				paletteKey = next;
				revision += 1;
				for (const entry of entries.values()) {
					entry.hash = '';
					if (entry.state !== 'ok') continue;
					if (entry.view === 'diagram' && !entry.diagram.hidden) {
						// The reader is looking at it: repaint with the new colours.
						schedule(entry);
					} else {
						// Drop the stale SVG and go back to on-demand; the cache key
						// changed with the palette, so the next open re-renders.
						entry.state = 'idle';
						paint(entry);
					}
				}
			};
			step();
			paletteTimer = window.setInterval(step, 1500);
		}

		/** Sweep decorations whose code block the renderer unmounted. */
		function sweep() {
			for (const [pre, entry] of [...entries]) {
				if (pre.isConnected) continue;
				release(entry);
				entries.delete(pre);
			}
		}

		/**
		 * Detach one decoration and hand its code block back to the document, in the
		 * place the card occupied. The block is never ours to keep: a view that
		 * unmounts, or a source the renderer replaced, must leave the Markdown intact.
		 * @param entry - the decoration to release.
		 */
		function release(entry) {
			if (lightbox !== null && lightbox.entry === entry) closeLightbox();
			if (entry.timer !== null) window.clearTimeout(entry.timer);
			if (reveal !== null && entry.root !== null) reveal.unobserve(entry.root);
			entry.timer = null;
			entry.resize?.disconnect();
			entry.resize = null;
			entry.pre.hidden = false;
			for (const child of entry.hiddenChrome ?? []) child.hidden = false;
			entry.hiddenChrome = [];
			const root = entry.root;
			// Put the frame back whole when we adopted one; otherwise the bare block.
			const restore = entry.frame ?? entry.pre;
			if (root?.parentNode != null) root.parentNode.insertBefore(restore, root);
			else if (!restore.isConnected) entry.source.append(restore);
			entry.frame = null;
			root?.remove();
		}

		/** One debounced pass over the document: adopt new blocks, drop dead ones. */
		function scan() {
			if (sweepTimer !== null) return;
			sweepTimer = window.setTimeout(() => {
				sweepTimer = null;
				if (observer === null) return;
				sweep();
				const fresh = candidates();
				for (const code of fresh) adopt(code);
				// The scan itself stays quiet; only adopted blocks and failures report.
				if (fresh.length > 0) report('adopted', { count: fresh.length });
				// A block that belongs to no card and was not recognised: record what the
				// DOM actually holds, a few times, so a renderer this detector misses can
				// be diagnosed from a real session instead of a screenshot.
				// A block we do not own and do not recognise: record only how many, never
				// what they contain. This is a support signal, not a content log.
				if (unmatchedReports < 3) {
					const stray = [...document.querySelectorAll('pre')].filter(
						(pre) => !entries.has(pre) && pre.closest('[data-dsh-mermaid]') === null,
					);
					const signature = String(stray.length);
					if (stray.length > 0 && signature !== lastStraySignature) {
						lastStraySignature = signature;
						unmatchedReports += 1;
						report('blocks-unmatched', { count: stray.length });
					}
				}
				hub.emit({ rendered: countState('ok'), failed: countState('error') });
			}, 80);
		}

		/**
		 * Track which cards have been seen, but only while the mode needs it.
		 *
		 * `visible` mode renders a diagram the first time its card enters the
		 * viewport; the other modes never pay for an observer.
		 */
		function syncReveal() {
			const need = hub.snapshot.mode === 'visible';
			if (need && reveal === null && typeof IntersectionObserver === 'function') {
				reveal = new IntersectionObserver(
					(records) => {
						for (const record of records) {
							if (!record.isIntersecting) continue;
							for (const entry of entries.values()) {
								if (entry.root !== record.target) continue;
								reveal.unobserve(record.target);
								entry.revealed = true;
								pump(entry);
								break;
							}
						}
					},
					{ rootMargin: '200px 0px' },
				);
				for (const entry of entries.values()) reveal.observe(entry.root);
			}
			if (!need && reveal !== null) {
				reveal.disconnect();
				reveal = null;
			}
		}

		/** Start decorating the document; idempotent while any view stays mounted. */
		function start() {
			if (observer !== null) return;
			observer = new MutationObserver(() => scan());
			observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
			watchPalette();
			syncReveal();
			// A safety net for content that arrives without a mutation this observer
			// sees; it is idle work, so it stays cheap and skips a hidden page.
			scanTimer = window.setInterval(() => {
				if (document.visibilityState === 'visible') scan();
			}, 2000);
			report('start', { mode: hub.snapshot.mode, candidates: candidates().length, scheme: currentScheme() });
			scan();
		}

		/** Stop decorating and remove every decoration and resource we own. */
		function stop() {
			if (observer !== null) {
				observer.disconnect();
				observer = null;
			}
			if (paletteTimer !== null) {
				window.clearInterval(paletteTimer);
				paletteTimer = null;
			}
			if (sweepTimer !== null) {
				window.clearTimeout(sweepTimer);
				sweepTimer = null;
			}
			if (scanTimer !== null) {
				window.clearInterval(scanTimer);
				scanTimer = null;
			}
			if (reveal !== null) {
				reveal.disconnect();
				reveal = null;
			}
			closeLightbox();
			paletteKey = '';
			for (const entry of entries.values()) release(entry);
			entries.clear();
			svgCache.clear();
			revision += 1;
			hub.emit({ rendered: 0, failed: 0 });
		}
		//#endregion

		//#region views
		/**
		 * Mounted view that owns the document decoration for as long as its session
		 * lives, and the stylesheet that decoration needs: a static client bundle has
		 * no `styles` builtin, so the card CSS is a component-owned `<style>` element
		 * that unmounts with the view.
		 */
		function MermaidHost() {
			const [live, setLive] = React.useState(() => true);
			React.useEffect(() => {
				watchers += 1;
				try {
					start();
				} catch (error) {
					console.error(`${PKG}: decoration failed to start`, error);
				}
				setLive(observer !== null);
				return () => {
					watchers = Math.max(0, watchers - 1);
					if (watchers === 0) stop();
				};
			}, []);
			if (!live) return null;
			return h('style', { 'data-dsh-mermaid-style': PKG, dangerouslySetInnerHTML: { __html: CSS } });
		}

		/** Ambient status line under the composer: silent until a diagram rendered. */
		function MermaidStatus() {
			const snapshot = React.useSyncExternalStore(subscribeHub, getHubSnapshot);
			if (snapshot.rendered === 0 && snapshot.failed === 0) return null;
			const parts = [`${snapshot.rendered} ${t('statusDiagrams')}`];
			if (snapshot.failed > 0) parts.push(`${snapshot.failed} ${t('statusFailed')}`);
			return h(
				'div',
				{
					style: {
						fontSize: '11px',
						lineHeight: '16px',
						padding: '0 2px',
						color: 'var(--dsw-alias-label-tertiary, #9aa1ae)',
						// The composer dock is a narrow flex row; without this the
						// counter wraps one character per line.
						whiteSpace: 'nowrap',
						flex: 'none',
					},
				},
				`Mermaid · ${parts.join(' · ')}`,
			);
		}

		/** One pill in the mode chooser. */
		function modePill(mode, active) {
			return h(
				'button',
				{
					key: mode,
					type: 'button',
					role: 'radio',
					'aria-checked': active,
					className: 'dsh-mdm-pill',
					onClick: () => writeMode(mode),
				},
				t(`mode${mode[0].toUpperCase()}${mode.slice(1)}`),
			);
		}

		/** General-settings row: the render-mode chooser. */
		function MermaidSetting() {
			const snapshot = React.useSyncExternalStore(subscribeHub, getHubSnapshot);
			const hint = { manual: 'hintManual', visible: 'hintVisible', always: 'hintAlways' }[snapshot.mode];
			return h(
				'div',
				{
					style: {
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						gap: '16px',
						padding: '10px 0',
						flexWrap: 'wrap',
					},
				},
				h(
					'div',
					{ style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0', flex: '1 1 220px' } },
					h('div', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-primary, #111827)' } }, t('settingsTitle')),
					h(
						'div',
						{ style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #6b7280)' } },
						t(hint),
					),
				),
				h(
					'div',
					{ role: 'radiogroup', 'aria-label': t('settingsTitle'), style: { display: 'flex', gap: '4px', flex: 'none' } },
					...MODES.map((mode) => modePill(mode, snapshot.mode === mode)),
				),
			);
		}
		//#endregion

		/** Plugin entry: register the dictionaries and the three views. */
		return {
			inject: ['slots', 'locale'],
			apply(ctx) {
				hostCtx = ctx;
				try {
					ctx.effect(() => ctx.locale.register(NS, DICT), 'dsh-mermaid: dictionaries');
					// The decoration owns the whole document, not one Session: this
					// root-scoped layer exists before — and without — an open Session, so
					// diagrams render in an existing transcript as soon as the page loads.
					// The entry renders a stylesheet and nothing else, and the layer is
					// click-through, so it never occupies space or blocks the app.
					ctx.slots.inject('shell.overlay', () =>
						ctx.slots.register({ name: 'shell.overlay', id: 'mermaid-host', order: 95 }, MermaidHost),
					);
					ctx.slots.inject('conversation.composer.bar', () =>
						ctx.slots.register({ name: 'conversation.composer.dock', id: 'mermaid-status', order: 40 }, MermaidStatus),
					);
					ctx.slots.inject('settings.section', () =>
						ctx.slots.register({ name: 'settings.general.item', id: 'mermaid-diagrams', order: 40 }, MermaidSetting),
					);
					report('apply-ok');
				} catch (error) {
					report('apply-throw', String(error?.stack ?? error));
					throw error;
				}
			},
		};
		}
	},
});
