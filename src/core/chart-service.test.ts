import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileChart } from './chart-service';
import type { Analysis, Chart } from '../types';
import type { ChartResponse } from './chart.worker';

const instances: FakeWorker[] = [];
class FakeWorker {
  onmessage?: (event: { data: ChartResponse }) => void;
  onerror?: () => void;
  postMessage = vi.fn(); terminate = vi.fn();
  constructor() { instances.push(this); }
  emit(data: ChartResponse) { this.onmessage?.({ data }); }
}
const analysis = { fingerprint: 'worker', duration: 5 } as Analysis;
const chart: Chart = { version: 4, fingerprint: 'worker', duration: 5, difficulty: 'three', bpm: 120, notes: [] };
afterEach(() => { vi.unstubAllGlobals(); instances.length = 0; });

describe('cancellable chart compilation worker', () => {
  it('passes settings, reports stages, returns the chart and releases the worker', async () => {
    vi.stubGlobal('Worker', FakeWorker); const progress = vi.fn();
    const job = compileChart(analysis, 'three', 128, progress), worker = instances[0];
    expect(worker.postMessage).toHaveBeenCalledWith({ analysis, difficulty: 'three', bpmOverride: 128 });
    worker.emit({ type: 'progress', value: 0.72, stage: 'hands' });
    worker.emit({ type: 'done', chart });
    expect(await job.promise).toBe(chart); expect(progress).toHaveBeenCalledWith(0.72, 'hands'); expect(worker.terminate).toHaveBeenCalledTimes(1);
    worker.emit({ type: 'progress', value: 1, stage: 'late' }); expect(progress).toHaveBeenCalledTimes(1);
  });

  it('cancels and ignores a late result without replacing a new difficulty', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const old = compileChart(analysis, 'four', undefined, vi.fn()), oldFailure = expect(old.promise).rejects.toMatchObject({ name: 'AbortError' });
    old.cancel(); await oldFailure;
    const current = compileChart(analysis, 'one', undefined, vi.fn());
    instances[0].emit({ type: 'done', chart });
    const next = { ...chart, difficulty: 'one' as const }; instances[1].emit({ type: 'done', chart: next });
    expect(await current.promise).toBe(next); expect(instances[0].terminate).toHaveBeenCalledTimes(1);
  });

  it('surfaces a recoverable compiler error and terminates exactly once', async () => {
    vi.stubGlobal('Worker', FakeWorker); const job = compileChart(analysis, 'two', undefined, vi.fn());
    const failure = expect(job.promise).rejects.toThrow('try another');
    instances[0].emit({ type: 'error', message: 'try another' }); job.cancel(); await failure;
    expect(instances[0].terminate).toHaveBeenCalledTimes(1);
  });

  it('surfaces worker startup failure without leaving a pending promise', async () => {
    vi.stubGlobal('Worker', FakeWorker); const job = compileChart(analysis, 'two', undefined, vi.fn());
    const failure = expect(job.promise).rejects.toThrow(/线程启动失败/); instances[0].onerror?.(); await failure;
    expect(instances[0].terminate).toHaveBeenCalledTimes(1);
  });

  it('releases the worker when posting the analysis fails', async () => {
    class BrokenWorker extends FakeWorker { postMessage = vi.fn(() => { throw new Error('clone'); }); }
    vi.stubGlobal('Worker', BrokenWorker); const job = compileChart(analysis, 'two', undefined, vi.fn());
    await expect(job.promise).rejects.toThrow(/传递失败/); expect(instances[0].terminate).toHaveBeenCalledTimes(1);
  });
});
