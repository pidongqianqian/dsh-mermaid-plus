/**
 * Build the browser halves of the Mermaid bundle.
 *
 * Run from the workspace root of this plugin (where `node_modules/mermaid`
 * lives): `node build.mjs`.
 *
 * Produces `vendor/mermaid.esm.min.mjs` — Mermaid bundled into ONE file, including
 * every diagram parser, so the browser half can `import()` it from the Host route.
 *
 * The browser half loads this through the Host's own route rather than the
 * client module loader's package-local chunk mechanism: that mechanism addresses
 * a chunk as `/plugins/<id>/<file>`, and a scoped package id (`@scope/name`)
 * contains a `/`, so the Host's chunk route never matches it.
 */
import { build } from 'esbuild';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const mermaidDir = join(root, 'node_modules', 'mermaid');
const version = JSON.parse(readFileSync(join(mermaidDir, 'package.json'), 'utf8')).version;
const vendor = join(root, 'vendor');

// 1. One self-contained ESM bundle: static and dynamic imports both inlined, so
//    the browser needs exactly one request and the runtime needs no import map.
//
//    The JS API, not `node_modules/.bin/esbuild`: that directory holds a shell
//    script plus a `.cmd` wrapper on Windows, and spawning the extensionless name
//    fails there. The API is the same binary on every platform, so a contributor
//    on Windows can regenerate `vendor/` exactly as CI does.
await build({
	entryPoints: [join(mermaidDir, 'dist', 'mermaid.esm.min.mjs')],
	bundle: true,
	format: 'esm',
	minify: true,
	target: 'es2022',
	outfile: join(vendor, 'mermaid.esm.min.mjs'),
	logLevel: 'warning',
	// Legal comments keep esbuild's default (`eof`): third-party notices stay in
	// the bundle, collected at its end, which is also what the committed build has.
});

const runtime = readFileSync(join(vendor, 'mermaid.esm.min.mjs'), 'utf8');
const body = runtime.replace(/\/\/#\s*sourceMappingURL=.*$/m, '');
if (/^\s*(?:import|export)\s/m.test(body)) {
	throw new Error('build: the vendored runtime still has bare import/export statements');
}

// 3. License notices travel with the vendored bytes.
//
//    Mermaid itself is MIT. Its layout engine, elkjs, is EPL-2.0 and gets inlined
//    by this bundle, so the EPL text ships beside it and the notice in
//    THIRD-PARTY-NOTICES.md says which version and where its source lives.
copyFileSync(join(mermaidDir, 'LICENSE'), join(vendor, 'mermaid.LICENSE'));
const elkLicense = join(root, 'node_modules', 'elkjs', 'LICENSE.md');
if (!existsSync(elkLicense)) {
	throw new Error('build: elkjs/LICENSE.md is missing — Mermaid no longer depends on elkjs?');
}
copyFileSync(elkLicense, join(vendor, 'elkjs.LICENSE'));

console.log(`build: bundled Mermaid ${version} — runtime ${body.length} B -> vendor/`);
