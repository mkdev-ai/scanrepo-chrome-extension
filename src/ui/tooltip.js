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

const UNKNOWN_VERDICT = 'unknown';

export const TOOLTIP_ID = 'scanrepo-tooltip';

/**
 * Escape a value before it is interpolated into innerHTML — report text is remote data.
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Wrap already-safe content in a classed element. The class name and content are the
 * caller's responsibility; report text must be escaped before it is passed in.
 * @param {string} tag
 * @param {string} className
 * @param {string} [content]
 * @returns {string}
 */
function wrap(tag, className, content = '') {
  return `<${tag} class="${escapeHtml(className)}">${content}</${tag}>`;
}

/** The label for a verdict, defaulting to the unknown state.
 * @param {string} [verdict]
 * @returns {string}
 */
export function verdictLabel(verdict) {
  const label = verdict === undefined ? undefined : VERDICT_LABEL[verdict];
  return label === undefined ? VERDICT_LABEL[UNKNOWN_VERDICT] : label;
}

/** @param {import('../types.js').ViewModel} vm */
function scoreBar(vm) {
  if (vm.score === null) return '';
  const clamped = Math.max(0, Math.min(100, vm.score));
  const max = '<span class="scanrepo-score-max">/100</span>';
  const value = wrap('span', 'scanrepo-score-value', `${clamped}${max}`);
  const label = wrap('span', 'scanrepo-score-label', 'risk score');
  const fillStyle = `class="scanrepo-meter-fill" style="width:${clamped}%"`;
  const meter = wrap('div', 'scanrepo-meter', `<div ${fillStyle}></div>`);
  return wrap('div', 'scanrepo-score', value + label) + meter;
}

/** @param {import('../types.js').FindingView} finding */
function findingHtml(finding) {
  const severityText = escapeHtml(finding.severity);
  const badge = wrap('span', `scanrepo-sev scanrepo-sev-${finding.severity}`, severityText);
  const rule = wrap('code', 'scanrepo-rule', escapeHtml(finding.ruleId));
  const head = wrap('div', 'scanrepo-finding-head', badge + rule);
  const title = wrap('div', 'scanrepo-finding-title', escapeHtml(finding.title));

  const location = escapeHtml(finding.location);
  const locAttrs = `class="scanrepo-finding-loc" title="${location}"`;
  const loc = `<div ${locAttrs}>${location}</div>`;

  const snippet = finding.snippet
    ? wrap('pre', 'scanrepo-snippet', escapeHtml(finding.snippet.slice(0, 240)))
    : '';

  return wrap('li', 'scanrepo-finding', head + title + loc + snippet);
}

/** @param {import('../types.js').ViewModel} vm */
function moreFindings(vm) {
  const hidden = vm.totalFindings - vm.findings.length;
  if (hidden <= 0) return '';
  return wrap('p', 'scanrepo-more', `+${hidden} more findings in the full report`);
}

/** @param {import('../types.js').ViewModel} vm */
function findingsHtml(vm) {
  if (vm.verdict === 'error') return '';
  if (vm.findings.length === 0) {
    return wrap('p', 'scanrepo-empty', 'No findings reported.');
  }
  const items = vm.findings.map(findingHtml).join('');
  return wrap('ul', 'scanrepo-findings', items) + moreFindings(vm);
}

/** @param {import('../types.js').ViewModel} vm */
function coverageNote(vm) {
  // Unknown coverage is not worth noting; a complete scan at high coverage speaks for itself.
  if (vm.coverage === null) return '';
  if (!vm.incomplete && vm.coverage >= 95) return '';

  const warning = vm.incomplete
    ? 'Too few files could be read to stand behind a verdict.'
    : 'Partial coverage — some files could not be read.';
  const commit = vm.commitSha ? ` at ${escapeHtml(vm.commitSha.slice(0, 7))}` : '';
  const scanned = ` Scanned ${vm.coverage}% of the repo${commit}.`;
  const hint = ' Add a GitHub token in options for full coverage.';
  return wrap('p', 'scanrepo-coverage', warning + scanned + hint);
}

/** @param {import('../types.js').ViewModel} vm */
function reportLink(vm) {
  if (!vm.url) return '';
  const attrs = `class="scanrepo-link" href="${escapeHtml(vm.url)}" target="_blank" rel="noopener noreferrer"`;
  return `<a ${attrs}>View full report on scanrepo.dev →</a>`;
}

/** @param {import('../types.js').ViewModel} vm @param {string} verdict */
function tooltipBody(vm, verdict) {
  if (verdict === 'error') {
    const message = escapeHtml(vm.errorMessage === undefined ? 'Scan failed.' : vm.errorMessage);
    return wrap('p', 'scanrepo-error', message);
  }
  return [
    wrap('p', 'scanrepo-summary', escapeHtml(vm.summary)),
    scoreBar(vm),
    findingsHtml(vm),
    coverageNote(vm),
  ].join('');
}

/**
 * Render tooltip markup. Pure function of the view model, so it is unit-testable
 * without a browser.
 * @param {import('../types.js').ViewModel} vm view model from buildViewModel
 * @returns {string} HTML
 */
export function renderTooltipHtml(vm) {
  const verdict = vm.verdict === undefined ? UNKNOWN_VERDICT : vm.verdict;
  const verdictBadge = wrap(
    'span',
    `scanrepo-verdict scanrepo-verdict-${verdict}`,
    escapeHtml(verdictLabel(verdict)),
  );
  const repoName = wrap('span', 'scanrepo-repo', escapeHtml(vm.repoFullName));
  const header = wrap('div', 'scanrepo-header', verdictBadge + repoName);
  const disclaimer = wrap('p', 'scanrepo-disclaimer', escapeHtml(vm.disclaimer));
  return header + tooltipBody(vm, verdict) + disclaimer + reportLink(vm);
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
  node.dataset.verdict = vm.verdict === undefined ? UNKNOWN_VERDICT : vm.verdict;
  return node;
}

export function removeTooltip() {
  document.getElementById(TOOLTIP_ID)?.remove();
}