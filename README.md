# ScanRepo — one-click repo security scan on GitHub

A Chrome extension (Manifest V3) that adds a **Scan this repo** button to GitHub
repository pages. Before you clone an unfamiliar repo, one click checks it for malware,
credential stealers, crypto scams and supply-chain risk, powered by
[scanrepo.dev](https://www.scanrepo.dev).

The button sits in the repository action bar, immediately to the left of GitHub's own
**Code** button. Clicking it streams progress into a hover tooltip and then shows a
verdict, a risk score and the top findings, with a link to the full report.

## What it checks

scanrepo.dev performs static analysis of a repository. A result is not a guarantee:
**a "safe" verdict means no known malicious pattern matched, not that the repo is
harmless.** The tooltip states this on every result.

## Scope and limitations

- **Public repositories only.** scanrepo.dev accepts GitHub and Bitbucket public repos.
  The extension does not offer a scan on private repos, because the service cannot
  reach them.
- **Static analysis.** Findings are patterns in the code, not a runtime sandbox.
- **Unchanged repos are cached** by scanrepo.dev, so repeat scans return quickly.

## Install (from source)

```bash
npm install
npm run build
```

Then in Chrome: **chrome://extensions** → enable *Developer mode* → **Load unpacked** →
select the `dist/` directory.

To produce a zip for the Chrome Web Store instead:

```bash
npm run package
```

## Configuration

Open the extension's options page (click the toolbar icon) to set:

| Setting | Default | Purpose |
| --- | --- | --- |
| GitHub token | empty | Raises scanrepo.dev's rate limits and coverage. Stored in `chrome.storage.sync`, sent only to scanrepo.dev. |
| Publish scan | off | Off keeps your scans private to you. On contributes the result to scanrepo.dev's public index. |
| Scan on page load | off | Runs a scan automatically when you open a repo page. |
| Timeout | 90 s | Aborts a scan that runs too long. |

The token is optional. Without one, scans are still attempted but are subject to
anonymous rate limits.

## Architecture

The extension makes no request from the GitHub page's origin. The content script sends a
message to the background service worker, which performs the scan.

```
src/
  manifest.json          MV3 manifest
  contract.js            frozen scanrepo.dev constants (endpoint, verdicts, defaults)
  types.js               shared JSDoc typedefs
  lib/
    parse.js             GitHub URL -> { owner, repo }, canonical scan slug
    scan-client.js       POST /api/scan, NDJSON streaming, timeouts, error classes
    ndjson.js            streaming NDJSON parser
    report.js            raw report -> tooltip view model
  content/
    dom.js               GitHub DOM discovery (Code button, visibility, repo identity)
    index.js             button injection, SPA navigation handling, scan lifecycle
    content.css          button and tooltip styling that follows GitHub's theme
  background/index.js    service worker: scans, options, progress relay
  ui/tooltip.js          tooltip rendering (escaped; remote text is never trusted)
  options/               options page
```

`docs/integration-contract.md` records the verified scanrepo.dev API contract, including
corrections to assumptions that did not hold.

### Design notes

- The service worker owns all network access. The content script only posts messages, so
  no scanrepo.dev request is ever attributed to `github.com`.
- Report text is remote data — a hostile repo can name a file anything. All of it is
  HTML-escaped before it reaches the tooltip.
- GitHub is a single-page app. A `MutationObserver` plus a `history` patch re-inject the
  button across soft navigation, so it tracks the repo actually on screen.
- GitHub's DOM changes often. Discovery prefers documented hooks and falls back to
  label-based search, so a changed `data-testid` does not break injection.

## Development

```bash
npm run lint         # eslint
npm run typecheck    # tsc over JSDoc types (no TS source)
npm test             # unit tests — deterministic, no network
npm run test:e2e     # end-to-end: real Chromium + a live scanrepo.dev scan
npm run verify       # lint + typecheck + unit tests + build
```

`npm test` runs offline against a local stub server. `npm run test:e2e` loads the built
extension into a real Chromium, drives the button on a live GitHub page and completes a
real scan against scanrepo.dev; it needs network access and an available Chromium. Set
`CHROME_PATH` if Chromium is not at `/usr/bin/chromium`, or `E2E_REPO` to scan a
different repository.

## Disclaimer

This extension is not affiliated with GitHub or scanrepo.dev. Static analysis can miss
malicious code, and a clean result is not a safety guarantee.