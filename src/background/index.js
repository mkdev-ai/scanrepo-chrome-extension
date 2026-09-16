// Background service worker: the only place that talks to scanrepo.dev.
// Content-script scans are relayed here so no cross-origin request is ever made
// from GitHub's origin (CSP-safe), and the GitHub token never enters page context.

import { DEFAULT_OPTIONS } from '../contract.js';
import { scanRepo } from '../lib/scan-client.js';

const SCAN_MESSAGE = 'scanrepo:scan';
const GITHUB_HOSTS = ['github.com', 'www.github.com'];

export async function readOptions() {
  try {
    const stored = await chrome.storage.sync.get(DEFAULT_OPTIONS);
    return { ...DEFAULT_OPTIONS, ...stored };
  } catch {
    // storage unavailable (e.g. worker spun up before install) — fall back to defaults
    return { ...DEFAULT_OPTIONS };
  }
}

/** Hostname of the sender, or an empty string when it cannot be determined.
 * @param {chrome.runtime.MessageSender} sender
 * @returns {string}
 */
function senderHostname(sender) {
  let raw = '';
  if (sender.tab && sender.tab.url) raw = sender.tab.url;
  else if (sender.url) raw = sender.url;
  try {
    return new URL(raw).hostname;
  } catch {
    return '';
  }
}

/** Build a RepoTarget from an untrusted message payload.
 * @param {any} message
 * @returns {import('../types.js').RepoTarget}
 */
function targetFromMessage(message) {
  return {
    owner: String(message.owner === undefined ? '' : message.owner),
    repo: String(message.repo === undefined ? '' : message.repo),
    provider: 'github',
  };
}

/** @param {unknown} error @returns {{message: string, code: string}} */
function toErrorPayload(error) {
  const err = /** @type {{message?: string, code?: string}} */ (error);
  const message = err && err.message ? err.message : 'Scan failed.';
  const code = err && err.code ? err.code : 'unknown';
  return { message, code };
}

/** Run the scan and answer the originator, streaming progress to its tab.
 * @param {import('../types.js').RepoTarget} target
 * @param {chrome.runtime.MessageSender} sender
 * @param {(response: any) => void} sendResponse
 */
async function respondWithScan(target, sender, sendResponse) {
  const tabId = sender.tab ? sender.tab.id : undefined;
  /** @param {{step: string, progress: number}} progress */
  const onProgress = (progress) => {
    // Progress frames are best-effort; the tab may have navigated away.
    if (tabId === undefined) return;
    chrome.tabs.sendMessage(tabId, { type: 'scanrepo:progress', progress }).catch(() => {});
  };

  try {
    const options = await readOptions();
    const report = await scanRepo(target, options, onProgress);
    sendResponse({ ok: true, report });
  } catch (error) {
    sendResponse({ ok: false, error: toErrorPayload(error) });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== SCAN_MESSAGE) return false;

  // Only relay for requests originating from a GitHub tab.
  if (!GITHUB_HOSTS.includes(senderHostname(sender))) {
    sendResponse({ ok: false, error: { message: 'Unsupported origin.', code: 'bad-origin' } });
    return false;
  }

  const target = targetFromMessage(message);
  if (!target.owner || !target.repo) {
    sendResponse({ ok: false, error: { message: 'Missing repository.', code: 'bad-request' } });
    return false;
  }

  respondWithScan(target, sender, sendResponse);
  return true; // keep the message channel open for the async response
});

chrome.runtime.onInstalled?.addListener(({ reason }) => {
  if (reason === 'install') chrome.runtime.openOptionsPage?.();
});