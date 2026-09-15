import { describe, expect, it } from 'vitest';
import { extractReport, parseNdjson, streamNdjson } from '../../src/lib/ndjson.js';

const PROGRESS = '{"type":"progress","step":"Checking cache...","progress":5}';
const RESULT = '{"type":"result","data":{"riskLevel":"safe","riskScore":4}}';

describe('parseNdjson', () => {
  it('parses each line into an event', () => {
    const events = parseNdjson(`${PROGRESS}\n${RESULT}\n`);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('progress');
    expect(events[1].type).toBe('result');
  });

  it('ignores blank lines', () => {
    expect(parseNdjson(`\n\n${RESULT}\n\n`)).toHaveLength(1);
  });

  it('skips malformed lines without discarding good ones', () => {
    const events = parseNdjson(`{"type":"progress"}\nNOT JSON\n${RESULT}`);
    expect(events).toHaveLength(2);
    expect(events[1].type).toBe('result');
  });

  it('handles an empty body', () => {
    expect(parseNdjson('')).toEqual([]);
    expect(parseNdjson(null)).toEqual([]);
  });

  it('keeps a JSON scalar out of the event list', () => {
    // A bare number is valid JSON but not an event object.
    expect(parseNdjson('42')).toEqual([]);
  });
});

describe('extractReport', () => {
  it('returns the data of the result event', () => {
    const report = extractReport(parseNdjson(`${PROGRESS}\n${RESULT}`));
    expect(report).toEqual({ riskLevel: 'safe', riskScore: 4 });
  });

  it('returns null when no result event is present', () => {
    expect(extractReport(parseNdjson(PROGRESS))).toBeNull();
  });

  it('takes the last result when several are present', () => {
    const body = '{"type":"result","data":{"riskScore":1}}\n{"type":"result","data":{"riskScore":2}}';
    expect(extractReport(parseNdjson(body)).riskScore).toBe(2);
  });

  it('ignores a result event with no data', () => {
    expect(extractReport(parseNdjson('{"type":"result"}'))).toBeNull();
  });
});

describe('streamNdjson', () => {
  /** Feed a body to streamNdjson in chunks, mimicking a network stream. */
  async function streamInChunks(chunks) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    return streamNdjson(stream);
  }

  it('reassembles a frame split across chunk boundaries', async () => {
    const events = await streamInChunks(['{"type":"prog', 'ress","step":"x"}\n', RESULT]);
    expect(events).toHaveLength(2);
    expect(events[0].step).toBe('x');
    expect(entitiesOfResult(events)).toBe('safe');
  });

  it('emits events through the callback as they arrive', async () => {
    const seen = [];
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`${PROGRESS}\n`));
        controller.enqueue(encoder.encode(`${RESULT}\n`));
        controller.close();
      },
    });
    await streamNdjson(stream, (event) => seen.push(event.type));
    expect(seen).toEqual(['progress', 'result']);
  });

  it('flushes a final frame with no trailing newline', async () => {
    const events = await streamInChunks([RESULT]);
    expect(events).toHaveLength(1);
    expect(extractReport(events).riskScore).toBe(4);
  });

  it('handles a multibyte character split across chunks', async () => {
    const encoder = new TextEncoder();
    const payload = encoder.encode('{"type":"progress","step":"café"}\n');
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(payload.slice(0, 28));
        controller.enqueue(payload.slice(28));
        controller.close();
      },
    });
    const events = await streamNdjson(stream);
    expect(events[0].step).toBe('café');
  });
});

function entitiesOfResult(events) {
  return extractReport(events).riskLevel;
}