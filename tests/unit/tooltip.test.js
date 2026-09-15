// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderTooltip, renderTooltipHtml, TOOLTIP_ID } from '../../src/ui/tooltip.js';
import { buildViewModel } from '../../src/lib/report.js';

const report = {
  riskLevel: 'dangerous',
  riskScore: 70,
  incomplete: false,
  commitSha: 'abc1234deadbeef',
  filesScanned: 100,
  totalRepoFiles: 100,
  coverage: 1,
  meta: { owner: 'moom825', repo: 'Discord-RAT', provider: 'github' },
  findings: [
    {
      title: 'Browser credential store access',
      ruleId: 'browser-profiles',
      severity: 'critical',
      filePath: 'DiscordRAT.py',
      snippet: 'path_org = r"C:\\Users\\..."',
    },
    {
      title: 'Suspicious files are not reachable',
      ruleId: 'orphan-suspicious-module',
      severity: 'info',
      filePath: '',
    },
  ],
};

describe('renderTooltipHtml', () => {
  it('shows the verdict, score and findings', () => {
    const html = renderTooltipHtml(buildViewModel(report));
    expect(html).toContain('Dangerous');
    expect(html).toContain('70');
    expect(html).toContain('/100');
    expect(html).toContain('browser-profiles');
    expect(html).toContain('DiscordRAT.py');
  });

  it('links to the full report on scanrepo.dev', () => {
    const html = renderTooltipHtml(buildViewModel(report));
    expect(html).toContain('https://www.scanrepo.dev/scan/github/moom825/Discord-RAT');
    expect(html).toContain('View full report on scanrepo.dev');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('always warns that it is static analysis only', () => {
    const html = renderTooltipHtml(buildViewModel(report));
    expect(html).toContain('Static analysis only');
    expect(html).toContain('not a guarantee');
  });

  it('labels repo-level findings rather than leaving a blank file', () => {
    const html = renderTooltipHtml(buildViewModel(report));
    expect(html).toContain('repository-level');
  });

  it('escapes remote report text so it cannot inject markup', () => {
    // Report content is remote data; a malicious repo could name a file anything.
    const hostile = {
      ...report,
      meta: { owner: 'x', repo: '<img src=x onerror=alert(1)>', provider: 'github' },
      findings: [
        {
          title: '<script>alert("pwned")</script>',
          ruleId: 'a"><script>bad()</script>',
          severity: 'critical',
          filePath: '<b>bold</b>',
        },
      ],
    };
    const html = renderTooltipHtml(buildViewModel(hostile));
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>bold</b>');
    expect(html).toContain('&lt;script&gt;alert(&quot;pwned&quot;)&lt;/script&gt;');
  });

  it('cannot be redirected off scanrepo.dev by a hostile repo name', () => {
    // The report link is built from the report's own meta, so a crafted owner or
    // repo must only ever produce a scanrepo.dev URL.
    const hostile = {
      ...report,
      meta: { owner: 'evil.test', repo: '../../redirect?to=https://attacker.test', provider: 'github' },
    };
    const html = renderTooltipHtml(buildViewModel(hostile));
    const href = html.match(/href="([^"]+)"/)?.[1];
    expect(href).toBeTruthy();
    expect(new URL(href).origin).toBe('https://www.scanrepo.dev');
  });

  it('renders an inconclusive verdict as a distinct state', () => {
    const html = renderTooltipHtml(buildViewModel({ ...report, incomplete: true }));
    expect(html).toContain('Inconclusive');
    expect(html).toContain('Too few files could be read');
  });

  it('warns about partial coverage and suggests a token', () => {
    const html = renderTooltipHtml(
      buildViewModel({ ...report, incomplete: false, filesScanned: 40, totalRepoFiles: 100, coverage: 0.4 }),
    );
    expect(html).toContain('Partial coverage');
    expect(html).toContain('Add a GitHub token');
  });

  it('renders an error state with no score meter', () => {
    const html = renderTooltipHtml({
      verdict: 'error',
      errorMessage: 'Could not reach scanrepo.dev.',
      findings: [],
      score: null,
      disclaimer: '',
    });
    expect(html).toContain('Scan failed');
    expect(html).toContain('Could not reach scanrepo.dev.');
    expect(html).not.toContain('scanrepo-meter');
  });

  it('reports a clean scan without a findings list', () => {
    const html = renderTooltipHtml(buildViewModel({ ...report, findings: [], riskLevel: 'safe', riskScore: 0 }));
    expect(html).toContain('No findings.');
    expect(html).toContain('Safe');
  });

  it('caps the snippet length so a huge blob cannot dominate the tooltip', () => {
    const html = renderTooltipHtml(
      buildViewModel({
        ...report,
        findings: [{ ...report.findings[0], snippet: 'x'.repeat(5000) }],
      }),
    );
    const snippetMatch = html.match(/<pre class="scanrepo-snippet">([\s\S]*?)<\/pre>/);
    expect(snippetMatch[1].length).toBeLessThanOrEqual(240);
  });

  it('notes how many findings were withheld', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      title: `finding ${i}`,
      ruleId: `rule-${i}`,
      severity: 'warning',
      filePath: `f${i}.js`,
    }));
    const html = renderTooltipHtml(buildViewModel({ ...report, findings: many }));
    expect(html).toContain('+4 more findings');
  });
});

describe('renderTooltip', () => {
  it('creates the tooltip element once and updates it in place', () => {
    const first = renderTooltip(document, buildViewModel(report));
    const second = renderTooltip(document, buildViewModel({ ...report, riskLevel: 'safe' }));
    expect(document.querySelectorAll(`#${TOOLTIP_ID}`)).toHaveLength(1);
    expect(second).toBe(first);
    expect(first.dataset.verdict).toBe('safe');
  });

  it('sets accessibility attributes', () => {
    const node = renderTooltip(document, buildViewModel(report));
    expect(node.getAttribute('role')).toBe('dialog');
    expect(node.getAttribute('aria-live')).toBe('polite');
  });

  it('is hidden until marked visible', () => {
    const node = renderTooltip(document, buildViewModel(report));
    expect(node.classList.contains('scanrepo-tooltip-visible')).toBe(false);
  });
});