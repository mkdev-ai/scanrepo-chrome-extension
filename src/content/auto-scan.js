// Policy for "Scan automatically when a repository page loads".
// Pure logic — no DOM and no chrome APIs — so the decision itself is unit-testable.

/**
 * Identity of a repository for de-duplicating auto-scans. GitHub is a single-page
 * app, so injection runs many times per page; each repo must scan only once.
 * @param {import('../types.js').RepoTarget | null} target
 * @returns {string}
 */
export function autoScanKey(target) {
  if (!target) return '';
  return `${target.owner}/${target.repo}`.toLowerCase();
}

/**
 * Decide whether the repository page on screen should scan itself.
 * @param {object} input
 * @param {boolean} input.enabled the saved scanOnLoad preference
 * @param {string} input.key identity of the repository on screen
 * @param {string} input.lastScannedKey repository already auto-scanned on this page
 * @param {'idle'|'loading'|'ready'|'error'} input.state current button state
 * @returns {boolean}
 */
export function shouldAutoScan({ enabled, key, lastScannedKey, state }) {
  if (!enabled) return false;
  if (state !== 'idle') return false;
  if (!key) return false;
  return key !== lastScannedKey;
}