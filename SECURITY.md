# Security policy

## Reporting a vulnerability

Please do **not** open a public issue. Use GitHub's private reporting:

**Security → Advisories → Report a vulnerability** on
<https://github.com/pidongqianqian/dsh-mermaid-plus/security/advisories/new>

Include what you did, what happened, the plugin and DSH versions, and the smallest
input that reproduces it. We will acknowledge within a few days and coordinate a
fix and disclosure date with you.

## Supported versions

The latest published version receives fixes. Older versions may be asked to
upgrade; the plugin is small and has no long-lived branches.

## What is in scope

- **Diagram source handling.** Mermaid runs with `securityLevel: 'strict'` and
  `htmlLabels: false`; links inside rendered SVGs are stripped before insertion.
  A way to execute script or exfiltrate data through a diagram source is in scope.
- **The Host route.** `index.js` serves the vendored runtime under a package-derived
  path. Path traversal, serving arbitrary files, or responding to unexpected
  methods is in scope.
- **Document handling.** The plugin reads rendered DOM, not files; it must not
  copy document text anywhere. The support log (`<os tmp>/dsh-mermaid-plus/`)
  records event names and counts only. A leak of diagram source or file contents
  into that log is in scope.
- **Supply chain.** The published tarball should contain only the whitelisted
  files; CI verifies that shape on every push. A release that contains anything
  else is in scope.

## What is not in scope

- Vulnerabilities in Mermaid, React, or DSH itself — report those upstream. We will
  still bump our vendored runtime when they do.
- A malicious diagram that makes the page slow or draws a misleading picture; that
  is a content problem, not a plugin vulnerability.
- Anything that requires an attacker to already control the local machine or the
  profile's `node_modules`.

## Our own practices

- No runtime dependencies; no network requests except the local Host route.
- CI runs the suites and the publish-whitelist check on every push; releases are
  tag-driven and reproducible (`npm run build` must reproduce `vendor/`).
