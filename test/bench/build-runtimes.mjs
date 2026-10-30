/**
 * Prepare the runtimes the benchmark compares.
 *
 *   node test/bench/build-runtimes.mjs
 *
 * - `mermaid11.esm.min.mjs` is the runtime this repository ships (`vendor/`).
 * - `mermaid12.esm.min.mjs` is `mermaid@12.2.0`, bundled the same way `build.mjs`
 *   bundles the shipped one, so the comparison is version-only.
 *
 * Output goes to `test/bench/.runtimes/`, which is ignored by git.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(dirname(here));
const runtimeDir = join(here, '.runtimes');
mkdirSync(runtimeDir, { recursive: true });

copyFileSync(join(root, 'vendor', 'mermaid.esm.min.mjs'), join(runtimeDir, 'mermaid11.esm.min.mjs'));
console.log('copied the shipped Mermaid 11 runtime');

// Prefer the interpreter npm was started with; Windows cannot spawn bare `npm`.
const npmCli = process.env.npm_execpath;
const [command, args, shell] = npmCli === undefined
	? ['npm', ['install', '--prefix', runtimeDir, '--no-save', '--no-audit', '--no-fund', 'mermaid@12.2.0'], process.platform === 'win32']
	: [process.execPath, [npmCli, 'install', '--prefix', runtimeDir, '--no-save', '--no-audit', '--no-fund', 'mermaid@12.2.0'], false];
execFileSync(command, args, { stdio: 'inherit', shell });

await build({
	entryPoints: [join(runtimeDir, 'node_modules', 'mermaid', 'dist', 'mermaid.esm.min.mjs')],
	bundle: true,
	format: 'esm',
	minify: true,
	target: 'es2022',
	outfile: join(runtimeDir, 'mermaid12.esm.min.mjs'),
	logLevel: 'warning',
});
console.log('bundled Mermaid 12 into .runtimes/mermaid12.esm.min.mjs');
