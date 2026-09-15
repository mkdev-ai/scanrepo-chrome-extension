// DOM discovery for GitHub repository pages, hardened against GitHub's DOM churn.
// Every function takes an explicit root element so it can be unit-tested with jsdom.
//
// Verified against github.com as of 2026-09: GitHub no longer renders
// `data-testid="code-button"`, the repository header (`#repository-container-header`)
// contains only the repo name and visibility label, and `ul.pagehead-actions` now
// holds the Notifications control rather than the Code/Watch/Fork action bar. The
// Code button is a direct child of an unlabelled flex container. Discovery therefore
// searches the document for a visible "Code" control and anchors to its parent.

/**
 * Prefer elements that are actually rendered. jsdom reports no client rects at all,
 * so fall back to document order rather than discarding every candidate.
 * @param {HTMLElement[]} candidates
 * @returns {HTMLElement[]}
 */
function preferVisible(candidates) {
  const rendered = candidates.filter((el) => el.getClientRects().length > 0);
  return rendered.length ? rendered : candidates;
}

/**
 * Locate the "Code" button that our button must sit before.
 * File-view dropdowns reuse the "Code" label, so the overview action row is taken
 * first — it appears earlier in document order than any in-file control.
 * @param {ParentNode} root
 * @returns {HTMLElement | null}
 */
export function findCodeButton(root) {
  const legacy = root.querySelector('[data-testid="code-button"]');
  if (legacy instanceof HTMLElement && legacy.getClientRects().length > 0) return legacy;

  /** @type {HTMLElement[]} */
  const candidates = [];
  for (const el of root.querySelectorAll('button, summary, a[role="button"]')) {
    if (el instanceof HTMLElement && /^code$/i.test(el.textContent?.trim() ?? '')) {
      candidates.push(el);
    }
  }
  if (candidates.length === 0) return legacy instanceof HTMLElement ? legacy : null;
  return preferVisible(candidates)[0] ?? null;
}

/**
 * The element the button is inserted before. The Code button's own parent holds the
 * action row ("Go to file", "Code", "…"), so it is the correct inline anchor.
 * @param {Element | null} codeButton
 * @returns {Element | null}
 */
export function findActionContainer(codeButton) {
  return codeButton?.parentElement ?? null;
}

/**
 * Detect whether the current repo is private.
 * scanrepo.dev scans public repos only, so the button must not be offered otherwise.
 * Falls back to "public" and lets the scan itself report an inaccessible repo.
 * @param {ParentNode} root
 * @returns {boolean}
 */
export function isPrivateRepo(root) {
  const meta = root.querySelector('meta[name="octolytics-dimension-repository_public"]');
  if (meta) {
    const value = meta.getAttribute('content');
    if (value === 'false') return true;
    if (value === 'true') return false;
  }

  // The header renders the visibility as a standalone "Public"/"Private" label.
  const header = root.querySelector('#repository-container-header') ?? root;
  for (const node of header.querySelectorAll('span, div, a')) {
    const text = node.textContent?.trim() ?? '';
    if (/^private$/i.test(text)) return true;
    if (/^public$/i.test(text)) return false;
  }
  return false;
}

/** Repo identity taken from the page URL, independent of DOM structure.
 * @param {{pathname: string}} location
 * @returns {import('../types.js').RepoTarget | null}
 */
export function repoFromLocation(location) {
  const segments = location.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;
  const [owner, repo] = segments;
  if (!owner || !repo) return null;
  return { owner, repo, provider: 'github' };
}