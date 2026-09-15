// Frozen scanrepo.dev integration contract. See docs/integration-contract.md.

export const SCAN_ENDPOINT = 'https://www.scanrepo.dev/api/scan';
export const REPORT_BASE = 'https://www.scanrepo.dev/scan';

export const VERDICTS = ['safe', 'low', 'suspicious', 'dangerous', 'malicious'];

export const SEVERITIES = ['critical', 'warning', 'info'];

export const DEFAULT_OPTIONS = {
  githubToken: '',
  publish: false,
  scanOnLoad: false,
  timeoutMs: 90_000,
};