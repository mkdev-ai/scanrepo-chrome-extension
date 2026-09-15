# SPIKE 1 — scanrepo.dev integration contract (verified 2026-09-15)

This document freezes the contract the extension codes against. Every claim below was
verified by direct observation against the live service, not inferred from the epic text.
Where the epic's assumptions were wrong, the correction is recorded here.

## 1. Correction to the epic's recommended architecture

The epic recommends calling the **scanrepo.dev MCP server** as the primary path, with the
CLI `--json` contract as the schema reference and the web UI as fallback.

**The MCP server cannot be used from a Chrome extension.** Verified facts:

- The MCP server is published as `scanrepo-mcp` and is **stdio-only** — the docs page
  (`/mcp`) shows it being registered as a subprocess: `claude mcp add scanrepo -- npx -y
  scanrepo-mcp`. There is no HTTP/SSE transport exposed.
- A Manifest V3 service worker cannot spawn processes or run `npx`. Offscreen documents
  likewise cannot spawn subprocesses.
- `scanrepo-mcp` is **not published to npm** — `npm view scanrepo-mcp` returns `404 Not
  Found`, despite the `/mcp` page instructing users to `npx -y scanrepo-mcp`. So even a
  native-messaging host could not install it today.

**Therefore the primary integration is the scanrepo.dev HTTP API**, which the service
exposes and the web UI itself uses. The CLI remains the schema reference (it produces the
identical result object). This is a documentation correction; the extension therefore talks
to the HTTP API directly.

## 2. Primary endpoint — `POST https://www.scanrepo.dev/api/scan`

Request:

```http
POST /api/scan
Content-Type: application/json

{ "url": "github.com/owner/repo" }
```

- `url` is **required**; omitting it returns `400 {"error":"URL is required"}`.
- Accepts GitHub (`github.com/owner/repo`) and Bitbucket (`bitbucket.org/workspace/repo`).
- The apex host `scanrepo.dev` responds `307` to `www.scanrepo.dev`; always call the `www`
  host directly to avoid a cross-origin redirect.

Response is **newline-delimited JSON** (NDJSON), not a single JSON body. Each line is one
event:

```json
{"type":"progress","step":"Checking cache...","progress":5}
{"type":"progress","step":"Downloading tarball...","progress":40}
{"type":"result","data":{ ...Report }}
```

Consume by reading the stream, splitting on newlines, discarding `progress` events and
taking the final `result` event's `data` as the Report.

### Options accepted

`token` (GitHub PAT, lifts anonymous rate limits) and `publish`/`noPublish` are accepted
field names on the request body. Note: **the service response does not echo which mode it
used**, and a cached response short-circuits before the option is applied. The extension
therefore sends the privacy preference but does **not** claim in the UI that a scan was or
was not published, because that cannot be verified from the response.

## 3. The Report object

Verified top-level fields:

| Field | Type | Notes |
|---|---|---|
| `riskLevel` | string | one of `safe` `low` `suspicious` `dangerous` `malicious` (`incomplete` is signalled separately) |
| `riskScore` | number | 0–100 |
| `findings` | array | see below |
| `categories` | array | `{id,name,icon,score,maxScore,findings}` |
| `filesScanned` | number | |
| `totalRepoFiles` | number | |
| `coverage` | number | 0–1 fraction |
| `incomplete` | boolean | true when too few files were read to stand behind a verdict |
| `commitSha` / `rawCommitSha` | string | the commit scanned |
| `ref` | string | branch name |
| `scannedAt` | ISO string | |
| `scannerVersion` | string | |
| `cached` | boolean | |
| `source` | string | e.g. `cli`, `manual` |
| `repoUrl` | string | canonical repo tree URL |
| `meta` | object | `owner`, `repo`, `stars`, `forks`, `openIssues`, `description`, `provider`, `defaultBranch`, `createdAt`, `pushedAt`, `language`, `topics`, `size` |
| `badges` | array | repo-age / popularity signals |
| `graph` | object | import graph; `nodes`, `edges`, `entryPoints` — not rendered by the extension |

### Finding object

Verified field set (union across a real dangerous scan):

| Field | Type | Notes |
|---|---|---|
| `ruleId` | string | e.g. `browser-profiles` |
| `title` | string | human-readable, e.g. "Browser credential store access" |
| `description` | string | |
| `severity` | string | `critical` \| `warning` \| `info` |
| `category` | string | e.g. `filesystem-access` |
| `points` | number | contribution to the score |
| `filePath` | string | **may be empty** for repo-level findings |
| `snippet` | string | **may be absent** entirely |

> **Correction to the epic and acceptance criteria.** The epic requires top findings shown
> as **"file + line + rule"** and the spike stage says to freeze fields "score, verdict,
> findings, file, line". **The scanner does not produce line numbers.** The verified field
> set contains `filePath` and `snippet`, with no line/column/offset field anywhere in the
> finding object, and `filePath` is empty for repo-level (supply-chain/reputation)
> findings. The results UI therefore shows **file + rule + severity**, rendering the
> snippet as context, and labels repo-level findings as such rather than displaying a bare
> empty path. Likewise there is no `summary` field; the extension derives the summary from
> `findings`.

## 4. Report deep link

Verified canonical form:

```
https://www.scanrepo.dev/scan/{provider}/{owner}/{repo}
```

Confirmed live: `https://www.scanrepo.dev/scan/github/moom825/Discord-RAT` returns `200`
and renders `dangerous` / `70/100`. `{provider}` is `github` or `bitbucket`, taken from
`meta.provider`. This exact URL shape appears in the site's own `sitemap.xml`, confirming
it is the published permalink.

Construct it from the scanned repo identity, never from raw user input, to avoid producing
an off-site link to an attacker-supplied host.

## 5. Public-repo-only gating

The service supports public repos only. The extension must not offer a scan it cannot
perform. Reliable signals, cheapest first:

1. **Visibility from the DOM** — the repo page renders a `Public`/`Private` label next to
   the repo name. Primary signal.
2. **`meta` from GitHub's own JSON** — `GET https://api.github.com/repos/{owner}/{repo}`
   returns `private` and `visibility`. Authoritative cross-check when a PAT is configured;
   unauthenticated calls are rate-limited.
3. **Failure path** — if the scan returns an error indicating the repo is private or
   inaccessible, surface it as a friendly "private/unsupported" state rather than a raw
   error.

Gating behaviour: the button is **not rendered** on private repos (per the epic: "button
must be hidden (or disabled with a notice)"). The extension prefers hidden, and shows an
explanatory state on the options page.

## 6. Static-analysis-only language

Required UI copy, taken from the service's own limitation text: a `safe`/`low` verdict
means *no known pattern matched*, not a guarantee of safety. The service additionally
warns that anonymous rate limits can truncate large scans (surfaced as `incomplete` /
low `coverage`), and that results are published to scanrepo.dev by default.

## 7. Error and rate-limit behaviour

- `400` — missing/invalid `url`. Treated as a programming error; shown as a generic
  failure.
- Non-200 with `{"error": ...}` — surfaced verbatim as the error message (the service's
  messages are user-facing).
- Network failure / timeout — the extension imposes its own timeout (default 90s; a large
  cold scan can exceed 60s) and reports a timeout state with a link to the web report.
- No `RateLimit-*` or `Retry-After` headers were returned on the observed responses, so the
  extension cannot read remaining quota from headers. It therefore surfaces the
  `incomplete` flag and the coverage percentage instead of guessing at an unverifiable
  quota number.

## 8. What the extension must never do

- Never execute or download repository code. All analysis is server-side; the extension
  only receives a JSON report.
- Never fetch scanrepo.dev from the content script (the page origin). All network calls go
  through the background service worker, keeping the request off GitHub's origin and
  CSP-safe.
- Never send the user's PAT anywhere except the scanrepo.dev scan endpoint.