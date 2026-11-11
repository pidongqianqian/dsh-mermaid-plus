/**
 * Assert that every image the README points at is a complete PNG in the repo.
 *
 *   node tools/check-readme-images.mjs
 *
 * The README uses absolute raw.githubusercontent URLs so npm and the catalogs can
 * render them, which means a truncated file is published silently: the page simply
 * shows an empty block. This check catches that before a push: the URL must resolve
 * to a local path, and the file must carry a PNG signature, an IEND chunk, and a
 * plausible size.
 */
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const readme = readFileSync(join(root, 'README.md'), 'utf8');

/** Raw GitHub URLs on the default branch, mapped back to repository paths. */
const pattern = /https:\/\/raw\.githubusercontent\.com\/[^/\s]+\/[^/\s]+\/main\/([^\s)"'<>]+)/g;
const paths = [...new Set([...readme.matchAll(pattern)].map((match) => match[1]))];

if (paths.length === 0) {
	console.error('check: the README does not reference any raw images');
	process.exit(1);
}

const problems = [];
for (const path of paths) {
	const absolute = join(root, path);
	let bytes;
	try {
		bytes = readFileSync(absolute);
	} catch {
		problems.push(`${path}: missing (the README would show a broken image)`);
		continue;
	}
	const signature = bytes.subarray(0, 8).toString('hex');
	const hasEnd = bytes.subarray(-8).toString('hex').includes('49454e44');
	if (signature !== '89504e470d0a1a0a') {
		problems.push(`${path}: not a PNG (signature ${signature || 'empty'})`);
	} else if (!hasEnd) {
		problems.push(`${path}: truncated PNG (${statSync(absolute).size} bytes, no IEND)`);
	} else if (bytes.length < 2_000) {
		problems.push(`${path}: suspiciously small (${bytes.length} bytes)`);
	}
}

if (problems.length > 0) {
	console.error(`check failed: ${problems.length} README image(s)`);
	for (const problem of problems) console.error(`  ${problem}`);
	process.exit(1);
}
console.log(`readme images: ${paths.length} valid PNG(s)`);
