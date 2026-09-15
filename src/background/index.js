// Background service worker: the only place that talks to scanrepo.dev.
// Content-script scans are relayed here so no cross-origin request is ever made
// from GitHub's origin (CSP-safe), and the GitHub token never enters page context.

import { DEFAULT_OPTIONS } from '../contract.js';
import { scanRepo } from '../lib/scan-client.js';

const SCAN_MESSAGE = 'scanrepo:scan';

export async function readOptions() {
  try {
    const stored = await chrome.storage.sync.get(DEFAULT_OPTIONS);
    return { ...DEFAULT_OPTIONS, ...stored };
  } catch {
    // storage unavailable (e.g. worker spun up before install) — fall back to defaults
    return { ...DEFAULT_OPTIONS };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== SCAN_MESSAGE) return false;

  // Only relay for requests originating from a GitHub tab.
  const senderUrl = sender?.tab?.url ?? sender?.url ?? '';
  const hostname = (() => {
    try {
      return new URL(senderUrl).hostname;
    } catch {
      return '';
    }
  })();
  if (hostname !== 'github.com' && hostname !== 'www.github.com') {
    sendResponse({ ok: false, error: { message: 'Unsupported origin.', code: 'bad-origin' } });
    return false;
  }

  /** @type {import('../types.js').RepoTarget} */
  const target = {
    owner: String(message.owner ?? ''),
    repo: String(message.repo ?? ''),
    provider: 'github',
  };
  if (!target.owner || !target.repo) {
    sendResponse({ ok: false, error: { message: 'Missing repository.', code: 'bad-request' } });
    return false;
  }

  const tabId = sender.tab?.id;
  (async () => {
    try {
      const options = await readOptions();
      const report = await scanRepo(target, options, (progress) => {
        // Progress frames are best-effort; the tab may have navigated away.
        if (tabId === undefined) return;
        chrome.tabs.sendMessage(tabId, { type: 'scanrepo:progress', progress }).catch(() => {});
      });
      sendResponse({ ok: true, report });
    } catch (error) {
      const err = /** @type {{message?: string, code?: string}} */ (error);
      sendResponse({
        ok: false,
        error: { message: err?.message ?? 'Scan failed.', code: err?.code ?? 'unknown' },
      });
    }
  })();

  return true; // keep the message channel open for the async response
});

chrome.runtime.onInstalled?.addListener(({ reason }) => {
  if (reason === 'install') chrome.runtime.openOptionsPage?.();
});