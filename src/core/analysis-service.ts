import type { Analysis, WorkerRequest, WorkerResponse } from '../types';
import { ANALYSIS_STALL_MS } from './analysis-fallback';

/** The page owns the watchdog so a stalled analysis worker remains cancellable. */
export function analyzeMusic(samples: Float32Array, progress: (value: number, stage: string) => void) {
  let worker: Worker;
  try { worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' }); }
  catch { return { promise: Promise.reject<Analysis>(new Error('分析线程启动失败，请刷新页面后重试。')), cancel: () => {} }; }
  let finished = false, timer: ReturnType<typeof setTimeout> | undefined, cancel = () => {};
  const promise = new Promise<Analysis>((resolve, reject) => {
    const finish = (action: () => void) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
      worker.terminate(); action();
    };
    const fail = (message: string) => finish(() => reject(new Error(message)));
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => fail('音频分析连续 45 秒没有响应，请重试或更换歌曲。'), ANALYSIS_STALL_MS); };
    cancel = () => finish(() => reject(new DOMException('Analysis cancelled', 'AbortError')));
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (finished) return;
      try {
        const message = event.data;
        if (message.type === 'progress') {
          if (!Number.isFinite(message.value)) { fail('音频分析进度无效，请重新选择歌曲。'); return; }
          arm(); progress(Math.max(0, Math.min(1, message.value)), message.stage);
        } else if (message.type === 'done') {
          if (!message.analysis || typeof message.analysis.fingerprint !== 'string' || !Number.isFinite(message.analysis.duration) || !Number.isFinite(message.analysis.bpm) || !Array.isArray(message.analysis.onsets)) { fail('音频分析结果无效，请重新选择歌曲。'); return; }
          finish(() => resolve(message.analysis));
        } else if (message.type === 'error') fail(message.message);
        else fail('音频分析响应无效，请重新选择歌曲。');
      } catch { fail('音频分析数据无效，请重新选择歌曲。'); }
    };
    worker.onerror = event => { event.preventDefault(); fail('分析线程异常，请重新选择歌曲。'); };
    worker.onmessageerror = () => fail('音频分析数据传递失败，请重新选择歌曲。');
    arm();
    try { worker.postMessage({ samples, sampleRate: 22050 } satisfies WorkerRequest, [samples.buffer]); }
    catch { fail('音频数据传递失败，请重新选择歌曲。'); }
  });
  return { promise, cancel: () => cancel() };
}
