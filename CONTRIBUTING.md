# Contributing

Thanks for taking the time to improve this plugin. It is a small codebase on purpose: two JavaScript files, no runtime dependencies, no build step for its own code.

## What this plugin is

A DeepSeek Harness client plugin. A Host half (`index.js`) serves the bundled Mermaid runtime over a local route; a browser half (`client.js`) decorates rendered Markdown, renders diagrams on demand, and provides the fullscreen viewer and the settings row.

The browser half works on the **rendered output**, because the Markdown renderer exposes no code-fence extension point. That is the fragile part of the design, and most bug reports come from it. When the renderer's DOM changes, `isMermaidBlock()` is the one place that decides what a diagram is.

## Requirements

- Node.js 22 or newer, npm.
- A Chrome/Chromium binary for the real-browser suite (`CHROME_BIN` overrides the search).
- No DSH installation is needed to run the tests.

## Setup

```sh
npm ci                 # dependencies (mermaid, esbuild, jsdom)
npm run build          # only when the bundled Mermaid version changes
npm test               # host route + cordis mount + browser-half suites (jsdom)
npm run test:e2e       # real Chrome against test/e2e/index.html
```

`npm run build` regenerates `vendor/mermaid.esm.min.mjs`. It must reproduce the committed bytes: CI runs `npm run build` followed by `git diff --exit-code -- vendor`, and a Windows job verifies the same build path there.

## Where something goes

| Change | File |
|---|---|
| Which blocks are diagrams | `isMermaidBlock()` in `client.js` |
| Card, toolbar, viewer, settings | `client.js` |
| Host route, runtime serving, support log | `index.js` |
| Mermaid version | `package.json` + `npm run build` |
| Strings | `client.js` (both locales) and `locale/*.json` |
| Behaviour tests | `test/client.test.mjs` |
| DOM-shape tests | `test/e2e/index.html` (and `index-dark.html`) |
| How to develop, debug, release | `docs/development.md` |

## Tests

- `test/run.mjs` runs the Host route suite, a real cordis mount (skipped when the desktop application's 0.2.x packages are absent), and the browser half in jsdom.
- `test/run-e2e-headless.mjs` starts `test/serve-e2e.mjs`, drives Chrome, and reads the page's own verdict from its title.

For anything that changes what the page looks like or what the card does, add a case to `test/e2e/index.html`: it loads the shipped bundle with real React and the real vendored Mermaid. Reproduce a reported DOM shape there before fixing it — that is how the preview-rendering bug and the code-block frame work were found.

## Pull requests

- Keep one PR to one behavioural change; small fixes can be bundled.
- Add a test for a behaviour change. A test that fails without the fix is the standard we hold ourselves to.
- Do not add runtime dependencies without discussing it first. The zero-dependency design is deliberate.
- Run `npm test`. CI also runs the browser suite and the pack check.
- Update `README.md` and `CHANGELOG.md` when a change is user-visible.
- Commits: an imperative summary line, then a short paragraph explaining *why* when it is not obvious. We do not require a specific format.

A maintainer reviews within a few days. We may push small follow-up commits to your branch (formatting, tests) rather than round-tripping; the merge commit keeps your authorship.

## Releases

Releases are tag-driven: bump `package.json`, push, then `git tag vX.Y.Z && git push origin vX.Y.Z`. The `Release` workflow runs the suites, verifies the tag matches the manifest, publishes to npm and opens the GitHub release. Maintainers handle this; contributors do not need an npm token.

## Good places to start

- Add `test/e2e` fixtures for diagram types the suite does not cover yet.
- Improve the Chinese or English strings; both live in `client.js`.
- Take a look at the open ideas in [`docs/development.md`](docs/development.md) and the invitation in issue #2 — compact ELK layout and diagram export are both wanted, and both have a working prototype in a community fork.

## Security

Please report vulnerabilities privately, not in a public issue: see [SECURITY.md](SECURITY.md).
