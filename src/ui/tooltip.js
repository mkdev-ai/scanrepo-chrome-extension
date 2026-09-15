// Tooltip/popover rendering, isolated from the content script's injection logic.

/** @type {Record<string, string>} */
const VERDICT_LABEL = {
  safe: 'Safe',
  low: 'Low risk',
  suspicious: 'Suspicious',
  dangerous: 'Dangerous',
  malicious: 'Malicious',
  inconclusive: 'Inconclusive',
  unknown: 'Unknown',
  error: 'Scan failed',
};

export const TOOLTIP_ID = 'scanrepo-tooltip';

/**
 * Escape before interpolating into innerHTML — report text is remote data.
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** @param {string} verdict */
export function verdictLabel(verdict) {
  return VERDICT_LABEL[verdict] ?? VERDICT_LABEL.unknown;
}

/** @param {import('../types.js').ViewModel} vm */
function scoreBar(vm) {
  if (vm.score === null) return '';
  const clamped = Math.max(0, Math.min(100, vm.score));
  return `<div class="scanrepo-score">
      <span class="scanrepo-score-value">${clamped}<span class="scanrepo-score-max">/100</span></span>
      <span class="scanrepo-score-label">risk score</span>
    </div>
    <div class="scanrepo-meter"><div class="scanrepo-meter-fill" style="width:${clamped}%"></div></div>`;
}

/** @param {import('../types.js').ViewModel} vm */
function findingsHtml(vm) {
  if (vm.verdict === 'error') return '';
  if (vm.findings.length === 0) {
    return '<p class="scanrepo-empty">No findings reported.</p>';
  }
  const items = vm.findings
    .map(
      (finding) => `<li class="scanrepo-finding">
        <div class="scanrepo-finding-head">
          <span class="scanrepo-sev scanrepo-sev-${escapeHtml(finding.severity)}">${escapeHtml(finding.severity)}</span>
          <code class="scanrepo-rule">${escapeHtml(finding.ruleId)}</code>
        </div>
        <div class="scanrepo-finding-title">${escapeHtml(finding.title)}</div>
        <div class="scanrepo-finding-loc" title="${escapeHtml(finding.location)}">${escapeHtml(finding.location)}</div>
        ${finding.snippet ? `<pre class="scanrepo-snippet">${escapeHtml(finding.snippet.slice(0, 240))}</pre>` : ''}
      </li>`,
    )
    .join('');
  const more =
    vm.totalFindings > vm.findings.length
      ? `<p class="scanrepo-more">+${vm.totalFindings - vm.findings.length} more findings in the full report</p>`
      : '';
  return `<ul class="scanrepo-findings">${items}</ul>${more}`;
}

/** @param {import('../types.js').ViewModel} vm */
function coverageNote(vm) {
  if (!vm.incomplete && vm.coverage === null) return '';
  if (vm.coverage === null) return '';
  if (vm.coverage >= 95 && !vm.incomplete) return '';
  const warning = vm.incomplete
    ? 'Too few files could be read to stand behind a verdict.'
    : 'Partial coverage — some files could not be read.';
  return `<p class="scanrepo-coverage">${warning} Scanned ${vm.coverage}% of the repo${
    vm.commitSha ? ` at ${escapeHtml(vm.commitSha.slice(0, 7))}` : ''
  }. Add a GitHub token in options for full coverage.</p>`;
}

/**
 * Render tooltip markup. Pure function of the view model, so it is unit-testable
 * without a browser.
 * @param {import('../types.js').ViewModel} vm view model from buildViewModel
 * @returns {string} HTML
 */
export function renderTooltipHtml(vm) {
  const verdict = vm.verdict ?? 'unknown';
  const link = vm.url
    ? `<a class="scanrepo-link" href="${escapeHtml(vm.url)}" target="_blank" rel="noopener noreferrer">View full report on scanrepo.dev →</a>`
    : '';

  const body =
    verdict === 'error'
      ? `<p class="scanrepo-error">${escapeHtml(vm.errorMessage ?? 'Scan failed.')}</p>`
      : `<p class="scanrepo-summary">${escapeHtml(vm.summary)}</p>
         ${scoreBar(vm)}
         ${findingsHtml(vm)}
         ${coverageNote(vm)}`;

  return `<div class="scanrepo-header">
      <span class="scanrepo-verdict scanrepo-verdict-${escapeHtml(verdict)}">${escapeHtml(verdictLabel(verdict))}</span>
      <span class="scanrepo-repo">${escapeHtml(vm.repoFullName)}</span>
    </div>
    ${body}
    <p class="scanrepo-disclaimer">${escapeHtml(vm.disclaimer)}</p>
    ${link}`;
}

/**
 * Create (or reuse) the tooltip element and apply rendered content.
 * @param {Document} root document
 * @param {import('../types.js').ViewModel} vm
 * @returns {HTMLElement}
 */
export function renderTooltip(root, vm) {
  let node = /** @type {HTMLElement | null} */ (document.getElementById(TOOLTIP_ID));
  if (!node) {
    node = document.createElement('div');
    node.id = TOOLTIP_ID;
    node.className = 'scanrepo-tooltip';
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-live', 'polite');
    node.setAttribute('aria-label', 'Repository security scan result');
    (document.body ?? document.documentElement).appendChild(node);
  }
  node.innerHTML = renderTooltipHtml(vm);
  node.dataset.verdict = vm.verdict ?? 'unknown';
  return node;
}

export function removeTooltip() {
  document.getElementById(TOOLTIP_ID)?.remove();
}