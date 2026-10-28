import type { Analysis, Chart, Difficulty } from '../types';
import type { ChartRequest, ChartResponse } from './chart.worker';

export function compileChart(analysis: Analysis, difficulty: Difficulty, bpmOverride: number | undefined, progress: (value: number, stage: string) => void) {
  const worker = new Worker(new URL('./chart.worker.ts', import.meta.url), { type: 'module' });
  let finished = false, cancel = () => {};
  const promise = new Promise<Chart>((resolve, reject) => {
    const finish = (action: () => void) => { if (finished) return; finished = true; worker.terminate(); action(); };
    cancel = () => finish(() => reject(new DOMException('Chart compilation cancelled', 'AbortError')));
    worker.onmessage = (event: MessageEvent<ChartResponse>) => {
      if (finished) return;
      const message = event.data;
      if (message.type === 'progress') progress(message.value, message.stage);
      else if (message.type === 'done') finish(() => resolve(message.chart));
      else finish(() => reject(new Error(message.message)));
    };
    worker.onerror = () => finish(() => reject(new Error('编谱线程启动失败，请重新生成或刷新页面。')));
    try { worker.postMessage({ analysis, difficulty, bpmOverride } satisfies ChartRequest); }
    catch { finish(() => reject(new Error('编谱数据传递失败，请重新生成。'))); }
  });
  return { promise, cancel: () => cancel() };
}
