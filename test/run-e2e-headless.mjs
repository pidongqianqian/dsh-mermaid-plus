/**
 * Run the real-browser suite headless, for CI and for a one-command local check.
 *
 *   node test/run-e2e-headless.mjs
 *
 * Starts `test/serve-e2e.mjs` on a free port, drives Chrome with `--dump-dom`,
 * and reads the page's own verdict from `<title>E2E passed/total</title>`. A
 * browser is required: this suite loads the shipped bundle with real React and
 * the real vendored Mermaid, which jsdom cannot do.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Minimum number of assertions the page must run for a pass to mean anything. */
const MIN_CASES = 30;

/** Candidate browser binaries, in the order a maintainer would try them. */
const candidates = [
	process.env.CHROME_BIN,
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/Applications/Chromium.app/Contents/MacOS/Chromium',
	'google-chrome',
	'google-chrome-stable',
	'chromium',
	'chromium-browser',
].filter((value) => typeof value === 'string' && value !== '');

/** First candidate that answers `--version`. */
function findBrowser() {
	for (const candidate of candidates) {
		if (candidate.includes('/') && !existsSync(candidate)) continue;
		try {
			execFileSync(candidate, ['--version'], { stdio: 'ignore', timeout: 15_000 });
			return candidate;
		} catch {
			/* try the next one */
		}
	}
	return undefined;
}

/** Failure lines the page rendered into its own DOM, without the script source. */
function failures(dom) {
	const block = /<pre id="e2e-failures">([\s\S]*?)<\/pre>/.exec(dom)?.[1] ?? '';
	return block
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.startsWith('FAIL '))
		.slice(0, 12);
}

const browser = findBrowser();
if (browser === undefined) {
	console.error('e2e: no Chrome/Chromium found. Set CHROME_BIN to run this suite.');
	process.exit(2);
}

const port = 8790 + Math.floor(Math.random() * 100);
const server = spawn(process.execPath, [join(import.meta.dirname, 'serve-e2e.mjs'), String(port)], {
	stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (chunk) => {
	serverLog += String(chunk);
});
server.stderr.on('data', (chunk) => {
	serverLog += String(chunk);
});

/** Wait until the page answers. */
async function waitForServer(deadlineMs = 15_000) {
	const started = Date.now();
	while (Date.now() - started < deadlineMs) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/`);
			if (response.ok) return true;
		} catch {
			/* not up yet */
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	return false;
}

const profileDir = await mkdtemp(join(tmpdir(), 'dsh-mermaid-e2e-'));
let failed = 1;
try {
	if (!(await waitForServer())) {
		console.error(`e2e: the page server did not start on :${port}`);
		console.error(serverLog.slice(-2000));
		process.exit(1);
	}
	const dom = execFileSync(
		browser,
		[
			'--headless=new',
			'--disable-gpu',
			'--no-sandbox',
			'--disable-dev-shm-usage',
			'--virtual-time-budget=60000',
			`--user-data-dir=${profileDir}`,
			'--dump-dom',
			`http://127.0.0.1:${port}/`,
		],
		{ encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
	);
	const title = /<title>([^<]*)<\/title>/.exec(dom)?.[1] ?? '';
	const match = /^E2E (\d+)\/(\d+)$/.exec(title.trim());
	if (match === null) {
		console.error(`e2e: the page did not report a verdict (title: ${JSON.stringify(title)})`);
		for (const check of failures(dom)) console.error(`  ${check}`);
	} else {
		const [, passed, total] = match.map(Number);
		failed = passed === total && total >= MIN_CASES ? 0 : 1;
		console.log(`e2e: ${passed}/${total} assertions passed (minimum ${MIN_CASES})`);
		if (failed !== 0) {
			for (const check of failures(dom)) console.error(`  ${check}`);
		}
	}
} finally {
	server.kill('SIGTERM');
	await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
}
process.exit(failed);
