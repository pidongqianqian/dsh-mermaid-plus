# Developing this plugin

The plugin has **no build step for its own code**: `index.js` (Host half) and `client.js` (browser half) run as they are. `vendor/mermaid.esm.min.mjs` is the only generated file, and only needs rebuilding when the bundled Mermaid version changes.

That means a fix is usually: edit a file → restart DSH → look. This page removes the friction around "restart and look".

## Three ways to run it

| Setup | How | Use when |
|---|---|---|
| **Link** (development) | `dsh plugin add` of this checkout, or `plugin_manager` install with the repo path | You are changing the code. Edits apply to the running install; restart DSH to load them. |
| **Published** (normal use) | `dsh plugin --profile <profile> add dsh-mermaid-plus` | You want the released artifact, and fixes arrive by publishing a version. |
| **Copied + patched** | Published install, then `node tools/dev-sync.mjs` | You want to try a fix on a *published* install without releasing. Copies this checkout over the installed package; restart applies it. |

`node tools/dev-sync.mjs --dry-run` lists what it would replace. If the profile already links this checkout, the script says so and does nothing.

## The loop that avoids restarting DSH

Most UI work can be verified **outside** the app:

```sh
node test/serve-e2e.mjs      # serve the harness page on :8732
open http://127.0.0.1:8732/  # 35 assertions run in the page; results in window.__E2E__
```

`test/e2e/index.html` loads the **shipped** `client.js`, the real vendored Mermaid, real React, and a DOM that looks like the Chat renderer's Markdown. Add a fixture there for the case you are fixing — a new fence shape, a theme, a viewer interaction — and iterate with a browser refresh instead of an app restart.

```sh
node test/run.mjs            # host route, real cordis mount, jsdom browser-half behaviour
node test/bench/build-runtimes.mjs   # only when re-checking a Mermaid upgrade
node test/bench/run.mjs             # layout/upgrade benchmark (test/bench/results.md)
```

## When something breaks in the app

```sh
node tools/doctor.mjs         # activation, install mode, and the last browser events
```

It prints:

- **checkout vs installed versions** and whether the install is a link or a copy;
- the Host half's `activation.json`: package name, route, resolved `clientPath`, and whether this package's browser row was in the client graph;
- the browser half's `report.json`: event counts and the last few events.

Both files live in `<os tmp>/dsh-mermaid-plus/`. They contain **event names and counts only** — no diagram source, no file contents. Browser-side render errors are also printed to the developer-tools console.

### Reading the symptoms

| Symptom | Likely cause | Where to look |
|---|---|---|
| Mermaid blocks show no card at all | The rendered Markdown changed shape, so the block is not recognised | `blocks-unmatched` count > 0 in the report → compare the new DOM with `isMermaidBlock()` |
| Card appears, diagram fails | Mermaid parse error, or the runtime did not load | `render-error` in the report + console; the runtime URL is `<route>/mermaid.esm.min.mjs` |
| Cards disappear after a DSH update | Client bundle not loaded, or the seat moved | `activation.json` (`own entry in client graph`), then the client slots |
| Works in the app, not in a preview (or vice versa) | A renderer with a different DOM shape | Add that shape to `test/e2e/index.html`; `isMermaidBlock()` is the single place that decides |
| Nothing renders after an edit | The app did not reload; the desktop shell does not reliably reload on ⌘R | Restart DSH |

The decoration layer is the fragile part: it keys on rendered `<pre>` elements because the shipped Markdown renderer exposes no code-fence extension point. If upstream ever adds one, that is the code to replace — the rest (Host route, modes, viewer, settings) survives.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request:

```sh
npm ci
node test/run.mjs
node test/run-e2e-headless.mjs   # spawns the page server, drives Chrome, reads <title>E2E n/m
node tools/pack-check.mjs        # asserts the publish whitelist and the vendored runtime
```

`test/run-e2e-headless.mjs` needs a Chrome/Chromium binary; it finds the usual
names, and `CHROME_BIN` overrides the search. The page reports its own verdict in
the title, so a browser that renders nothing fails instead of passing vacuously.

One suite is skipped on CI on purpose: `test/host-mount.test.mjs` mounts the
plugin on the real `webServer` service, and the published
`@deepseek-ai/dsh-host-webserver` is still the 0.0.x generation (it registers
`httpServer`). It needs the application's own 0.2.x package.

Since Desktop 2.0.20 the application ships as `app.asar`, so the symlink recipe
that used to work no longer applies. The suite prints a skip instead of failing;
everything else — the Host route handler, the browser half and the real-browser
suite — runs everywhere. Treat a local run of the mount suite as optional
verification, and rely on the browser suite for behaviour.

## Releasing

By hand:

```sh
node test/run.mjs && node test/run-e2e-headless.mjs   # 33 + 35 cases
npm pkg set version=x.y.z
git commit -am "Release x.y.z" && git push
npm publish --access public                            # needs a 2FA-capable token
gh release create "vx.y.z" --title "vx.y.z" --generate-notes
```

By tag (`.github/workflows/release.yml`):

```sh
npm pkg set version=x.y.z
git commit -am "Release x.y.z" && git push
git tag "vx.y.z" && git push origin "vx.y.z"          # runs the suites, publishes, opens the release
```

The release workflow refuses a tag that does not match `package.json`. It needs
one repository secret, **`NPM_TOKEN`**: a granular npm access token with
“Read and write” for this package and **“Bypass 2FA”** enabled — npm rejects
publishing without 2FA or such a token (`E403`). `workflow_dispatch` on the
release workflow defaults to a dry run that skips publishing.

npm takes a few minutes to expose a new tarball. The README on the npm page comes
from the published tarball, so documentation-only changes still need a version to
appear there.

`files` in `package.json` is the publish whitelist: tooling (`tools/`, `test/`, `build.mjs`) and `docs/` are repository-only.

## Compatibility

Verified against DSH `0.2.0-rc.2`. DSH is a developer preview; client plugin contracts, slot keys and rendered Markdown can change between releases. Treat a DSH upgrade as a test run: `node tools/doctor.mjs`, then open a conversation with a diagram and a preview.
