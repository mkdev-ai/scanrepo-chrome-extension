// Content script: injects the "Scan this repo" button into GitHub's repository
// action bar, immediately before the native "Code" button.

import { buildViewModel, errorViewModel, pendingViewModel } from '../lib/report.js';
import { autoScanKey, shouldAutoScan } from './auto-scan.js';
import { findActionContainer, findCodeButton, isPrivateRepo } from './dom.js';
import { parseRepoFromUrl } from '../lib/parse.js';
import { removeTooltip, renderTooltip } from '../ui/tooltip.js';

const BUTTON_ID = 'scanrepo-scan-button';
const STYLE_ID = 'scanrepo-styles';
const HOVER_CLOSE_DELAY_MS = 250;

/** @type {'idle'|'loading'|'ready'|'error'} */
let state = 'idle';
/** @type {import('../types.js').ViewModel | null} */
let currentVm = null;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let closeTimer;
/** Repo already auto-scanned in this page. Survives in-repo navigation so a repo is
 *  scanned once per visit, while a move to a different repo scans again. */
let lastAutoScannedKey = '';
/** Last read of the scanOnLoad preference; the flag is never consulted directly. */
let scanOnLoadEnabled = false;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  // web_accessible_resources; loaded from the page so GitHub's CSP cannot block injecting CSS.
  link.href = chrome.runtime.getURL('content.css');
  (document.head || document.documentElement).appendChild(link);
}

function buildButton() {
  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.type = 'button';
  // Match GitHub's native action-bar button classes so it inherits Primer styling
  // and the same hover treatment as "Code".
  button.className = 'btn btn-sm scanrepo-btn';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');

  button.innerHTML = `
    <span class="scanrepo-btn-icon" aria-hidden="true">
      <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Zm0 2.5 1.6 3.4 3.7.5-2.7 2.6.7 3.7L8 10.9l-3.3 1.8.7-3.7L2.7 6.4l3.7-.5L8 2.5Z"/>
      </svg>
    </span>
    <span class="scanrepo-btn-label">Scan this repo</span>
    <span class="scanrepo-btn-spinner" hidden></span>`;
  return button;
}

/** The tooltip is positioned under the button; GitHub's header is sticky, so we
 *  anchor to the button's viewport rectangle each time it is shown. */
/** @param {HTMLElement} tooltip @param {HTMLElement} button */
function positionTooltip(tooltip, button) {
  const rect = button.getBoundingClientRect();
  tooltip.style.top = `${rect.bottom + window.scrollY + 6}px`;
  tooltip.style.left = `${Math.max(8, rect.left + window.scrollX - 220)}px`;
}

/** @param {'idle'|'loading'|'ready'|'error'} next @param {string} [label] */
function setButtonState(next, label) {
  state = next;
  const button = document.getElementById(BUTTON_ID);
  if (!(button instanceof HTMLButtonElement)) return;
  button.dataset.state = next;
  button.disabled = next === 'loading';
  const labelEl = button.querySelector('.scanrepo-btn-label');
  if (labelEl && label) labelEl.textContent = label;
  const spinner = button.querySelector('.scanrepo-btn-spinner');
  if (spinner instanceof HTMLElement) spinner.hidden = next !== 'loading';
}

function showTooltip() {
  const button = document.getElementById(BUTTON_ID);
  if (!button || !currentVm) return;
  clearTimeout(closeTimer);
  const tooltip = renderTooltip(document, currentVm);
  positionTooltip(tooltip, button);
  tooltip.classList.add('scanrepo-tooltip-visible');
  button.setAttribute('aria-expanded', 'true');
}

function hideTooltip() {
  const tooltip = document.getElementById('scanrepo-tooltip');
  const button = document.getElementById(BUTTON_ID);
  if (tooltip) tooltip.classList.remove('scanrepo-tooltip-visible');
  button?.setAttribute('aria-expanded', 'false');
}

function scheduleHide() {
  clearTimeout(closeTimer);
  closeTimer = setTimeout(hideTooltip, HOVER_CLOSE_DELAY_MS);
}

function showLoading() {
  const button = document.getElementById(BUTTON_ID);
  if (!button) return;
  const [owner, repo] = window.location.pathname.split('/').filter(Boolean);
  currentVm = pendingViewModel(`${owner}/${repo}`);
  showTooltip();
}

/** @param {import('../types.js').RepoTarget} target */
async function runScan(target) {
  if (state === 'loading') return;
  // Remember which repo this page has already scanned, so the auto-scan below does not
  // fire again the next time the observer runs injection.
  lastAutoScannedKey = autoScanKey(target);
  setButtonState('loading', 'Scanning…');
  showLoading();

  let response;
  try {
    response = await chrome.runtime.sendMessage({
      type: 'scanrepo:scan',
      owner: target.owner,
      repo: target.repo,
    });
  } catch {
    response = { ok: false, error: { message: 'Extension was reloaded. Refresh the page.', code: 'disconnected' } };
  }

  if (!response || !response.ok) {
    const errorMessage = response && response.error ? response.error.message : undefined;
    const message = errorMessage === undefined ? 'Scan failed.' : errorMessage;
    currentVm = errorViewModel(`${target.owner}/${target.repo}`, message);
    setButtonState('error', 'Scan failed');
    showTooltip();
    return;
  }

  currentVm = buildViewModel(response.report);
  setButtonState('ready', 'Scan this repo');
  showTooltip();
}

/** Trigger the automatic scan once per repository, when the preference is on.
 *  Injection re-runs constantly on GitHub's single-page app, so the guard matters. */
function maybeAutoScan() {
  // Without the button there is nowhere to show progress or the result, so wait for
  // injection to land; the observer re-runs this as soon as it does.
  if (!document.getElementById(BUTTON_ID)) return;
  const target = parseRepoFromUrl(window.location.href);
  if (!target) return;
  const key = autoScanKey(target);
  if (!shouldAutoScan({ enabled: scanOnLoadEnabled, key, lastScannedKey: lastAutoScannedKey, state })) return;
  lastAutoScannedKey = key;
  runScan(target);
}

/** Read the scanOnLoad preference from the worker, which owns chrome.storage. */
async function loadScanOnLoadSetting() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'scanrepo:options' });
    scanOnLoadEnabled = Boolean(response && response.scanOnLoad === true);
  } catch {
    // Worker not reachable (e.g. extension was reloaded): leave auto-scan off.
    scanOnLoadEnabled = false;
  }
  maybeAutoScan();
}

/** Inject the button before "Code". Returns false when the page is not ready. */
function injectButton() {
  if (document.getElementById(BUTTON_ID)) return true;

  const root = document;
  // Private repos are unsupported by scanrepo.dev — do not offer a scan we cannot run.
  if (isPrivateRepo(root)) return false;

  const codeButton = findCodeButton(root);
  const target = parseRepoFromUrl(window.location.href);
  if (!codeButton || !target) return false;

  // Insert immediately before the native Code control, in its own action row.
  const container = findActionContainer(codeButton);
  if (!container) return false;
  const button = buildButton();

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (state === 'loading') return;
    if (state === 'ready') {
      // Already scanned: toggle the existing result rather than rescanning.
      const tooltip = document.getElementById('scanrepo-tooltip');
      if (tooltip?.classList.contains('scanrepo-tooltip-visible')) hideTooltip();
      else showTooltip();
      return;
    }
    runScan(target);
  });

  // Mirror GitHub's own hover-tooltip behaviour on the "Code" button.
  button.addEventListener('mouseenter', () => {
    if (currentVm) showTooltip();
  });
  button.addEventListener('mouseleave', scheduleHide);
  button.addEventListener('focus', () => {
    if (currentVm) showTooltip();
  });

  // Keep the tooltip reachable: hovering the tooltip itself must not dismiss it.
  /** @param {Event} event @returns {boolean} */
  const isTooltipEvent = (event) =>
    event.target instanceof Element && event.target.closest('#scanrepo-tooltip') !== null;
  document.addEventListener('mouseover', (event) => {
    if (isTooltipEvent(event)) clearTimeout(closeTimer);
  });
  document.addEventListener('mouseout', (event) => {
    if (isTooltipEvent(event)) scheduleHide();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideTooltip();
  });

  // Insert inside the action row, immediately before the native Code control.
  container.insertBefore(button, codeButton);
  maybeAutoScan();
  return true;
}

function cleanup() {
  document.getElementById(BUTTON_ID)?.remove();
  removeTooltip();
  state = 'idle';
  currentVm = null;
}

/**
 * GitHub is a single-page app: navigating swaps the DOM without a reload.
 * A MutationObserver re-runs injection, and a history patch detects soft navigation
 * so the button tracks the repo actually being viewed.
 */
function watchForChanges() {
  injectStyles();
  injectButton();
  // Fire-and-forget: loads the auto-scan preference, then scans if it is on.
  void loadScanOnLoadSetting();

  let lastUrl = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      cleanup();
      injectStyles();
    }
    injectButton();
    // The observer is the only signal that injection (and so the button) is ready.
    maybeAutoScan();
  });
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

  const mutableHistory = /** @type {Record<string, any>} */ (history);
  for (const method of ['pushState', 'replaceState']) {
    const original = mutableHistory[method];
    mutableHistory[method] = function patched(/** @type {any[]} */ ...args) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event('scanrepo:locationchange'));
      return result;
    };
  }
  window.addEventListener('scanrepo:locationchange', () => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      cleanup();
      injectStyles();
      injectButton();
      maybeAutoScan();
    }
  });
  window.addEventListener('popstate', () => {
    cleanup();
    injectStyles();
    injectButton();
    maybeAutoScan();
  });

  // Progress frames from the background worker keep the tooltip honest while scanning.
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'scanrepo:progress' && state === 'loading' && currentVm) {
      const { step, progress } = message.progress;
      currentVm.summary = `${step} (${progress}%)`;
      const button = document.getElementById(BUTTON_ID);
      if (button) {
        const tooltip = renderTooltip(document, currentVm);
        positionTooltip(tooltip, button);
        tooltip.classList.add('scanrepo-tooltip-visible');
      }
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', watchForChanges, { once: true });
} else {
  watchForChanges();
}