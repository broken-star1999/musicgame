import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Analysis, WorkerRequest, WorkerResponse } from '../types';
import { analyzeMusic } from './analysis-service';
import { basicAnalysis } from './analysis-fallback';

const instances: FakeWorker[] = [];
class FakeWorker {
  onmessage: ((event: { data: WorkerResponse }) => void) | null = null;
  onerror: ((event: { preventDefault: () => void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn(); terminate = vi.fn();
  constructor() { instances.push(this); }
  emit(data: WorkerResponse) { this.onmessage?.({ data }); }
}
const baseline: Analysis = {
  fingerprint: 'same-song', duration: 12, bpm: 120, confidence: 0.4, onsets: [], candidates: [],
  energy: [0.3, 0.5], energyStep: 0.05, waveform: [0.2, 0.5], chroma: [[0.2, 0.4]], tonalEnergy: [[0.1, 0.3]], chromaStep: 0.05,
  rhythm: { beats: [1, 1.5, 2], tempo: [], confidence: 0.4, downbeats: [], meterConfidence: 0 },
  pulse: { onsets: [], sections: [] },
};
const start = (progress = vi.fn()) => { vi.stubGlobal('Worker', FakeWorker); return analyzeMusic(new Float32Array(100), progress); };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); instances.length = 0; vi.doUnmock('./analysis'); });

describe('single DSP worker lifecycle', () => {
  it('transfers PCM once, receives one complete result and releases every handler', async () => {
    const samples = new Float32Array(100); vi.stubGlobal('Worker', FakeWorker);
    const job = analyzeMusic(samples, vi.fn()), worker = instances[0], analysis = basicAnalysis(baseline);
    expect(worker.postMessage).toHaveBeenCalledWith({ samples, sampleRate: 22050 }, [samples.buffer]);
    expect(Object.keys(job).sort()).toEqual(['cancel', 'promise']);
    worker.emit({ type: 'done', analysis }); expect(await job.promise).toBe(analysis);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull(); expect(worker.onerror).toBeNull(); expect(worker.onmessageerror).toBeNull();
  });
  it('rejects a stalled analysis and clears the worker and watchdog', async () => {
    vi.useFakeTimers(); const job = start(), failure = expect(job.promise).rejects.toThrow(/45 秒/);
    await vi.advanceTimersByTimeAsync(45000); await failure;
    expect(instances[0].terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('renews the watchdog on real progress, then reports a recoverable timeout', async () => {
    vi.useFakeTimers(); const progress = vi.fn(), job = start(progress), failure = expect(job.promise).rejects.toThrow(/45 秒/), worker = instances[0];
    await vi.advanceTimersByTimeAsync(30000); worker.emit({ type: 'progress', value: 0.6, stage: '正在跟踪节拍' });
    expect(progress).toHaveBeenCalledWith(0.6, '正在跟踪节拍');
    await vi.advanceTimersByTimeAsync(44999); expect(worker.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await failure; expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels immediately and ignores results from a replaced song', async () => {
    vi.useFakeTimers(); const old = start(), oldWorker = instances[0], cancelled = expect(old.promise).rejects.toMatchObject({ name: 'AbortError' });
    const late = oldWorker.onmessage; old.cancel(); old.cancel(); await cancelled;
    const next = start(), analysis = basicAnalysis({ ...baseline, fingerprint: 'replacement' });
    late?.({ data: { type: 'done', analysis: basicAnalysis(baseline) } });
    instances[1].emit({ type: 'done', analysis }); expect(await next.promise).toBe(analysis);
    expect(oldWorker.terminate).toHaveBeenCalledOnce(); expect(instances[1].terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['error', 'messageerror'] as const)('releases the worker after %s', async kind => {
    const job = start(), failure = expect(job.promise).rejects.toThrow(/线程异常|数据传递失败/), worker = instances[0];
    if (kind === 'error') worker.onerror?.({ preventDefault: vi.fn() }); else worker.onmessageerror?.();
    await failure; expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('propagates recoverable decoder/analysis errors', async () => {
    const job = start(), failure = expect(job.promise).rejects.toThrow('没有找到声音起点');
    instances[0].emit({ type: 'error', message: '没有找到声音起点' }); await failure;
  });
  it.each([NaN, Infinity])('rejects invalid progress %s instead of renewing forever', async value => {
    const job = start(), failure = expect(job.promise).rejects.toThrow(/进度无效/);
    instances[0].emit({ type: 'progress', value, stage: '无效' }); await failure;
  });
  it('bounds finite progress and completes without duplicate results', async () => {
    const progress = vi.fn(), job = start(progress), worker = instances[0], late = worker.onmessage;
    worker.emit({ type: 'progress', value: -1, stage: '起点' }); worker.emit({ type: 'progress', value: 2, stage: '完成' });
    const analysis = basicAnalysis(baseline); worker.emit({ type: 'done', analysis });
    late?.({ data: { type: 'done', analysis: { ...analysis, bpm: 999 } } });
    expect(await job.promise).toBe(analysis); expect(progress.mock.calls).toEqual([[0, '起点'], [1, '完成']]); expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it.each([null, { type: 'patch', patch: {} }, { type: 'done', analysis: null }])('rejects obsolete or malformed payload %j', async payload => {
    const job = start(), failure = expect(job.promise).rejects.toThrow(/无效/);
    instances[0].emit(payload as unknown as WorkerResponse); await failure;
  });
  it('reports constructor and transfer failures without hanging', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('blocked'); } });
    await expect(analyzeMusic(new Float32Array(10), vi.fn()).promise).rejects.toThrow(/线程启动失败/);
    class BrokenWorker extends FakeWorker { postMessage = vi.fn(() => { throw new Error('clone'); }); }
    vi.stubGlobal('Worker', BrokenWorker);
    await expect(analyzeMusic(new Float32Array(10), vi.fn()).promise).rejects.toThrow(/数据传递失败/);
  });
});

describe('DSP worker protocol', () => {
  it.each([false, true])('returns one DSP analysis even with obsolete request fields: %s', async legacy => {
    vi.resetModules(); const messages: WorkerResponse[] = [], worker = { onmessage: null as ((event: MessageEvent<WorkerRequest>) => void) | null, postMessage: (message: WorkerResponse) => messages.push(structuredClone(message)) };
    vi.stubGlobal('self', worker);
    vi.doMock('./analysis', () => ({ analyzeAudio: (_samples: Float32Array, _rate: number, progress: (n: number, text: string) => void) => { progress(0.8, '节拍'); return structuredClone(baseline); } }));
    await import('./analysis.worker');
    const data = { samples: new Float32Array(100), sampleRate: 22050, ...(legacy ? { recognitionMode: 'enhanced', assetBase: 'https://unused.invalid/' } : {}) };
    worker.onmessage!({ data } as MessageEvent<WorkerRequest>);
    expect(messages.filter(m => m.type === 'done')).toEqual([{ type: 'done', analysis: basicAnalysis(baseline) }]);
    expect(messages.some(m => m.type === 'progress' && m.value === 0.8)).toBe(true);
    expect(messages.every(m => ['progress', 'done'].includes(m.type))).toBe(true);
  });
  it('returns a recoverable error for silent/unsupported input', async () => {
    vi.resetModules(); const messages: WorkerResponse[] = [], worker = { onmessage: null as ((event: MessageEvent<WorkerRequest>) => void) | null, postMessage: (message: WorkerResponse) => messages.push(message) };
    vi.stubGlobal('self', worker); vi.doMock('./analysis', () => ({ analyzeAudio: () => { throw new Error('这段音频接近静音'); } }));
    await import('./analysis.worker'); worker.onmessage!({ data: { samples: new Float32Array(100), sampleRate: 22050 } } as MessageEvent<WorkerRequest>);
    expect(messages).toEqual([{ type: 'error', message: '这段音频接近静音' }]);
  });
});
