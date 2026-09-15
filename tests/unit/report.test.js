import { describe, expect, it } from 'vitest';
import {
  buildViewModel,
  coveragePercent,
  reportUrl,
  summarize,
  topFindings,
  verdictOf,
} from '../../src/lib/report.js';

/** A realistic report captured from a live scan of moom825/Discord-RAT. */
const dangerousReport = {
  ref: 'main',
  riskLevel: 'dangerous',
  riskScore: 70,
  incomplete: false,
  commitSha: 'abc1234def5678',
  filesScanned: 1,
  totalRepoFiles: 1,
  coverage: 1,
  scannedAt: '2026-09-15T19:00:00.000Z',
  meta: { owner: 'moom825', repo: 'Discord-RAT', provider: 'github' },
  findings: [
    {
      title: 'Browser credential store access',
      points: 10,
      ruleId: 'browser-profiles',
      category: 'filesystem-access',
      filePath: 'DiscordRAT.py',
      severity: 'critical',
      description: 'Accessing Chrome profile directories.',
      snippet: 'path_org = r"C:\\Users\\...\\History"',
    },
    {
      title: 'Python subprocess / os.system usage',
      points: 4,
      ruleId: 'python-subprocess',
      category: 'code-execution',
      filePath: 'DiscordRAT.py',
      severity: 'warning',
      description: 'shell=True can execute arbitrary commands.',
    },
    {
      title: 'Suspicious files are not reachable from entry points',
      points: 2,
      ruleId: 'orphan-suspicious-module',
      category: 'code-execution',
      filePath: '',
      severity: 'info',
      description: 'Flagged files are not imported by any entry point.',
    },
  ],
};

describe('verdictOf', () => {
  it('passes through a known verdict', () => {
    expect(verdictOf({ riskLevel: 'malicious' })).toBe('malicious');
    expect(verdictOf({ riskLevel: 'safe' })).toBe('safe');
  });

  it('normalizes case', () => {
    expect(verdictOf({ riskLevel: 'DANGEROUS' })).toBe('dangerous');
  });

  it('reports inconclusive when the API flags incomplete coverage', () => {
    // The API signals low confidence through `incomplete`, not a riskLevel value.
    expect(verdictOf({ riskLevel: 'safe', incomplete: true })).toBe('inconclusive');
  });

  it('falls back to unknown for an unrecognized level', () => {
    expect(verdictOf({ riskLevel: 'banana' })).toBe('unknown');
  });

  it('reports error when there is no report', () => {
    expect(verdictOf(null)).toBe('error');
  });
});

describe('reportUrl', () => {
  it('builds the canonical scan permalink', () => {
    expect(reportUrl(dangerousReport)).toBe(
      'https://www.scanrepo.dev/scan/github/moom825/Discord-RAT',
    );
  });

  it('supports the bitbucket provider', () => {
    const report = { meta: { owner: 'ws', repo: 'r', provider: 'bitbucket' } };
    expect(reportUrl(report)).toBe('https://www.scanrepo.dev/scan/bitbucket/ws/r');
  });

  it('encodes path segments rather than injecting them raw', () => {
    const report = { meta: { owner: 'a b', repo: 'c/d', provider: 'github' } };
    const url = reportUrl(report);
    expect(url).toBe('https://www.scanrepo.dev/scan/github/a%20b/c%2Fd');
    // The encoded slash must not create an extra path segment: /scan/github/owner/repo
    expect(new URL(url).pathname.split('/')).toHaveLength(5);
    expect(new URL(url).pathname.split('/')[4]).toBe('c%2Fd');
  });

  it('returns null without owner/repo metadata', () => {
    expect(reportUrl({ meta: {} })).toBeNull();
    expect(reportUrl(null)).toBeNull();
  });
});

describe('topFindings', () => {
  it('orders critical before warning before info', () => {
    const ordered = topFindings(dangerousReport).map((f) => f.severity);
    expect(ordered).toEqual(['critical', 'warning', 'info']);
  });

  it('breaks ties within a severity by points, descending', () => {
    const report = {
      findings: [
        { ruleId: 'a', severity: 'warning', points: 3 },
        { ruleId: 'b', severity: 'warning', points: 9 },
      ],
    };
    expect(topFindings(report).map((f) => f.ruleId)).toEqual(['b', 'a']);
  });

  it('respects the limit', () => {
    expect(topFindings(dangerousReport, 2)).toHaveLength(2);
  });

  it('does not mutate the input array', () => {
    const before = dangerousReport.findings.map((f) => f.ruleId);
    topFindings(dangerousReport);
    expect(dangerousReport.findings.map((f) => f.ruleId)).toEqual(before);
  });

  it('handles a missing findings array', () => {
    expect(topFindings({})).toEqual([]);
    expect(topFindings(null)).toEqual([]);
  });
});

describe('summarize', () => {
  it('counts findings by severity and flags repo-level ones', () => {
    // Line numbers are not available from the API, and repo-level findings have an
    // empty filePath — the summary must not present them as files.
    expect(summarize(dangerousReport)).toBe(
      '3 findings: 1 critical, 1 warning, 1 info (1 repo-level)',
    );
  });

  it('uses the singular for one finding', () => {
    expect(summarize({ findings: [{ severity: 'warning', filePath: 'a.js' }] })).toBe(
      '1 finding: 1 warning',
    );
  });

  it('reports no findings for a clean scan', () => {
    expect(summarize({ findings: [] })).toBe('No findings.');
  });

  it('qualifies a clean result when coverage was too low', () => {
    expect(summarize({ findings: [], incomplete: true })).toBe(
      'No findings, but coverage was too low to conclude.',
    );
  });

  it('treats an unknown severity as info', () => {
    expect(summarize({ findings: [{ severity: 'weird', filePath: 'a.js' }] })).toBe(
      '1 finding: 1 info',
    );
  });
});

describe('coveragePercent', () => {
  it('rounds the coverage ratio to a percentage', () => {
    expect(coveragePercent({ coverage: 0.755, totalRepoFiles: 100, filesScanned: 76 })).toBe(76);
  });

  it('derives coverage from file counts when the ratio is absent', () => {
    expect(coveragePercent({ filesScanned: 25, totalRepoFiles: 100 })).toBe(25);
  });

  it('returns 0 percent for zero files scanned', () => {
    expect(coveragePercent({ coverage: 0, filesScanned: 0, totalRepoFiles: 10 })).toBe(0);
  });

  it('returns null when the total is unknown or zero', () => {
    expect(coveragePercent({ totalRepoFiles: 0, filesScanned: 0 })).toBeNull();
    expect(coveragePercent({})).toBeNull();
  });
});

describe('buildViewModel', () => {
  it('produces the display model', () => {
    const vm = buildViewModel(dangerousReport);
    expect(vm.verdict).toBe('dangerous');
    expect(vm.score).toBe(70);
    expect(vm.totalFindings).toBe(3);
    expect(vm.findings).toHaveLength(3);
    expect(vm.coverage).toBe(100);
    expect(vm.repoFullName).toBe('moom825/Discord-RAT');
    expect(vm.url).toBe('https://www.scanrepo.dev/scan/github/moom825/Discord-RAT');
    expect(vm.disclaimer).toContain('Static analysis only');
  });

  it('labels a repo-level finding instead of showing a blank path', () => {
    const vm = buildViewModel(dangerousReport);
    const repoLevel = vm.findings.find((f) => f.ruleId === 'orphan-suspicious-module');
    expect(repoLevel.location).toBe('repository-level');
    expect(repoLevel.filePath).toBe('');
  });

  it('keeps a real file path as the location', () => {
    const vm = buildViewModel(dangerousReport);
    const withFile = vm.findings.find((f) => f.ruleId === 'browser-profiles');
    expect(withFile.location).toBe('DiscordRAT.py');
  });

  it('exposes no line numbers, because the API provides none', () => {
    const vm = buildViewModel(dangerousReport);
    for (const finding of vm.findings) {
      expect(finding).not.toHaveProperty('line');
    }
  });

  it('defaults a missing snippet to an empty string', () => {
    const vm = buildViewModel(dangerousReport);
    const noSnippet = vm.findings.find((f) => f.ruleId === 'python-subprocess');
    expect(noSnippet.snippet).toBe('');
  });

  it('tolerates an empty report', () => {
    const vm = buildViewModel({});
    expect(vm.score).toBeNull();
    expect(vm.findings).toEqual([]);
    expect(vm.repoFullName).toBe('');
  });
});