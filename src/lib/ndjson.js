// scanrepo.dev returns newline-delimited JSON: progress events then a final result.

/**
 * Parse a complete NDJSON body into its events, skipping blank and malformed lines.
 * A malformed line is ignored rather than fatal so one bad progress frame cannot
 * discard an otherwise-good result.
 * @param {string} text
 * @returns {Array<Record<string, any>>}
 */
export function parseNdjson(text) {
  const events = [];
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') events.push(parsed);
    } catch {
      // ignore: partial or non-JSON frame
    }
  }
  return events;
}

/**
 * Extract the report from a parsed event list.
 * The last result event wins; earlier ones are only ever progress frames.
 * @param {Array<Record<string, any>>} events
 * @returns {import('../types.js').RepoReport | null}
 */
export function extractReport(events) {
  let report = null;
  for (const event of events) {
    if (event?.type === 'result' && event.data && typeof event.data === 'object') {
      report = event.data;
    }
  }
  return report;
}

/**
 * Stream an NDJSON response, invoking `onEvent` per frame.
 * @param {ReadableStream<Uint8Array>} stream
 * @param {(event: Record<string, any>) => void} onEvent
 * @returns {Promise<Array<Record<string, any>>>} all events seen
 */
export async function streamNdjson(stream, onEvent = () => {}) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  /** @type {Array<Record<string, any>>} */
  const events = [];
  let buffer = '';

  /** @param {string} line */
  const flush = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const event = JSON.parse(trimmed);
      if (event && typeof event === 'object') {
        events.push(event);
        onEvent(event);
      }
    } catch {
      // ignore partial frame
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        flush(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    }
    buffer += decoder.decode();
    flush(buffer);
  } finally {
    reader.releaseLock?.();
  }

  return events;
}