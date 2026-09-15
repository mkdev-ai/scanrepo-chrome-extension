// Normalizes a raw scanrepo.dev report into the shape the tooltip renders.
// Kept free of DOM/chrome so it is fully unit-testable.

import { REPORT_BASE, SEVERITIES, VERDICTS } from '../contract.js';

/** @typedef {import('../types.js').RepoReport} RepoReport */
/** @typedef {import('../types.js').Finding} Finding */

/** @type {Record<string, number>} */
const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 };

/** Sort rank for a severity; unknown severities sort last.
 * @param {Finding | null | undefined} finding
 * @returns {number}
 */
function severityRank(finding) {
  const severity = String(finding?.severity ?? '');
  return SEVERITY_RANK[severity] ?? 99;
}

/** The finding's severity, narrowed to a known level.
 * @param {Finding | null | undefined} finding
 * @returns {string}
 */
function severityOf(finding) {
  const severity = String(finding?.severity ?? '');
  return SEVERITIES.includes(severity) ? severity : 'info';
}

export const DISCLAIMER =
  'Static analysis only — a safe result means no known pattern matched, not a guarantee.';

/** Human-facing verdict, folding the API's `incomplete` flag into a distinct state.
 * @param {RepoReport | null} report
 * @returns {string}
 */
export function verdictOf(report) {
  if (!report) return 'error';
  if (report.incomplete === true) return 'inconclusive';
  const level = String(report.riskLevel ?? '').toLowerCase();
  return VERDICTS.includes(level) ? level : 'unknown';
}

/** Canonical report permalink, built from the report's own meta (never raw user input).
 * @param {RepoReport | null} report
 * @returns {string | null}
 */
export function reportUrl(report) {
  const meta = report?.meta ?? {};
  const provider = meta.provider === 'bitbucket' ? 'bitbucket' : 'github';
  const owner = String(meta.owner ?? '');
  const repo = String(meta.repo ?? '');
  if (!owner || !repo) return null;
  return `${REPORT_BASE}/${provider}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

/**
 * Rank findings for display: critical first, then warning, then info;
 * within a severity, higher point contribution first.
 * @param {RepoReport | null} report
 * @param {number} [limit]
 * @returns {Finding[]}
 */
export function topFindings(report, limit = 5) {
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  return [...findings]
    .sort((a, b) => {
      const bySeverity = severityRank(a) - severityRank(b);
      if (bySeverity !== 0) return bySeverity;
      return (Number(b?.points) || 0) - (Number(a?.points) || 0);
    })
    .slice(0, limit);
}

/**
 * One-line summary derived from the findings, since the API exposes no summary field.
 * Repo-level findings carry an empty `filePath`; they are counted separately rather
 * than rendered as a blank path.
 * @param {RepoReport | null} report
 * @returns {string}
 */
export function summarize(report) {
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  if (findings.length === 0) {
    return report?.incomplete ? 'No findings, but coverage was too low to conclude.' : 'No findings.';
  }
  /** @type {Record<string, number>} */
  const counts = { critical: 0, warning: 0, info: 0 };
  let repoLevel = 0;
  for (const finding of findings) {
    counts[severityOf(finding)] += 1;
    if (!finding?.filePath) repoLevel += 1;
  }
  const parts = [];
  if (counts.critical) parts.push(`${counts.critical} critical`);
  if (counts.warning) parts.push(`${counts.warning} warning`);
  if (counts.info) parts.push(`${counts.info} info`);
  const detail = parts.join(', ');
  const repoNote = repoLevel ? ` (${repoLevel} repo-level)` : '';
  return `${findings.length} finding${findings.length === 1 ? '' : 's'}: ${detail}${repoNote}`;
}

/** A single finding reduced to display fields. Line numbers are not provided by the API.
 * @param {Finding | null | undefined} finding
 * @returns {import('../types.js').FindingView}
 */
export function findingView(finding) {
  const filePath = String(finding?.filePath ?? '').trim();
  return {
    ruleId: String(finding?.ruleId ?? 'unknown'),
    title: String(finding?.title ?? ''),
    description: String(finding?.description ?? ''),
    severity: severityOf(finding),
    filePath,
    // Repo-level findings have no file; label them so the UI never shows a bare blank.
    location: filePath || 'repository-level',
    snippet: String(finding?.snippet ?? '').trim(),
  };
}

/** Coverage as a whole-number percentage, guarding divide-by-zero.
 * @param {RepoReport | null} report
 * @returns {number | null}
 */
export function coveragePercent(report) {
  const total = Number(report?.totalRepoFiles);
  if (!Number.isFinite(total) || total <= 0) return null;
  const scanned = Number(report?.filesScanned);
  if (!Number.isFinite(scanned)) return null;
  const fromRatio = Number(report?.coverage);
  const ratio =
    Number.isFinite(fromRatio) && fromRatio >= 0 && fromRatio <= 1 ? fromRatio : scanned / total;
  return Math.round(ratio * 100);
}

/** View model representing a failed scan.
 * @param {string} repoFullName
 * @param {string} message
 * @returns {import('../types.js').ViewModel}
 */
export function errorViewModel(repoFullName, message) {
  return {
    verdict: 'error',
    errorMessage: message,
    summary: '',
    findings: [],
    totalFindings: 0,
    score: null,
    url: null,
    coverage: null,
    incomplete: false,
    commitSha: '',
    repoFullName,
    disclaimer: '',
  };
}

/** View model representing an in-flight scan.
 * @param {string} repoFullName
 * @returns {import('../types.js').ViewModel}
 */
export function pendingViewModel(repoFullName) {
  return {
    verdict: 'unknown',
    summary: 'Scanning… this usually takes a few seconds.',
    findings: [],
    totalFindings: 0,
    score: null,
    url: null,
    coverage: null,
    incomplete: false,
    commitSha: '',
    repoFullName,
    disclaimer: '',
    pending: true,
  };
}

/**
 * Build the full view model consumed by the tooltip.
 * @param {RepoReport} report raw report from the API
 * @returns {import('../types.js').ViewModel} normalized view model
 */
export function buildViewModel(report) {
  const verdict = verdictOf(report);
  const coverage = coveragePercent(report);
  return {
    verdict,
    score: Number.isFinite(Number(report?.riskScore)) ? Number(report.riskScore) : null,
    summary: summarize(report),
    findings: topFindings(report).map(findingView),
    totalFindings: Array.isArray(report?.findings) ? report.findings.length : 0,
    url: reportUrl(report),
    coverage,
    incomplete: report?.incomplete === true,
    commitSha: String(report?.commitSha ?? ''),
    ref: String(report?.ref ?? ''),
    repoFullName: report?.meta ? `${report.meta.owner}/${report.meta.repo}` : '',
    scannedAt: String(report?.scannedAt ?? ''),
    disclaimer: DISCLAIMER,
  };
}