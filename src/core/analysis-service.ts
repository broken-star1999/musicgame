import type { Analysis, RecognitionMode, WorkerRequest, WorkerResponse } from '../types';
import { ANALYSIS_STALL_MS, basicAnalysis } from './analysis-fallback';
import { mergeAnalysisPatch } from './analysis-result';

/** The watchdog lives on the page, outside the WASM worker. A blocked worker
 * cannot prevent this timeout or discard the already finished signal result. */
export function analyzeMusic(samples: Float32Array, recognitionMode: RecognitionMode, assetBase: string, progress: (value: number, stage: string) => void) {
  let worker: Worker;
  try { worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' }); }
  catch { return { promise: Promise.reject<Analysis>(new Error('分析线程启动失败，请刷新页面后重试。')), cancel: () => {}, useBasic: () => {} }; }
  let finished = false, baseline: Analysis | undefined, preferBasic = false;
  let timer: ReturnType<typeof setTimeout>, cancel = () => {}, useBasic = () => {};
  const promise = new Promise<Analysis>((resolve, reject) => {
    const finish = (action: () => void) => { if (finished) return; finished = true; clearTimeout(timer); worker.terminate(); action(); };
    const recover = (reason: string) => finish(() => baseline ? resolve(basicAnalysis(baseline, reason)) : reject(new Error(reason)));
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => recover(baseline ? '模型辅助识别连续 45 秒没有响应' : '音频分析连续 45 秒没有响应'), ANALYSIS_STALL_MS); };
    cancel = () => finish(() => reject(new DOMException('Analysis cancelled', 'AbortError')));
    useBasic = () => { if (finished) return; preferBasic = true; if (baseline) finish(() => resolve(basicAnalysis(baseline!))); };
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (finished) return;
      const message = event.data; arm();
      if (message.type === 'progress') progress(message.value, message.stage);
      else if (message.type === 'baseline') { baseline = message.analysis; if (preferBasic) useBasic(); }
      else if (message.type === 'patch') {
        if (!baseline) finish(() => reject(new Error('模型辅助分析结果缺少基础数据，请重新识别。')));
        else try {
          const analysis = mergeAnalysisPatch(baseline, message.patch);
          finish(() => resolve(analysis));
        } catch { recover('模型辅助分析结果无效，请重新识别'); }
      }
      else if (message.type === 'done') finish(() => resolve(message.analysis));
      else recover(message.message);
    };
    worker.onerror = event => { event.preventDefault(); if (!finished) recover('分析线程异常，请重试或切换纯算法识别'); };
    arm();
    try { worker.postMessage({ samples, sampleRate: 22050, recognitionMode, assetBase } satisfies WorkerRequest, [samples.buffer]); }
    catch { recover('音频数据传递失败，请重新选择歌曲。'); }
  });
  return { promise, cancel: () => cancel(), useBasic: () => useBasic() };
}
