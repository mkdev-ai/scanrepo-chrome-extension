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
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium';
// A tiny public repo, so the live scan is quick.
const FIXTURE_REPO = process.env.E2E_REPO || 'octocat/Hello-World';
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
    scanOnLoadDefault: document.getElementById('scanOnLoad')?.checked,
    timeoutValue: document.getElementById('timeoutMs')?.value,
    limitsMentioned: document.body.textContent.includes('Public repositories only'),
  }));
  check('options form renders', optionsState.hasForm);
  check('token field is masked', optionsState.tokenField === 'password', optionsState.tokenField);
  check('publish is off by default', optionsState.publishDefault === false);
  check('scan-on-load is off by default', optionsState.scanOnLoadDefault === false);
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
    // Read a nested field without optional chaining.
    const pick = (value, key) => (value === null || value === undefined ? undefined : value[key]);
    const text = (value) => (value === null || value === undefined ? '' : value);
    const button = document.getElementById('scanrepo-scan-button');
    // Select the *rendered* Code control; file-view dropdowns reuse the same label.
    let codeButton = null;
    for (const el of document.querySelectorAll('button, summary, a[role="button"]')) {
      if (/^code$/i.test(el.textContent.trim()) && el.getClientRects().length > 0) {
        codeButton = el;
        break;
      }
    }
    const parent = codeButton ? codeButton.parentElement : null;
    const stylesheet = document.getElementById('scanrepo-styles');
    const stylesheetHref = stylesheet ? stylesheet.getAttribute('href') : '';
    return {
      visible: button.offsetParent !== null,
      label: text(pick(button.querySelector('.scanrepo-btn-label'), 'textContent')),
      hasAria: button.getAttribute('aria-haspopup'),
      stylesheetHref,
      codeButtonFound: Boolean(codeButton),
      sharesRowWithCode: Boolean(parent && button.parentElement === parent),
      isPrecedingSiblingOfCode: Boolean(codeButton && button.nextElementSibling === codeButton),
      rowSiblings: parent
        ? [...parent.children].map((c) => c.textContent.trim().slice(0, 18))
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

  // scanOnLoad is off by default, so opening a repo page must not scan on its own.
  // This is the regression guard for SCB-3: the preference used to be saved but never read.
  check('no scan runs automatically while scan-on-load is off', scanRequests.length === 0, `got ${scanRequests.length}`);
  const idleState = await page.evaluate(() => document.getElementById('scanrepo-scan-button')?.dataset.state);
  check('the button stays idle until it is clicked', idleState !== 'loading', String(idleState));

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
    const pick = (value, key) => (value === null || value === undefined ? undefined : value[key]);
    const text = (value) => (value === null || value === undefined ? '' : value);
    const tooltip = document.getElementById('scanrepo-tooltip');
    const button = document.getElementById('scanrepo-scan-button');
    const queryText = (selector) => text(pick(tooltip ? tooltip.querySelector(selector) : null, 'textContent'));
    const queryAttr = (selector, attr) => {
      const el = tooltip ? tooltip.querySelector(selector) : null;
      return el ? text(el.getAttribute(attr)) : '';
    };
    return {
      state: pick(button, 'dataset') ? button.dataset.state : undefined,
      verdict: pick(tooltip, 'dataset') ? tooltip.dataset.verdict : undefined,
      summary: queryText('.scanrepo-summary'),
      visible: Boolean(tooltip && tooltip.classList.contains('scanrepo-tooltip-visible')),
      linkHref: queryAttr('.scanrepo-link', 'href'),
      linkRel: queryAttr('.scanrepo-link', 'rel'),
      disclaimer: queryText('.scanrepo-disclaimer'),
      errorText: queryText('.scanrepo-error'),
      scoreText: queryText('.scanrepo-score-value'),
      hasRawScript: text(pick(tooltip, 'innerHTML')).includes('<script'),
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
  const requestUrl = request ? request.url : undefined;
  const requestMethod = request ? request.method : undefined;
  const requestBody = request ? request.body : undefined;
  check(
    'the request targets the scanrepo.dev scan endpoint',
    requestUrl === 'https://www.scanrepo.dev/api/scan',
    requestUrl,
  );
  check('the request uses POST', requestMethod === 'POST', requestMethod);

  let body = null;
  try {
    body = JSON.parse(requestBody === undefined ? 'null' : requestBody);
  } catch {
    body = null;
  }
  check('the request body is valid JSON', body !== null, String(requestBody).slice(0, 120));
  // scanrepo.dev rejects a bare `owner/repo` (HTTP 400) and accepts both
  // `github.com/o/r` and `https://github.com/o/r`; the scheme-less form is the
  // documented canonical one.
  const bodyUrl = body ? body.url : undefined;
  check('the request carries the repo slug the API expects', bodyUrl === `github.com/${FIXTURE_REPO}`, bodyUrl);
  // These two prove the saved options were read and forwarded.
  const bodyPublish = body ? body.publish : undefined;
  check('the saved publish preference is forwarded', bodyPublish === true, String(bodyPublish));
  const bodyToken = body ? body.token : undefined;
  check(
    'the saved GitHub token is forwarded',
    bodyToken === 'ghp_e2e_probe_token',
    bodyToken ? 'present' : 'missing',
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
  console.log(`\n[9] scan-on-load runs by itself once it is enabled`);
  // Regression guard for SCB-3. Turn the preference on, then open a repository page
  // without clicking anything: the scan must start on its own and reach a verdict.
  await optionsPage.evaluate(() => {
    document.getElementById('scanOnLoad').checked = true;
    document.getElementById('options-form').requestSubmit();
  });
  const scanOnLoadSaved = await worker.evaluate(() => chrome.storage.sync.get(['scanOnLoad']));
  check('the scan-on-load preference persists', scanOnLoadSaved.scanOnLoad === true, String(scanOnLoadSaved.scanOnLoad));

  // A second repository proves the automatic scan is not tied to the first fixture.
  const AUTO_REPO = process.env.E2E_AUTO_REPO || 'octocat/Spoon-Knife';
  const autoRequests = [];
  workerSession.on('Network.requestWillBeSent', (event) => {
    if (event.request.url.includes('scanrepo.dev/api')) {
      autoRequests.push({ url: event.request.url, body: event.request.postData });
    }
  });

  const autoPage = await browser.newPage();
  await autoPage.setViewport({ width: 1280, height: 900 });
  await autoPage.goto(`https://github.com/${AUTO_REPO}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await autoPage.waitForSelector('#scanrepo-scan-button', { timeout: 30_000 });

  // Nobody clicks the button. Leaving `idle` at all is the behaviour under test, and it
  // happens within moments of load — so a short window keeps a regression failing fast
  // instead of turning into a two-minute harness timeout. A completed cached scan can
  // jump straight from idle to ready, so every non-idle state counts.
  let startedOnItsOwn = true;
  try {
    await autoPage.waitForFunction(
      () => {
        const state = document.getElementById('scanrepo-scan-button')?.dataset.state;
        return state === 'loading' || state === 'ready' || state === 'error';
      },
      { timeout: 20_000, polling: 250 },
    );
  } catch {
    startedOnItsOwn = false;
  }
  check('the page starts a scan with no click', startedOnItsOwn);

  const autoResult = { state: 'idle', verdict: undefined, visible: false, repo: '', errorText: 'never started' };
  if (startedOnItsOwn) {
    await autoPage.waitForFunction(
      () => {
        const state = document.getElementById('scanrepo-scan-button')?.dataset.state;
        return state === 'ready' || state === 'error';
      },
      { timeout: 120_000, polling: 500 },
    );
    const observed = await autoPage.evaluate(() => {
      const pick = (value, key) => (value === null || value === undefined ? undefined : value[key]);
      const text = (value) => (value === null || value === undefined ? '' : value);
      const tooltip = document.getElementById('scanrepo-tooltip');
      const button = document.getElementById('scanrepo-scan-button');
      return {
        state: pick(button, 'dataset') ? button.dataset.state : undefined,
        verdict: pick(tooltip, 'dataset') ? tooltip.dataset.verdict : undefined,
        visible: Boolean(tooltip && tooltip.classList.contains('scanrepo-tooltip-visible')),
        repo: text(pick(tooltip ? tooltip.querySelector('.scanrepo-repo') : null, 'textContent')),
        errorText: text(pick(tooltip ? tooltip.querySelector('.scanrepo-error') : null, 'textContent')),
      };
    });
    Object.assign(autoResult, observed);
  }

  check('the page scans itself without a click', autoResult.state === 'ready', `state=${autoResult.state} ${autoResult.errorText}`);
  check('the automatic scan shows its verdict', autoResult.visible && autoResult.verdict !== undefined, `verdict=${autoResult.verdict}`);
  check(
    'the automatic scan is for the repository on screen',
    autoResult.repo === AUTO_REPO,
    autoResult.repo,
  );

  // Exactly one scan for the page just opened — the observer runs injection many times
  // per page, so a missing guard would show up as a burst of requests here.
  const autoBodies = autoRequests.map((request) => {
    try {
      return JSON.parse(request.body === undefined ? 'null' : request.body);
    } catch {
      return null;
    }
  });
  check('the automatic scan runs exactly once', autoRequests.length === 1, `got ${autoRequests.length}`);
  const autoBody = autoBodies[0];
  check(
    'the automatic scan targets the repository on screen',
    Boolean(autoBody) && autoBody.url === `github.com/${AUTO_REPO}`,
    JSON.stringify(autoBody),
  );

  // ---------------------------------------------------------------------------
  console.log(`\n[10] the live API contract holds for other shapes`);
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
      let result = null;
      for (const event of events) {
        if (event.type === 'result') result = event.data;
      }
      return {
        status: response.status,
        types: events.map((e) => e.type),
        result,
      };
    };
    return {
      bareSlug: await probe('octocat/Hello-World'),
      fullUrl: await probe('github.com/octocat/Hello-World'),
    };
  });

  const bare = apiProbe.bareSlug;
  const full = apiProbe.fullUrl;
  const fullResult = full.result;
  check('a bare owner/repo is rejected as invalid', bare.status === 400, String(bare.status));
  check('the scheme-less slug form is accepted', full.status === 200, String(full.status));
  check(
    'the stream ends with a result frame',
    full.types.at(-1) === 'result',
    full.types.join(','),
  );
  check(
    'the result carries riskLevel, riskScore and findings',
    fullResult !== null &&
      typeof fullResult.riskLevel === 'string' &&
      typeof fullResult.riskScore === 'number' &&
      Array.isArray(fullResult.findings),
    JSON.stringify(fullResult === null ? {} : fullResult).slice(0, 120),
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