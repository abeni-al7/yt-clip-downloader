// Byte-range downloads from googlevideo. YouTube throttles single requests above ~10 MB, so
// large spans are fetched as consecutive ≤8 MiB ranges into one preallocated buffer.

const CHUNK = 8 * 1024 * 1024;

export class FetchError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function fetchOnce(url, start, end, signal) {
  const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, credentials: "omit", signal });
  if (response.status === 200 && start !== 0) {
    throw new FetchError("YouTube's media server ignored the byte range.", 200);
  }
  if (response.status !== 206 && response.status !== 200) {
    throw new FetchError(`YouTube's media server answered ${response.status} for a byte range.`, response.status);
  }
  return response;
}

/** Fetch bytes [start, end] (inclusive) of `url`; `onBytes(n)` reports progress increments. */
export async function fetchRange(url, start, end, { signal, onBytes } = {}) {
  const total = end - start + 1;
  const out = new Uint8Array(total);
  let written = 0;
  while (written < total) {
    const chunkStart = start + written;
    const chunkEnd = Math.min(end, chunkStart + CHUNK - 1);
    let response;
    for (let attempt = 0; ; attempt += 1) {
      try {
        response = await fetchOnce(url, chunkStart, chunkEnd, signal);
        break;
      } catch (error) {
        if (signal?.aborted || attempt >= 2 || (error instanceof FetchError && error.status === 403)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    const reader = response.body.getReader();
    let expected = chunkEnd - chunkStart + 1;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const take = Math.min(value.length, total - written);
      out.set(value.subarray(0, take), written);
      written += take;
      expected -= take;
      onBytes?.(take);
      if (written >= total) break;
    }
    if (expected > 0) throw new FetchError("The media server closed the connection early.", 0);
  }
  return out;
}

/** Concatenate typed arrays. */
export function concat(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
