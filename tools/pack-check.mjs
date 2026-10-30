/**
 * Assert what `npm publish` would actually ship.
 *
 *   node tools/pack-check.mjs
 *
 * Guards the `files` whitelist: the tarball must contain the runtime package and
 * nothing from the repository's tooling, tests or logs.
 */
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** Every file the published package must contain, and nothing else. */
const EXPECTED = [
	'LICENSE',
	'README.md',
	'client.js',
	'cordis.patch.yml',
	'icon.svg',
	'index.js',
	'locale/zh.json',
	'package.json',
	'vendor/mermaid.LICENSE',
	'vendor/mermaid.esm.min.mjs',
];

/** Paths that must never be published, whatever `files` says. */
const FORBIDDEN = [/^test\//, /^tools\//, /^docs\//, /^build\.mjs$/, /diagnostics\.json$/, /\.tgz$/, /node_modules\//];

// `npm` is a shell script on POSIX but `npm.cmd` on Windows, where spawning the
// bare name fails with ENOENT. Prefer the interpreter npm itself was started
// with (`npm run pack:check` sets this), and fall back to a shell otherwise.
const npmCli = process.env.npm_execpath;
const [command, args, shell] = npmCli === undefined
	? ['npm', ['pack', '--dry-run', '--json'], process.platform === 'win32']
	: [process.execPath, [npmCli, 'pack', '--dry-run', '--json'], false];
const raw = execFileSync(command, args, { cwd: root, encoding: 'utf8', shell });
const [report] = JSON.parse(raw);
const files = report.files.map((file) => file.path).sort();

const problems = [];
for (const expected of EXPECTED) {
	if (!files.includes(expected)) problems.push(`missing: ${expected}`);
}
for (const file of files) {
	if (EXPECTED.includes(file)) continue;
	const forbidden = FORBIDDEN.find((pattern) => pattern.test(file));
	problems.push(forbidden === undefined ? `unexpected: ${file}` : `forbidden: ${file}`);
}
const vendor = report.files.find((file) => file.path === 'vendor/mermaid.esm.min.mjs');
if (vendor === undefined || vendor.size < 1_000_000) {
	problems.push(`vendored runtime looks wrong: ${vendor?.size ?? 0} bytes`);
}

if (problems.length > 0) {
	console.error(`pack check failed (${files.length} files, ${report.files.length} entries):`);
	for (const problem of problems) console.error(`  ${problem}`);
	process.exit(1);
}
console.log(`pack check: ${files.length} files, ${(report.size / 1024).toFixed(0)} kB packed — as expected`);
