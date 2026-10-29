import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Analysis, AnalysisPatch, WorkerRequest, WorkerResponse } from '../types';
import { analyzeMusic } from './analysis-service';
import { makeAnalysisPatch } from './analysis-result';
import { basicAnalysis } from './analysis-fallback';

const instances: FakeWorker[] = [];
class FakeWorker {
  onmessage?: (event: { data: WorkerResponse }) => void;
  onerror?: (event: { preventDefault: () => void }) => void;
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
const enhanced: Analysis = { ...baseline, bpm: 128, confidence: 0.9,
  rhythm: { beats: [1, 1.46875, 1.9375], tempo: [{ time: 1.46875, bpm: 128 }], confidence: 0.9, downbeats: [1], meterConfidence: 0.8 },
  pulse: { onsets: [{ time: 1, strength: 1, band: 0, role: 'beat' }], sections: [] }, recognition: { engine: 'beat-this', model: 'small0', rawBeats: 3 },
};
const enhancedPatch = makeAnalysisPatch(baseline, enhanced);
const start = () => { vi.stubGlobal('Worker', FakeWorker); return analyzeMusic(new Float32Array(100), 'enhanced', 'https://example.test/musicgame/', vi.fn()); };
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllGlobals(); instances.length = 0;
  vi.doUnmock('./analysis'); vi.doUnmock('./recognition'); vi.doUnmock('./beat-inference');
});

describe('page-side analysis watchdog and checkpoint recovery', () => {
  it('transfers the audio, accepts checkpoints and releases a successful worker', async () => {
    const job = start(), worker = instances[0];
    expect(worker.postMessage.mock.calls[0][0]).toMatchObject({ sampleRate: 22050, recognitionMode: 'enhanced', assetBase: 'https://example.test/musicgame/' });
    worker.emit({ type: 'baseline', analysis: baseline }); worker.emit({ type: 'patch', patch: structuredClone(enhancedPatch) });
    const result = await job.promise;
    expect(result).toEqual(enhanced); expect(worker.terminate).toHaveBeenCalledTimes(1);
    for (const key of ['chroma', 'tonalEnergy', 'energy', 'waveform', 'onsets', 'candidates'] as const) expect(result[key]).toBe(baseline[key]);
  });
  it('keeps a lightweight result as a single done message without a baseline', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const job = analyzeMusic(new Float32Array(100), 'basic', 'https://example.test/', vi.fn()), analysis = basicAnalysis(baseline);
    instances[0].emit({ type: 'done', analysis });
    expect(await job.promise).toBe(analysis); expect(instances[0].terminate).toHaveBeenCalledOnce();
  });
  it('merges a resource-error fallback patch without replacing the baseline feature arrays', async () => {
    const job = start(), worker = instances[0], fallback = basicAnalysis(baseline, '下载连接超时');
    worker.emit({ type: 'baseline', analysis: baseline }); worker.emit({ type: 'patch', patch: makeAnalysisPatch(baseline, fallback) });
    const result = await job.promise; expect(result).toEqual(fallback);
    expect(result.chroma).toBe(baseline.chroma); expect(result.tonalEnergy).toBe(baseline.tonalEnergy);
    expect(result.rhythm).toBe(baseline.rhythm); expect(result.pulse).toBe(baseline.pulse);
  });
  it('rejects a patch without a baseline and releases its watchdog and worker', async () => {
    vi.useFakeTimers(); const job = start(), failure = expect(job.promise).rejects.toThrow(/缺少基础数据/);
    instances[0].emit({ type: 'patch', patch: enhancedPatch }); await failure;
    expect(instances[0].terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('recovers a malformed patch using the existing baseline rather than hanging', async () => {
    const job = start(), worker = instances[0]; worker.emit({ type: 'baseline', analysis: baseline });
    worker.emit({ type: 'patch', patch: null as unknown as AnalysisPatch });
    const result = await job.promise;
    expect(result.recognition).toMatchObject({ engine: 'signal', warning: expect.stringContaining('结果无效') });
    expect(result.chroma).toBe(baseline.chroma); expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('recovers the same song when a WASM worker never answers again', async () => {
    vi.useFakeTimers(); const job = start(), worker = instances[0]; worker.emit({ type: 'baseline', analysis: baseline });
    await vi.advanceTimersByTimeAsync(45000);
    expect(await job.promise).toMatchObject({ fingerprint: baseline.fingerprint, recognition: { engine: 'signal', warning: expect.stringContaining('45 秒') } });
    worker.emit({ type: 'patch', patch: enhancedPatch }); expect(worker.terminate).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
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
    worker.emit({ type: 'patch', patch: enhancedPatch }); expect((await job.promise).recognition?.engine).toBe('signal');
  });
  it('cancels without returning a stale fallback or result', async () => {
    vi.useFakeTimers(); const job = start(), worker = instances[0], failure = expect(job.promise).rejects.toMatchObject({ name: 'AbortError' });
    worker.emit({ type: 'baseline', analysis: baseline }); job.cancel(); await failure; worker.emit({ type: 'patch', patch: enhancedPatch });
    await vi.advanceTimersByTimeAsync(90000); expect(worker.terminate).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it('ignores an old pre-checkpoint job while a replacement song completes its patch', async () => {
    const old = start(), oldWorker = instances[0], cancelled = expect(old.promise).rejects.toMatchObject({ name: 'AbortError' });
    old.cancel(); await cancelled;
    const replacement = start(), worker = instances[1], nextBaseline = { ...baseline, fingerprint: 'replacement-song', chroma: [[0.9, 0.1]] };
    oldWorker.emit({ type: 'baseline', analysis: baseline }); oldWorker.emit({ type: 'patch', patch: enhancedPatch });
    worker.emit({ type: 'baseline', analysis: nextBaseline }); worker.emit({ type: 'patch', patch: enhancedPatch });
    const result = await replacement.promise;
    expect(result.fingerprint).toBe('replacement-song'); expect(result.chroma).toBe(nextBaseline.chroma);
    expect(result.recognition?.engine).toBe('beat-this'); expect(oldWorker.terminate).toHaveBeenCalledOnce(); expect(worker.terminate).toHaveBeenCalledOnce();
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

describe('worker completion payloads', () => {
  it.each(['enhanced', 'fallback', 'basic', 'analysis-error'] as const)('does not resend feature arrays for %s', async mode => {
    vi.resetModules();
    const messages: WorkerResponse[] = [];
    const worker = { onmessage: null as ((event: MessageEvent<WorkerRequest>) => Promise<void>) | null,
      postMessage: (message: WorkerResponse) => { messages.push(structuredClone(message)); },
    };
    const infer = vi.fn(async () => {
      if (mode === 'fallback') throw Object.assign(new Error('节拍模型连接超时'), { name: 'BeatResourceError' });
      return new Float32Array(4);
    });
    vi.stubGlobal('self', worker);
    vi.doMock('./analysis', () => ({ analyzeAudio: () => { if (mode === 'analysis-error') throw new Error('这段音频接近静音'); return structuredClone(baseline); } }));
    vi.doMock('./recognition', () => ({ applyBeatRecognition: (analysis: Analysis) => ({ ...analysis, ...enhancedPatch }) }));
    vi.doMock('./beat-inference', () => ({ inferBeatLogits: infer }));
    await import('./analysis.worker');
    await worker.onmessage!({ data: { samples: new Float32Array(100), sampleRate: 22050, assetBase: 'https://example.test/', recognitionMode: mode === 'basic' ? 'basic' : 'enhanced' } } as MessageEvent<WorkerRequest>);
    const checkpoints = messages.filter(message => message.type === 'baseline'), patches = messages.filter(message => message.type === 'patch'), results = messages.filter(message => message.type === 'done');
    if (mode === 'analysis-error') {
      expect(messages).toEqual([{ type: 'error', message: '这段音频接近静音' }]);
    } else if (mode === 'basic') {
      expect(checkpoints).toHaveLength(0); expect(patches).toHaveLength(0); expect(results).toHaveLength(1);
      expect(results[0].analysis).toEqual(basicAnalysis(baseline)); expect(infer).not.toHaveBeenCalled();
    } else {
      expect(checkpoints).toHaveLength(1); expect(results).toHaveLength(0); expect(patches).toHaveLength(1);
      expect(checkpoints[0].analysis).toEqual(baseline);
      for (const field of ['chroma', 'tonalEnergy', 'energy', 'waveform', 'onsets', 'candidates']) expect(patches[0].patch).not.toHaveProperty(field);
      if (mode === 'enhanced') expect(patches[0].patch).toEqual(enhancedPatch);
      else expect(patches[0].patch).toEqual({ recognition: { engine: 'signal', warning: expect.stringContaining('节拍模型连接超时') } });
    }
  });
});
