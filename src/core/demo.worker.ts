import { DEMO_FRAMES, DEMO_SAMPLE_RATE, synthesizeDemo } from './demo-synthesis';

export type DemoRequest = { type: 'synthesize' };
export type DemoResponse = { type: 'progress'; value: number; stage: string }
  | { type: 'done'; sampleRate: number; samples: Float32Array }
  | { type: 'error'; message: string };

const worker = self as unknown as {
  onmessage: (event: MessageEvent<DemoRequest>) => void;
  postMessage(message: DemoResponse, transfer?: Transferable[]): void;
};

worker.onmessage = event => {
  try {
    if (event.data?.type !== 'synthesize') throw new Error('演示曲合成请求无效。');
    const samples = new Float32Array(DEMO_FRAMES);
    synthesizeDemo(samples, (value, stage) => worker.postMessage({ type: 'progress', value, stage }));
    worker.postMessage({ type: 'done', sampleRate: DEMO_SAMPLE_RATE, samples }, [samples.buffer as ArrayBuffer]);
  } catch {
    worker.postMessage({ type: 'error', message: '演示曲合成失败，请重试或导入本地音频。' });
  }
};
