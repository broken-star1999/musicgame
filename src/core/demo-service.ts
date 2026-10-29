import { audioContext } from './audio-context';
import { DEMO_FRAMES, DEMO_SAMPLE_RATE } from './demo-synthesis';
import type { AudioWorkOptions } from './audio-work';
import type { DemoRequest, DemoResponse } from './demo.worker';

export const DEMO_TIMEOUT_MS = 30000;
const cancelled = () => new DOMException('Demo synthesis cancelled', 'AbortError');

/** The page only allocates and copies the completed PCM. Synthesis never falls
 * back to the main thread when a worker fails, times out, or is cancelled. */
export function createDemoAsync(options: AudioWorkOptions = {}): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const { signal, progress } = options;
    if (signal?.aborted) { reject(cancelled()); return; }
    let worker: Worker;
    try { worker = new Worker(new URL('./demo.worker.ts', import.meta.url), { type: 'module' }); }
    catch { reject(new Error('演示曲线程启动失败，请刷新页面或导入本地音频。')); return; }
    let finished = false, timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (action: () => void) => {
      if (finished) return;
      finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
      worker.terminate(); action();
    };
    const fail = (message: string) => finish(() => reject(new Error(message)));
    const abort = () => finish(() => reject(cancelled()));
    worker.onmessage = (event: MessageEvent<DemoResponse>) => {
      if (finished) return;
      try {
        const message = event.data;
        if (message.type === 'progress') {
          if (!Number.isFinite(message.value)) { fail('演示曲合成进度无效，请重试。'); return; }
          progress?.(Math.max(0, Math.min(1, message.value)), message.stage);
        } else if (message.type === 'done') {
          if (!(message.samples instanceof Float32Array) || message.samples.length !== DEMO_FRAMES || message.sampleRate !== DEMO_SAMPLE_RATE) {
            fail('演示曲音频数据无效，请重试或导入本地音频。'); return;
          }
          finish(() => {
            try {
              const buffer = audioContext().createBuffer(1, DEMO_FRAMES, DEMO_SAMPLE_RATE);
              buffer.getChannelData(0).set(message.samples);
              resolve(buffer);
            } catch { reject(new Error('演示曲声音准备失败，请重试或导入本地音频。')); }
          });
        } else if (message.type === 'error') fail('演示曲合成失败，请重试或导入本地音频。');
        else fail('演示曲合成响应无效，请重试。');
      } catch { fail('演示曲数据处理失败，请重试或导入本地音频。'); }
    };
    worker.onerror = event => { event.preventDefault(); fail('演示曲合成线程异常，请重试或导入本地音频。'); };
    worker.onmessageerror = () => fail('演示曲数据传递失败，请重试或导入本地音频。');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    timer = setTimeout(() => fail('演示曲合成超过 30 秒，请重试或导入本地音频。'), DEMO_TIMEOUT_MS);
    try {
      progress?.(0, '正在合成演示曲');
      if (!finished) worker.postMessage({ type: 'synthesize' } satisfies DemoRequest);
    } catch { fail('演示曲合成请求失败，请重试或导入本地音频。'); }
  });
}
