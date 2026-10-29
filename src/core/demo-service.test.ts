import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_FRAMES, DEMO_SAMPLE_RATE } from './demo-synthesis';
import type { DemoResponse } from './demo.worker';

const instances: FakeWorker[] = [];
class FakeWorker {
  onmessage: ((event: MessageEvent<DemoResponse>) => void) | null = null;
  onerror: ((event: { preventDefault(): void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn(); terminate = vi.fn();
  constructor() { instances.push(this); }
  emit(data: DemoResponse) { this.onmessage?.({ data } as MessageEvent<DemoResponse>); }
}
let createDemoAsync: typeof import('./demo-service')['createDemoAsync'];
let provider: ReturnType<typeof vi.fn>, createBuffer: ReturnType<typeof vi.fn>;
// Lifecycle/copy tests need valid dimensions and nonzero markers, not synthesis.
const done = (): DemoResponse => {
  const samples = new Float32Array(DEMO_FRAMES);
  samples[0] = 0.25; samples[123] = 0.5; samples[Math.floor(DEMO_FRAMES / 2)] = -0.125; samples[DEMO_FRAMES - 1] = -0.25;
  return { type: 'done', sampleRate: DEMO_SAMPLE_RATE, samples };
};

beforeEach(async () => {
  vi.resetModules(); instances.length = 0; vi.stubGlobal('Worker', FakeWorker);
  createBuffer = vi.fn((_channels: number, frames: number, rate: number) => {
    const samples = new Float32Array(frames);
    return { length: frames, duration: frames / rate, sampleRate: rate, getChannelData: vi.fn(() => samples) };
  });
  provider = vi.fn(() => ({ createBuffer }));
  vi.doMock('./audio-context', () => ({ audioContext: provider }));
  ({ createDemoAsync } = await import('./demo-service'));
});
afterEach(() => { vi.useRealTimers(); vi.doUnmock('./audio-context'); vi.unstubAllGlobals(); });

describe('cancellable worker demo synthesis', () => {
  it('requests synthesis without a main-thread PCM, reports progress, then copies the received PCM once', async () => {
    vi.useFakeTimers(); const progress = vi.fn(), loading = createDemoAsync({ progress }), worker = instances[0];
    expect(provider).not.toHaveBeenCalled(); expect(createBuffer).not.toHaveBeenCalled();
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'synthesize' });
    worker.emit({ type: 'progress', value: 0.5, stage: '正在合成乐段' });
    expect(progress).toHaveBeenLastCalledWith(0.5, '正在合成乐段');
    const message = done(); if (message.type !== 'done') throw new Error('fixture');
    worker.emit(message);
    const buffer = await loading;
    expect(createBuffer).toHaveBeenCalledExactlyOnceWith(1, DEMO_FRAMES, DEMO_SAMPLE_RATE);
    const actual = buffer.getChannelData(0), expected = message.samples;
    // Vitest's toBe eagerly deep-compares unequal references for hints, even
    // with .not. Keep its matcher away from two million float elements.
    expect(actual === expected).toBe(false);
    expect(Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength)
      .equals(Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength))).toBe(true);
    expect(worker.terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    expect(worker.onmessage).toBeNull(); expect(worker.onerror).toBeNull();
  });

  it('does not construct a worker or audio context for a pre-aborted request', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(createDemoAsync({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(instances).toHaveLength(0); expect(provider).not.toHaveBeenCalled();
  });

  it('cancels promptly, removes listeners, and ignores a captured late result and progress', async () => {
    vi.useFakeTimers(); const controller = new AbortController(), progress = vi.fn(), removed = vi.spyOn(controller.signal, 'removeEventListener');
    const loading = createDemoAsync({ signal: controller.signal, progress }), failure = expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    const worker = instances[0], late = worker.onmessage!;
    controller.abort(); await failure;
    late({ data: { type: 'progress', value: 1, stage: 'late' } } as MessageEvent<DemoResponse>);
    late({ data: done() } as MessageEvent<DemoResponse>);
    expect(progress).toHaveBeenCalledTimes(1); expect(provider).not.toHaveBeenCalled();
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(worker.terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a silent worker at 30 seconds without recomputing on the main thread', async () => {
    vi.useFakeTimers(); const loading = createDemoAsync(), failure = expect(loading).rejects.toThrow(/30 秒/);
    await vi.advanceTimersByTimeAsync(30000); await failure;
    expect(instances[0].terminate).toHaveBeenCalledOnce(); expect(provider).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the total deadline bounded even if a broken worker emits repeated progress', async () => {
    vi.useFakeTimers(); const loading = createDemoAsync(), failure = expect(loading).rejects.toThrow(/30 秒/);
    for (let index = 0; index < 3; index++) { await vi.advanceTimersByTimeAsync(9000); instances[0].emit({ type: 'progress', value: 0.2, stage: 'still working' }); }
    await vi.advanceTimersByTimeAsync(3000); await failure; expect(provider).not.toHaveBeenCalled();
  });

  it('does not let cancellation of an old synthesis terminate its replacement', async () => {
    const controller = new AbortController(), old = createDemoAsync({ signal: controller.signal }), failure = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    const late = instances[0].onmessage!, next = createDemoAsync(); controller.abort(); await failure;
    late({ data: done() } as MessageEvent<DemoResponse>);
    expect(instances[1].terminate).not.toHaveBeenCalled(); expect(provider).not.toHaveBeenCalled();
    instances[1].emit(done()); await next; expect(instances[1].terminate).toHaveBeenCalledOnce();
  });

  it.each(['worker', 'message', 'response'] as const)('recovers from a %s error and releases the worker', async kind => {
    vi.useFakeTimers(); const loading = createDemoAsync(), failure = expect(loading).rejects.toThrow(/演示曲/), worker = instances[0];
    if (kind === 'worker') worker.onerror?.({ preventDefault: vi.fn() });
    else if (kind === 'message') worker.onmessageerror?.();
    else worker.emit({ type: 'error', message: 'private worker error' });
    await failure; expect(worker.terminate).toHaveBeenCalledOnce(); expect(provider).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a blocked worker constructor without allocating audio', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('blocked'); } });
    await expect(createDemoAsync()).rejects.toThrow(/线程启动失败/); expect(provider).not.toHaveBeenCalled();
  });

  it('cleans a failed initial message without synthesizing a fallback', async () => {
    class BrokenWorker extends FakeWorker { postMessage = vi.fn(() => { throw new Error('clone'); }); }
    vi.stubGlobal('Worker', BrokenWorker);
    await expect(createDemoAsync()).rejects.toThrow(/请求失败/);
    expect(instances[0].terminate).toHaveBeenCalledOnce(); expect(provider).not.toHaveBeenCalled();
  });

  it.each(['length', 'rate'] as const)('rejects invalid received %s before creating an AudioBuffer', async kind => {
    const loading = createDemoAsync(), failure = expect(loading).rejects.toThrow(/音频数据无效/);
    instances[0].emit({ type: 'done', sampleRate: kind === 'rate' ? 48000 : DEMO_SAMPLE_RATE, samples: new Float32Array(kind === 'length' ? 4 : DEMO_FRAMES) });
    await failure; expect(provider).not.toHaveBeenCalled(); expect(instances[0].terminate).toHaveBeenCalledOnce();
  });

  it('releases the worker and reports AudioBuffer allocation failure as recoverable', async () => {
    createBuffer.mockImplementation(() => { throw new Error('allocation'); });
    const loading = createDemoAsync(), failure = expect(loading).rejects.toThrow(/声音准备失败/);
    instances[0].emit(done()); await failure; expect(instances[0].terminate).toHaveBeenCalledOnce();
  });

  it('cleans up if the initial progress observer throws', async () => {
    await expect(createDemoAsync({ progress: () => { throw new Error('observer'); } })).rejects.toThrow(/请求失败/);
    expect(instances[0].postMessage).not.toHaveBeenCalled(); expect(instances[0].terminate).toHaveBeenCalledOnce();
  });
});
