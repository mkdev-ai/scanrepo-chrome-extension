// The "Scan automatically when a repository page loads" preference.
//
// Regression guard for SCB-3: the options page saved `scanOnLoad` but nothing ever read
// it, so ticking the box had no effect. The decision is pure, so it is tested directly;
// the e2e suite proves the wiring in a real browser.
import { describe, expect, it } from 'vitest';
import { autoScanKey, shouldAutoScan } from '../../src/content/auto-scan.js';

/** Defaults describing an idle page for a repo that has not been scanned yet. */
function idle(overrides = {}) {
  return { enabled: true, key: 'octocat/hello-world', lastScannedKey: '', state: 'idle', ...overrides };
}

describe('autoScanKey', () => {
  it('joins owner and repo, lower-cased', () => {
    expect(autoScanKey({ owner: 'OctoCat', repo: 'Hello-World' })).toBe('octocat/hello-world');
  });

  it('is empty without a target', () => {
    expect(autoScanKey(null)).toBe('');
  });
});

describe('shouldAutoScan', () => {
  it('scans an idle repository page when the preference is on', () => {
    expect(shouldAutoScan(idle())).toBe(true);
  });

  it('does nothing when the preference is off', () => {
    // The bug: this returned true, or the flag was never read at all.
    expect(shouldAutoScan(idle({ enabled: false }))).toBe(false);
  });

  it('scans each repository only once', () => {
    expect(shouldAutoScan(idle({ lastScannedKey: 'octocat/hello-world' }))).toBe(false);
  });

  it('scans again when navigating to a different repository', () => {
    expect(shouldAutoScan(idle({ key: 'facebook/react', lastScannedKey: 'octocat/hello-world' }))).toBe(true);
  });

  it('does not re-enter while a scan is in flight', () => {
    expect(shouldAutoScan(idle({ state: 'loading' }))).toBe(false);
  });

  it('does not rescan after a result is on screen', () => {
    expect(shouldAutoScan(idle({ state: 'ready' }))).toBe(false);
  });

  it('does not scan a page that is not a repository', () => {
    expect(shouldAutoScan(idle({ key: '' }))).toBe(false);
  });
});