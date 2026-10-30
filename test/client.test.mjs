/**
 * Client-half checks: the bundle registers itself, adopts mermaid fenced blocks
 * out of rendered Markdown, renders them only when the mode asks for it, caches
 * the result, and cleans up. Runs against a real DOM (jsdom) with a stubbed
 * module loader and a stubbed Mermaid runtime, so it exercises the shipped
 * `client.js` unmodified.
 *
 * Run from the plugin root: `node test/client.test.mjs`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = 'dsh-mermaid-plus';

const dom = new JSDOM(
	`<!doctype html><html><head></head><body><main id="transcript"></main></body></html>`,
	{ pretendToBeVisual: true, url: 'http://127.0.0.1:53610/' },
);
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.DOMParser = window.DOMParser;
globalThis.MutationObserver = window.MutationObserver;
globalThis.ResizeObserver = window.ResizeObserver;
globalThis.Node = window.Node;
// The bundle is evaluated with the page's `window` but resolves bare globals
// against the host realm; Node ships a `navigator` without a clipboard, so point
// it at the page's navigator to exercise the real copy path.
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });

/**
 * jsdom delivers MutationObserver callbacks on its own microtask queue, which is
 * not deterministic here. Record the callback so the test can drive a scan.
 */
const observerInstances = [];
const NativeObserver = window.MutationObserver;
window.MutationObserver = class RecordingObserver extends NativeObserver {
	constructor(callback) {
		super(callback);
		this.recordedCallback = callback;
		observerInstances.push(this);
	}
};

/** jsdom has no IntersectionObserver; record targets so the test can reveal them. */
const intersectionObservers = [];
globalThis.IntersectionObserver = window.IntersectionObserver = class FakeIntersectionObserver {
	constructor(callback) {
		this.callback = callback;
		this.targets = new Set();
		intersectionObservers.push(this);
	}
	observe(target) {
		this.targets.add(target);
	}
	unobserve(target) {
		this.targets.delete(target);
	}
	disconnect() {
		this.targets.clear();
	}
};

/** The one factory this bundle must register. */
const registrations = [];
window.__ModuleLoader__ = {
	load(registration) {
		registrations.push(registration);
	},
};

/** Stand-in for the frozen platform module table entry this bundle requires. */
const pendingEffects = [];
const mountedEffects = [];
const React = {
	createElement: (type, props, ...children) => ({ type, props, children }),
	useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => undefined],
	useEffect: (effect) => {
		pendingEffects.push(effect);
	},
	useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
};

/** Every module the plugin asked for, and every dynamic import it performed. */
const requested = [];
const importedModules = [];

/** Fake Mermaid runtime: records work so laziness is measurable. */
const runtime = {
	initializeCount: 0,
	renderCount: 0,
	lastOptions: null,
	lastSource: null,
	/** When set, a render waits on this promise so a test can change the source mid-flight. */
	gate: null,
	async initialize(options) {
		this.initializeCount += 1;
		this.lastOptions = options;
	},
	async render(id, source) {
		this.renderCount += 1;
		this.lastSource = source;
		if (this.gate !== null) await this.gate;
		if (source.includes('FAILME')) throw new Error('Parse error on line 2');
		if (source.includes('NEEDSDAGRE') && this.lastOptions?.layout === 'elk') {
			throw new Error('elk cannot lay this out');
		}
		return { svg: `<svg id="${id}" xmlns="http://www.w3.org/2000/svg"><text>${source.length}</text></svg>` };
	},
};

const requireStub = (spec) => {
	requested.push(spec);
	if (spec === 'react') return React;
	throw new Error(`unexpected require(${spec})`);
};

/** The shipped bundle loads Mermaid with a real `import()` of the Host route. */
globalThis.__dshMermaidImport = async (specifier) => {
	importedModules.push(specifier);
	if (specifier.includes('/x-dsh-mermaid-plus/mermaid.esm.min.mjs')) return { default: runtime };
	throw new Error(`unexpected import(${specifier})`);
};

// Evaluate the shipped bundle exactly as the browser would.
new Function('window', readFileSync(join(root, 'client.js'), 'utf8'))(window);

assert.equal(registrations.length, 1, 'the bundle must register exactly one factory');
assert.equal(registrations[0].id, PKG, 'the factory id must be the package name');

const plugin = registrations[0].factory(requireStub);
assert.deepEqual(plugin.inject, ['slots', 'locale']);

const injections = { requested: [], registered: [] };
const pluginEffects = [];
plugin.apply({
	get(name) {
		if (name === 'locale') return { register: () => () => undefined, bind: () => (key) => key };
		return undefined;
	},
	effect(callback, label) {
		pluginEffects.push({ label, disposer: callback() });
		return () => undefined;
	},
	locale: { register: () => () => undefined },
	slots: {
		inject(key, callback) {
			injections.requested.push(key);
			return callback();
		},
		register(options, component) {
			injections.registered.push({ ...options, component });
			return () => undefined;
		},
	},
});

//#region helpers
/** One rendered Markdown code block, shaped like the primitives' output. */
function addBlock(language, source, { labelled = true } = {}) {
	const pre = window.document.createElement('pre');
	const code = window.document.createElement('code');
	if (labelled) code.className = `language-${language}`;
	code.textContent = source;
	pre.append(code);
	window.document.getElementById('transcript').append(pre);
	return { pre, code };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Render a view the way React would: render first, then commit its effects.
 * @param view - registered slot occupant to render.
 * @returns the element the view returned.
 */
function renderView(view) {
	pendingEffects.length = 0;
	const element = view.component();
	for (const effect of pendingEffects.splice(0)) {
		const cleanup = effect();
		if (typeof cleanup === 'function') mountedEffects.push(cleanup);
	}
	return element;
}

/** Run every cleanup React would run on unmount, newest first. */
function unmountAll() {
	for (const cleanup of [...mountedEffects].reverse()) cleanup();
	mountedEffects.length = 0;
}

/** Drive the debounced document scan the way a DOM mutation would. */
function mutate() {
	const observer = observerInstances.at(-1);
	observer?.recordedCallback([], observer);
}

/** Reveal every card the bundle is watching, as scrolling one into view would. */
function revealAll() {
	for (const observer of intersectionObservers) {
		const targets = [...observer.targets];
		if (targets.length === 0) continue;
		observer.callback(targets.map((target) => ({ target, isIntersecting: true })));
	}
}

/** Enough wall-clock time for the scan debounce plus the slowest settle window. */
async function settle() {
	mutate();
	await wait(700);
}

// A registration is only valid once the slot it targets has been declared. Waiting
// on a different slot registers too early: the target does not exist yet, the call
// fails, and the row silently never appears (that is how the settings row and the
// status row were missing in 0.3.1).
assert.deepEqual(
	[...new Set(injections.registered.map((entry) => entry.name))].sort(),
	[...new Set(injections.requested)].sort(),
	'every registration must wait for the slot it registers into',
);

const hostView = injections.registered.find((entry) => entry.name === 'shell.overlay');
const statusView = injections.registered.find((entry) => entry.name === 'conversation.composer.dock');
const settingView = injections.registered.find((entry) => entry.id === 'mermaid-diagrams');
const layoutView = injections.registered.find((entry) => entry.id === 'mermaid-layout');

/** Pick one of the three render modes through the settings row's own control. */
function setMode(label) {
	const tree = renderView(settingView);
	const group = tree.children.find((child) => child?.props?.role === 'radiogroup');
	assert.ok(group, 'the settings row must offer a radiogroup');
	const pill = group.children.find((child) => String(child?.children?.[0] ?? '') === label);
	assert.ok(pill, `the settings row must offer "${label}"`);
	pill.props.onClick();
}
//#endregion

//#region registration
assert.deepEqual(
	injections.requested,
	['shell.overlay', 'conversation.composer.dock', 'settings.general.item'],
	'the three view hosts must be injected, each waiting on its own slot',
);
assert.deepEqual(
	injections.registered.map((entry) => entry.name),
	['shell.overlay', 'conversation.composer.dock', 'settings.general.item', 'settings.general.item'],
	'every view must register into its slot (two rows share the General settings slot)',
);
assert.deepEqual(
	injections.registered.map((entry) => entry.id),
	['mermaid-host', 'mermaid-status', 'mermaid-diagrams', 'mermaid-layout'],
	'each registration keeps its own entry id',
);
console.log('ok   registration       three views registered into their slots');
//#endregion

//#region mount
const hostElement = renderView(hostView);
assert.ok(hostElement !== null, 'the host view must render its own stylesheet');
assert.equal(hostElement.type, 'style');
assert.match(hostElement.props.dangerouslySetInnerHTML.__html, /dsh-mdm\{/, 'the stylesheet must carry the card CSS');
assert.equal(hostElement.props['data-dsh-mermaid-style'], PKG);
console.log('ok   mount              host view renders the package stylesheet');
//#endregion

//#region adoption (default = on demand)
const flow = addBlock('mermaid', 'flowchart LR\n  A --> B');
const plain = addBlock('js', 'const a = 1;');
const bare = addBlock('', 'sequenceDiagram\n  Alice->>Bob: Hi', { labelled: false });
const barePre = window.document.createElement('pre');
barePre.textContent = 'flowchart LR\n  X --> Y';
window.document.getElementById('transcript').append(barePre);
const plainPre = window.document.createElement('pre');
plainPre.textContent = 'const a = 1;\nconsole.log(a);';
window.document.getElementById('transcript').append(plainPre);

const inline = window.document.createElement('code');
inline.className = 'language-mermaid';
inline.textContent = 'flowchart LR';
window.document.getElementById('transcript').append(inline);

await settle();

const card = flow.pre.closest('.dsh-mdm');
assert.ok(card !== null, 'a mermaid block must be adopted into a card');
assert.equal(card.getAttribute('data-dsh-mermaid'), PKG);
assert.equal(card.getAttribute('data-dsh-mermaid-state'), 'idle', 'the default mode must not render');
assert.ok(card.querySelector('[data-dsh-mermaid-action="view"]') !== null, 'the card must carry a view control');
assert.equal(flow.pre.closest('.dsh-mdm-source') !== null, true, 'the source block must move into the card');
assert.equal(flow.pre.hidden, false, 'the source must stay visible until render is requested');
assert.equal(plain.pre.closest('.dsh-mdm'), null, 'a non-mermaid block must stay untouched');
assert.equal(inline.closest('.dsh-mdm'), null, 'inline code must stay untouched');
assert.equal(bare.pre.closest('.dsh-mdm') !== null, true, 'an unlabelled block with a diagram keyword must be adopted');
assert.equal(barePre.closest('.dsh-mdm') !== null, true, 'a <pre> without a <code> child must be adopted');
assert.equal(plainPre.closest('.dsh-mdm'), null, 'an unrelated bare <pre> must stay untouched');
assert.equal(importedModules.length, 0, 'the 3.5 MB runtime must not load before a diagram is requested');
assert.equal(runtime.renderCount, 0, 'nothing may be rendered in the default mode');
console.log('ok   on demand          cards adopted, nothing rendered, runtime not loaded');
//#endregion

//#region render on request
const button = card.querySelector('[data-dsh-mermaid-action="view"]');
button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await settle();

assert.equal(
	importedModules.filter((spec) => spec.includes('mermaid.esm.min.mjs')).length,
	1,
	'the runtime must load on first use',
);
assert.equal(runtime.renderCount, 1, 'the click must render exactly one diagram');
assert.equal(runtime.lastOptions.layout, 'elk', 'ELK is the default layout');
assert.ok(card.querySelector('.dsh-mdm-svg svg') !== null, 'the diagram must be rendered into the card');
assert.equal(flow.pre.hidden, true, 'the source must hide once the diagram shows');
assert.equal(card.getAttribute('data-dsh-mermaid-state'), 'ok');
console.log('ok   render on demand   one click renders one diagram and loads the runtime once');
//#endregion

//#region toggle + cache
button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
assert.equal(flow.pre.hidden, false, 'the control must reveal the source');
assert.ok(card.querySelector('.dsh-mdm-diagram').hidden, 'the control must hide the diagram');

button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
assert.equal(flow.pre.hidden, true, 'the control must show the diagram again');
assert.equal(runtime.renderCount, 1, 'switching views must reuse the rendered diagram, not re-render');
console.log('ok   cache              switching views reuses the rendered diagram');
//#endregion

//#region viewer
const expand = card.querySelector('[data-dsh-mermaid-action="expand"]');
assert.ok(expand !== undefined, 'a rendered card must offer the enlarge control');
assert.equal(expand.hidden, false, 'the enlarge control must appear once a diagram exists');
expand.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

const dialog = window.document.querySelector('.dsh-mdm-lb');
assert.ok(dialog !== null, 'the enlarge control must open the viewer');
assert.equal(dialog.getAttribute('role'), 'dialog');
assert.equal(dialog.getAttribute('aria-modal'), 'true');
assert.ok(dialog.querySelector('svg') !== null, 'the viewer must show the diagram');
assert.equal(window.document.body.style.overflow, 'hidden', 'the viewer must lock page scrolling');
const surface = dialog.querySelector('.dsh-mdm-lb-canvas');
assert.ok(surface !== null, 'the viewer must have a surface');
assert.match(
	surface.style.background,
	/rgb\(255,\s*255,\s*255\)|#ffffff/i,
	'the surface must paint the palette background, not stay transparent',
);
assert.equal(surface.getAttribute('data-dsh-mermaid-surface'), 'light');

const level = dialog.querySelector('.dsh-mdm-lb-zoom');
const before = level.textContent;
const zoomIn = [...dialog.querySelectorAll('.dsh-mdm-lb-btn')].find((node) => node.getAttribute('aria-label') === 'Zoom in');
zoomIn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
assert.notEqual(level.textContent, before, 'zooming in must change the readout');

window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
assert.equal(window.document.querySelector('.dsh-mdm-lb'), null, 'Escape must close the viewer');
assert.equal(window.document.body.style.overflow, '', 'closing must restore page scrolling');

expand.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const reopen = window.document.querySelector('.dsh-mdm-lb');
assert.ok(reopen !== null, 'the viewer must open again');
const closeButton = [...reopen.querySelectorAll('.dsh-mdm-lb-btn')].find((node) => node.getAttribute('aria-label') === 'Close');
closeButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
assert.equal(window.document.querySelector('.dsh-mdm-lb'), null, 'the close control must close the viewer');
console.log('ok   viewer             opens, zooms, and closes with Escape and the close control');

//#endregion

//#region mode: always
setMode('Always');
const auto = addBlock('mermaid', 'flowchart LR\n  C --> D');
await settle();
assert.ok(auto.pre.closest('.dsh-mdm')?.querySelector('.dsh-mdm-svg svg') !== null, 'always mode must render on adoption');
assert.equal(auto.pre.hidden, true, 'always mode must show the diagram');
console.log('ok   mode always        adopts and renders immediately');
//#endregion

//#region mode: visible
setMode('When visible');
const offscreen = addBlock('mermaid', 'flowchart LR\n  E --> F');
await settle();
const offscreenCard = offscreen.pre.closest('.dsh-mdm');
assert.ok(offscreenCard !== null, 'the block must be adopted');
assert.equal(offscreenCard.querySelector('.dsh-mdm-svg svg'), null, 'an unseen card must not render');
revealAll();
await settle();
assert.ok(offscreenCard.querySelector('.dsh-mdm-svg svg') !== null, 'revealing the card must render it');
console.log('ok   mode visible       renders only once the card is revealed');
//#endregion

//#region mode: back to manual
setMode('On demand');
const later = addBlock('mermaid', 'flowchart LR\n  G --> H');
await settle();
assert.equal(later.pre.closest('.dsh-mdm').getAttribute('data-dsh-mermaid-state'), 'idle', 'manual mode must stay lazy');
console.log('ok   mode manual        a later card waits for a request');
//#endregion

//#region coexistence with another renderer
// A second renderer may have taken the block already: it marks the block it
// claimed, and its error state echoes the source back as a <pre> inside its own
// card. Neither is a fence of ours, so neither may grow a second card.
const preview = window.document.createElement('div');
preview.className = 'nArs4W_editorMd';
window.document.body.append(preview);

const claimed = window.document.createElement('pre');
claimed.setAttribute('data-mermaid-processed', 'true');
claimed.textContent = 'flowchart LR\n  P --> Q';
preview.append(claimed);

const echo = window.document.createElement('pre');
echo.className = 'nArs4W_mermaidCode';
echo.textContent = 'flowchart LR\n  R --> S';
preview.append(echo);

await settle();
assert.equal(claimed.closest('.dsh-mdm'), null, 'a block another renderer claimed must stay untouched');
assert.equal(echo.closest('.dsh-mdm'), null, 'a source echo inside another card must stay untouched');
console.log('ok   coexistence       blocks claimed by another renderer are left alone');
//#endregion

//#region code-block frame
// Both the chat renderer and the document preview wrap a fence in the
// application's `.md-code-block` frame; 2.0.21's shape is
// frame > bannerWrap + [data-code-block-content] > pre > code. The card takes the
// frame's place and adopts the frame itself: the source keeps the application's
// highlighting, while the card's header replaces the frame's label and toolbar.
const frame = window.document.createElement('div');
frame.className = 'md-code-block';
const frameBannerWrap = window.document.createElement('div');
const frameBanner = window.document.createElement('div');
frameBanner.setAttribute('data-code-block-banner', '');
frameBanner.textContent = 'mermaid | Copy';
frameBannerWrap.append(frameBanner);
const frameBody = window.document.createElement('div');
frameBody.setAttribute('data-code-block-content', '');
const framed = window.document.createElement('pre');
framed.className = 'plain';
const framedCode = window.document.createElement('code');
framedCode.textContent = 'flowchart LR\n  T --> U';
framed.append(framedCode);
frameBody.append(framed);
frame.append(frameBannerWrap, frameBody);
preview.append(frame);

await settle();
const framedCard = preview.querySelector('.dsh-mdm');
assert.ok(framedCard !== null, 'a fenced block inside a frame must still be adopted');
assert.equal(framedCard.parentElement, preview, 'the card must sit where the frame sat');
assert.equal(framed.closest('.dsh-mdm'), framedCard, 'the source must live inside the card');
assert.equal(framedCard.querySelector('.md-code-block'), frame, 'the frame itself is adopted, not deleted');
assert.equal(frameBannerWrap.hidden, true, "the frame's own label and toolbar are hidden");
assert.equal(frameBody.hidden, false, 'the highlighted body stays available');

// The card owns the copy action now that the frame's toolbar is gone.
const copy = framedCard.querySelector('[data-dsh-mermaid-action="copy"]');
assert.ok(copy !== null, 'the card must offer copy in place of the hidden toolbar');
let copiedText = null;
Object.defineProperty(window.navigator, 'clipboard', {
	configurable: true,
	value: { writeText: async (text) => { copiedText = text; } },
});
copy.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(20);
assert.match(copiedText ?? '', /flowchart LR[\s\S]*T --> U/, 'copy must copy the fence source');

// The first press is the render request (manual mode), the second switches views.
const viewToggle = framedCard.querySelector('[data-dsh-mermaid-action="view"]');
viewToggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await settle();
assert.equal(framedCard.getAttribute('data-dsh-mermaid-state'), 'ok', 'the framed fence must render on request');
assert.equal(framedCard.querySelector('.dsh-mdm-source').hidden, true, 'the diagram view hides the adopted frame');
viewToggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
assert.equal(framedCard.querySelector('.dsh-mdm-source').hidden, false, 'the code view shows the adopted frame');
console.log('ok   code-block frame   the card replaces the frame and keeps its body');
//#endregion

//#region stale results
// Streaming edits a fence faster than Mermaid lays it out, so a queued render can
// finish after the source it was started for has changed. That result must be
// dropped and the card asked again, never shown as if it were current.
const stalePre = window.document.createElement('pre');
stalePre.textContent = 'flowchart LR\n  S --> T';
window.document.getElementById('transcript').append(stalePre);
await settle();
const staleCard = stalePre.closest('.dsh-mdm');
assert.ok(staleCard !== null, 'the streaming block must be adopted');

let openGate;
runtime.gate = new Promise((resolve) => {
	openGate = resolve;
});
staleCard.querySelector('[data-dsh-mermaid-action="view"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(30);
assert.equal(staleCard.getAttribute('data-dsh-mermaid-state'), 'rendering', 'the first render must be in flight');

// The fence grows while the layout is still running, then the old render lands.
stalePre.textContent = 'flowchart LR\n  S --> T\n  T --> U';
openGate();
runtime.gate = null;
await settle();
assert.equal(runtime.lastSource, 'flowchart LR\n  S --> T\n  T --> U', 'the stale result must be discarded and the new source rendered');
assert.equal(staleCard.getAttribute('data-dsh-mermaid-state'), 'ok', 'the card must settle on the current source');
console.log('ok   stale results      a result for an old source is dropped, not shown');

staleCard.remove();
stalePre.remove();
await settle();
//#endregion

//#region status + settings
const status = renderView(statusView);
assert.ok(status !== null, 'the status row must appear once diagrams rendered');
assert.match(JSON.stringify(status.children), /diagram/i);
const settings = renderView(settingView);
assert.ok(settings !== null, 'the settings row must render');
const group = settings.children.find((child) => child?.props?.role === 'radiogroup');
assert.equal(group.children.length, 3, 'the settings row must offer all three modes');
assert.equal(
	group.children.filter((child) => child.props['aria-checked'] === true).length,
	1,
	'exactly one mode must be selected',
);

// The layout row is a second entry in the same slot, with its own choice.
const layoutRow = renderView(layoutView);
assert.ok(layoutRow !== null, 'the layout row must render');
const layoutGroup = layoutRow.children.find((child) => child?.props?.role === 'radiogroup');
assert.equal(layoutGroup.children.length, 2, 'the layout row must offer two engines');
assert.equal(
	String(layoutGroup.children.find((child) => child.props['aria-checked'] === true)?.children?.[0] ?? ''),
	'Compact',
	'ELK must be the selected layout by default',
);
console.log('ok   views              status row, three-mode chooser and layout chooser render');
//#endregion

//#region layout switching
// Switching engines persists the choice and re-draws what is already on screen.
const layoutGroupNow = () => renderView(layoutView).children.find((child) => child?.props?.role === 'radiogroup');
const dagrePill = layoutGroupNow().children.find(
	(child) => String(child?.children?.[0] ?? '') === 'Standard',
);
dagrePill.props.onClick();
await settle();
assert.equal(window.localStorage.getItem('dsh-mermaid-plus.layout'), 'dagre', 'the choice must persist');
assert.equal(runtime.lastOptions.layout, 'dagre', 'an already rendered card must re-render with the new engine');
assert.match(card.querySelector('.dsh-mdm-svg svg')?.outerHTML ?? '', /<svg/, 'the re-render must land in the card');

// Back to the default. The card rendered a moment ago is served from the cache by
// engine+source, so a fresh block is what proves the choice reaches the runtime.
layoutGroupNow()
	.children.find((child) => String(child?.children?.[0] ?? '') === 'Compact')
	.props.onClick();
await settle();
assert.equal(window.localStorage.getItem('dsh-mermaid-plus.layout'), 'elk');
const afterSwitch = window.document.createElement('pre');
afterSwitch.textContent = 'flowchart LR\n  Z1 --> Z2';
window.document.getElementById('transcript').append(afterSwitch);
await settle();
afterSwitch.closest('.dsh-mdm').querySelector('[data-dsh-mermaid-action="view"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await settle();
assert.equal(runtime.lastOptions.layout, 'elk', 'a new diagram must use the restored layout');
afterSwitch.closest('.dsh-mdm').remove();
afterSwitch.remove();
await settle();
console.log('ok   layout settings    switching engines persists and reaches the runtime');
//#endregion

//#region layout fallback
// ELK handles nearly everything; a graph it cannot lay out must still render.
const needsDagre = window.document.createElement('pre');
needsDagre.textContent = 'flowchart LR\n  N1[NEEDSDAGRE] --> N2';
window.document.getElementById('transcript').append(needsDagre);
await settle();
const fallbackCard = needsDagre.closest('.dsh-mdm');
assert.ok(fallbackCard !== null, 'the block must be adopted');
const fallbackRendersBefore = runtime.renderCount;
fallbackCard.querySelector('[data-dsh-mermaid-action="view"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await settle();
assert.equal(runtime.renderCount, fallbackRendersBefore + 2, 'a failed ELK render must retry once with dagre');
assert.equal(fallbackCard.getAttribute('data-dsh-mermaid-state'), 'ok', 'the fallback diagram must show');
console.log('ok   layout fallback    a failed ELK render retries once with dagre');
fallbackCard.remove();
needsDagre.remove();
await settle();
//#endregion

//#region failure
const broken = addBlock('mermaid', 'flowchart LR\n  FAILME --> B');
await settle();
const brokenCard = broken.pre.closest('.dsh-mdm');
assert.ok(brokenCard !== null, 'the broken block must still be adopted');
brokenCard.querySelector('[data-dsh-mermaid-action="view"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await settle();
assert.match(brokenCard.querySelector('.dsh-mdm-msg').textContent, /render|渲染/i);
assert.match(brokenCard.querySelector('.dsh-mdm-err').textContent, /Parse error/);
assert.equal(broken.pre.hidden, false, 'a failed diagram must keep the source visible');
assert.equal(
	runtime.lastOptions?.suppressErrorRendering,
	true,
	'a failed render must not leave Mermaid error chrome behind',
);
console.log('ok   failure            a render error falls back to the visible source');
//#endregion

//#region idempotence
const cardsBefore = window.document.querySelectorAll('.dsh-mdm').length;
const rendersBefore = runtime.renderCount;
await settle();
await settle();
assert.equal(window.document.querySelectorAll('.dsh-mdm').length, cardsBefore, 'a rescan must not duplicate cards');
assert.equal(runtime.renderCount, rendersBefore, 'rescans must not re-render settled cards');
console.log('ok   idempotence        repeated scans never duplicate or re-render');
//#endregion

//#region sweep + teardown
const orphan = addBlock('mermaid', 'pie title P\n  "a" : 1');
await settle();
assert.ok(orphan.pre.closest('.dsh-mdm') !== null, 'the orphan fixture must be decorated');
orphan.pre.closest('.dsh-mdm').remove();
orphan.pre.remove();
mutate();
await wait(300);
console.log('ok   sweep              a removed code block loses its card');

unmountAll();
assert.equal(window.document.querySelectorAll('.dsh-mdm').length, 0, 'unmounting the view must remove every card');
const restored = [...window.document.querySelectorAll('#transcript pre')].filter((pre) =>
	/flowchart|sequenceDiagram|pie/.test(pre.textContent ?? ''),
);
assert.equal(restored.length, 7, 'unmounting must hand every adopted code block back to the document');
// The adopted frame is restored with its chrome visible and outside any card.
assert.equal(frame.closest('.dsh-mdm'), null, 'the frame must leave the card on unmount');
assert.equal(frameBannerWrap.hidden, false, "the frame's own label comes back on unmount");
assert.equal(restored.every((pre) => pre.hidden === false), true, 'restored code blocks must be visible again');
console.log('ok   teardown           unmount removes cards and restores every source block');

// Re-mounting after teardown must decorate again.
assert.ok(renderView(hostView) !== null);
await settle();
assert.ok(flow.pre.closest('.dsh-mdm') !== null, 'a remount must decorate again');
assert.equal(mountedEffects.length, 1, 'a remount must register a fresh effect');
console.log('ok   remount            a second mount decorates the document again');
//#endregion

console.log('client bundle: all cases passed');

// The decoration owns a live palette timer by design; end the run explicitly.
process.exit(0);
