// Normalizes a raw scanrepo.dev report into the shape the tooltip renders.
// Kept free of DOM/chrome so it is fully unit-testable.

import { REPORT_BASE, SEVERITIES, VERDICTS } from '../contract.js';

/** @typedef {import('../types.js').RepoReport} RepoReport */
/** @typedef {import('../types.js').Finding} Finding */

/** @type {Record<string, number>} */
const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 };

/**
 * Read an untyped API field as a string. Only null/undefined fall back, so an
 * explicit empty string or `0` is preserved as the API sent it.
 * @param {Record<string, any> | null | undefined} record
 * @param {string} key
 * @param {string} [fallback]
 * @returns {string}
 */
function readText(record, key, fallback = '') {
  if (!record) return fallback;
  const value = record[key];
  if (value === null || value === undefined) return fallback;
  return String(value);
}

/** The report's findings, or an empty list when the field is absent.
 * @param {RepoReport | null | undefined} report
 * @returns {Finding[]}
 */
function findingsOf(report) {
  if (!report || !Array.isArray(report.findings)) return [];
  return report.findings;
}

/** Sort rank for a severity; unknown severities sort last.
 * @param {Finding | null | undefined} finding
 * @returns {number}
 */
function severityRank(finding) {
  const rank = SEVERITY_RANK[readText(finding, 'severity')];
  return rank === undefined ? 99 : rank;
}

/** The finding's severity, narrowed to a known level.
 * @param {Finding | null | undefined} finding
 * @returns {string}
 */
function severityOf(finding) {
  const severity = readText(finding, 'severity');
  return SEVERITIES.includes(severity) ? severity : 'info';
}

/** Point contribution, treating a non-numeric value as zero.
 * @param {Finding | null | undefined} finding
 * @returns {number}
 */
function pointsOf(finding) {
  if (!finding) return 0;
  return Number(finding.points) || 0;
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
  const level = readText(report, 'riskLevel').toLowerCase();
  return VERDICTS.includes(level) ? level : 'unknown';
}

/** Canonical report permalink, built from the report's own meta (never raw user input).
 * @param {RepoReport | null} report
 * @returns {string | null}
 */
export function reportUrl(report) {
  const meta = report ? report.meta : null;
  const provider = readText(meta, 'provider') === 'bitbucket' ? 'bitbucket' : 'github';
  const owner = readText(meta, 'owner');
  const repo = readText(meta, 'repo');
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
  return [...findingsOf(report)]
    .sort((a, b) => {
      const bySeverity = severityRank(a) - severityRank(b);
      if (bySeverity !== 0) return bySeverity;
      return pointsOf(b) - pointsOf(a);
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
  const findings = findingsOf(report);
  if (findings.length === 0) {
    if (report && report.incomplete) return 'No findings, but coverage was too low to conclude.';
    return 'No findings.';
  }

  /** @type {Record<string, number>} */
  const counts = { critical: 0, warning: 0, info: 0 };
  let repoLevel = 0;
  for (const finding of findings) {
    counts[severityOf(finding)] += 1;
    if (!readText(finding, 'filePath')) repoLevel += 1;
  }

  const parts = [];
  if (counts.critical) parts.push(`${counts.critical} critical`);
  if (counts.warning) parts.push(`${counts.warning} warning`);
  if (counts.info) parts.push(`${counts.info} info`);
  const repoNote = repoLevel ? ` (${repoLevel} repo-level)` : '';
  const noun = findings.length === 1 ? 'finding' : 'findings';
  return `${findings.length} ${noun}: ${parts.join(', ')}${repoNote}`;
}

/** A single finding reduced to display fields. Line numbers are not provided by the API.
 * @param {Finding | null | undefined} finding
 * @returns {import('../types.js').FindingView}
 */
export function findingView(finding) {
  const filePath = readText(finding, 'filePath').trim();
  return {
    ruleId: readText(finding, 'ruleId', 'unknown'),
    title: readText(finding, 'title'),
    description: readText(finding, 'description'),
    severity: severityOf(finding),
    filePath,
    // Repo-level findings have no file; label them so the UI never shows a bare blank.
    location: filePath || 'repository-level',
    snippet: readText(finding, 'snippet').trim(),
  };
}

/** Coverage as a whole-number percentage, guarding divide-by-zero.
 * @param {RepoReport | null} report
 * @returns {number | null}
 */
export function coveragePercent(report) {
  if (!report) return null;
  const total = Number(report.totalRepoFiles);
  if (!Number.isFinite(total) || total <= 0) return null;

  const scanned = Number(report.filesScanned);
  if (!Number.isFinite(scanned)) return null;

  const fromRatio = Number(report.coverage);
  const usable = Number.isFinite(fromRatio) && fromRatio >= 0 && fromRatio <= 1;
  const ratio = usable ? fromRatio : scanned / total;
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
  const findings = findingsOf(report);
  const meta = report ? report.meta : null;
  // `Number(undefined)` is NaN, so a missing score maps to null below.
  const rawScore = Number(report ? report.riskScore : undefined);

  return {
    verdict: verdictOf(report),
    score: Number.isFinite(rawScore) ? rawScore : null,
    summary: summarize(report),
    findings: topFindings(report).map(findingView),
    totalFindings: findings.length,
    url: reportUrl(report),
    coverage: coveragePercent(report),
    incomplete: report ? report.incomplete === true : false,
    commitSha: readText(report, 'commitSha'),
    ref: readText(report, 'ref'),
    repoFullName: meta ? `${meta.owner}/${meta.repo}` : '',
    scannedAt: readText(report, 'scannedAt'),
    disclaimer: DISCLAIMER,
  };
}
