import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Analysis, WorkerResponse } from '../types';
import { analyzeMusic } from './analysis-service';

const instances: FakeWorker[] = [];
class FakeWorker {
  onmessage?: (event: { data: WorkerResponse }) => void;
  onerror?: (event: { preventDefault: () => void }) => void;
  postMessage = vi.fn(); terminate = vi.fn();
  constructor() { instances.push(this); }
  emit(data: WorkerResponse) { this.onmessage?.({ data }); }
}
const baseline = { fingerprint: 'same-song', duration: 12, bpm: 120, onsets: [] } as unknown as Analysis;
const enhanced = { ...baseline, recognition: { engine: 'beat-this' as const } };
const start = () => { vi.stubGlobal('Worker', FakeWorker); return analyzeMusic(new Float32Array(100), 'enhanced', 'https://example.test/musicgame/', vi.fn()); };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); instances.length = 0; });

describe('page-side analysis watchdog and checkpoint recovery', () => {
  it('transfers the audio, accepts checkpoints and releases a successful worker', async () => {
    const job = start(), worker = instances[0];
    expect(worker.postMessage.mock.calls[0][0]).toMatchObject({ sampleRate: 22050, recognitionMode: 'enhanced', assetBase: 'https://example.test/musicgame/' });
    worker.emit({ type: 'baseline', analysis: baseline }); worker.emit({ type: 'done', analysis: enhanced });
    expect(await job.promise).toBe(enhanced); expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('recovers the same song when a WASM worker never answers again', async () => {
    vi.useFakeTimers(); const job = start(), worker = instances[0]; worker.emit({ type: 'baseline', analysis: baseline });
    await vi.advanceTimersByTimeAsync(45000);
    expect(await job.promise).toMatchObject({ fingerprint: baseline.fingerprint, recognition: { engine: 'signal', warning: expect.stringContaining('45 秒') } });
    worker.emit({ type: 'done', analysis: enhanced }); expect(worker.terminate).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it('renews the watchdog only when the worker actually reports progress', async () => {
    vi.useFakeTimers(); const job = start(), worker = instances[0]; worker.emit({ type: 'baseline', analysis: baseline });
    await vi.advanceTimersByTimeAsync(30000); worker.emit({ type: 'progress', value: 0.6, stage: '下载运行组件 1 / 15 MB' });
    await vi.advanceTimersByTimeAsync(44999); expect(worker.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect((await job.promise).recognition?.engine).toBe('signal');
  });
  it.each([true, false])('uses the existing basic result on request, checkpoint already received: %s', async alreadyReceived => {
    const job = start(), worker = instances[0]; if (alreadyReceived) worker.emit({ type: 'baseline', analysis: baseline });
    job.useBasic(); if (!alreadyReceived) { expect(worker.terminate).not.toHaveBeenCalled(); worker.emit({ type: 'baseline', analysis: baseline }); }
    expect(await job.promise).toMatchObject({ fingerprint: baseline.fingerprint, recognition: { engine: 'signal' } });
    expect((await job.promise).recognition?.warning).toBeUndefined(); expect(instances).toHaveLength(1); expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('cancels without returning a stale fallback or result', async () => {
    vi.useFakeTimers(); const job = start(), worker = instances[0], failure = expect(job.promise).rejects.toMatchObject({ name: 'AbortError' });
    worker.emit({ type: 'baseline', analysis: baseline }); job.cancel(); await failure; worker.emit({ type: 'done', analysis: enhanced });
    await vi.advanceTimersByTimeAsync(90000); expect(worker.terminate).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it('fails cleanly when no signal analysis is available', async () => {
    vi.useFakeTimers(); const job = start(), failure = expect(job.promise).rejects.toThrow(/音频分析.*45 秒/);
    await vi.advanceTimersByTimeAsync(45000); await failure; expect(instances[0].terminate).toHaveBeenCalledTimes(1);
  });
  it('recovers from a worker error after the checkpoint', async () => {
    const job = start(), worker = instances[0]; worker.emit({ type: 'baseline', analysis: baseline }); worker.onerror?.({ preventDefault: vi.fn() });
    expect((await job.promise).recognition?.engine).toBe('signal');
  });
  it('reports constructor and transfer failures instead of hanging', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('blocked'); } });
    await expect(analyzeMusic(new Float32Array(10), 'basic', '/', vi.fn()).promise).rejects.toThrow(/线程启动失败/);
    class BrokenWorker extends FakeWorker { postMessage = vi.fn(() => { throw new Error('clone'); }); }
    vi.stubGlobal('Worker', BrokenWorker);
    await expect(analyzeMusic(new Float32Array(10), 'enhanced', '/', vi.fn()).promise).rejects.toThrow(/数据传递失败/);
  });
});
