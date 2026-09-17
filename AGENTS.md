# AGENTS.md

Chrome extension (Manifest V3) that adds a repo security scan button to GitHub pages,
powered by scanrepo.dev. Plain JavaScript with JSDoc types; `tsc` typechecks the JSDoc.

## Commands

```bash
npm run lint         # eslint
npm run typecheck    # tsc -p jsconfig.json (JSDoc types, no TS source)
npm test             # unit tests — offline, deterministic
npm run test:e2e     # real Chromium + live GitHub + live scanrepo.dev scan
npm run verify       # lint + typecheck + test + build
npm run build        # esbuild -> dist/
npm run package      # dist/ -> versioned .zip
```

## Testing rules

- **`npm test` must stay offline.** Unit tests exercise the scan client against a real
  local HTTP server (`tests/unit/scan-client.test.js`), not a mocked fetch and not the
  live API. Hitting scanrepo.dev from the unit suite makes it flaky and gets the shared
  service to return HTTP 429 for everyone.
- **Live API checks belong in `npm run test:e2e`.** That suite covers request shape,
  verdict rendering and error classification against the real service.
- Do not use mocks where a real code path can run. Prefer a local server, jsdom, or a
  real browser.

## GitHub DOM gotchas (verified 2026-09, will drift again)

GitHub's repository header was rewritten. Do not reintroduce the old assumptions:

- `data-testid="code-button"` **no longer exists**. Discovery falls back to a
  label-based search for a rendered `button`/`summary` whose text is exactly "Code".
- The action bar is **not** inside `#repository-container-header`; that element now holds
  only the repo name and the visibility label.
- `ul.pagehead-actions` now contains the **Notifications** control, not Code/Watch/Fork.
- The Code button's own `parentElement` is the action row. Insert with
  `container.insertBefore(button, codeButton)` — `insertAdjacentElement('beforebegin', …)`
  on the container lands the button as a sibling of the row instead of inside it.
- File-view dropdowns also read "Code". Prefer elements with client rects, and take the
  first in document order (the overview action row comes before any in-file control).

All discovery lives in `src/content/dom.js` and takes an explicit root so it is testable
under jsdom. Keep it that way.

## scanrepo.dev contract

- `POST https://www.scanrepo.dev/api/scan`, NDJSON streaming, ends with a `result` frame.
- `url` must be `github.com/owner/repo` (scheme-less) or `https://…`. A bare
  `owner/repo` returns **HTTP 400**. Build it with `toScanSlug()` in `src/lib/parse.js`.
- Use the `www.` host; the apex redirects with a 307.
- Verified details and corrections are in `docs/integration-contract.md`. The MCP server
  is **not** usable from an extension (stdio-only, and `scanrepo-mcp` is unpublished).

## Architecture invariants

- **The injected button must be centred without content.css.** `content.css` is fetched
  over an asynchronous `<link>`, so the button paints with UA defaults for the first few
  frames unless the centring declarations are also applied inline at creation. Without
  them the button is `display:block` with an `inline` icon, which drops the 16px SVG onto
  the text baseline ~3px above the button's centre — the "icon is off while loading"
  bug (SCB-4). `src/content/button.js` applies the same declarations `content.css`
  repeats; `tests/unit/button.test.js` fails if the two drift.
- The **service worker owns all network access**. The content script only posts messages,
  so no scanrepo.dev request is attributed to the `github.com` origin.
- **`chrome.storage` is read through the service worker.** The content script asks for the
  `scanrepo:options` message and gets back only the auto-scan flag, because it runs in
  page-origin context and must never hold the stored GitHub token. Auto-scan itself is
  gated by the pure `shouldAutoScan` in `src/content/auto-scan.js`, so a decisive
  preference is unit-tested rather than only exercised in a browser.
- **Report text is untrusted** (a hostile repo names its own files). Everything reaching
  the DOM is escaped in `src/ui/tooltip.js`. Keep the escaping tests passing.
- MV3 worker fetches are not visible to `page.on('request')` in Puppeteer. Observe them
  via a CDP session on the worker target (`Network.enable` +
  `Network.requestWillBeSent`).

## Style constraints imposed by the scanner

This repo is itself scanned by scanrepo.dev, and two of its heuristic rules fire on
perfectly ordinary JavaScript. `tests/unit/obfuscation.test.js` reimplements both rules
and fails the suite if they trip, so run `npm test` after editing any source file.

- **Avoid optional chaining (`?.`) and nullish coalescing (`??`).** They contain the
  operator characters the `flattened-control-flow` rule counts, and roughly five in one
  file cross its threshold. Use explicit checks instead:
  `if (!record) return fallback;` over `record?.[key] ?? fallback`, `a || b` over
  `a ?? b`, `x ? y : ''` over `x?.y ?? ''`.
- Non-null assertions (`!`) are unavailable: this is plain JS, and `jsconfig.json` runs
  `strict: true` (including `noImplicitAny`), so narrow before you dereference.
- **Keep inline HTML literals short.** The `high-entropy-strings` rule counts string
  literals of 32+ characters with Shannon entropy above 4.5, and three in one file trip
  it. Long interpolated markup is the usual culprit — split it into named fragments
  (class-attribute strings, small constants) or leave the long text as plain prose.
- The guard ignores the usual false-positive shapes (simple identifiers, URLs,
  `CONSTANT_CASE`), and it warns one hit early with a "margin" assertion, so a change
  that is about to break the scan fails in the unit suite rather than on a live scan.