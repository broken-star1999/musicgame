import { downloadBeatAsset, verifyBeatAsset } from './beat-resources';
import type { DownloadOptions } from './beat-resources';

export const BEAT_CACHE = 'beatfall-beat-assets-v1';
const READ_TIMEOUT = 3000, WRITE_TIMEOUT = 1500;

interface CachedOptions extends DownloadOptions {
  scope: string;
  slot: 'model' | 'runtime';
  onCached?: () => void;
}

/** Storage is optional. Its promises cannot block model loading indefinitely,
 * and a late operation must not report progress or start deleting entries. */
async function storageAttempt<T>(operation: (current: () => boolean) => Promise<T>, timeout: number): Promise<T | undefined> {
  let active = true, timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      operation(() => active).catch(() => undefined),
      new Promise<undefined>(resolve => { timer = setTimeout(() => { active = false; resolve(undefined); }, timeout); }),
    ]);
  } finally { active = false; clearTimeout(timer!); }
}

/** Only verified public model/runtime bytes enter this cache, never music or
 * analysis. Virtual keys keep cleanup scoped to this app and resource kind. */
export async function loadBeatAsset(url: string | URL, options: CachedOptions): Promise<Uint8Array> {
  const started = performance.now();
  const prefix = new URL(`.beatfall-assets/${options.slot}/`, options.scope).href;
  const key = `${prefix}${options.sha256}`;
  let cache: Cache | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cached = await storageAttempt(async current => {
    // CacheStorage may throw when accessed, e.g. in restricted/private contexts.
    if (!globalThis.crypto?.subtle || !globalThis.caches) return;
    const opened = await caches.open(BEAT_CACHE);
    if (!current()) return;
    cache = opened;
    const response = await cache.match(key);
    if (!current() || !response) return;
    try {
      if (!response.ok || !response.body) throw new Error('Invalid cached response');
      reader = response.body.getReader();
      const data = new Uint8Array(options.bytes); let received = 0;
      while (current()) {
        const part = await reader.read();
        if (!current()) return;
        if (part.done) break;
        if (received + part.value.byteLength > data.byteLength) throw new Error('Oversized cache entry');
        data.set(part.value, received); received += part.value.byteLength;
      }
      if (received !== options.bytes) throw new Error('Truncated cache entry');
      await verifyBeatAsset(data, options);
      if (current()) return data;
    } catch {
      // Treat corruption as a miss and overwrite only after verification.
      // A fire-and-forget delete could finish after put and erase the repair.
    }
  }, READ_TIMEOUT);
  if (reader) { void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch { /* A timed-out read may still be pending. */ } }
  if (cached) { options.onCached?.(); return cached; }

  const data = await downloadBeatAsset(url, {
    ...options, totalTimeoutMs: Math.max(1, (options.totalTimeoutMs ?? 90000) - (performance.now() - started)),
  });
  if (cache) await storageAttempt(async current => {
    await cache!.put(key, new Response(data, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(data.byteLength) } }));
    if (!current()) return;
    // Retain the other resource, other sites on this origin, and unrelated caches.
    const keys = await cache!.keys();
    if (current()) await Promise.all(keys.filter(request => request.url.startsWith(prefix) && request.url !== key).map(request => cache!.delete(request)));
  }, WRITE_TIMEOUT);
  return data;
}
