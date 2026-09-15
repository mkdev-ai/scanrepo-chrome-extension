import { DEFAULT_OPTIONS } from '../contract.js';

const form = /** @type {HTMLFormElement} */ (document.getElementById('options-form'));
const status = /** @type {HTMLElement} */ (document.getElementById('status'));
const tokenInput = /** @type {HTMLInputElement} */ (document.getElementById('githubToken'));
const publishInput = /** @type {HTMLInputElement} */ (document.getElementById('publish'));
const scanOnLoadInput = /** @type {HTMLInputElement} */ (document.getElementById('scanOnLoad'));
const timeoutInput = /** @type {HTMLInputElement} */ (document.getElementById('timeoutMs'));

/**
 * @param {string} message
 * @param {boolean} [isError]
 */
function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
  if (message) setTimeout(() => (status.textContent = ''), 4000);
}

/** @param {Record<string, any>} options */
function toForm(options) {
  tokenInput.value = options.githubToken ?? '';
  publishInput.checked = options.publish === true;
  scanOnLoadInput.checked = options.scanOnLoad === true;
  timeoutInput.value = String(Math.round((options.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs) / 1000));
}

function fromForm() {
  const seconds = Number(timeoutInput.value);
  const timeoutMs =
    Number.isFinite(seconds) && seconds >= 10 && seconds <= 600
      ? Math.round(seconds * 1000)
      : DEFAULT_OPTIONS.timeoutMs;
  return {
    githubToken: tokenInput.value.trim(),
    publish: publishInput.checked,
    scanOnLoad: scanOnLoadInput.checked,
    timeoutMs,
  };
}

async function load() {
  try {
    const stored = await chrome.storage.sync.get(DEFAULT_OPTIONS);
    toForm({ ...DEFAULT_OPTIONS, ...stored });
  } catch {
    toForm(DEFAULT_OPTIONS);
    setStatus('Could not read saved settings.', true);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await chrome.storage.sync.set(fromForm());
    setStatus('Saved.');
  } catch {
    setStatus('Could not save settings.', true);
  }
});

const resetButton = /** @type {HTMLElement} */ (document.getElementById('reset'));
resetButton.addEventListener('click', async () => {
  try {
    await chrome.storage.sync.set({ ...DEFAULT_OPTIONS });
    toForm(DEFAULT_OPTIONS);
    setStatus('Reset to defaults.');
  } catch {
    setStatus('Could not reset settings.', true);
  }
});

void load();