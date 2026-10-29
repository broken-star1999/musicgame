import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { BEAT_CACHE, loadBeatAsset } from './beat-cache';

const bytes = Uint8Array.of(1, 2, 3, 4, 5, 6);
const options = { label: '节拍模型', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), scope: 'https://example.test/musicgame/', slot: 'model' as const };
const key = `${options.scope}.beatfall-assets/model/${options.sha256}`;
const url = `${options.scope}models/test.onnx`;
const forever = <T>() => new Promise<T>(() => {});

function storage() {
  const entries = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (input: string) => entries.get(input)?.clone()),
    put: vi.fn(async (input: string, response: Response) => { entries.set(input, response.clone()); }),
    delete: vi.fn(async (input: string | Request) => entries.delete(typeof input === 'string' ? input : input.url)),
    keys: vi.fn(async () => Array.from(entries.keys(), input => new Request(input))),
  };
  const open = vi.fn(async () => cache);
  vi.stubGlobal('caches', { open });
  const fetch = vi.fn(async () => new Response(bytes)); vi.stubGlobal('fetch', fetch);
  return { entries, cache, open, fetch };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('verified optional beat resource cache', () => {
  it('populates once and reuses verified bytes without a network request', async () => {
    const { entries, open, fetch } = storage(), onCached = vi.fn();
    expect(await loadBeatAsset(url, { ...options, onCached })).toEqual(bytes);
    expect(onCached).not.toHaveBeenCalled();
    expect(entries.size).toBe(1); expect(open).toHaveBeenCalledWith(BEAT_CACHE);
    fetch.mockRejectedValue(new Error('offline'));
    expect(await loadBeatAsset(url, { ...options, onCached })).toEqual(bytes);
    expect(onCached).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    ['checksum', new Uint8Array(6)], ['length', bytes.slice(0, 2)], ['oversized', new Uint8Array(7)],
  ])('ignores a cache entry with invalid %s and overwrites it with a verified replacement', async (_reason, corrupt) => {
    const { entries, cache, fetch } = storage(), onCached = vi.fn();
    entries.set(key, new Response(corrupt));
    expect(await loadBeatAsset(url, { ...options, onCached })).toEqual(bytes);
    expect(onCached).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledOnce();
    expect(cache.delete).not.toHaveBeenCalledWith(key);
    expect(new Uint8Array(await entries.get(key)!.arrayBuffer())).toEqual(bytes);
  });

  it('does not issue a delayed delete that could erase a repaired cache entry', async () => {
    const { entries, cache } = storage(); entries.set(key, new Response(new Uint8Array(6)));
    cache.delete.mockImplementation(() => forever());
    expect(await loadBeatAsset(url, options)).toEqual(bytes);
    expect(cache.delete).not.toHaveBeenCalled();
    expect(new Uint8Array(await entries.get(key)!.arrayBuffer())).toEqual(bytes);
  });

  it('cleans only old versions of this app and resource kind', async () => {
    const { entries } = storage();
    const old = `${options.scope}.beatfall-assets/model/old`;
    const otherKeys = [`${options.scope}.beatfall-assets/runtime/old`, 'https://example.test/other/.beatfall-assets/model/old', `${options.scope}unrelated`];
    for (const input of [old, ...otherKeys]) entries.set(input, new Response(bytes));
    await loadBeatAsset(url, options);
    expect(entries.has(old)).toBe(false); expect(entries.has(key)).toBe(true);
    for (const input of otherKeys) expect(entries.has(input)).toBe(true);
  });

  it.each(['missing', 'denied', 'no-crypto', 'quota'] as const)('keeps network loading usable when storage is %s', async reason => {
    const { open, cache, fetch } = storage();
    if (reason === 'missing') vi.stubGlobal('caches', undefined);
    if (reason === 'denied') open.mockRejectedValue(new DOMException('Denied', 'SecurityError'));
    if (reason === 'no-crypto') vi.stubGlobal('crypto', undefined);
    if (reason === 'quota') cache.put.mockRejectedValue(new DOMException('Full', 'QuotaExceededError'));
    expect(await loadBeatAsset(url, options)).toEqual(bytes); expect(fetch).toHaveBeenCalledOnce();
    if (reason === 'no-crypto') expect(cache.put).not.toHaveBeenCalled();
  });

  it.each(['open', 'match', 'body', 'put', 'keys'] as const)('bounds a stalled storage %s operation without losing the model', async operation => {
    vi.useFakeTimers(); const { cache, open, fetch } = storage();
    let entered: () => void; const writeStarted = new Promise<void>(resolve => { entered = resolve; });
    if (operation === 'open') open.mockImplementation(() => forever());
    if (operation === 'match') cache.match.mockImplementation(() => forever());
    if (operation === 'body') cache.match.mockImplementation(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 2)); } })));
    if (operation === 'put') cache.put.mockImplementation(() => { entered(); return forever(); });
    if (operation === 'keys') cache.keys.mockImplementation(() => { entered(); return forever(); });
    const loading = loadBeatAsset(url, options);
    if (operation === 'put' || operation === 'keys') await writeStarted;
    await vi.advanceTimersByTimeAsync(operation === 'put' || operation === 'keys' ? 1500 : 3000);
    expect(await loading).toEqual(bytes); expect(fetch).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores a cache hit that completes after the storage deadline', async () => {
    vi.useFakeTimers(); const { cache, fetch } = storage(), onCached = vi.fn();
    let complete: (value: Response) => void;
    cache.match.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const loading = loadBeatAsset(url, { ...options, onCached });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await loading).toEqual(bytes);
    complete!(new Response(bytes)); await vi.advanceTimersByTimeAsync(0);
    expect(onCached).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledOnce();
  });

  it('never stores a failed or corrupt network response', async () => {
    const { fetch, cache } = storage(); fetch.mockImplementation(async () => new Response(new Uint8Array(6)));
    await expect(loadBeatAsset(url, options)).rejects.toThrow(/校验失败/);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('deducts slow cache reads from the caller download deadline', async () => {
    vi.useFakeTimers(); const { open, fetch } = storage();
    open.mockImplementation(() => forever()); fetch.mockImplementation(() => forever());
    const loading = loadBeatAsset(url, { ...options, totalTimeoutMs: 4000 });
    const failure = expect(loading).rejects.toThrow(/下载超时/);
    await vi.advanceTimersByTimeAsync(4000); await failure;
    expect(vi.getTimerCount()).toBe(0);
  });
});
