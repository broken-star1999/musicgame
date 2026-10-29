import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { downloadBeatAsset } from './beat-resources';

const bytes = Uint8Array.of(1, 2, 3, 4, 5, 6);
const settings = { label: '节拍模型', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('bounded model and runtime downloads', () => {
  it('counts decoded stream bytes rather than a compressed Content-Length', async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.slice(0, 2)); controller.enqueue(bytes.slice(2)); controller.close(); } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { headers: { 'content-length': '2', 'content-encoding': 'gzip' } })));
    const progress = vi.fn();
    expect(await downloadBeatAsset('/model', { ...settings, progress })).toEqual(bytes);
    expect(progress).toHaveBeenCalledWith(0, 6); expect(progress).toHaveBeenLastCalledWith(6, 6);
  });
  it('aborts stalled headers after 15 seconds even if fetch ignores abort', async () => {
    vi.useFakeTimers(); const fetch = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>(() => {})); vi.stubGlobal('fetch', fetch);
    const download = downloadBeatAsset('/model', settings), failure = expect(download).rejects.toThrow(/连接超时/);
    await vi.advanceTimersByTimeAsync(15000); await failure;
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it('detects a stalled body after initially receiving data', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 2)); } }))));
    const download = downloadBeatAsset('/model', settings), failure = expect(download).rejects.toThrow(/下载停滞/);
    await vi.advanceTimersByTimeAsync(15000); await failure; expect(vi.getTimerCount()).toBe(0);
  });
  it('caps total loading time while a trickle keeps resetting the idle deadline', async () => {
    vi.useFakeTimers(); let controller: ReadableStreamDefaultController<Uint8Array>;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start(value) { controller = value; } }))));
    const download = downloadBeatAsset('/model', { ...settings, idleTimeoutMs: 10000, totalTimeoutMs: 12000 });
    const failure = expect(download).rejects.toThrow(/下载超时/);
    await vi.advanceTimersByTimeAsync(5000); controller!.enqueue(bytes.slice(0, 1));
    await vi.advanceTimersByTimeAsync(5000); controller!.enqueue(bytes.slice(1, 2));
    await vi.advanceTimersByTimeAsync(2000); await failure; expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    ['HTTP error', () => new Response('missing', { status: 404 }), /404/],
    ['truncated file', () => new Response(bytes.slice(0, 2)), /不完整/],
    ['oversized file', () => new Response(new Uint8Array(7)), /大小不符/],
    ['bad checksum', () => new Response(new Uint8Array(6)), /校验失败/],
  ] as const)('rejects %s with a recoverable resource error', async (_name, response, message) => {
    vi.stubGlobal('fetch', vi.fn(async () => response()));
    await expect(downloadBeatAsset('/model', settings)).rejects.toThrow(message);
  });
});
