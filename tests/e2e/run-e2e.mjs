// End-to-end test: loads the built extension into a real Chromium and drives it on
// a real github.com repository page, against the live scanrepo.dev API.
//
// Order matters. The options page is exercised first so the saved settings are in
// place before the scan that asserts they were forwarded to the API.
//
// Run with: npm run test:e2e
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = path.join(root, 'dist');
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/chromium';
// A tiny public repo, so the live scan is quick.
const FIXTURE_REPO = process.env.E2E_REPO ?? 'octocat/Hello-World';
const PROTOCOL_TIMEOUT_MS = 180_000;

const failures = [];
const passes = [];

function check(label, condition, detail = '') {
  if (condition) {
    passes.push(label);
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

if (!existsSync(dist)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}
if (!existsSync(CHROME)) {
  console.error(`Chromium not found at ${CHROME} — set CHROME_PATH.`);
  process.exit(1);
}

const profile = await mkdtemp(path.join(tmpdir(), 'scanrepo-e2e-'));
let browser;

try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    userDataDir: profile,
    protocolTimeout: PROTOCOL_TIMEOUT_MS,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
    ],
  });

  console.log(`\n[1] the extension loads`);
  const workerTarget = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().includes('background.js'),
    { timeout: 15_000 },
  );
  check('background service worker registers', Boolean(workerTarget));
  const worker = await workerTarget.worker();
  const workerReady = await worker.evaluate(() => typeof fetch === 'function');
  check('service worker has fetch available', workerReady === true);

  // ---------------------------------------------------------------------------
  console.log(`\n[2] the options page renders and saves settings`);
  const optionsUrl = await worker.evaluate(() => chrome.runtime.getURL('options.html'));
  const optionsPage = await browser.newPage();
  const optionsErrors = [];
  optionsPage.on('pageerror', (error) => optionsErrors.push(error.message));
  await optionsPage.goto(optionsUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  const optionsState = await optionsPage.evaluate(() => ({
    hasForm: Boolean(document.getElementById('options-form')),
    tokenField: document.getElementById('githubToken')?.type,
    publishDefault: document.getElementById('publish')?.checked,
    timeoutValue: document.getElementById('timeoutMs')?.value,
    limitsMentioned: document.body.textContent.includes('Public repositories only'),
  }));
  check('options form renders', optionsState.hasForm);
  check('token field is masked', optionsState.tokenField === 'password', optionsState.tokenField);
  check('publish is off by default', optionsState.publishDefault === false);
  check('timeout default is 90 seconds', optionsState.timeoutValue === '90', optionsState.timeoutValue);
  check('the public-repos-only limitation is documented', optionsState.limitsMentioned);
  check('no script errors on the options page', optionsErrors.length === 0, optionsErrors.join('; '));

  await optionsPage.evaluate(() => {
    document.getElementById('timeoutMs').value = '120';
    document.getElementById('githubToken').value = 'ghp_e2e_probe_token';
    document.getElementById('publish').checked = true;
    document.getElementById('options-form').requestSubmit();
  });
  await optionsPage.waitForFunction(
    () => !document.getElementById('status')?.hidden,
    { timeout: 10_000 },
  );

  const saved = await worker.evaluate(() =>
    chrome.storage.sync.get(['timeoutMs', 'publish', 'githubToken']),
  );
  check('timeout persists', saved.timeoutMs === 120_000, String(saved.timeoutMs));
  check('publish preference persists', saved.publish === true, String(saved.publish));
  check(
    'token persists',
    saved.githubToken === 'ghp_e2e_probe_token',
    saved.githubToken ? 'present' : 'missing',
  );

  // ---------------------------------------------------------------------------
  console.log(`\n[3] the button renders on a repository page (${FIXTURE_REPO})`);
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  // Capture the scan request the service worker emits. An MV3 worker's fetch is not
  // attributed to any page, so listen on the worker target's own CDP session.
  const workerSession = await workerTarget.createCDPSession();
  await workerSession.send('Network.enable');
  const scanRequests = [];
  workerSession.on('Network.requestWillBeSent', (event) => {
    if (event.request.url.includes('scanrepo.dev/api')) {
      scanRequests.push({
        url: event.request.url,
        method: event.request.method,
        body: event.request.postData,
      });
    }
  });

  await page.goto(`https://github.com/${FIXTURE_REPO}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForSelector('#scanrepo-scan-button', { timeout: 30_000 });
  check('the button is injected', true);

  const injected = await page.evaluate(() => {
    const button = document.getElementById('scanrepo-scan-button');
    // Select the *rendered* Code control; file-view dropdowns reuse the same label.
    const codeButton =
      [...document.querySelectorAll('button, summary, a[role="button"]')].find(
        (el) => /^code$/i.test(el.textContent.trim()) && el.getClientRects().length > 0,
      ) ?? null;
    return {
      visible: button.offsetParent !== null,
      label: button.querySelector('.scanrepo-btn-label')?.textContent ?? '',
      hasAria: button.getAttribute('aria-haspopup'),
      stylesheetHref: document.getElementById('scanrepo-styles')?.getAttribute('href') ?? '',
      codeButtonFound: Boolean(codeButton),
      sharesRowWithCode: Boolean(codeButton && button.parentElement === codeButton.parentElement),
      isPrecedingSiblingOfCode: Boolean(codeButton && button.nextElementSibling === codeButton),
      rowSiblings: codeButton
        ? [...button.parentElement.children].map((c) => c.textContent.trim().slice(0, 18))
        : [],
    };
  });
  const row = injected.rowSiblings.join(' | ');
  check('the button is visible', injected.visible);
  check('the native Code control was found', injected.codeButtonFound);
  check('the button shares the action row with Code', injected.sharesRowWithCode, row);
  check('the button is the immediate predecessor of Code', injected.isPrecedingSiblingOfCode, row);
  check('the button label reads "Scan this repo"', injected.label === 'Scan this repo', injected.label);
  check('the content stylesheet is injected', injected.stylesheetHref.includes('content.css'));
  check('the button declares a dialog popup', injected.hasAria === 'dialog');

  // ---------------------------------------------------------------------------
  console.log(`\n[4] a live scan runs and returns a verdict`);
  await page.click('#scanrepo-scan-button');
  await page.waitForFunction(
    () => document.getElementById('scanrepo-scan-button')?.dataset.state === 'loading',
    { timeout: 15_000 },
  );
  check('the button enters the loading state on click', true);

  await page.waitForFunction(
    () => {
      const state = document.getElementById('scanrepo-scan-button')?.dataset.state;
      return state === 'ready' || state === 'error';
    },
    { timeout: 120_000, polling: 500 },
  );

  const result = await page.evaluate(() => {
    const tooltip = document.getElementById('scanrepo-tooltip');
    return {
      state: document.getElementById('scanrepo-scan-button')?.dataset.state,
      verdict: tooltip?.dataset.verdict,
      summary: tooltip?.querySelector('.scanrepo-summary')?.textContent ?? '',
      visible: tooltip?.classList.contains('scanrepo-tooltip-visible') ?? false,
      linkHref: tooltip?.querySelector('.scanrepo-link')?.getAttribute('href') ?? '',
      linkRel: tooltip?.querySelector('.scanrepo-link')?.getAttribute('rel') ?? '',
      disclaimer: tooltip?.querySelector('.scanrepo-disclaimer')?.textContent ?? '',
      errorText: tooltip?.querySelector('.scanrepo-error')?.textContent ?? '',
      scoreText: tooltip?.querySelector('.scanrepo-score-value')?.textContent ?? '',
      hasRawScript: (tooltip?.innerHTML ?? '').includes('<script'),
    };
  });

  check('the scan reaches a terminal state', result.state === 'ready', `state=${result.state} ${result.errorText}`);
  check('the tooltip becomes visible', result.visible);
  check(
    'the verdict is a known state',
    ['safe', 'low', 'suspicious', 'dangerous', 'malicious', 'inconclusive'].includes(result.verdict),
    `verdict=${result.verdict}`,
  );
  check('a summary line is rendered', result.summary.length > 0, result.summary);
  check('a numeric risk score is shown', /^\d{1,3}\/100$/.test(result.scoreText), result.scoreText);
  check('no raw script tag in the tooltip markup', result.hasRawScript === false);

  // ---------------------------------------------------------------------------
  console.log(`\n[5] the deep link to the full report is well-formed`);
  check(
    'the link points at the repo report on scanrepo.dev',
    result.linkHref === `https://www.scanrepo.dev/scan/github/${FIXTURE_REPO}`,
    result.linkHref,
  );
  check('the link opens safely', result.linkRel.includes('noopener'), result.linkRel);

  console.log(`\n[6] the static-analysis disclaimer is present`);
  check(
    'the disclaimer warns the scan is not a guarantee',
    /not a guarantee/i.test(result.disclaimer),
    result.disclaimer,
  );

  // ---------------------------------------------------------------------------
  console.log(`\n[7] the emitted scan request is well-formed`);
  check('exactly one scan request was made', scanRequests.length === 1, `got ${scanRequests.length}`);

  const request = scanRequests[0];
  check(
    'the request targets the scanrepo.dev scan endpoint',
    request?.url === 'https://www.scanrepo.dev/api/scan',
    request?.url,
  );
  check('the request uses POST', request?.method === 'POST', request?.method);

  let body = null;
  try {
    body = JSON.parse(request?.body ?? 'null');
  } catch {
    body = null;
  }
  check('the request body is valid JSON', body !== null, String(request?.body).slice(0, 120));
  // scanrepo.dev rejects a bare `owner/repo` (HTTP 400) and accepts both
  // `github.com/o/r` and `https://github.com/o/r`; the scheme-less form is the
  // documented canonical one.
  check('the request carries the repo slug the API expects', body?.url === `github.com/${FIXTURE_REPO}`, body?.url);
  // These two prove the saved options were read and forwarded.
  check('the saved publish preference is forwarded', body?.publish === true, String(body?.publish));
  check(
    'the saved GitHub token is forwarded',
    body?.token === 'ghp_e2e_probe_token',
    body?.token ? 'present' : 'missing',
  );

  // ---------------------------------------------------------------------------
  console.log(`\n[8] non-repository pages are left alone`);
  const otherPage = await browser.newPage();
  // A nonexistent repo renders GitHub's 404 page, which has no action row. This also
  // proves injection is not attempted outside repository pages.
  await otherPage.goto('https://github.com/this-owner-does-not-exist-xyz/nope', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await otherPage.waitForFunction(
    () => document.readyState === 'complete',
    { timeout: 30_000 },
  );
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const absent = await otherPage.evaluate(() => !document.getElementById('scanrepo-scan-button'));
  check('no button on a non-repository page', absent);

  // ---------------------------------------------------------------------------
  console.log(`\n[9] the live API contract holds for other shapes`);
  // The unit suite covers transport deterministically against a local server; these
  // checks confirm the real API still behaves the way the client assumes.
  const apiProbe = await worker.evaluate(async () => {
    const probe = async (url) => {
      const response = await fetch('https://www.scanrepo.dev/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, publish: false }),
      });
      const text = await response.text();
      const events = text
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return { type: 'unparseable' };
          }
        });
      return {
        status: response.status,
        types: events.map((e) => e.type),
        result: events.find((e) => e.type === 'result')?.data ?? null,
      };
    };
    return {
      bareSlug: await probe('octocat/Hello-World'),
      fullUrl: await probe('github.com/octocat/Hello-World'),
    };
  });

  check('a bare owner/repo is rejected as invalid', apiProbe.bareSlug.status === 400, String(apiProbe.bareSlug.status));
  check('the scheme-less slug form is accepted', apiProbe.fullUrl.status === 200, String(apiProbe.fullUrl.status));
  check(
    'the stream ends with a result frame',
    apiProbe.fullUrl.types.at(-1) === 'result',
    apiProbe.fullUrl.types.join(','),
  );
  check(
    'the result carries riskLevel, riskScore and findings',
    typeof apiProbe.fullUrl.result?.riskLevel === 'string' &&
      typeof apiProbe.fullUrl.result?.riskScore === 'number' &&
      Array.isArray(apiProbe.fullUrl.result?.findings),
    JSON.stringify(apiProbe.fullUrl.result ?? {}).slice(0, 120),
  );
} catch (error) {
  failures.push(`harness error: ${error.message}`);
  console.error(`\nharness error: ${error.stack}`);
} finally {
  await browser?.close();
  await rm(profile, { recursive: true, force: true });
}

console.log(`\n${passes.length} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const failure of failures) console.log(`  - ${failure}`);
}
process.exit(failures.length ? 1 : 0);