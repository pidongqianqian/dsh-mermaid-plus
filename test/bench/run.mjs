/**
 * Drive the benchmark page in a real Chrome over CDP, with the real clock.
 *
 * A `--virtual-time-budget` harness would be easier, but virtual time makes the
 * numbers meaningless: it advances timers without waiting for CPU work.
 *
 *   node run.mjs [runtime...]
 */
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const root = join(import.meta.dirname, '.runtimes');
const assets = import.meta.dirname;
const PORT = 8811;
const CDP_PORT = 9223;

/** First Chrome/Chromium candidate that answers `--version`. */
const CHROME = [
	process.env.CHROME_BIN,
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/Applications/Chromium.app/Contents/MacOS/Chromium',
	'google-chrome',
	'google-chrome-stable',
	'chromium',
	'chromium-browser',
].filter(Boolean).find((candidate) => {
	try {
		execFileSync(candidate, ['--version'], { stdio: 'ignore', timeout: 10_000 });
		return true;
	} catch {
		return false;
	}
});

if (CHROME === undefined) {
	console.error('bench: no Chrome/Chromium found. Set CHROME_BIN.');
	process.exit(2);
}

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.mmd': 'text/plain; charset=utf-8',
};

const server = createServer(async (request, response) => {
	const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
	const path = url.pathname;
	const file = path === '/'
		? join(assets, 'index.html')
		: path === '/corpus.json'
			? join(assets, 'corpus.json')
			: path.startsWith('/.runtimes/')
				? join(root, path.slice('/.runtimes/'.length))
				: null;
	if (file === null) {
		response.writeHead(404).end();
		return;
	}
	try {
		const body = await readFile(file);
		response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
		response.end(body);
	} catch {
		response.writeHead(404).end();
	}
});
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

const chrome = spawn(CHROME, [
	'--headless=new',
	'--disable-gpu',
	'--no-sandbox',
	'--disable-dev-shm-usage',
	`--remote-debugging-port=${CDP_PORT}`,
	`--user-data-dir=${join(root, '.chrome')}`,
	'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'] });

/** Wait for the DevTools endpoint. */
async function cdpReady(deadline = 20_000) {
	const started = Date.now();
	while (Date.now() - started < deadline) {
		try {
			const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
			if (response.ok) return;
		} catch {
			/* not up yet */
		}
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
	throw new Error('chrome did not open the debugging port');
}

/** Open one tab and return its websocket URL. */
async function openTab(url) {
	const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
	return response.json();
}

/** Minimal CDP client: one request/response in flight at a time is enough here. */
function connect(webSocketUrl) {
	const socket = new WebSocket(webSocketUrl);
	const pending = new Map();
	let id = 0;
	const ready = new Promise((resolve, reject) => {
		socket.addEventListener('open', resolve);
		socket.addEventListener('error', reject);
	});
	socket.addEventListener('message', (event) => {
		const message = JSON.parse(event.data);
		const waiter = pending.get(message.id);
		if (waiter === undefined) return;
		pending.delete(message.id);
		if (message.error === undefined) waiter.resolve(message.result);
		else waiter.reject(new Error(message.error.message));
	});
	return {
		ready,
		send(method, params = {}) {
			id += 1;
			const current = id;
			socket.send(JSON.stringify({ id: current, method, params }));
			return new Promise((resolve, reject) => pending.set(current, { resolve, reject }));
		},
		close() {
			socket.close();
		},
	};
}

/** Run one configuration and return its result object. */
async function measure(rt, layout) {
	const url = `http://127.0.0.1:${PORT}/?rt=${rt}&layout=${layout}`;
	const tab = await openTab(url);
	const client = connect(tab.webSocketDebuggerUrl);
	const started = Date.now();
	let result;
	try {
		await client.ready;
		for (;;) {
			if (Date.now() - started > 180_000) throw new Error(`${rt}/${layout}: timed out`);
			const evaluated = await client.send('Runtime.evaluate', {
				expression: 'window.__BENCH__',
				returnByValue: true,
				awaitPromise: true,
			});
			result = evaluated.result.value;
			if (result !== undefined && result !== null) break;
			await new Promise((resolve) => setTimeout(resolve, 300));
		}
	} finally {
		client.close();
		await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${tab.id}`).catch(() => undefined);
	}
	return result;
}

const median = (values) => {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.floor(sorted.length / 2)];
};

const configs = process.argv.slice(2).length > 0
	? process.argv.slice(2).map((value) => value.split(':'))
	: [
		['mermaid11.esm.min.mjs', 'dagre'],
		['mermaid12.esm.min.mjs', 'dagre'],
		['mermaid12.esm.min.mjs', 'elk'],
	];

await cdpReady();
const rows = [];
for (const [rt, layout] of configs) {
	const result = await measure(rt, layout);
	const label = `${rt.replace('mermaid', 'v').replace('.esm.min.mjs', '')} ${layout}`;
	if (result.fatal !== undefined) {
		console.log(`FAIL ${label}: ${result.fatal}`);
		rows.push({ label, fatal: result.fatal });
		continue;
	}
	for (const item of result.results) {
		rows.push({
			label,
			id: item.id,
			ms: item.times.length > 0 ? Math.round(median(item.times)) : null,
			all: item.times.map((value) => Math.round(value)).join('/'),
			width: Math.round(item.width),
			height: Math.round(item.height),
			error: item.error,
		});
	}
	rows.push({ label, id: '__load__', ms: Math.round(result.importMs), all: `init ${Math.round(result.initMs)}ms`, width: 0, height: 0, error: null });
	console.log(`done ${label}  (import ${Math.round(result.importMs)}ms, init ${Math.round(result.initMs)}ms)`);
}

const ids = [...new Set(rows.map((row) => row.id))];
const labels = [...new Set(rows.map((row) => row.label))];
const pad = (value, width) => String(value).padStart(width);
console.log(`\n${'diagram'.padEnd(10)}${labels.map((label) => label.padStart(18)).join('')}`);
for (const id of ids.filter((value) => value !== '__load__')) {
	const cells = labels.map((label) => {
		const row = rows.find((candidate) => candidate.id === id && candidate.label === label);
		if (row === undefined) return pad('-', 18);
		if (row.error !== null) return pad('ERR', 18);
		const ratio = row.width > 0 && row.height > 0 ? ` ${row.width}x${row.height}` : '';
		return pad(`${row.ms}ms${ratio}`, 18);
	});
	console.log(id.padEnd(10) + cells.join(''));
}
console.log('\nper-run ms (3 runs):');
for (const id of ids) {
	for (const label of labels) {
		const row = rows.find((candidate) => candidate.id === id && candidate.label === label);
		if (row !== undefined && row.ms !== null) console.log(`  ${id.padEnd(10)} ${label.padEnd(22)} ${row.all}${row.error ? ` — ${row.error}` : ''}`);
	}
}

chrome.kill('SIGTERM');
server.close();
process.exit(0);
