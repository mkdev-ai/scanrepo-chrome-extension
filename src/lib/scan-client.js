// scanrepo.dev scan client. Runs in the background service worker only, so no
// scanrepo.dev request is ever made from the GitHub page's origin.

import { DEFAULT_OPTIONS, SCAN_ENDPOINT } from '../contract.js';
import { extractReport, streamNdjson } from './ndjson.js';
import { toScanSlug } from './parse.js';

export class ScanError extends Error {
  /** @param {string} message @param {string} code */
  constructor(message, code) {
    super(message);
    this.name = 'ScanError';
    this.code = code;
  }
}

/** Distinguishes "this repo cannot be scanned" from a transient failure.
 * @param {number} status
 * @param {{error?: string} | null} body
 * @returns {ScanError}
 */
function classifyError(status, body) {
  const message = String(body?.error ?? '').trim();
  const lower = message.toLowerCase();
  if (status === 400) {
    return new ScanError(message || 'scanrepo.dev rejected the request.', 'bad-request');
  }
  if (status === 404 || lower.includes('private') || lower.includes('not found')) {
    return new ScanError(
      message || 'Repository not found or not public. scanrepo.dev scans public repos only.',
      'unscannable',
    );
  }
  if (status === 429) {
    return new ScanError(
      'scanrepo.dev rate limit reached. Add a GitHub token in options for full coverage.',
      'rate-limited',
    );
  }
  return new ScanError(message || `scanrepo.dev returned HTTP ${status}.`, 'http-error');
}

/**
 * Scan a repository.
 * @param {import('../types.js').RepoTarget} target
 * @param {Record<string, any>} [options] extension options
 * @param {(progress: {step: string, progress: number}) => void} [onProgress]
 * @returns {Promise<import('../types.js').RepoReport>} the raw report
 */
export async function scanRepo(target, options = {}, onProgress = () => {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };

  /** @type {{url: string, token?: string, publish: boolean}} */
  const body = { url: toScanSlug(target), publish: config.publish === true };
  // Default is private: publish only when the user explicitly opts in.
  if (config.githubToken) body.token = config.githubToken;

  const controller = new AbortController();
  const timeoutMs = Number(config.timeoutMs) || DEFAULT_OPTIONS.timeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(SCAN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    if (/** @type {Error} */ (error)?.name === 'AbortError') {
      throw new ScanError(
        `Scan timed out after ${Math.round(timeoutMs / 1000)}s. Large repos can take longer — open the full report instead.`,
        'timeout',
      );
    }
    throw new ScanError('Could not reach scanrepo.dev. Check your connection.', 'network');
  }
  clearTimeout(timer);

  if (!response.ok) {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // non-JSON error body; classify on status alone
    }
    throw classifyError(response.status, payload);
  }

  if (!response.body) {
    throw new ScanError('scanrepo.dev returned an empty response.', 'no-result');
  }
  const events = await streamNdjson(response.body, (event) => {
    if (event?.type === 'progress') {
      onProgress({ step: String(event.step ?? ''), progress: Number(event.progress) || 0 });
    }
  });

  const report = extractReport(events);
  if (!report) {
    throw new ScanError('scanrepo.dev returned no result. Try again or open the web report.', 'no-result');
  }
  return report;
}